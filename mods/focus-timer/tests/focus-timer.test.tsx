import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { FocusTimerRun } from '../types'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const MIN = 60_000
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'focus-timer',
  component: 'Pane',
  requestId: 'focus-timer',
  props: {
    title: '集中',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// エンジンの代わりに一番下で答える。通知は拒んで、落ちないことも見る
const bottom = (on: On) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ deny: 'テストでは送らない' }))
  return toasts
}

const spy = (on: On) => {
  const last: Record<string, unknown> = {}
  on('state.set', ($, e, next) => {
    if (e.plugin === 'focus-timer') last[e.key] = e.value
    return next(e)
  })
  return last
}

// store を自前で答えて、mod が書いた値を覗く (mock.store と同じ所には登録できない)
const storeSpy = (on: On) => {
  const saved: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: saved[e.key] }))
  on('store.set', ($, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  return saved
}

const start = ($: Engine) => $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })

type Found = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
const svgOf = async (ui: Found, alt: RegExp) => (await ui.findAll({ type: 'Svg' })).find(el => alt.test(String(el.props.alt)))?.props
const ringAlt = async (ui: Found) => String((await svgOf(ui, /残り/))?.alt)
const todayAlt = async (ui: Found) => String((await svgOf(ui, /^今日の完了/))?.alt)
const buttonKeys = async (ui: Found) => (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label))

test('状態ごとのボタンと、押した時の state の変化 (vscode と terminal)', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  bottom(on)
  const last = spy(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await buttonKeys(ui)).toEqual(['開始'])

    await ui.press({ key: 'start' })
    expect(last.run).toEqual({ mode: 'focus', totalMs: 25 * MIN, endsAt: NOW + 25 * MIN, leftMs: 25 * MIN })
    expect(await buttonKeys(ui)).toEqual(['一時停止', 'やめる'])

    await ui.press({ key: 'pause' })
    expect((last.run as FocusTimerRun).endsAt).toBeNull()
    expect(await buttonKeys(ui)).toEqual(['再開', 'やめる'])

    await ui.press({ key: 'resume' })
    expect((last.run as FocusTimerRun).endsAt).toBe(NOW + 25 * MIN)

    await ui.press({ key: 'stop' })
    expect(last.run).toBeNull()
    expect(await buttonKeys(ui)).toEqual(['開始'])

    if (surface === 'vscode') {
      expect(await ringAlt(ui)).toBe('待機 残り 25:00')
      expect(await todayAlt(ui)).toBe('今日の完了 0 本')
    } else {
      expect((await ui.find({ type: 'Text', text: /残り/ }))?.text).toBe('待機  残り 25:00')
      expect((await ui.find({ type: 'Text', text: /^今日/ }))?.text).toBe('今日 0 本 ')
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('集中 25 分 → 休憩 5 分 → 待機。完了本数が増え、store に残り、トーストが出る', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const saved = storeSpy(on)
  const toasts = bottom(on)
  const last = spy(on)
  await start($)

  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await vs.press({ key: 'start' })
  expect(await ringAlt(vs)).toBe('集中中 残り 25:00')
  const src = String((await svgOf(vs, /残り/))?.source)
  expect(src).toContain('<animate attributeName="stroke-dashoffset"')
  expect(src).toContain('dur="1500.000s"')
  expect(src).toContain('<set attributeName="visibility"')
  expect(src).toContain('>25:00<')
  expect(src).toContain('>24:59<')
  expect(src).toContain('url(#heat)')

  // 1 分ごとに描き直す
  await clock.advance(MIN)
  expect(await ringAlt(vs)).toBe('集中中 残り 24:00')

  await clock.advance(24 * MIN)
  expect(await ringAlt(vs)).toBe('休憩中 残り 5:00')
  expect(await todayAlt(vs)).toBe('今日の完了 1 本')
  expect(String((await svgOf(vs, /残り/))?.source)).toContain('stroke="#3fb950"')
  expect(await buttonKeys(vs)).toEqual(['一時停止', '休憩をとばす', 'やめる'])
  expect(toasts).toEqual(['集中 25 分おわり。5 分休憩しましょう'])
  expect(Object.values(last.done as Record<string, number>)).toEqual([1])
  expect(Object.values(saved.done as Record<string, number>)).toEqual([1])
  await vs.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /残り/ }))?.props.color).toBe('green')
  expect((await term.find({ type: 'Text', text: /^今日/ }))?.text).toBe('今日 1 本 ●')

  await clock.advance(5 * MIN)
  expect(last.run).toBeNull()
  expect((await term.find({ type: 'Text', text: /残り/ }))?.text).toBe('待機  残り 25:00')
  expect(toasts).toEqual(['集中 25 分おわり。5 分休憩しましょう', '休憩おわり。次の集中をどうぞ'])
  expect(Object.values(last.done as Record<string, number>)).toEqual([1])
})

