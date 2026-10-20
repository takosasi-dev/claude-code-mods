import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModHubCommand, ModHubSort } from '../types'
import { byCategory, clean, headerSvg, launchers, noteMod } from './hub'
import type { Launcher } from './hub'

const PANE = 'mod-hub'
const TITLE = 'mod'

const MODS = atom({ plugin: 'mod-hub', key: 'mods' } as const, [])
const COMMANDS = atom({ plugin: 'mod-hub', key: 'commands' } as const, [])
const NOTICE = atom({ plugin: 'mod-hub', key: 'notice' } as const, '')
const SORT = atom({ plugin: 'mod-hub', key: 'sort' } as const, 'category' as ModHubSort)

// 並べ方を切り替え、次のセッションにも残す(残せなくてもこのセッションでは効く)
async function toggleSort($: EngineInterface) {
  let next: ModHubSort = 'category'
  await update($, SORT, s => (next = s === 'category' ? 'name' : 'category'))
  await $.store.set('sort', next).catch(() => {})
}

async function loadCommands($: EngineInterface) {
  const list = await $.command.list()
  const mine: ModHubCommand[] = list
    .filter(c => c.source === 'plugin' && c.plugin !== undefined)
    .map(c => ({ name: c.name, description: clean(c.description), plugin: c.plugin ?? '' }))
  await update($, COMMANDS, () => mine)
}

async function runCommand($: EngineInterface, command: string) {
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
    const saved = await $.store.get('sort').catch(() => undefined)
    if (saved === 'category' || saved === 'name') await update($, SORT, () => saved)
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

    const list = launchers(await read($, MODS), await read($, COMMANDS))
    const notice = await read($, NOTICE)
    const sort = await read($, SORT)

    const card = (l: Launcher) => (
      <Box key={`card:${l.name}`} flexDirection="column">
        <Text bold>{l.version === '' ? l.name : `${l.name} v${l.version}`}</Text>
        {l.commands.map(c => (
          <Button key={`run:${l.name}:${c.name}`} onPress={() => void runCommand($, c.name)}>
            {`/${c.name}`} <Text dimColor>{short(c.description, 22)}</Text>
          </Button>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={headerSvg(list.length)} alt={`画面のある mod ${list.length} 本`} />
        ) : (
          <Text bold>{`画面のある mod ${list.length} 本`}</Text>
        )}
        {notice !== '' && <Text color="#d29922">{notice}</Text>}
        {list.length === 0 && <Text dimColor>開ける mod が見つかりません(mod-hub より後に読み込まれる mod だけが並びます)</Text>}
        {list.length > 0 && (
          <Button key="sort" onPress={() => void toggleSort($)}>
            <Text>{sort === 'category' ? '並び: カテゴリー別' : '並び: 名前順'}</Text> <Text dimColor>押して切り替え</Text>
          </Button>
        )}
        {sort === 'name'
          ? list.map(card)
          : byCategory(list).map(g => (
              <Box key={`group:${g.category}`} flexDirection="column" gap={1}>
                <Text bold color="#58a6ff">{`${g.category} (${g.items.length})`}</Text>
                {g.items.map(card)}
              </Box>
            ))}
      </Box>
    )
  })
}
