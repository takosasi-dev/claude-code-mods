import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModHubCommand, ModHubMod, ModHubSort } from '../types'
import { REFUSE, SELF, STATUS, arrange, buildRows, disableCommand, headerSvg, kindInfo, sourceLabel, stats } from './hub'
import type { Row } from './hub'

const PANE = 'mod-hub'
const TITLE = 'mod'
const STORE_OFF = 'off'

const MODS = atom({ plugin: 'mod-hub', key: 'mods' } as const, [])
const COMMANDS = atom({ plugin: 'mod-hub', key: 'commands' } as const, [])
const OFF = atom({ plugin: 'mod-hub', key: 'off' } as const, [])
const FILTER = atom({ plugin: 'mod-hub', key: 'filter' } as const, '')
const SORT = atom({ plugin: 'mod-hub', key: 'sort' } as const, 'name')
const BUILTIN = atom({ plugin: 'mod-hub', key: 'showBuiltin' } as const, false)
const NOTICE = atom({ plugin: 'mod-hub', key: 'notice' } as const, '')

const SORTS: { value: ModHubSort; label: string }[] = [
  { value: 'name', label: '名前順' },
  { value: 'kind', label: '種類順' },
]

// store の 'off' を文字列の配列として読む (壊れていれば空)
async function readOff($: EngineInterface): Promise<string[]> {
  try {
    const v = await $.store.get(STORE_OFF)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

async function loadCommands($: EngineInterface) {
  const list = await $.command.list()
  const mine: ModHubCommand[] = list
    .filter(c => c.source === 'plugin' && c.plugin !== undefined)
    .map(c => ({ name: c.name, description: c.description, plugin: c.plugin ?? '' }))
  await update($, COMMANDS, () => mine)
}

async function toggle($: EngineInterface, name: string) {
  if (name === SELF) return
  const cur = await readOff($)
  const isOff = cur.includes(name)
  const next = isOff ? cur.filter(n => n !== name) : [...cur, name]
  await $.store.set(STORE_OFF, next)
  await update($, OFF, () => next)
  await update($, NOTICE, () => (isOff ? `${name} は次の起動からオンに戻ります` : `${name} は次の起動からオフになります`))
}

async function runCommand($: EngineInterface, command: string) {
  await update($, NOTICE, () => `/${command} を送りました(セッションが空いたら走ります)`)
  try {
    await $.command.run({ command })
  } catch {
    await update($, NOTICE, () => `/${command} を送れませんでした`)
  }
}

// /mod (取れなければ /mod-hub) の答え
async function openPane($: EngineInterface) {
  await loadCommands($).catch(() => {})
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'mod の一覧を開きました。' }
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const register: Register = on => {
  // 自分より後に読み込まれる mod を 1 本ずつ見る。オフの物だけ拒む
  on('plugin.register', async ($, e, next) => {
    const off = await readOff($)
    const isOff = e.name !== SELF && off.includes(e.name)
    try {
      const mod: ModHubMod = {
        name: e.name,
        version: e.version ?? '',
        provenance: e.provenance,
        tier: e.tier,
        events: [...e.uses.events],
        calls: [...e.uses.calls],
        isRefused: isOff,
      }
      await update($, MODS, list => [...list.filter(m => m.name !== e.name), mod])
      await update($, OFF, () => off)
    } catch {
      // 記録に失敗しても判定は変えない
    }
    return isOff ? { refuse: REFUSE } : next(e)
  })

  on('session.start', async ($, e, next) => {
    // /mod が拒まれたら (組み込みと被ったら) /mod-hub にする
    const description = '入っている mod の一覧・起動・オン/オフを開く'
    const got = await $.command.register({ name: 'mod', description }).catch(() => undefined)
    if (got?.command !== 'mod') await $.command.register({ name: 'mod-hub', description }).catch(() => {})
    const off = await readOff($)
    await update($, OFF, () => off)
    await loadCommands($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'mod' }, openPane)
  on('command.run', { command: 'mod-hub' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Code } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined

    const off = await read($, OFF)
    const showBuiltin = await read($, BUILTIN)
    const sort = await read($, SORT)
    const filter = await read($, FILTER)
    const notice = await read($, NOTICE)
    const all = buildRows(await read($, MODS), await read($, COMMANDS), off).filter(r => showBuiltin || !r.isBuiltin)
    const s = stats(all)
    const shown = arrange(all, sort, filter)

    const card = (r: Row) => {
      const kind = kindInfo(r.kind)
      const st = STATUS[r.status]
      const isOffSet = r.status === 'off' || r.status === 'off-next'
      return (
        <Box key={`card:${r.name}`} flexDirection="column" borderStyle="round" borderColor={kind.color} paddingX={1}>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text bold>{r.name}</Text>
            {r.version !== '' && <Text dimColor>{`v${r.version}`}</Text>}
            <Text color={st.color}>{`● ${st.label}`}</Text>
          </Box>
          {r.status === 'early' ? (
            <Text dimColor>読み込み順が先のため詳細不明</Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Text color={kind.color}>{`■ ${kind.label}`}</Text>
              {r.provenance !== '' && <Text dimColor>{sourceLabel(r.provenance)}</Text>}
            </Box>
          )}
          {r.uses.length > 0 && (
            <Text dimColor>{`フック: ${r.uses.slice(0, 4).join('・')}${r.uses.length > 4 ? ` ほか${r.uses.length - 4}` : ''}`}</Text>
          )}
          {r.commands.map(c => (
            <Button key={`run:${r.name}:${c.name}`} onPress={() => void runCommand($, c.name)}>
              {`/${c.name}`} <Text dimColor>{short(c.description, 22)}</Text>
            </Button>
          ))}
          {r.status === 'self' ? (
            <Text dimColor>mod-hub 自身はオフにできません</Text>
          ) : r.status === 'early' ? (
            <Box flexDirection="column">
              <Text dimColor>
                この mod は mod-hub より先に読み込まれるため、ここではオフにできません。下のコマンドか、フォルダ指定の場合は CLAUDE_CODE_PLUGIN_DIRS から外してください
              </Text>
              <Code source={disableCommand(r)} language="sh" />
            </Box>
          ) : (
            <Button key={`toggle:${r.name}`} label={isOffSet ? 'オンにする' : 'オフにする'} variant={isOffSet ? 'primary' : 'secondary'} onPress={() => void toggle($, r.name)} />
          )}
        </Box>
      )
    }

    const kindLine = s.byKind.map(k => `${kindInfo(k.kind).label} ${k.count}`).join('・')

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={headerSvg(s)} alt={`読み込み中の mod ${s.loaded} 本、オフ ${s.off} 本、コマンド ${s.commands} 個。${kindLine}`} />
        ) : (
          <Box key="summary" flexDirection="column">
            <Text bold>{`読み込み中 ${s.loaded} 本 / オフ ${s.off} 本 / コマンド ${s.commands} 個`}</Text>
            {kindLine !== '' && <Text dimColor>{`種類: ${kindLine}`}</Text>}
          </Box>
        )}
        {'Select' in t && 'Input' in t && (
          <Box flexDirection="column">
            <t.Input
              key="filter"
              placeholder="名前・種類で絞り込み"
              value={filter}
              submitLabel="絞り込む"
              onInput={v => void update($, FILTER, () => v)}
              onSubmit={v => void update($, FILTER, () => v)}
            />
            <t.Select key="sort" options={SORTS} value={sort} onSelect={v => void update($, SORT, () => (v === 'kind' ? 'kind' : 'name'))} />
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="builtin" label={showBuiltin ? '組み込みを隠す' : '組み込みも表示'} onPress={() => void update($, BUILTIN, v => !v)} />
          <Button key="refresh" label="再読込" onPress={() => void loadCommands($)} />
        </Box>
        {notice !== '' && <Text color="#d29922">{notice}</Text>}
        {shown.length === 0 && <Text dimColor>該当する mod がありません</Text>}
        {shown.map(card)}
        <Text dimColor>オフは mod-hub より後に読み込まれる mod にだけ効きます(次の起動から)</Text>
      </Box>
    )
  })
}