test('一時停止中は進まず、再開すると残りから続ける', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  bottom(on)
  const last = spy(on)
  await start($)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await vs.press({ key: 'start' })
  await clock.advance(10 * MIN)
  await vs.press({ key: 'pause' })
  await clock.advance(60 * MIN)
  expect(await ringAlt(vs)).toBe('一時停止 残り 15:00')
  expect(String((await svgOf(vs, /残り/))?.source)).not.toContain('<animate attributeName="stroke-dashoffset"')
  expect(await todayAlt(vs)).toBe('今日の完了 0 本')

  await vs.press({ key: 'resume' })
  expect(String((await svgOf(vs, /残り/))?.source)).toContain('dur="900.000s"')
  await clock.advance(15 * MIN)
  expect((last.run as FocusTimerRun).mode).toBe('break')
  expect(await todayAlt(vs)).toBe('今日の完了 1 本')
})

test('やめると後で鳴らない。休憩をとばすと待機に戻る', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const toasts = bottom(on)
  const last = spy(on)
  await start($)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await vs.press({ key: 'start' })
  await clock.advance(5 * MIN)
  await vs.press({ key: 'stop' })
  await clock.advance(60 * MIN)
  expect(last.run).toBeNull()
  expect(toasts).toEqual([])

  await vs.press({ key: 'start' })
  await clock.advance(25 * MIN)
  expect((last.run as FocusTimerRun).mode).toBe('break')
  await vs.press({ key: 'skip' })
  expect(last.run).toBeNull()
  await clock.advance(10 * MIN)
  expect(toasts).toEqual(['集中 25 分おわり。5 分休憩しましょう'])
  expect(await ringAlt(vs)).toBe('待機 残り 25:00')
})

test('長さは userConfig の focusMinutes / breakMinutes', { options: { focusMinutes: 1, breakMinutes: 2 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  bottom(on)
  await start($)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ringAlt(vs)).toBe('待機 残り 1:00')
  await vs.press({ key: 'start' })
  await clock.advance(MIN)
  expect(await ringAlt(vs)).toBe('休憩中 残り 2:00')
  expect(String((await svgOf(vs, /残り/))?.source)).toContain('休憩 2 分')
})

test('前のセッションの今日の本数を store から読み戻す', async ($, on) => {
  mock.clock(on, { now: NOW })
  const d = new Date(NOW)
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  mock.store(on, { done: { [today]: 3, '2000-01-01': 9 } })
  bottom(on)
  await start($)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await todayAlt(vs)).toBe('今日の完了 3 本')
  await vs.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^今日/ }))?.text).toBe('今日 3 本 ●●●')
})

test('/focus を登録できればそれでペインを開く', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  bottom(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(`${e.id}:${e.title}`)
    return { value: { isPlaced: true as const } }
  })
  await start($)
  const r = await $.command.run({ command: 'focus', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(opened).toEqual(['focus-timer:集中'])
  expect(r).toMatchObject({ text: '集中タイマーを開きました。' })
})

test('/focus が組み込みで拒まれたら /focus-timer で開き、/focus は組み込みに渡す', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  bottom(on)
  const registered: string[] = []
  on('command.register', ($, e) => {
    if (e.name === 'focus') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.run', { command: 'focus' }, () => ({ text: '組み込みの focus' }))
  await start($)
  expect(registered).toEqual(['focus-timer'])
  const presentation = { isFullscreen: false, columns: 80 }
  const own = await $.command.run({ command: 'focus-timer', args: '', origin: { kind: 'composer' }, presentation })
  expect(own).toMatchObject({ text: '集中タイマーを開きました。' })
  const builtin = await $.command.run({ command: 'focus', args: '', origin: { kind: 'composer' }, presentation })
  expect(builtin).toMatchObject({ text: '組み込みの focus' })
  expect(opened).toEqual(['focus-timer'])
})
