import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { InboxItem } from '../types'
import { KEEP, asItems, asReadAt, commandsByMod, countByMod, inboxSvg, merge, modLabel, toItem, unreadCount, when } from './inbox'
import { followTheme, mayWrite, readTheme, rememberVersion } from './style'

type $ = EngineInterface

const PANE = 'toast-inbox'
const TITLE = '通知の受け箱'
const DESCRIPTION = 'ほかの mod が出したトーストとステータス行を見返す'
/** 溜めてから store に書くまでの待ち */
const FLUSH_MS = 1000
const ALL = '*'

const ITEMS = atom({ plugin: 'toast-inbox', key: 'items' } as const, [] as InboxItem[])
const READ_AT = atom({ plugin: 'toast-inbox', key: 'readAt' } as const, 0)
const FILTER = atom({ plugin: 'toast-inbox', key: 'filter' } as const, '')
const CONFIRM = atom({ plugin: 'toast-inbox', key: 'confirmClear' } as const, false)
const COMMANDS = atom({ plugin: 'toast-inbox', key: 'commands' } as const, {} as Record<string, string>)
const NOTICE = atom({ plugin: 'toast-inbox', key: 'notice' } as const, '')

// /inbox を自分で取れたか (取れなければ /toast-inbox にして、/inbox は横取りしない)
let ownsMain = false

// まだ store に書いていない通知。1 ターンで大量に来ても、1 秒ごとに 1 回まとめて書く
let pending: InboxItem[] = []
let isScheduled = false
// mod ごとの直前のステータス行 (同じ文の連続は 1 件にまとめる。消されたら忘れる)
const lastStatus = new Map<string, string>()

// store への書き込みは 1 本ずつ
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(f: () => Promise<T>) => {
  const p = chain.then(f, f)
  chain = p.catch(() => {})
  return p
}

const BROKEN = '通知の記録を読めなかったので、保存していません(上書きしないよう止めています)'
const STALE = '新しい版が入ったので保存していません。VS Code を開き直してください'
const SET_FAILED = '通知を保存できませんでした。次の通知の時にもう一度書きます'
const STORE_NOTES = [BROKEN, STALE, SET_FAILED]

/** store の値を読む。キーが無ければ空 (readAt は 0)。読めない時 (例外・形が違う) は undefined */
async function readKey<T>($: $, key: string, as: (v: unknown) => T | undefined, empty: T): Promise<T | undefined> {
  try {
    const raw = await $.store.get(key)
    return raw === undefined ? empty : as(raw)
  } catch {
    return undefined
  }
}

// 書く直前に読み直し、溜めた分だけを足す (他のセッションが足した分を消さない)。
// 読めない・古い版のまま・書けない時は書かずに、溜めた分を戻して次の通知の時にもう一度
const flush = ($: $) =>
  serial(async () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    const putBack = async (text: string) => {
      pending = merge(batch, pending)
      await update($, NOTICE, () => text)
    }
    const saved = await readKey($, 'items', asItems, [])
    if (!saved) return putBack(BROKEN)
    if (!(await mayWrite($, await $.clock.now()))) return putBack(STALE)
    const next = merge(saved, batch)
    if (!(await $.store.set('items', next).then(() => true, () => false))) return putBack(SET_FAILED)
    await update($, ITEMS, () => next)
    await update($, NOTICE, n => (STORE_NOTES.includes(n) ? '' : n))
  })

async function note($: $, plugin: string, text: string | undefined, kind: InboxItem['kind']) {
  const item = toItem(plugin, text, await $.clock.now(), kind)
  if (!item) return
  pending = merge(pending, [item])
  if (isScheduled) return
  isScheduled = true
  $.clock.after(FLUSH_MS, () => {
    isScheduled = false
    void flush($).catch(() => {})
  })
}

async function markRead($: $) {
  await update($, CONFIRM, () => false)
  const now = await $.clock.now()
  await serial(async () => {
    const saved = await readKey($, 'readAt', asReadAt, 0)
    // 読めない・古い版のまま動いている時は、このセッションの中だけ既読にする
    if (saved === undefined) {
      await update($, READ_AT, r => Math.max(r, now))
      return void (await update($, NOTICE, () => BROKEN))
    }
    const next = Math.max(saved, now)
    await update($, READ_AT, () => next)
    if (!(await mayWrite($, now))) return void (await update($, NOTICE, () => STALE))
    await $.store.set('readAt', next).catch(() => update($, NOTICE, () => '既読を保存できませんでした'))
  })
}

// 1 回目は確かめ、2 回目で空にする (他のセッションの分も消える)
async function pressClear($: $) {
  if (!(await read($, CONFIRM))) {
    await update($, CONFIRM, () => true)
    return
  }
  await update($, CONFIRM, () => false)
  await serial(async () => {
    if (!(await mayWrite($, await $.clock.now()))) return void (await update($, NOTICE, () => STALE))
    pending = []
    await update($, ITEMS, () => [])
    await update($, FILTER, () => '')
    await $.store.set('items', []).catch(() => {})
  })
}

// どの mod がどのコマンドか。起動直後はまだ登録していない mod があるので、ペインを開くたびに引き直す
async function loadCommands($: $) {
  const map = commandsByMod(await $.command.list())
  await update($, COMMANDS, () => map)
}

