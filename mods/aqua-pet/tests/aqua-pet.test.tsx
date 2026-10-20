import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { AquaTank } from '../types'
import { FEED_MS, INITIAL, UPSET_MS, drawTank, fishCount, periodAt, viewAt } from '../hooks/tank'

// 2026-10-20 12:00 JST (昼)
const NOW = Date.parse('2026-10-20T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'aqua-pet',
  component: 'Pane',
  requestId: 'aqua-pet',
  props: {
    title: '水槽',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** store を手元の Map で答え、書かれた値を test から読めるようにする */
const fakeStore = (on: On, init: Record<string, unknown> = {}) => {
  const m = new Map<string, unknown>(Object.entries(init))
  on('store.get', ($, e) => ({ value: m.get(e.key) }))
  on('store.set', ($, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return { saved: () => m.get('tank') as Partial<AquaTank> | undefined }
}

/** 下の hook は全部ここで足す (test が $ を呼んだ後は足せない) */
const boot = async ($: Engine, on: On, saved?: Partial<AquaTank>, opts: { failTool?: () => boolean } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const store = fakeStore(on, saved ? { tank: saved } : {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const failTool = opts.failTool
  if (failTool) on('tool.call', () => (failTool() ? { isError: true as const, result: 'boom', text: 'boom' } : { result: 'ok' }))
  // test の $ に state は無いので、書かれた値を下で拾う
  let last: AquaTank | undefined
  let writes = 0
  on('state.set', async ($, e, next) => {
    const r = await next(e)
    if (e.plugin === 'aqua-pet' && e.key === 'tank' && r.value?.isSet) {
      last = e.value as AquaTank
      writes++
    }
    return r
  })
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  const tank = async () => {
    if (!last) throw new Error('tank が書かれていない')
    return last
  }
  return { clock, store, tank, writes: () => writes }
}

type Drawn = { find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }
const svgOf = async (ui: Drawn) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const infoOf = async (ui: Drawn) => (await ui.find({ type: 'Text', text: /育てた日数/ }))?.text ?? ''
const summaryOf = async (ui: Drawn) => (await ui.find({ type: 'Text', text: /^魚 \d+ 匹/ }))?.text ?? ''

test('魚の数は 0〜4 ターンで 1 匹、以後 10 ターンごとに 1 匹、最大 8 匹', () => {
  expect([0, 4, 5, 14, 15, 25, 65, 75, 500].map(fishCount)).toEqual([1, 1, 2, 2, 3, 4, 8, 8, 8])
})

test('時刻帯は JST で決まる', () => {
  const at = (h: number) => periodAt(Date.parse(`2026-10-20T${String(h).padStart(2, '0')}:30:00+09:00`))
  expect([5, 9, 10, 15, 16, 18, 19, 4].map(at)).toEqual(['朝', '朝', '昼', '昼', '夕', '夕', '夜', '夜'])
})

test('同じ状態なら SVG は毎回同じ (ちらつかない)・最大でも上限内', () => {
  const t: AquaTank = { ...INITIAL, turns: 500, murk: 10, isRunning: true }
  const full = { ...t, view: { ...viewAt(t, NOW), isFeeding: true, isUpset: true } }
  expect(drawTank(full)).toBe(drawTank(full))
  expect(drawTank(full).length).toBeLessThan(131_072)
  expect((drawTank(full).match(/animateMotion/g) ?? []).length).toBe(8)
})

for (const surface of SURFACES) {
  test(`${surface}: 主な要素を描く`, async ($, on) => {
    await boot($, on, { turns: 25, fullness: 70, fedAt: NOW, bornAt: NOW - 3 * 86_400_000 })
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const key of ['feed', 'rename', 'clean']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
    expect(await infoOf(ui)).toContain('育てた日数 4日 / 累計 25ターン')
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg.startsWith('<svg')).toBe(true)
      expect((svg.match(/animateMotion/g) ?? []).length).toBe(4)
      expect(svg).toContain('font-family="sans-serif"')
      expect(svg).not.toMatch(/<svg[^>]* width=/)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await summaryOf(ui)).toBe('魚 4 匹 / 満腹度 70%')
    }
  })

  test(`${surface}: えさをやると満腹度が上がり、粒が落ちて、しばらくで消える`, async ($, on) => {
    const { clock, store, tank } = await boot($, on, { fullness: 40, fedAt: NOW })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'feed' })
    expect((await tank()).view.fullness).toBe(65)
    expect(store.saved()?.fullness).toBe(65)
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('fill="freeze"')
    else expect(await summaryOf(ui)).toContain('満腹度 65%')
    await clock.advance(FEED_MS + 100)
    expect((await tank()).view.isFeeding).toBe(false)
    if (surface === 'vscode') expect(await svgOf(ui)).not.toContain('fill="freeze"')
    for (let i = 0; i < 4; i++) await ui.press({ key: 'feed' })
    expect((await tank()).view.fullness).toBe(100) // 100 を超えない
  })

  test(`${surface}: 名前ボタンで入力欄が出て、決めると state と store に残る`, async ($, on) => {
    const { store, tank } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await ui.press({ key: 'rename' })
    expect(await ui.find({ type: 'Input', key: 'name' })).toBeDefined()
    await ui.input({ key: 'name', text: '  ぎょぎょ丸  ' })
    expect((await tank()).name).toBe('ぎょぎょ丸')
    expect(store.saved()?.name).toBe('ぎょぎょ丸')
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    expect(await infoOf(ui)).toContain('ぎょぎょ丸 / ')
  })

  test(`${surface}: 掃除で濁りが 0 に戻る`, async ($, on) => {
    const { store, tank } = await boot($, on, { murk: 4 })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await infoOf(ui)).toContain('濁り 4')
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('#5b6a2e')
    await ui.press({ key: 'clean' })
    expect((await tank()).murk).toBe(0)
    expect(store.saved()?.murk).toBe(0)
    expect(await infoOf(ui)).not.toContain('濁り')
    if (surface === 'vscode') expect(await svgOf(ui)).not.toContain('#5b6a2e')
  })
}

