import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { LONG_MS, SHOW, dur, kindOf, segments, timelineLines, timelineSvg } from '../hooks/timeline'
import type { TimelineTurn } from '../types'

const NOW = Date.parse('2026-10-21T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'session-timeline',
  component: 'Pane',
  requestId: 'session-timeline',
  props: {
    title: 'タイムライン',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

const ORANGE = '#f78166'
const BLUE = '#58a6ff'
const PURPLE = '#bc8cff'
const GREEN = '#3fb950'
const RED = '#f85149'
const YELLOW = '#d29922'

type Clock = { advance: (ms: number) => Promise<void> }

/** エンジンの代わりに一番下で答える。ツールは command / file_path に書いた ms だけ時間がかかる */
const bottom = (on: On, clock: Clock) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('tool.call', async (_$, e) => {
    await clock.advance(5_000)
    return e.tool === 'Bash' && e.command === 'fail' ? { isError: true as const, result: 'boom' } : { result: 'ok' }
  })
}

let n = 0
/** ターンを 1 回流す。tools はツール名 ('fail' は失敗する Bash)。ms はツールの後に待つ時間 */
const turn = async ($: Engine, clock: Clock, id: string, text: string, ms: number, tools: string[] = [], opts: { agentId?: string; reason?: 'answer' | 'aborted' } = {}) => {
  const sub = opts.agentId ? { agentId: opts.agentId } : {}
  await $.turn.start({ text, turnId: id, ...sub })
  for (const tool of tools) {
    const tool_use_id = `tu-${++n}`
    if (tool === 'fail' || tool === 'Bash') await $.tool.call({ tool: 'Bash', command: tool === 'fail' ? 'fail' : 'ls', tool_use_id, ...sub })
    else if (tool === 'Edit') await $.tool.call({ tool: 'Edit', file_path: '/tmp/demo/a.ts', old_string: 'a', new_string: 'b', tool_use_id, ...sub })
    else if (tool === 'Agent') await $.tool.call({ tool: 'Agent', description: 'しらべ', prompt: 'しらべて', tool_use_id, ...sub } as never)
    else await $.tool.call({ tool: 'Read', file_path: '/tmp/demo/a.ts', tool_use_id, ...sub })
  }
  await clock.advance(ms)
  const reason = opts.reason ?? 'answer'
  await $.turn.complete({ answer: 'ok', durationMs: ms, isAborted: reason === 'aborted', turnId: id, reason, ...sub } as never)
}

type Found = { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }
const svgOf = async (ui: Found) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')

test('ターンとツールを流すと帯が描かれる。数えるのはメインの answer だけ、サブは細い帯', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on, clock)
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  await turn($, clock, 't1', '帯を描いて', 70_000, ['Edit', 'Read', 'fail'])
  // メインのターンの途中で、サブエージェントが自分のターンを回す
  await $.turn.start({ text: '調べて', turnId: 't2' })
  await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'x', tool_use_id: 'tu-agent' } as never)
  await turn($, clock, 'sub-1', 'サブの仕事', 1_000, ['Read', 'Bash'], { agentId: 'agent-1' })
  await clock.advance(2_000)
  await $.turn.complete({ answer: 'ok', durationMs: 30_000, isAborted: false, turnId: 't2', reason: 'answer' })
  await turn($, clock, 't3', '止めたやつ', 1_000, ['Bash'], { reason: 'aborted' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toMatch(/^合計 .+ ターン 2 ツール 7\(サブ 2\) 失敗 1$/)
      expect(svg).toContain('タイムライン')
      expect(svg).toContain(`fill="${BLUE}"/>`) // 編集
      expect(svg).toContain(`fill="${PURPLE}"/>`) // 調べ
      expect(svg).toContain(`fill="${ORANGE}"/>`) // 実行
      expect(svg).toContain(`fill="${GREEN}"/>`) // エージェント
      expect(svg).toContain(`r="3.5" fill="${RED}"`) // 失敗の印
      expect(svg).toContain('height="4" rx="1"') // サブの細い帯
      expect(svg).toContain(`stroke="${YELLOW}" stroke-width="1.5"/>`) // 1 分を超えたターン
      expect(svg).toContain('中断')
      expect(svg).toContain('<animate attributeName="width"') // 左から伸びる
      expect(svg).not.toContain('サブの仕事') // サブのターンは行にしない
      expect(svg.length).toBeLessThan(131_072)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      const texts = (await ui.findAll({ type: 'Text' })).map(x => String(x.text))
      expect(texts[0]).toMatch(/^合計 .+ ターン 2 ツール 7\(サブ 2\) 失敗 1$/)
      // 新しい順
      expect(texts[1]).toMatch(/^\d{1,2}:\d{2} \d+秒 中断 実行1 止めたやつ$/)
      expect(texts[2]).toMatch(/実行1 調べ1 エージェント1 調べて$/)
      expect(texts[3]).toMatch(/^\d{1,2}:\d{2} 1分\d+秒 長い 失敗1 実行1 編集1 調べ1 帯を描いて$/)
      expect((await ui.find({ type: 'Text', text: /帯を描いて$/ }))?.props.color).toBe('red')
    }
    await ui.unmount()
  }
})

