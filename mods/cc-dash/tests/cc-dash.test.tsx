import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { CcDashCall } from '../types'

const NOW = Date.parse('2026-10-03T07:15:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'cc-dash',
  component: 'Pane',
  requestId: 'cc-dash',
  props: {
    title: '計器盤',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RED = '#f85149'
const YELLOW = '#d29922'

const USAGE_FILE = { options: { usageFile: '/tmp/demo/usage.json' } }
const usage = (sessionPct: number) =>
  JSON.stringify({
    sessionPct,
    weeklyPct: 58,
    sessionResetAt: '2026-10-03T09:29:59.591552+00:00',
    weeklyResetAt: '2026-10-05T18:59:59.591571+00:00',
    modelName: 'Fable',
    modelPct: 0,
    modelResetAt: '2026-10-05T19:00:00+00:00',
    fetchedAt: NOW - 5 * 60_000,
  })

// エンジンの代わりに一番下で答えるフック
const bottom = (on: On) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', ($, e) =>
    e.tool === 'Bash' && e.command === 'fail' ? { isError: true as const, result: 'boom' } : { result: 'ok' },
  )
}

// mod が書いた state を一番下で覗く (読むのは kit が答える)
const spy = (on: On) => {
  const last: Record<string, unknown> = {}
  on('state.set', ($, e, next) => {
    if (e.plugin === 'cc-dash') last[e.key] = e.value
    return next(e)
  })
  return last
}

const turn = async ($: Engine, id: string, durationMs: number, agentId?: string) => {
  await $.turn.start({ text: 'p', turnId: id, ...(agentId ? { agentId } : {}) })
  await $.turn.complete({ answer: 'a', durationMs, isAborted: false, turnId: id, reason: 'answer', ...(agentId ? { agentId } : {}) })
}

// Svg と Text の key は描かれた木に残らないので、Svg は alt で探す
const ALT: Record<string, RegExp> = {
  header: /^経過/,
  turns: /^直近20ターン/,
  'tool-bars': /^ツール別/,
  timeline: /^直近30回/,
  gauges: /^5時間枠/,
}
type Found = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
const svgOf = async (ui: Found, key: string) =>
  (await ui.findAll({ type: 'Svg' })).find(el => ALT[key]?.test(String(el.props.alt)))?.props
const svgSource = async (ui: Found, key: string) => String((await svgOf(ui, key))?.source ?? '')

test('タブの Button が 3 つ、今のタブが primary、押すと state が変わる', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('fs.read', () => ({ value: usage(10) }))
  const last = spy(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
    expect((await ui.find({ key: 'tab-overview' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'tab-tools' }))?.props.variant).toBe('secondary')

    await ui.press({ key: 'tab-tools' })
    expect(last.tab).toBe('tools')
    expect((await ui.find({ key: 'tab-tools' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'tab-overview' }))?.props.variant).toBe('secondary')

    await ui.press({ key: 'tab-usage' })
    expect(last.tab).toBe('usage')
    expect((await ui.find({ key: 'tab-usage' }))?.props.variant).toBe('primary')

    await ui.press({ key: 'tab-overview' })
    expect(last.tab).toBe('overview')
    await ui.unmount()
  }
})

test('概要: ターン・ツール・エラーを数え、サブエージェントのターンは数えない', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  await turn($, 't1', 30_000)
  await turn($, 't2', 150_000)
  await turn($, 'sub', 999_000, 'agent-1')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'fail' })
  await clock.advance(5 * 60_000)

  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await svgOf(vs, 'header'))?.alt).toBe('経過 0:05 ターン 2 ツール 2 エラー 1')
  const header = await svgSource(vs, 'header')
  expect(header).toContain('待機中')
  expect(header).toContain(`fill="${RED}" font-weight="bold">1<`)
  const bars = await svgSource(vs, 'turns')
  expect(bars).toContain('<animate attributeName="height"')
  expect(bars).toContain(`fill="${YELLOW}" opacity="1"`) // 最新 150 秒は黄
  expect(bars).not.toContain('16分39秒') // サブエージェントの 999 秒は入らない
  await vs.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^経過/ }))?.text).toBe('経過 0:05  ターン 2  ツール 2  エラー 1')
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
})

test('概要: ターン実行中は脈打つ丸と「実行中」、5 分超えの棒は赤', async ($, on) => {
  mock.clock(on, { now: NOW })
  bottom(on)
  await turn($, 't1', 400_000)
  await $.turn.start({ text: 'p', turnId: 't2' })
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const header = await svgSource(vs, 'header')
  expect(header).toContain('実行中')
  expect(header).toContain('<animate attributeName="r"')
  expect(await svgSource(vs, 'turns')).toContain(`fill="${RED}" opacity="1"`)
  await vs.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /行中|待機中/ }))?.text).toBe('● 実行中')
})

