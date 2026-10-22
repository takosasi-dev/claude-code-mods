import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TokenMeterTurn } from '../types'

const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'token-meter',
  component: 'Pane',
  requestId: 'token-meter',
  props: {
    title: 'トークン',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const GREEN = '#3fb950'
const YELLOW = '#d29922'
const RED = '#f85149'

// エンジンの代わりに一番下で答える
const bottom = (on: On) => {
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
}

// mod が書いた state を覗く
const spy = (on: On) => {
  const last: Record<string, unknown> = {}
  on('state.set', ($, e, next) => {
    if (e.plugin === 'token-meter') last[e.key] = e.value
    return next(e)
  })
  return last
}

type U = { input: number; output: number; read: number; write: number }
const turn = async ($: Engine, id: string, u: U | null, agentId?: string) =>
  $.turn.complete({
    answer: 'a',
    durationMs: 1000,
    isAborted: false,
    turnId: id,
    reason: 'answer',
    ...(agentId ? { agentId } : {}),
    ...(u
      ? {
          usage: {
            model: 'test-model',
            input_tokens: u.input,
            output_tokens: u.output,
            cache_read_input_tokens: u.read,
            cache_creation_input_tokens: u.write,
          },
        }
      : {}),
  })

// Svg と Text の key は描かれた木に残らないので、Svg は alt で探す
type Found = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
const svgOf = async (ui: Found, alt: RegExp) => (await ui.findAll({ type: 'Svg' })).find(el => alt.test(String(el.props.alt)))?.props
const src = async (ui: Found, alt: RegExp) => String((await svgOf(ui, alt))?.source ?? '')

test('合計・当たり率・積み上げ棒・一番重いターンを描き、リセットで 0 に戻す', async ($, on) => {
  bottom(on)
  const last = spy(on)
  await turn($, 't1', { input: 1200, output: 300, read: 0, write: 8000 })
  await turn($, 't2', { input: 200, output: 3400, read: 90_000, write: 500 })
  await turn($, 't3', { input: 100, output: 800, read: 9_000, write: 0 })
  await turn($, 'aborted', null) // usage の無いターンは数えない

  for (const surface of SURFACES) {
    // 1 面目でリセットするので、2 面目の前に流し直す
    if (surface === 'terminal') {
      await turn($, 't1', { input: 1200, output: 300, read: 0, write: 8000 })
      await turn($, 't2', { input: 200, output: 3400, read: 90_000, write: 500 })
      await turn($, 't3', { input: 100, output: 800, read: 9_000, write: 0 })
    }
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      // 入力 1500 / 出力 4500 / 読み 99000 / 書き 8500 → 当たり率 99000/109000 = 91%
      expect((await svgOf(ui, /^合計/))?.alt).toBe('合計 入力 1.5k 出力 4.5k キャッシュ読み 99k キャッシュ書き 8.5k 当たり率 91%')
      const summary = await src(ui, /^合計/)
      expect(summary).toContain(`fill="${GREEN}" text-anchor="middle" font-weight="bold">91%<`)
      expect(summary).toContain('<animate attributeName="stroke-dashoffset"')
      const bars = await src(ui, /^ターンごと/)
      expect((await svgOf(ui, /^ターンごと/))?.alt).toBe('ターンごとの積み上げ棒 直近3ターン')
      expect(bars).toContain('<animate attributeName="y"')
      expect(bars).toContain('<animate attributeName="height"')
      expect(bars).toContain('キャッシュ読み')
      expect(bars).toContain('#3 最新 9.9k')
      expect(bars).toContain('>#2  94.1k<') // 一番重いのは t2 (200+3400+90000+500)
      expect(await ui.find({ type: 'Text' })).toBeUndefined()
    } else {
      expect((await ui.find({ type: 'Text', text: /^入力/ }))?.text).toBe('入力 1.5k  出力 4.5k')
      expect((await ui.find({ type: 'Text', text: /^キャッシュ/ }))?.text).toBe('キャッシュ 読み 99k  書き 8.5k')
      expect((await ui.find({ type: 'Text', text: /^当たり率/ }))?.props.color).toBe('green')
      expect((await ui.find({ type: 'Text', text: /^一番重かった/ }))?.text).toBe('一番重かったターン #2 94.1k')
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    }

    await ui.press({ key: 'reset' })
    expect(last.total).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    expect(last.turns).toEqual([])
    expect(last.count).toBe(0)
    expect(last.heaviest).toBeNull()
    if (surface === 'vscode') {
      expect((await svgOf(ui, /^合計/))?.alt).toBe('合計 入力 0 出力 0 キャッシュ読み 0 キャッシュ書き 0 当たり率 ─')
      expect(await src(ui, /^ターンごと/)).toContain('まだターンがありません')
    } else {
      expect((await ui.find({ type: 'Text', text: /^当たり率/ }))?.text).toBe('当たり率 ─')
      expect((await ui.find({ type: 'Text', text: /^まだ/ }))?.text).toBe('まだターンがありません')
    }
    await ui.unmount()
  }
})