test(`${SHOW} ターンを超えたら古い物は「ほか n ターン」`, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on, clock)
  for (let i = 1; i <= SHOW + 3; i++) await turn($, clock, `t${i}`, `仕事${i}`, 1_000, ['Read'])
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await svgOf(vs)
  expect(svg).toContain('ほか 3 ターン')
  expect(svg).toContain(`仕事${SHOW + 3}`)
  expect(svg).not.toContain('仕事3<')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: 'ほか 3 ターン' })).toBeDefined()
  expect((await term.findAll({ type: 'Text' })).length).toBe(1 + SHOW + 1)
})

test('実行中のターンは緑の点が点滅し、終わっていないツールも帯になる', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on, clock)
  await $.turn.start({ text: '長い仕事', turnId: 'run' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' })
  await clock.advance(10_000)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await svgOf(vs)
  expect(svg).toContain('実行中')
  expect(svg).toContain(`fill="${GREEN}"><animate attributeName="opacity"`)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /長い仕事$/ }))?.props.color).toBe('green')
})

test('/clear と「記録を消す」で空になる', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on, clock)
  await turn($, clock, 't1', 'ひとつめ', 1_000, ['Read'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(await ui.find({ type: 'Text', text: 'まだターンがありません' })).toBeDefined()
  await turn($, clock, 't2', 'ふたつめ', 1_000, ['Read'])
  expect(await ui.find({ type: 'Text', text: /ふたつめ$/ })).toBeDefined()
  await ui.press({ key: 'reset' })
  expect(await ui.find({ type: 'Text', text: 'まだターンがありません' })).toBeDefined()
  expect(await ui.find({ key: 'reset' })).toBeUndefined()
})

test('/timeline を登録して開く。取れなければ /session-timeline にして、/timeline は横取りしない', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'timeline' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  on('command.run', { command: 'timeline' }, () => ({ text: 'ほかの timeline' }))
  on('command.run', { command: 'session-timeline' }, () => ({ text: 'ほかの session-timeline' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['timeline'])
  expect(await $.command.run({ command: 'timeline', ...RUN })).toMatchObject({ text: 'タイムラインを開きました。' })
  // /timeline を持てた時は、/session-timeline をその名前の持ち主に回す (横取りしない)
  expect(await $.command.run({ command: 'session-timeline', ...RUN })).toMatchObject({ text: 'ほかの session-timeline' })
  isTaken = true
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['timeline', 'timeline', 'session-timeline'])
  expect(await $.command.run({ command: 'timeline', ...RUN })).toMatchObject({ text: 'ほかの timeline' })
  expect(await $.command.run({ command: 'session-timeline', ...RUN })).toMatchObject({ text: 'タイムラインを開きました。' })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on, clock)
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  await turn($, clock, 't1', 'ひとつめ', 1_000, ['Edit'])
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgOf(ui)).toMatch(/fill="#ffffff"/)
  expect(await svgOf(ui)).toContain('fill="#0969da"/>') // 明るい青
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await svgOf(ui)).toMatch(/fill="#0d1117"/)
})

test('区間の位置: ターンの始まりから測り、同じ種類で続く物はまとめる', () => {
  const t: TimelineTurn = {
    turnId: 'x',
    start: 0,
    end: 100_000,
    label: '',
    reason: 'answer',
    tools: [
      { id: 'a', tool: 'Read', start: 0, end: 10_000, isError: false, isSub: false },
      { id: 'b', tool: 'Grep', start: 10_000, end: 20_000, isError: true, isSub: false },
      { id: 'c', tool: 'Bash', start: 50_000, end: 60_000, isError: false, isSub: false },
      { id: 'd', tool: 'Read', start: 55_000, end: 56_000, isError: false, isSub: true },
    ],
  }
  const segs = segments(t, 100_000, 0, 0.001) // 1 秒 = 1px
  expect(segs).toEqual([
    { x: 0, w: 20, kind: 'look', isSub: false, isError: true },
    { x: 50, w: 10, kind: 'run', isSub: false, isError: false },
    { x: 55, w: 3, kind: 'look', isSub: true, isError: false },
  ])
  expect(kindOf('MultiEdit')).toBe('edit')
  expect(kindOf('WebFetch')).toBe('other')
  expect(dur(65_000)).toBe('1分5秒')
  expect(dur(LONG_MS)).toBe('1分')
})

test('多い区間と制御文字があっても SVG は上限に収まり、文字は落とす', () => {
  const tools = Array.from({ length: 300 }, (_, i) => ({ id: `${i}`, tool: i % 2 ? 'Read' : 'Bash', start: i * 1000, end: i * 1000 + 500, isError: i % 7 === 0, isSub: false }))
  const turns: TimelineTurn[] = Array.from({ length: 100 }, (_, i) => ({ turnId: `${i}`, start: i, end: 300_000 + i, label: `仕事\u0007${i}<b>`, reason: 'answer', tools }))
  const svg = timelineSvg(turns, 400_000)
  expect(svg.length).toBeLessThan(131_072)
  expect(svg).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/)
  expect(svg).toContain('仕事99&lt;b&gt;')
  expect(timelineLines(turns, 400_000).every(l => !/[\x00-\x1f]/.test(l.text))).toBe(true)
})