// 行を押した時。送るだけで、開くのはセッションが空いた時(mod-hub と同じ)
async function openMod($: $, command: string) {
  await update($, NOTICE, () => `/${command} を送りました(セッションが空いたら開きます)`)
  try {
    await $.command.run({ command })
  } catch {
    await update($, NOTICE, () => `/${command} を送れませんでした`)
  }
}

const openPane = async ($: $) => {
  // 保存できていない知らせは残す (開き直しても消えない)
  await update($, NOTICE, n => (STORE_NOTES.includes(n) ? n : ''))
  await loadCommands($).catch(() => {})
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '通知の受け箱を開きました。' }
}

export const register: Register = (on, options) => {
  // ステータス行も残すか (既定はオフ。live-commentary のように 1 ターンに何十回も出す mod で埋まるので、トーストだけ残す)
  const keepStatus = options.keepStatus === true
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await rememberVersion($).catch(() => {})
    const got = await $.command.register({ name: 'inbox', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'inbox'
    if (!ownsMain) await $.command.register({ name: 'toast-inbox', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    const items = await readKey($, 'items', asItems, [])
    if (items) await update($, ITEMS, () => items.slice(-KEEP))
    else await update($, NOTICE, () => BROKEN)
    const readAt = asReadAt(await $.store.get('readAt').catch(() => undefined))
    if (readAt !== undefined) await update($, READ_AT, () => readAt)
    await loadCommands($).catch(() => {})
    return started
  })

  // 閉じる前に溜めた分を書く
  on('session.end', async ($, e, next) => {
    await flush($).catch(() => {})
    return next(e)
  })

  // 見るだけ。呼び出し元 (next.origin) を記録し、トーストはそのまま通す (記録を待たせない)
  on('ui.toast', ($, e, next) => {
    const shown = next(e)
    void note($, next.origin.plugin, e.text, 'toast').catch(() => {})
    return shown
  }).catch(($, e, next) => next(e))

  on('ui.status', ($, e, next) => {
    const shown = next(e)
    if (!keepStatus) return shown
    const name = next.origin.plugin
    if (e.text === undefined) lastStatus.delete(name)
    else if (lastStatus.get(name) !== e.text) {
      lastStatus.set(name, e.text)
      void note($, name, e.text, 'status').catch(() => {})
    }
    return shown
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'inbox' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  // /inbox を持てた時は /toast-inbox を登録していないので、その名前の持ち主に回す
  on('command.run', { command: 'toast-inbox' }, ($, e, next) => (ownsMain ? next(e) : openPane($))).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const now = await $.clock.now()
    const items = await read($, ITEMS)
    const readAt = await read($, READ_AT)
    const filter = await read($, FILTER)
    const confirm = await read($, CONFIRM)
    const commands = await read($, COMMANDS)
    const notice = await read($, NOTICE)
    const unread = unreadCount(items, readAt)
    const mods = countByMod(items)
    const isKnown = filter === '' || mods.some(m => m.name === filter)
    const shown = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !isKnown || filter === '' || item.plugin === filter)
      .reverse()
    const line = `未読 ${unread} 件 / 全 ${items.length} 件`

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={inboxSvg(items, readAt)} alt={`通知の受け箱 ${line}`} />
        ) : (
          <Box flexDirection="column">
            <Text bold>{`通知の受け箱 ${line}`}</Text>
            {mods.map(m => (
              <Text key={`count:${m.name}`} dimColor>{`${modLabel(m.name)} ${m.count} 件`}</Text>
            ))}
          </Box>
        )}
        {items.length > 0 && 'Select' in t && (
          <t.Select
            key="filter"
            label="mod で絞る"
            value={isKnown && filter !== '' ? filter : ALL}
            options={[{ value: ALL, label: `すべて (${items.length})` }, ...mods.map(m => ({ value: m.name, label: `${modLabel(m.name)} (${m.count})` }))]}
            onSelect={v => update($, FILTER, () => (v === ALL ? '' : v))}
          />
        )}
        {items.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key="mark-read" dimColor={unread === 0} label="全部既読にする" variant={unread > 0 ? 'primary' : undefined} onPress={() => markRead($)} />
            <Button key="clear" dimColor={!confirm} label={confirm ? 'もう一度押すと空にします' : '空にする'} onPress={() => pressClear($)} />
          </Box>
        )}
        {items.length === 0 && <Text dimColor>{`まだ通知はありません。ほかの mod が${keepStatus ? 'トーストやステータス行' : 'トースト'}を出すと、ここに残ります`}</Text>}
        {notice !== '' && (
          <Text key="notice" dimColor>
            {notice}
          </Text>
        )}
        {shown.map(({ item, index }) => {
          const isUnread = item.at > readAt
          const lead = `${isUnread ? '未読 ' : ''}${when(item.at, now)} ${modLabel(item.plugin)}`
          const tail = item.kind === 'status' ? ' (ステータス)' : ''
          // 出した mod のコマンドが分かる行だけ押せる。本体と、今は入っていない mod の行は文字のまま
          const command = Object.hasOwn(commands, item.plugin) ? commands[item.plugin] : undefined
          return (
            <Box key={`item:${index}:${item.at}`} flexDirection="column">
              {command === undefined ? (
                <Text key={`head:${index}`} color={isUnread ? 'warning' : undefined} dimColor={!isUnread}>
                  {`${lead}${tail}`}
                </Text>
              ) : (
                <Button key={`open:${index}`} label={`${lead} を開く${tail}`} onPress={() => openMod($, command)} />
              )}
              <Text>{item.text}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