test('当たり率の色: 70% 以上は緑、40% 以上は黄、それ未満は赤', async ($, on) => {
  bottom(on)
  const cases: [U, string, string][] = [
    [{ input: 30, output: 0, read: 70, write: 0 }, GREEN, '70%'],
    [{ input: 60, output: 0, read: 40, write: 0 }, YELLOW, '40%'],
    [{ input: 61, output: 0, read: 39, write: 0 }, RED, '39%'],
  ]
  for (const [u, color, pct] of cases) {
    await turn($, 'x', u)
    const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
    expect(await src(ui, /^合計/)).toContain(`fill="${color}" text-anchor="middle" font-weight="bold">${pct}<`)
    await ui.press({ key: 'reset' })
    await ui.unmount()
  }
})

test('サブエージェントのターンは棒に入れず、合計も別に数える', async ($, on) => {
  bottom(on)
  const last = spy(on)
  await turn($, 'main', { input: 10, output: 20, read: 30, write: 40 })
  await turn($, 'sub1', { input: 1000, output: 1000, read: 1000, write: 1000 }, 'agent-1')
  await turn($, 'sub2', { input: 1000, output: 1000, read: 1000, write: 1000 }, 'agent-1')
  expect(last.total).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 })
  expect(last.sub).toEqual({ input: 2000, output: 2000, cacheRead: 2000, cacheWrite: 2000, runs: 2 })
  expect(last.turns).toHaveLength(1)

  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await src(vs, /^合計/)).toContain('サブエージェント 2回  計 8k')
  await vs.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^サブ/ }))?.text).toBe('サブエージェント 2回 計 8k')
})

test('ターンは直近 50 件だけ持ち、番号は通しで振る。棒は直近 20 本', async ($, on) => {
  bottom(on)
  const last = spy(on)
  for (let i = 1; i <= 55; i++) await turn($, `t${i}`, { input: i, output: 0, read: 0, write: 0 })
  const turns = last.turns as TokenMeterTurn[]
  expect(turns).toHaveLength(50)
  expect(turns[0]?.n).toBe(6)
  expect(turns[49]?.n).toBe(55)
  expect((last.heaviest as TokenMeterTurn).n).toBe(55)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await svgOf(vs, /^ターンごと/))?.alt).toBe('ターンごとの積み上げ棒 直近20ターン')
  const bars = await src(vs, /^ターンごと/)
  expect(bars).toContain('>#36<')
  expect(bars).toContain('#55 最新 55')
})

test('/clear で数え直す', async ($, on) => {
  bottom(on)
  const last = spy(on)
  on('session.end', () => ({ sessionId: 's' }))
  await turn($, 't1', { input: 5, output: 5, read: 5, write: 5 })
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(last.count).toBe(0)
  expect(last.turns).toEqual([])
})

test('/tokens でペインを開く', async ($, on) => {
  bottom(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(`${e.id}:${e.title}`)
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  const r = await $.command.run({ command: 'tokens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(opened).toEqual(['token-meter:トークン'])
  expect(r).toMatchObject({ text: 'トークンのペインを開きました。' })
})

test('/tokens が拒まれたら /token-meter で開き、/tokens には触らない', async ($, on) => {
  bottom(on)
  const registered: string[] = []
  on('command.register', ($, e) => {
    if (e.name === 'tokens') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('command.run', { command: 'tokens' }, () => ({ text: '組み込みの tokens' }))
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['token-meter'])
  const presentation = { isFullscreen: false, columns: 80 }
  expect(await $.command.run({ command: 'token-meter', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({
    text: 'トークンのペインを開きました。',
  })
  expect(await $.command.run({ command: 'tokens', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({
    text: '組み込みの tokens',
  })
})

test('/tokens を持てた時は /token-meter をその名前の持ち主に回す。別の名前で返されたら持てていない', async ($, on) => {
  bottom(on)
  let renamed = false
  on('command.register', ($, e) => ({ value: { command: renamed && e.name === 'tokens' ? 'tokens-2' : e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('command.run', ($, e) => ({ text: `別の ${e.command}` }))
  const run = (command: string) => $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  expect(await run('tokens')).toMatchObject({ text: 'トークンのペインを開きました。' })
  expect(await run('token-meter')).toMatchObject({ text: '別の token-meter' })
  renamed = true
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  expect(await run('tokens')).toMatchObject({ text: '別の tokens' })
  expect(await run('token-meter')).toMatchObject({ text: 'トークンのペインを開きました。' })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  bottom(on)
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  await turn($, 't1', { input: 30, output: 0, read: 70, write: 0 })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await src(ui, /^合計/)).toMatch(/fill="#ffffff"/)
  expect(await src(ui, /^合計/)).toContain('fill="#1a7f37" text-anchor="middle" font-weight="bold">70%<') // 明るい緑
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await src(ui, /^合計/)).toMatch(/fill="#0d1117"/)
  expect(await src(ui, /^合計/)).toContain(`fill="${GREEN}" text-anchor="middle" font-weight="bold">70%<`)
})
