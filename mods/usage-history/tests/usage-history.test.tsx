import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { DayRec, Days } from '../types'
import { asDays, asHeat, busiest, chartSvg, dayKey, dayLabel, EMPTY_DAY, fmtNum, heatSvg, KEEP_DAYS, lastDays, mergeDays, mergeHeat, slot, SLOTS, summarize } from '../hooks/history'
import { setTheme } from '../hooks/style'

// 2026-10-21(水) 12:00 UTC = 日本時間 21:00
const NOW = Date.parse('2026-10-21T12:00:00Z')
const DAY = 86_400_000
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'usage-history',
  component: 'Pane',
  requestId: 'usage-history',
  props: {
    title: '使い方の記録',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const usage = (input: number, output: number, cache = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cache, cache_creation_input_tokens: 0, model: 'demo' })
const rec = (d: Partial<DayRec>): DayRec => ({ ...EMPTY_DAY, ...d })

type Boot = { taken?: boolean; theme?: () => string; store?: Record<string, unknown> }

const boot = async ($: Engine, on: On, opts: Boot = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  let writes = 0
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    if (e.key === 'days') writes++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => (opts.taken && e.name === 'history' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  on('command.run', { command: 'history' }, () => ({ text: '別の /history' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  const theme = opts.theme
  if (theme) {
    on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme(), provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
    on('config.set', (_$, e) => ({ value: e.value }))
  }
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return { clock, days: () => asDays(m.get('days')) ?? {}, heat: () => asHeat(m.get('heat')), raw: m, writes: () => writes }
}

type Turn = { id: string; ms?: number; reason?: 'answer' | 'aborted'; agentId?: string; u?: ReturnType<typeof usage>; tools?: number }
const turn = async ($: Engine, t: Turn) => {
  const sub = t.agentId ? { agentId: t.agentId } : {}
  for (let k = 0; k < (t.tools ?? 0); k++) await $.tool.call({ tool: 'Read', file_path: '/tmp/demo/a.ts', ...sub })
  await $.turn.complete({ answer: 'ok', durationMs: t.ms ?? 1000, isAborted: t.reason === 'aborted', turnId: t.id, reason: t.reason ?? 'answer', ...sub, ...(t.u ? { usage: t.u } : {}) })
}

test('日付・ます目・足し方・刈り込み・集計 (純関数)', () => {
  // 日本時間の日付: UTC 14:59 は同じ日の 23:59、15:00 は翌日
  expect(dayKey(Date.parse('2026-10-20T14:59:00Z'))).toBe('2026-10-20')
  expect(dayKey(Date.parse('2026-10-20T15:00:00Z'))).toBe('2026-10-21')
  // 水曜 21 時 = 2 行目 (月=0) の 21
  expect(slot(NOW)).toBe(2 * 24 + 21)
  expect(dayLabel('2026-10-18')).toBe('10/18(日)')

  expect(asDays('壊れた値')).toBeUndefined()
  expect(asDays({ '2026-10-20': { turns: 3, tools: 'x' }, junk: { turns: 1 } })).toEqual({ '2026-10-20': rec({ turns: 3 }) })
  expect(asHeat([1, 2])).toBeUndefined()

  const many: Days = Object.fromEntries(Array.from({ length: KEEP_DAYS }, (_, k) => [dayKey(NOW - (KEEP_DAYS - k) * DAY), rec({ turns: 1 })]))
  const merged = mergeDays(many, { [dayKey(NOW)]: rec({ turns: 2 }), [dayKey(NOW - DAY)]: rec({ turns: 5 }) })
  expect(Object.keys(merged).length).toBe(KEEP_DAYS)
  expect(Object.keys(merged)[0]).toBe(dayKey(NOW - (KEEP_DAYS - 1) * DAY)) // いちばん古い日が落ちた
  expect(merged[dayKey(NOW - DAY)]?.turns).toBe(6)
  expect(mergeHeat([1], [2, 3]).slice(0, 3)).toEqual([3, 3, 0])

  const list = lastDays({ [dayKey(NOW)]: rec({ turns: 4 }), [dayKey(NOW - 2 * DAY)]: rec({ turns: 10, outputTokens: 50_000 }) }, NOW, 7)
  expect(list.length).toBe(7)
  expect(list.at(-1)?.key).toBe('2026-10-21')
  const s = summarize(list, 'turns')
  expect(s.value).toBe(14)
  expect(s.average).toBe(2)
  expect(s.top).toEqual({ key: '2026-10-19', value: 10 })
  expect(summarize(list, 'output').value).toBe(50_000)
  expect(fmtNum(12_345)).toBe('1.2万')
  expect(fmtNum(2.5)).toBe('2.5')
  expect(busiest(Array.from({ length: SLOTS }, (_, k) => (k === 30 ? 7 : 0)))).toEqual({ week: '火', hour: 6, turns: 7 })
  expect(busiest(new Array<number>(SLOTS).fill(0))).toBeUndefined()

  setTheme(false)
  const chart = chartSvg({ [dayKey(NOW - 2 * DAY)]: rec({ turns: 10 }) }, NOW, 7, 'turns')
  expect(chart).toContain('いちばん多かった日 10/19(月) 10 ターン')
  expect(chart).toContain('attributeName="height"') // growColumn
  expect(chart).not.toMatch(/<svg[^>]*\swidth=/)
  expect(chartSvg({}, NOW, 30, 'output')).toContain('直近 30 日はまだ記録がありません')
  expect(heatSvg(new Array<number>(SLOTS).fill(0))).toContain('まだ記録がありません')
})

test('ターンの終わりに日ごとの記録を足す (メインのターン・サブエージェント・ツール・トークン)', async ($, on) => {
  const s = await boot($, on)
  await turn($, { id: 'a1', agentId: 'agent-1', tools: 2, u: usage(100, 200, 1000) })
  await s.clock.settle()
  expect(s.writes()).toBe(0) // サブエージェントの終わりでは書かない
  await turn($, { id: 'm1', ms: 30_000, tools: 3, u: usage(10, 20, 500) })
  await s.clock.settle()
  await turn($, { id: 'm2', ms: 5000, reason: 'aborted', u: usage(1, 2) })
  await s.clock.settle()
  expect(s.writes()).toBe(2) // メインのターンごとに 1 回
  expect(s.days()).toEqual({
    '2026-10-21': { turns: 1, tools: 5, inputTokens: 111, outputTokens: 222, cacheRead: 1500, durationMs: 35_000, subTurns: 1 },
  })
  const heat = s.heat()
  expect(heat?.[slot(NOW)]).toBe(1)
  expect(heat?.reduce((a, b) => a + b, 0)).toBe(1)
})

test('書く直前に読み直し、別のセッションが足した分を消さない', async ($, on) => {
  const today = '2026-10-21'
  const s = await boot($, on, { store: { days: { [today]: rec({ turns: 2 }) } } })
  // セッションが始まった後に、別のセッションが 3 ターン足した
  s.raw.set('days', { [today]: rec({ turns: 5 }), '2026-10-20': rec({ turns: 1 }) })
  await turn($, { id: 'm1' })
  await s.clock.settle()
  expect(s.days()[today]?.turns).toBe(6)
  expect(s.days()['2026-10-20']?.turns).toBe(1)
})

test('400 日を超えたら古い日から捨てる', async ($, on) => {
  const old: Days = Object.fromEntries(Array.from({ length: KEEP_DAYS }, (_, k) => [dayKey(NOW - (KEEP_DAYS - k) * DAY), rec({ turns: 1 })]))
  const s = await boot($, on, { store: { days: old } })
  await turn($, { id: 'm1' })
  await s.clock.settle()
  const keys = Object.keys(s.days())
  expect(keys.length).toBe(KEEP_DAYS)
  expect(keys).toContain('2026-10-21')
  expect(keys).not.toContain(dayKey(NOW - KEEP_DAYS * DAY))
})

for (const surface of SURFACES) {
  test(`${surface}: 7 日 / 30 日・ターン数 / 出力トークンの切り替え、合計と平均・いちばん多かった日`, async ($, on) => {
    const s = await boot($, on, {
      store: {
        days: { '2026-10-19': rec({ turns: 10, outputTokens: 3000 }), '2026-09-30': rec({ turns: 40, outputTokens: 90_000 }) },
      },
    })
    await turn($, { id: 'm1', u: usage(5, 70_000) })
    await s.clock.settle()
    expect((await $.command.run({ command: 'history', ...RUN })).text).toBe('使い方の記録を開きました。')
    const ui = await $.ui.mount({ ...PANE, surface })
    const summary = async () =>
      surface === 'vscode'
        ? String((await ui.findAll({ type: 'Svg' }))[0]?.props.alt)
        : String((await ui.find({ type: 'Text', text: /^直近/ }))?.text)
    const body = async () =>
      surface === 'vscode'
        ? String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
        : (await ui.findAll({ type: 'Text' })).map(x => x.text).join('\n')

    expect(await summary()).toBe('直近 7 日 ターン 合計 11 / 1 日平均 1.6')
    expect(await body()).toContain('いちばん多かった日 10/19(月) 10 ターン')

    await ui.press({ key: 'range-30' })
    expect(await summary()).toBe('直近 30 日 ターン 合計 51 / 1 日平均 1.7')
    expect(await body()).toContain('いちばん多かった日 9/30(水) 40 ターン')

    await ui.press({ key: 'metric' })
    expect(await summary()).toBe('直近 30 日 出力トークン 合計 16.3万 / 1 日平均 5433')
    expect((await ui.find({ key: 'metric' }))?.props.label).toBe('ターン数で見る')

    if (surface === 'vscode') {
      const svgs = await ui.findAll({ type: 'Svg' })
      expect(svgs.length).toBe(2)
      expect(String(svgs[1]?.props.alt)).toBe('いちばん多い時間帯 水曜 21 時台')
      expect(String(svgs[1]?.props.source)).toContain('opacity="1.00"')
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'よく使う時間帯 水曜 21 時台(1 ターン)' })).toBeDefined()
    }
    await ui.unmount()
  })
}

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light-ansi'
  await boot($, on, { theme: () => theme })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const source = async () => String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
  expect(await source()).toMatch(/fill="#ffffff"/)
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light-ansi', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await source()).toMatch(/fill="#0d1117"/)
})

test('/history を持てなかった時は /usage-history にして、/history を横取りしない', async ($, on) => {
  await boot($, on, { taken: true })
  expect((await $.command.run({ command: 'history', ...RUN })).text).toBe('別の /history')
  expect((await $.command.run({ command: 'usage-history', ...RUN })).text).toBe('使い方の記録を開きました。')
})
