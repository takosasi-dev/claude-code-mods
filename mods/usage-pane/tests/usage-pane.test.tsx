import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-03T07:15:00Z')
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const PANE = {
  plugin: 'usage-pane',
  component: 'Pane',
  requestId: 'usage-pane',
  props: {
    title: '使用量',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

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

const FILE = { options: { usageFile: '/tmp/demo/usage.json' } }

test('3 本のバーと残り時間・取得時刻を全画面種で描く', FILE, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('fs.read', () => ({ value: usage(85) }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: '85%' }))?.props.color).toBe('red')
    expect((await ui.find({ type: 'Text', text: '58%' }))?.props.color).toBe('yellow')
    expect((await ui.find({ type: 'Text', text: '0%' }))?.text).toBe(`${'░'.repeat(20)} 0%`)
    expect(await ui.find({ type: 'Text', text: 'Fable 週' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'あと2時間14分' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'あと2日11時間' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '取得: 5分前' })).toBeDefined()
    await ui.unmount()
  }
})

test('model 系が無ければ 2 本だけ', FILE, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('fs.read', () => ({ value: JSON.stringify({ sessionPct: 10, weeklyPct: 20 }) }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Text', text: /%$/ })).toHaveLength(2)
})

test('ファイルが無い・壊れているときは dim の説明文', FILE, async ($, on) => {
  mock.clock(on, { now: NOW })
  let text = '{ broken'
  on('fs.read', () => (text === '' ? { deny: 'ENOENT' } : { value: text }))
  for (const body of ['{ broken', '', '{"sessionPct":"x"}']) {
    text = body
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const el = await ui.find({ type: 'Text', text: /読めません/ })
    expect(el?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('30 秒ごとに読み直して描き直す', FILE, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let pct = 32
  on('fs.read', () => ({ value: usage(pct) }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '32%' })).toBeDefined()
  pct = 40
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
})

test('ファイルが未設定なら読まずに設定のしかたを出す', async ($, on) => {
  mock.clock(on, { now: NOW })
  let reads = 0
  on('fs.read', () => {
    reads++
    return { value: '{}' }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/未設定/)
  expect(reads).toBe(0)
})
