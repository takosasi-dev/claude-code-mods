import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CcDashCall, CcDashLayout, CcDashPanel, CcDashTab, CcDashUsage } from '../types'
import { knownOrder, layoutOf, move, objOf, PANEL_LABEL, reset, setShown, shownOf } from './layout'
import { clean, clock, dur, gaugesSvg, left, overviewSvg, shortTool, TOOL_COLORS, timelineSvg, toolBarsSvg, turnsSvg } from './svg'
import type { Gauge } from './svg'
import { followTheme, readTheme } from './style'

const PANE = 'cc-dash'
const TITLE = '計器盤'
const KEEP_CALLS = 200
const KEEP_TURNS = 20
const LAYOUT_KEY = 'layout'

const tabA = atom({ plugin: 'cc-dash', key: 'tab' } as const, 'overview' as CcDashTab)
const startedA = atom({ plugin: 'cc-dash', key: 'startedAt' } as const, 0)
const turnCountA = atom({ plugin: 'cc-dash', key: 'turnCount' } as const, 0)
const turnDurA = atom({ plugin: 'cc-dash', key: 'turnDurations' } as const, [] as number[])
const runningA = atom({ plugin: 'cc-dash', key: 'runningSince' } as const, null as number | null)
const callsA = atom({ plugin: 'cc-dash', key: 'calls' } as const, [] as CcDashCall[])
const countsA = atom({ plugin: 'cc-dash', key: 'toolCounts' } as const, {} as Record<string, number>)
const totalA = atom({ plugin: 'cc-dash', key: 'toolTotal' } as const, 0)
const errorsA = atom({ plugin: 'cc-dash', key: 'errorCount' } as const, 0)
const usageA = atom({ plugin: 'cc-dash', key: 'usage' } as const, null as CcDashUsage | string | null)
const layoutA = atom({ plugin: 'cc-dash', key: 'layout' } as const, layoutOf(undefined))
const arrangingA = atom({ plugin: 'cc-dash', key: 'isArranging' } as const, false)

const TABS: [CcDashTab, string][] = [
  ['overview', '概要'],
  ['tools', 'ツール'],
  ['usage', '使用量'],
  ['mine', '自分の並び'],
]

/** 各タブに出す枠 (自分の並びは store の順) */
const TAB_PANELS: Record<Exclude<CcDashTab, 'mine'>, CcDashPanel[]> = {
  overview: ['overview', 'turns'],
  tools: ['toolBars', 'timeline'],
  usage: ['usage'],
}

const UNSET = '使用量ファイルが未設定です。/config で cc-dash の usageFile に JSON の絶対パスを入れてください'

// 絶対パス(/x、\x、C:\x、C:/x)だけを受け付ける。相対パスは今のフォルダから読まれてしまう
const isAbsolute = (path: string) => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)

type $ = EngineInterface

/** 使用量ファイルを読む。読めなければ理由の文字列 */
const readUsage = async ($: $, file: string): Promise<CcDashUsage | string> => {
  let raw: string
  try {
    raw = await $.fs.read(file)
  } catch (err) {
    return clean(`使用量ファイルを読めません: ${file} (${err instanceof Error ? err.message : String(err)})`)
  }
  try {
    const u = JSON.parse(raw) as CcDashUsage | null
    if (!u || typeof u.sessionPct !== 'number' || typeof u.weeklyPct !== 'number') throw new Error('bad')
    return u
  } catch {
    return clean(`使用量ファイルを読めません: ${file} (中身の形が違います)`)
  }
}

/** 使用量を読んで $.state に置く。描画フックの外(30 秒タイマーと使用量を出した時)で呼ぶ */
async function refreshUsage($: $, file: string) {
  if (file === '') return
  const u = await readUsage($, file)
  await update($, usageA, () => u)
}

/** 今のタブに出ている枠 */
const panelsOf = async ($: $, tab: CcDashTab) => (tab === 'mine' ? shownOf(await read($, layoutA)) : TAB_PANELS[tab])

// 並びの書き込みは 1 本ずつ流す (ボタンを続けて押しても読み直しと書き込みが重ならない)
let chain: Promise<unknown> = Promise.resolve()
const serial = (f: () => Promise<void>) => {
  const p = chain.then(f, f)
  chain = p.catch(() => {})
  return p
}

