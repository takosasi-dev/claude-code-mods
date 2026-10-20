import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModHubCommand, ModHubRecent, ModHubSort } from '../types'
import { applyFilter, asPins, asRecent, byCategory, clean, headerSvg, launchers, noteMod, pushRecent, sortRecent, splitPins } from './hub'
import type { Launcher } from './hub'
import { bandSvg, categoryColor, modIcon } from './icons'
import { C, followTheme, readTheme } from './style'

const PANE = 'mod-hub'
const TITLE = 'mod'

const MODS = atom({ plugin: 'mod-hub', key: 'mods' } as const, [])
const COMMANDS = atom({ plugin: 'mod-hub', key: 'commands' } as const, [])
const NOTICE = atom({ plugin: 'mod-hub', key: 'notice' } as const, '')
const SORT = atom({ plugin: 'mod-hub', key: 'sort' } as const, 'category' as ModHubSort)
const FILTER = atom({ plugin: 'mod-hub', key: 'filter' } as const, '')
const PINS = atom({ plugin: 'mod-hub', key: 'pins' } as const, [] as string[])
const RECENT = atom({ plugin: 'mod-hub', key: 'recent' } as const, [] as ModHubRecent[])

const SORTS: ModHubSort[] = ['category', 'name', 'recent']
const SORT_LABEL: Record<ModHubSort, string> = { category: '並び: カテゴリー別', name: '並び: 名前順', recent: '並び: 最近開いた順' }

// 並べ方を順に回し、次のセッションにも残す(残せなくてもこのセッションでは効く)
async function toggleSort($: EngineInterface) {
  let next: ModHubSort = 'category'
  await update($, SORT, s => (next = SORTS[(SORTS.indexOf(s) + 1) % SORTS.length] ?? 'category'))
  await $.store.set('sort', next).catch(() => {})
}

// 固定する・外す。$.store は他のセッションと共有なので、書く直前に読み直して 1 本だけ足す・抜く
async function setPin($: EngineInterface, name: string, on: boolean) {
  const saved = asPins(await $.store.get('pins').catch(() => undefined)) ?? (await read($, PINS))
  const next = on ? [...saved.filter(n => n !== name), name] : saved.filter(n => n !== name)
  await update($, PINS, () => next)
  await $.store.set('pins', next).catch(() => {})
}

// 開いた記録を残す(同じく書く直前に読み直す)
async function noteRecent($: EngineInterface, name: string) {
  const at = await $.clock.now()
  const saved = asRecent(await $.store.get('recent').catch(() => undefined)) ?? (await read($, RECENT))
  const next = pushRecent(saved, name, at)
  await update($, RECENT, () => next)
  await $.store.set('recent', next).catch(() => {})
}

async function loadCommands($: EngineInterface) {
  const list = await $.command.list()
  const mine: ModHubCommand[] = list
    .filter(c => c.source === 'plugin' && c.plugin !== undefined)
    .map(c => ({ name: c.name, description: clean(c.description), plugin: c.plugin ?? '' }))
  await update($, COMMANDS, () => mine)
}

async function runCommand($: EngineInterface, mod: string, command: string) {
  await noteRecent($, mod).catch(() => {})
  await update($, NOTICE, () => `/${command} を送りました(セッションが空いたら開きます)`)
  try {
    await $.command.run({ command })
  } catch {
    await update($, NOTICE, () => `/${command} を送れませんでした`)
  }
}

// /mod (取れなければ /mod-hub) の答え。起動直後はまだ無いコマンドがあるので開くたびに取り直す
async function openPane($: EngineInterface) {
  await loadCommands($).catch(() => {})
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'mod の一覧を開きました。' }
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// /mod を持てたか。session.start で決まる(リロードでも session.start が来るのでモジュール変数で足りる)
let ownsMain = false

