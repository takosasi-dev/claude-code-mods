import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

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

// ペインを開く求めに答える
const allowOpen = (on: On) => on('ui.open', () => ({ value: { isPlaced: true } }))
// ペインが開いている (リロードの後など)
const shownPane = (on: On) => on('ui.panes', () => ({ value: [{ id: 'usage-pane', title: '使用量', isShown: true, isFocused: false, isPlaced: true }] }))

// /usage-pane で開く(ここでファイルを読む)
const openPane = async ($: Engine) => {
  await $.command.run({
    command: 'usage-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
}

test('3 本のバーと残り時間・取得時刻を全画面種で描く', FILE, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('fs.read', () => ({ value: usage(85) }))
  allowOpen(on)
  await openPane($)
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
  allowOpen(on)
  await openPane($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Text', text: /%$/ })).toHaveLength(2)
})

test('ファイルが無い・壊れているときは dim の説明文', FILE, async ($, on) => {
  mock.clock(on, { now: NOW })
  let text = '{ broken'
  on('fs.read', () => (text === '' ? { deny: 'ENOENT' } : { value: text }))
  allowOpen(on)
  for (const body of ['{ broken', '', '{"sessionPct":"x"}', 'null']) {
    text = body
    await openPane($)
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
  shownPane(on)
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '32%' })).toBeDefined()
  pct = 40
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
})

test('描画ではファイルを読まない(読むのはタイマーとコマンド)', FILE, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let reads = 0
  on('fs.read', () => {
    reads++
    return { value: usage(32) }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  shownPane(on)
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  const afterStart = reads
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '32%' })).toBeDefined()
    await ui.unmount()
  }
  expect(reads).toBe(afterStart)
  await clock.advance(30_000)
  expect(reads).toBe(afterStart + 1)
})

// 監査: 閉じていても 30 秒ごとにファイルを読んでいた
test('ペインが閉じている間は、始まりにも 30 秒ごとにも読まない', FILE, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let reads = 0
  on('fs.read', () => {
    reads++
    return { value: usage(32) }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.panes', () => ({ value: [] }))
  await $.session.start({ cwd: '', surface: 'terminal', isInteractive: true })
  await clock.advance(90_000)
  expect(reads).toBe(0)
})

test('ファイルが未設定なら読まずに設定のしかたを出す', async ($, on) => {
  mock.clock(on, { now: NOW })
  let reads = 0
  on('fs.read', () => {
    reads++
    return { value: '{}' }
  })
  allowOpen(on)
  await openPane($)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/未設定/)
  expect(reads).toBe(0)
})

for (const usageFile of ['usage.json', './usage.json', 'C:usage.json', 'C:']) {
  test(`絶対パスでなければ未設定と同じ扱い(${usageFile})`, { options: { usageFile } }, async ($, on) => {
    mock.clock(on, { now: NOW })
    let reads = 0
    on('fs.read', () => {
      reads++
      return { value: usage(10) }
    })
    allowOpen(on)
    await openPane($)
    const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
    expect((await ui.find({ type: 'Text' }))?.text).toMatch(/未設定/)
    expect(reads).toBe(0)
  })
}