/**
 * 並びを変える。書く直前に store を読み直し、その値に変更を当てて、知らない欄と知らない枠は残して書く。
 * 読めなければ書かずに画面だけ変える (別のセッションの並びを消さない)
 */
const changeLayout = ($: $, f: (l: CcDashLayout) => CcDashLayout) =>
  serial(async () => {
    let raw: unknown
    try {
      raw = await $.store.get(LAYOUT_KEY)
    } catch {
      await update($, layoutA, f)
      return
    }
    const next = f(layoutOf(raw))
    await update($, layoutA, () => next)
    await $.store.set(LAYOUT_KEY, { ...objOf(raw), ...next }).catch(() => {})
  })

const gaugesOf = (u: CcDashUsage, now: number): Gauge[] => [
  { label: '5時間枠', pct: u.sessionPct, left: left(u.sessionResetAt, now) },
  { label: '週', pct: u.weeklyPct, left: left(u.weeklyResetAt, now) },
  ...(typeof u.modelName === 'string' && typeof u.modelPct === 'number'
    ? [{ label: `${clean(u.modelName)} 週`, pct: u.modelPct, left: left(u.modelResetAt, now) }]
    : []),
]

const fetchedText = (u: CcDashUsage, now: number) =>
  typeof u.fetchedAt === 'number' ? `取得: ${Math.max(0, Math.floor((now - u.fetchedAt) / 60_000))}分前` : ''