test('主ループのターンで実行中になり、終わると累計が増えて魚が増える (サブエージェントは数えない)', async ($, on) => {
  const { store, tank } = await boot($, on, { turns: 4 })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await summaryOf(ui)).toBe('魚 1 匹 / 満腹度 70%')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect((await tank()).isRunning).toBe(true)
  expect(await summaryOf(ui)).toContain('作業中')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1', agentId: 'sub', reason: 'answer' })
  expect((await tank()).turns).toBe(4)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't0', reason: 'aborted' })
  expect((await tank()).turns).toBe(4)
  expect((await tank()).isRunning).toBe(false)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await tank()).isRunning).toBe(false)
  expect((await tank()).turns).toBe(5)
  expect(store.saved()?.turns).toBe(5)
  expect(await summaryOf(ui)).toBe('魚 2 匹 / 満腹度 70%')
})

test('満腹度は時間で減り、低いと魚がくすむ', async ($, on) => {
  const { clock, tank } = await boot($, on, { fullness: 70, fedAt: NOW })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgOf(ui)).not.toContain('filter="url(#dull)"')
  await clock.advance(9 * 3_600_000)
  expect((await tank()).view.fullness).toBe(25)
  expect(await svgOf(ui)).toContain('filter="url(#dull)"')
})

test('実行中は泳ぎが速く泡が多い', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const bubbles = (s: string) => (s.match(/stroke="#e6f6ff" stroke-width="1" /g) ?? []).length
  const idle = await svgOf(ui)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const busy = await svgOf(ui)
  expect(bubbles(busy)).toBeGreaterThan(bubbles(idle))
  expect(busy).toContain('作業中')
})

test('ツールのエラーで魚が赤くなって震え、濁りが増え、少しで戻る (成功では書かない)', async ($, on) => {
  let fail = false
  const { clock, tank, writes } = await boot($, on, undefined, { failTool: () => fail })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const before = writes()
  await $.tool.call({ tool: 'Read', file_path: 'C:/x' })
  expect(writes()).toBe(before)
  fail = true
  await $.tool.call({ tool: 'Read', file_path: 'C:/x' })
  expect((await tank()).view.isUpset).toBe(true)
  expect((await tank()).murk).toBe(1)
  expect(await svgOf(ui)).toContain('stop-color="#f85149"')
  expect(await svgOf(ui)).toContain('びっくり')
  await clock.advance(UPSET_MS + 100)
  expect((await tank()).view.isUpset).toBe(false)
  expect(await svgOf(ui)).not.toContain('stop-color="#f85149"')
})

test('10 分超えて待機すると底でじっとする (terminal はおやすみ)', async ($, on) => {
  const { clock, tank } = await boot($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(9 * 60_000)
  expect((await tank()).view.isIdle).toBe(false)
  await clock.advance(2 * 60_000)
  expect((await tank()).view.isIdle).toBe(true)
  expect(await summaryOf(ui)).toContain('おやすみ')
  const svg = drawTank(await tank())
  expect(svg).not.toContain('animateMotion')
  expect(svg).toContain('>z<')
})

test('store の値はセッションをまたいで読み込まれ、壊れた値は既定に戻す', async ($, on) => {
  const { tank } = await boot($, on, { turns: 'x' as unknown as number, name: 'たろう', murk: 99, bornAt: NOW - 86_400_000 })
  const t = await tank()
  expect(t.turns).toBe(0)
  expect(t.name).toBe('たろう')
  expect(t.murk).toBe(10)
  expect(t.view.days).toBe(2)
})
