import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CheckReport } from '../types'
import { buildRows, countLine, countRows, envLine, kindTheme, reportText, rowLine, rowsSvg, SELF, summarySvg } from './check'
import { probeStates } from './probe'
import { clean, followTheme, readTheme } from './style'

type $ = EngineInterface

const PANE = 'mod-check'
const TITLE = 'mod の点検'
const DESCRIPTION = 'この mod 集の mod がちゃんと動いているかを 1 回で確かめる'

const REPORT = atom({ plugin: 'mod-check', key: 'report' } as const, null as CheckReport | null)
const SEEN = atom({ plugin: 'mod-check', key: 'seen' } as const, [])
const SURFACE = atom({ plugin: 'mod-check', key: 'surface' } as const, '')

/** 調べる。コマンドの一覧・state の読み・設定・版・自分のペインだけで、他の mod のコマンドは走らせない */
async function check($: $): Promise<CheckReport> {
  const [commands, states, config, version, panes, surfaces] = await Promise.all([
    $.command.list().catch(() => []),
    probeStates($),
    $.config.list().catch(() => []),
    $.session.version().catch(() => undefined),
    $.ui.panes().catch(() => []),
    $.session.surfaces().catch(() => []),
  ])
  const theme = config.find(r => r.key === 'theme')?.value
  const report: CheckReport = {
    at: await $.clock.now(),
    env: {
      surface: surfaces.length > 0 ? surfaces.join(' ') : await read($, SURFACE),
      theme: typeof theme === 'string' ? clean(theme) : '',
      engine: clean(version?.version ?? ''),
      panes: panes.map(p => clean(p.id)),
    },
    // 自分は動いているので、自分の state は書かれている扱い
    rows: buildRows(commands, { ...states, [SELF]: true }, await read($, SEEN)),
  }
  await update($, REPORT, () => report)
  return report
}

// /mod-check を自分で取れたか (取れなければ /modcheck にして、/mod-check は横取りしない)
let ownsMain = false

const openPane = async ($: $) => {
  const report = await check($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: reportText(report) }
}

export const register: Register = on => {
  followTheme(on)

  // 自分より後に読み込まれる mod の版と、拒まれたかを覚える(止めはしない)
  on('plugin.register', async ($, e, next) => {
    const result = await next(e)
    const row = { name: clean(e.name), version: clean(e.version ?? ''), refused: result.refuse === undefined ? '' : clean(result.refuse) }
    await update($, SEEN, list => [...list.filter(s => s.name !== row.name), row]).catch(() => {})
    return result
  })

  on('session.start', async ($, e, next) => {
    const got = await $.command.register({ name: 'mod-check', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'mod-check'
    if (!ownsMain) await $.command.register({ name: 'modcheck', description: DESCRIPTION }).catch(() => {})
    if (e.surface) await update($, SURFACE, () => e.surface ?? '').catch(() => {})
    await readTheme($)
    return next(e)
  })

  on('command.run', { command: 'mod-check' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'modcheck' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const report = await read($, REPORT)

    const again = (
      <Button key="again" onPress={() => void check($).catch(() => {})}>
        <Text>調べ直す</Text>
      </Button>
    )
    if (report === null) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>mod の点検</Text>
          <Text dimColor>まだ調べていません</Text>
          {again}
        </Box>
      )
    }
    // 画面の種類は今描いている物がいちばん確か
    const live = { ...report, env: { ...report.env, surface: e.surface } }
    const counts = countRows(report.rows)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg key="summary" source={summarySvg(live)} alt={countLine(counts)} />
        ) : (
          <Box key="summary" flexDirection="column">
            <Text bold>mod の点検</Text>
            <Text>{countLine(counts)}</Text>
            <Text dimColor>{envLine(live.env)}</Text>
          </Box>
        )}
        {again}
        <Text dimColor>{`/${ownsMain ? 'mod-check' : 'modcheck'} の返事に同じ結果が文で出ています。そのままコピーして貼ってください`}</Text>
        {Svg ? (
          <Svg key="rows" source={rowsSvg(report.rows)} alt={`mod ごとの結果 ${report.rows.length} 本`} />
        ) : (
          <Box key="rows" flexDirection="column">
            {report.rows.map(r => (
              <Text key={`row:${r.name}`} color={kindTheme(r.kind)}>
                {rowLine(r)}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
