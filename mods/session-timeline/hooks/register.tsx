import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TimelineTool, TimelineTurn } from '../types'
import { clean, followTheme, readTheme, short } from './style'
import { timelineLines, timelineSvg, totalsOf, totalsText } from './timeline'

const PANE = 'session-timeline'
const TITLE = 'タイムライン'
const DESCRIPTION = 'このセッションのターンとツールを横の帯で見る'
/** 覚えておくターンの数と、1 ターンのツールの数 */
const KEEP_TURNS = 100
const KEEP_TOOLS = 300
/** 実行中のターンがある間、帯を伸ばすために描き直す間隔 */
const TICK_MS = 5_000

const TURNS = atom({ plugin: 'session-timeline', key: 'turns' } as const, [] as TimelineTurn[])

type $ = EngineInterface

/** 走っている (end の無い) 最後のターンに fn をかける。無ければそのまま */
const onOpenTurn = (list: TimelineTurn[], fn: (t: TimelineTurn) => TimelineTurn) => {
  const i = list.findLastIndex(t => t.end === undefined)
  return i < 0 ? list : list.map((t, j) => (j === i ? fn(t) : t))
}

const setTool = (list: TimelineTurn[], id: string, fn: (x: TimelineTool) => TimelineTool) =>
  list.map(t => (t.tools.some(x => x.id === id) ? { ...t, tools: t.tools.map(x => (x.id === id ? fn(x) : x)) } : t))

// ponytail: 主の名前を持てたかはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false
let seq = 0

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'タイムラインを開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // /timeline が拒まれたら /session-timeline にする
    const got = await $.command.register({ name: 'timeline', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'timeline'
    if (!ownsMain) await $.command.register({ name: 'session-timeline', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    $.clock.every(TICK_MS, async () => {
      if ((await read($, TURNS)).some(t => t.end === undefined)) $.ui.invalidate('ui.render')
    })
    return started
  })

  // /timeline を持てなかった時は、その名前の持ち主に回す
  on('command.run', { command: 'timeline' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'session-timeline' }, openPane)

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, TURNS, () => [])
    return next(e)
  })

  // メインのターンだけ行にする。サブエージェントのターンは行にしない (そのツールは開いている行に入る)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      const turn: TimelineTurn = { turnId: e.turnId, start: now, label: short(clean(e.text), 60), tools: [] }
      // 閉じずに残っていた前のターンはここで閉じる
      await update($, TURNS, list => [...onOpenTurn(list, t => ({ ...t, end: now })), turn].slice(-KEEP_TURNS))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // 見るだけ。前後で時刻を取る。落ちても呼び出しは止めない
  on('tool.call', async ($, e, next) => {
    // tool_use_id が無い呼び出し (mod が自分で呼んだ物など) には手元の番号を振る
    const id = e.tool_use_id || `local-${++seq}`
    const start = await $.clock.now()
    const tool: TimelineTool = { id, tool: String(e.tool), start, isError: false, isSub: e.agentId !== undefined }
    let isOpen = false
    await update($, TURNS, list =>
      onOpenTurn(list, t => {
        isOpen = true
        return { ...t, tools: [...t.tools, tool].slice(-KEEP_TOOLS) }
      }),
    )
    let isError = true
    try {
      const r = await next(e)
      isError = r.deny !== undefined || r.isError === true
      return r
    } finally {
      if (isOpen) {
        const end = await $.clock.now()
        await update($, TURNS, list => setTool(list, id, x => ({ ...x, end, isError })))
      }
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, TURNS, list => {
        // 終わっていないツールもここで閉じる
        const close = (t: TimelineTurn): TimelineTurn => ({
          ...t,
          end: now,
          reason: e.reason,
          tools: t.tools.map(x => (x.end === undefined ? { ...x, end: now } : x)),
        })
        if (list.some(t => t.turnId === e.turnId)) return list.map(t => (t.turnId === e.turnId ? close(t) : t))
        // 始まりを聞いていないターン (読み込み前に始まった等)
        const t: TimelineTurn = { turnId: e.turnId, start: now - e.durationMs, end: now, label: '(始まりを見ていないターン)', tools: [], reason: e.reason }
        return [...list, t].slice(-KEEP_TURNS)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const now = await $.clock.now()
    const turns = await read($, TURNS)
    const lines = timelineLines(turns, now)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg key="timeline" source={timelineSvg(turns, now)} alt={totalsText(totalsOf(turns, now))} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map((l, i) => (
              <Text key={`line-${i}`} color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        {turns.length > 0 && <Button key="reset" dimColor label="記録を消す" onPress={() => void update($, TURNS, () => [])} />}
      </Box>
    )
  })
}