test('ツール: 回数の横棒と、実行中は縞・エラーは赤のタイムライン', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const last = spy(on)
  let release = () => {}
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash' && e.command === 'slow') return new Promise(r => (release = () => r({ result: 'ok' })))
    if (e.tool === 'Bash' && e.command === 'fail') return { isError: true as const, result: 'boom' }
    return { result: 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'fail' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/x.txt' })
  const slow = $.tool.call({ tool: 'Bash', command: 'slow' })
  await clock.advance(2_000)

  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await vs.press({ key: 'tab-tools' })
  const barsSrc = await svgSource(vs, 'tool-bars')
  expect(barsSrc).toContain('>Bash<')
  expect(barsSrc).toContain('>3<')
  expect(barsSrc).toContain('計 4回')
  const tl = await svgSource(vs, 'timeline')
  expect(tl).toContain('stroke-dashoffset')
  expect(tl).toContain('Bash 実行中')
  expect(tl).toContain(`fill="${RED}" opacity="1"`)
  expect(tl).toContain('失敗 1')
  await vs.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^Bash / }))?.text).toBe('Bash 3')
  expect((await term.find({ type: 'Text', text: /^Read / }))?.text).toBe('Read 1')
  expect(await term.find({ type: 'Svg' })).toBeUndefined()

  release()
  await slow
  const calls = last.calls as CcDashCall[]
  expect(calls).toHaveLength(4)
  expect(calls.every(c => c.end !== undefined)).toBe(true)
})

test('ツール記録は直近 200 件まで、回数は通算', async ($, on) => {
  mock.clock(on, { now: NOW })
  const last = spy(on)
  on('tool.call', () => ({ result: 'ok' }))
  for (let i = 0; i < 205; i++) await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
  expect(last.calls).toHaveLength(200)
  expect(last.toolTotal).toBe(205)
  expect(last.toolCounts).toEqual({ Bash: 205 })
})

test('使用量: リング型ゲージ、80% 超は赤・50% 超は黄、残り時間', USAGE_FILE, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('fs.read', () => ({ value: usage(85) }))

  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await vs.press({ key: 'tab-usage' })
  const src = await svgSource(vs, 'gauges')
  expect(src).toContain('stroke-dasharray')
  expect(src).toContain(`fill="${RED}" text-anchor="middle" font-weight="bold">85%<`)
  expect(src).toContain(`fill="${YELLOW}" text-anchor="middle" font-weight="bold">58%<`)
  expect(src).toContain('Fable 週')
  expect(src).toContain('あと2時間14分')
  expect(src).toContain('あと2日11時間')
  expect(src).toContain('取得: 5分前')
  await vs.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: '5時間枠 85%' }))?.props.color).toBe('red')
  expect((await term.find({ type: 'Text', text: '週 58%' }))?.props.color).toBe('yellow')
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
})

test('使用量: 読めない時は SVG でなく Text で理由', USAGE_FILE, async ($, on) => {
  mock.clock(on, { now: NOW })
  let text = ''
  on('fs.read', () => (text === '' ? { deny: 'ENOENT' } : { value: text }))
  for (const body of ['', '{ broken', '{"sessionPct":"x"}']) {
    text = body
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'tab-usage' })
      expect((await ui.find({ type: 'Text', text: /読めません/ }))?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('30 秒ごとに読み直して描き直す', USAGE_FILE, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let pct = 32
  on('fs.read', () => ({ value: usage(pct) }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'tab-usage' })
  expect(await svgSource(ui, 'gauges')).toContain('>32%<')
  pct = 40
  await clock.advance(30_000)
  expect(await svgSource(ui, 'gauges')).toContain('>40%<')
})

test('使用量: ファイルが未設定なら読まずに設定のしかたを出す', async ($, on) => {
  mock.clock(on, { now: NOW })
  let reads = 0
  on('fs.read', () => {
    reads++
    return { value: usage(10) }
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-usage' })
    expect(await ui.find({ type: 'Text', text: /未設定/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
  expect(reads).toBe(0)
})

test('/dash でペインを開く', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(`${e.id}:${e.title}`)
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  const r = await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(opened).toEqual(['cc-dash:計器盤'])
  expect(r).toMatchObject({ text: '計器盤を開きました。' })
})