export const register: Register = on => {
  followTheme(on)

  // 自分より後に読み込まれる mod を 1 本ずつ見て、画面を持つかを覚える (止めはしない)
  // 後ろの mod に拒まれた mod は並べない(next(e) の結果が allow の時だけ記録)
  on('plugin.register', async ($, e, next) => {
    const result = await next(e)
    const mod = noteMod(e, result)
    await update($, MODS, list => [...list.filter(m => m.name !== e.name), ...(mod ? [mod] : [])]).catch(() => {})
    return result
  })

  on('session.start', async ($, e, next) => {
    // /mod が拒まれたら (組み込みと被ったら) /mod-hub にする
    const description = '画面のある mod を開くボタンを並べる'
    const got = await $.command.register({ name: 'mod', description }).catch(() => undefined)
    ownsMain = got?.command === 'mod'
    if (!ownsMain) await $.command.register({ name: 'mod-hub', description }).catch(() => {})
    await loadCommands($).catch(() => {})
    await readTheme($)
    const saved = await $.store.get('sort').catch(() => undefined)
    if (SORTS.includes(saved as ModHubSort)) await update($, SORT, () => saved as ModHubSort)
    const pins = asPins(await $.store.get('pins').catch(() => undefined))
    if (pins) await update($, PINS, () => pins)
    const recent = asRecent(await $.store.get('recent').catch(() => undefined))
    if (recent) await update($, RECENT, () => recent)
    return next(e)
  })

  // /mod を持てなかった時は元の /mod を横取りしない
  on('command.run', { command: 'mod' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'mod-hub' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const Input = 'Input' in t ? t.Input : undefined

    const all = launchers(await read($, MODS), await read($, COMMANDS))
    const notice = await read($, NOTICE)
    const sort = await read($, SORT)
    const pins = await read($, PINS)
    const filter = Input ? await read($, FILTER) : ''

    const shown = applyFilter(all, filter)
    const { pinned, rest } = splitPins(sort === 'recent' ? sortRecent(shown, await read($, RECENT)) : shown, pins)

    const card = (l: Launcher) => {
      const isPinned = pins.includes(l.name)
      return (
        <Box key={`card:${l.name}`} flexDirection="column">
          <Box key={`head:${l.name}`} flexDirection="row" gap={1} alignItems="center">
            {Svg && <Svg source={modIcon(l.name)} alt={`${l.name} のアイコン`} width={28} />}
            <Text bold>{l.name}</Text>
            {l.version !== '' && <Text dimColor>{`v${l.version}`}</Text>}
          </Box>
          {l.commands.map(c => (
            <Button key={`run:${l.name}:${c.name}`} onPress={() => void runCommand($, l.name, c.name)}>
              {`/${c.name}`} <Text dimColor>{short(c.description, 22)}</Text>
            </Button>
          ))}
          <Button key={`pin:${l.name}`} onPress={() => void setPin($, l.name, !isPinned)}>
            <Text dimColor>{isPinned ? '外す' : '固定'}</Text>
          </Button>
        </Box>
      )
    }

    // 色の帯の見出し (terminal は色付きの文字)
    const group = (label: Parameters<typeof categoryColor>[0], items: Launcher[]) => (
      <Box key={`group:${label}`} flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={bandSvg(label, items.length)} alt={`${label} ${items.length} 本`} />
        ) : (
          <Text bold color={categoryColor(label)}>{`${label} (${items.length})`}</Text>
        )}
        {items.map(card)}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={headerSvg(all.length)} alt={`画面のある mod ${all.length} 本`} />
        ) : (
          <Text bold>{`画面のある mod ${all.length} 本`}</Text>
        )}
        {notice !== '' && <Text color={C.yellow}>{notice}</Text>}
        {all.length === 0 && <Text dimColor>開ける mod が見つかりません(mod-hub より後に読み込まれる mod だけが並びます)</Text>}
        {all.length > 0 && Input && (
          <Input
            key="filter"
            placeholder="名前や説明で絞る"
            value={filter}
            submitLabel="絞る"
            onInput={v => void update($, FILTER, () => v)}
            onSubmit={v => void update($, FILTER, () => v)}
          />
        )}
        {all.length > 0 && (
          <Button key="sort" onPress={() => void toggleSort($)}>
            <Text>{SORT_LABEL[sort]}</Text> <Text dimColor>押して切り替え</Text>
          </Button>
        )}
        {all.length > 0 && shown.length === 0 && <Text dimColor>一致する mod がありません</Text>}
        {pinned.length > 0 && group('固定', pinned)}
        {sort === 'category' ? byCategory(rest).map(g => group(g.category, g.items)) : rest.map(card)}
      </Box>
    )
  })
}
