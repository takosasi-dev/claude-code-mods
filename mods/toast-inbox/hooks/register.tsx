import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { InboxItem } from '../types'
import { asItems, asReadAt, countByMod, inboxSvg, merge, modLabel, toItem, unreadCount, when } from './inbox'
import { followTheme, readTheme } from './style'

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

// 書く直前に読み直し、溜めた分だけを足す (他のセッションが足した分を消さない)
const flush = ($: $) =>
  serial(async () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    const saved = asItems(await $.store.get('items').catch(() => undefined)) ?? (await read($, ITEMS))
    const next = merge(saved, batch)
    await update($, ITEMS, () => next)
    await $.store.set('items', next).catch(() => {})
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
    const saved = asReadAt(await $.store.get('readAt').catch(() => undefined)) ?? 0
    const next = Math.max(saved, now)
    await update($, READ_AT, () => next)
    await $.store.set('readAt', next).catch(() => {})
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
    pending = []
    await update($, ITEMS, () => [])
    await update($, FILTER, () => '')
    await $.store.set('items', []).catch(() => {})
  })
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '通知の受け箱を開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const got = await $.command.register({ name: 'inbox', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'inbox'
    if (!ownsMain) await $.command.register({ name: 'toast-inbox', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    const items = asItems(await $.store.get('items').catch(() => undefined))
    if (items) await update($, ITEMS, () => items)
    const readAt = asReadAt(await $.store.get('readAt').catch(() => undefined))
    if (readAt !== undefined) await update($, READ_AT, () => readAt)
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
    const name = next.origin.plugin
    if (e.text === undefined) lastStatus.delete(name)
    else if (lastStatus.get(name) !== e.text) {
      lastStatus.set(name, e.text)
      void note($, name, e.text, 'status').catch(() => {})
    }
    return shown
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'inbox' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'toast-inbox' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const now = await $.clock.now()
    const items = await read($, ITEMS)
    const readAt = await read($, READ_AT)
    const filter = await read($, FILTER)
    const confirm = await read($, CONFIRM)
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
            <Button key="mark-read" label="全部既読にする" variant={unread > 0 ? 'primary' : undefined} onPress={() => markRead($)} />
            <Button key="clear" label={confirm ? 'もう一度押すと空にします' : '空にする'} onPress={() => pressClear($)} />
          </Box>
        )}
        {items.length === 0 && <Text dimColor>まだ通知はありません。ほかの mod がトーストやステータス行を出すと、ここに残ります</Text>}
        {shown.map(({ item, index }) => {
          const isUnread = item.at > readAt
          return (
            <Box key={`item:${index}:${item.at}`} flexDirection="column">
              <Text key={`head:${index}`} color={isUnread ? 'warning' : undefined} dimColor={!isUnread}>
                {`${isUnread ? '未読 ' : ''}${when(item.at, now)} ${modLabel(item.plugin)}${item.kind === 'status' ? ' (ステータス)' : ''}`}
              </Text>
              <Text>{item.text}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