export const register: Register = (on, options) => {
  const raw = String(options.usageFile ?? '').trim()
  // 絶対パスでなければ未設定と同じ扱い
  const file = isAbsolute(raw) ? raw : ''
  followTheme(on)

  on('session.start', async ($, e, next) => {
    await readTheme($)
    await $.command.register({ name: 'dash', description: 'セッションの計器盤をペインに表示' }).catch(() => {})
    // リロードでも session.start は来る。最初の 1 回だけ時刻を入れる
    const now = await $.clock.now()
    await update($, startedA, v => v || now)
    try {
      const saved = await $.store.get(LAYOUT_KEY)
      await update($, layoutA, () => layoutOf(saved))
    } catch {
      // 読めなければ初めの並びのまま
    }
    // 30 秒ごとに、数字が変わる時だけ描き直す (使用量は読み直して毎回、概要は経過の分が変わった時、ツールは実行中がある時)
    let lastMinute = -1
    $.clock.every(30_000, async () => {
      const tab = await read($, tabA)
      const shown = (await read($, arrangingA)) && tab === 'mine' ? [] : await panelsOf($, tab)
      if (shown.includes('usage')) await refreshUsage($, file)
      const minute = Math.floor(((await $.clock.now()) - (await read($, startedA))) / 60_000)
      const isDue =
        shown.includes('usage') ||
        (shown.includes('overview') && minute !== lastMinute) ||
        (shown.includes('timeline') && (await read($, callsA)).some(c => c.end === undefined))
      lastMinute = minute
      if (isDue) await $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  // /clear で数え直す
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, startedA, () => now)
      await update($, turnCountA, () => 0)
      await update($, turnDurA, () => [])
      await update($, runningA, () => null)
      await update($, callsA, () => [])
      await update($, countsA, () => ({}))
      await update($, totalA, () => 0)
      await update($, errorsA, () => 0)
    }
    return next(e)
  })

  on('command.run', { command: 'dash' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '計器盤を開きました。' }
  })

  // メインループのターンだけ数える (サブエージェントのターンは agentId 付きで来る)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, runningA, () => now)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, turnDurA, list => [...list, e.durationMs].slice(-KEEP_TURNS))
      await update($, turnCountA, n => n + 1)
      await update($, runningA, () => null)
      // 答えが返らないまま終わった呼び出し(中断など)を締める。エラーには数えない
      const end = await $.clock.now()
      await update($, callsA, list => (list.some(c => c.end === undefined) ? list.map(c => (c.end === undefined ? { ...c, end } : c)) : list))
    }
    return next(e)
  })

  // 見るだけのフック。落ちても呼び出しは止めない (.catch で next の結果をそのまま返す)
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const tool = clean(String(e.tool))
    const start = await $.clock.now()
    const id = e.tool_use_id ?? `${tool}-${start}-${Math.random()}`
    await update($, callsA, list => [...list, { id, tool, start, isError: false }].slice(-KEEP_CALLS))
    await update($, countsA, c => ({ ...c, [tool]: (c[tool] ?? 0) + 1 }))
    await update($, totalA, n => n + 1)

    // 中断(next が投げる)・deny はエラーに数えない (work-bar とそろえる)
    let isError = false
    try {
      const r = await next(e)
      isError = r.isError === true
      return r
    } finally {
      const end = await $.clock.now()
      await update($, callsA, list => list.map(c => (c.id === id ? { ...c, end, isError } : c)))
      if (isError) await update($, errorsA, n => n + 1)
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const tab = await read($, tabA)
    const now = await $.clock.now()

    const tabs = (
      <Box key="tabs" flexDirection="row" flexWrap="wrap" gap={1}>
        {TABS.map(([id, label]) => (
          <Button
            key={`tab-${id}`} dimColor={tab !== id}
            label={label}
            variant={tab === id ? 'primary' : 'secondary'}
            onPress={async () => {
              await update($, tabA, () => id)
              // 使用量を出すタブを開いた時に読む
              if ((await panelsOf($, id)).includes('usage')) await refreshUsage($, file)
            }}
          />
        ))}
      </Box>
    )

    // terminal の部品表にも Svg の名前はあるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined

    // ツールの色は回数の順位で決まる。回数を読む(購読する)のは、ツールの枠を描く時だけ
    const colorFn = async () => {
      const counts = await read($, countsA)
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
      const rank = new Map(ranked.map(([tool], i) => [tool, i]))
      return { ranked, colorOf: (tool: string) => TOOL_COLORS[(rank.get(tool) ?? 0) % TOOL_COLORS.length] ?? TOOL_COLORS[0]! }
    }

    /** 枠 1 つ。読むのはその枠に要る値だけ */
    const panel = async (id: CcDashPanel) => {
      if (id === 'overview') {
        const startedAt = await read($, startedA)
        const o = {
          elapsedMs: startedAt ? now - startedAt : 0,
          turns: await read($, turnCountA),
          tools: await read($, totalA),
          errors: await read($, errorsA),
          isRunning: (await read($, runningA)) !== null,
        }
        return Svg ? (
          <Svg key="header" source={overviewSvg(o)} alt={`経過 ${clock(o.elapsedMs)} ターン ${o.turns} ツール ${o.tools} エラー ${o.errors}`} />
        ) : (
          <Box key="overview" flexDirection="column">
            <Text key="status" color={o.isRunning ? 'green' : undefined}>{o.isRunning ? '● 実行中' : '○ 待機中'}</Text>
            <Text key="summary">{`経過 ${clock(o.elapsedMs)}  ターン ${o.turns}  ツール ${o.tools}  エラー ${o.errors}`}</Text>
          </Box>
        )
      }
      if (id === 'turns') {
        const durations = await read($, turnDurA)
        return Svg ? (
          <Svg key="turns" source={turnsSvg(durations)} alt="直近20ターンの所要時間の棒グラフ" />
        ) : (
          <Text key="last" dimColor>
            {durations.length ? `最新ターン ${dur(durations[durations.length - 1] ?? 0)}` : 'まだ完了したターンがありません'}
          </Text>
        )
      }
      if (id === 'toolBars') {
        const { ranked, colorOf } = await colorFn()
        const top = ranked.slice(0, 8)
        const total = await read($, totalA)
        return Svg ? (
          <Svg key="tool-bars" source={toolBarsSvg(top, total, colorOf)} alt="ツール別の呼び出し回数の横棒グラフ" />
        ) : (
          <Box key="tool-counts" flexDirection="column">
            {top.length === 0 && <Text dimColor>まだ呼び出しがありません</Text>}
            {top.map(([tool, n]) => (
              <Text key={`count-${tool}`}>{`${shortTool(tool)} ${n}`}</Text>
            ))}
          </Box>
        )
      }
      if (id === 'timeline') {
        const { colorOf } = await colorFn()
        const calls = await read($, callsA)
        if (Svg) return <Svg key="timeline" source={timelineSvg(calls, now, colorOf)} alt="直近30回の呼び出しのタイムライン" />
        const recent = calls.slice(-30)
        const running = recent.filter(c => c.end === undefined).length
        const failed = recent.filter(c => c.isError).length
        return (
          <Text key="timeline-text" dimColor>
            {recent.length ? `直近${recent.length}回の呼び出し  実行中 ${running}  失敗 ${failed}` : '直近の呼び出しはまだありません'}
          </Text>
        )
      }
      // 使用量: 描画では読まない。読むのは 30 秒タイマーと使用量を出した時
      const u = file === '' ? UNSET : ((await read($, usageA)) ?? '読み込み中…')
      if (typeof u === 'string') {
        return (
          <Text key="usage-error" dimColor>
            {u}
          </Text>
        )
      }
      const gauges = gaugesOf(u, now)
      return Svg ? (
        <Svg key="gauges" source={gaugesSvg(gauges, fetchedText(u, now))} alt={gauges.map(g => `${g.label} ${g.pct}%`).join(' ')} />
      ) : (
        <Box key="usage" flexDirection="column">
          {gauges.map(g => (
            <Text key={`gauge-${g.label}`} color={g.pct > 80 ? 'red' : g.pct > 50 ? 'yellow' : undefined}>
              {`${g.label} ${Math.round(g.pct)}% ${g.left}`}
            </Text>
          ))}
        </Box>
      )
    }

    const panels = async (ids: CcDashPanel[]) => {
      const out = []
      for (const id of ids) out.push(await panel(id))
      return out
    }

    let body
    if (tab !== 'mine') {
      body = (
        <Box key={tab} flexDirection="column" gap={1}>
          {await panels(TAB_PANELS[tab])}
        </Box>
      )
    } else if (await read($, arrangingA)) {
      // 並べ替えの画面: 枠ごとに名前と「上へ」「下へ」「出す」/「隠す」
      const layout = await read($, layoutA)
      const order = knownOrder(layout)
      body = (
        <Box key="arrange" flexDirection="column" gap={1}>
          <Text dimColor>出す枠を選び、上から出す順に並べます</Text>
          {order.map((id, i) => {
            const isHidden = layout.hidden.includes(id)
            return (
              <Box key={`row-${id}`} flexDirection="column">
                <Text key={`name-${id}`} bold={!isHidden} dimColor={isHidden}>
                  {`${i + 1}. ${PANEL_LABEL[id]}${isHidden ? '  隠しています' : ''}`}
                </Text>
                <Box flexDirection="row" flexWrap="wrap" gap={1}>
                  {i > 0 && <Button key={`up-${id}`} dimColor label="上へ" onPress={() => changeLayout($, l => move(l, id, -1))} />}
                  {i < order.length - 1 && <Button key={`down-${id}`} dimColor label="下へ" onPress={() => changeLayout($, l => move(l, id, 1))} />}
                  {isHidden ? (
                    <Button key={`show-${id}`} dimColor label="出す" onPress={() => changeLayout($, l => setShown(l, id, true))} />
                  ) : (
                    <Button key={`hide-${id}`} dimColor label="隠す" onPress={() => changeLayout($, l => setShown(l, id, false))} />
                  )}
                </Box>
              </Box>
            )
          })}
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button
              key="arrange-done"
              label="並べ終わる"
              variant="primary"
              onPress={async () => {
                await update($, arrangingA, () => false)
                if (shownOf(await read($, layoutA)).includes('usage')) await refreshUsage($, file)
              }}
            />
            <Button key="arrange-reset" dimColor label="初めの並びに戻す" onPress={() => changeLayout($, reset)} />
          </Box>
        </Box>
      )
    } else {
      const shown = shownOf(await read($, layoutA))
      body = (
        <Box key="mine" flexDirection="column" gap={1}>
          {shown.length === 0 ? <Text dimColor>出す枠がありません。「並べ替える」で選んでください</Text> : await panels(shown)}
          <Button key="arrange" dimColor label="並べ替える" onPress={() => update($, arrangingA, () => true)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tabs}
        {body}
      </Box>
    )
  })
}
