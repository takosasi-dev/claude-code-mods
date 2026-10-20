import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModHubCommand } from '../types'
import { headerSvg, isGui, launchers } from './hub'

const PANE = 'mod-hub'
const TITLE = 'mod'

const MODS = atom({ plugin: 'mod-hub', key: 'mods' } as const, [])
const COMMANDS = atom({ plugin: 'mod-hub', key: 'commands' } as const, [])
const NOTICE = atom({ plugin: 'mod-hub', key: 'notice' } as const, '')

async function loadCommands($: EngineInterface) {
  const list = await $.command.list()
  const mine: ModHubCommand[] = list
    .filter(c => c.source === 'plugin' && c.plugin !== undefined)
    .map(c => ({ name: c.name, description: c.description, plugin: c.plugin ?? '' }))
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

export const register: Register = on => {
  // 自分より後に読み込まれる mod を 1 本ずつ見て、画面を持つかを覚える (止めはしない)
  on('plugin.register', async ($, e, next) => {
    const mod = { name: e.name, version: e.version ?? '', isGui: isGui(e.uses.events, e.uses.calls) }
    await update($, MODS, list => [...list.filter(m => m.name !== e.name), mod]).catch(() => {})
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    // /mod が拒まれたら (組み込みと被ったら) /mod-hub にする
    const description = '画面のある mod を開くボタンを並べる'
    const got = await $.command.register({ name: 'mod', description }).catch(() => undefined)
    if (got?.command !== 'mod') await $.command.register({ name: 'mod-hub', description }).catch(() => {})
    await loadCommands($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'mod' }, openPane)
  on('command.run', { command: 'mod-hub' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined

    const list = launchers(await read($, MODS), await read($, COMMANDS))
    const notice = await read($, NOTICE)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={headerSvg(list.length)} alt={`画面のある mod ${list.length} 本`} />
        ) : (
          <Text bold>{`画面のある mod ${list.length} 本`}</Text>
        )}
        {notice !== '' && <Text color="#d29922">{notice}</Text>}
        {list.length === 0 && <Text dimColor>開ける mod が見つかりません(mod-hub より後に読み込まれる mod だけが並びます)</Text>}
        {list.map(l => (
          <Box key={`card:${l.name}`} flexDirection="column">
            <Text bold>{l.version === '' ? l.name : `${l.name} v${l.version}`}</Text>
            {l.commands.map(c => (
              <Button key={`run:${l.name}:${c.name}`} onPress={() => void runCommand($, c.name)}>
                {`/${c.name}`} <Text dimColor>{short(c.description, 22)}</Text>
              </Button>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
