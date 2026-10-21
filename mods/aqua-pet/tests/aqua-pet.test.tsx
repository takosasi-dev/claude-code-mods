import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { AquaFish, AquaTank, FishKind } from '../types'
import {
  FEED_MS,
  INITIAL,
  KINDS,
  UPSET_MS,
  dayOf,
  drawTank,
  fishCount,
  fishListSvg,
  fromSaved,
  kindFor,
  migrateFish,
  periodAt,
  seasonAt,
  slotAt,
  stageOf,
  stepFish,
  viewAt,
  waterAt,
} from '../hooks/tank'

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
  return { saved: () => m.get('tank') as Partial<AquaTank> | undefined, put: (v: unknown) => m.set('tank', v) }
}

/** 下の hook は全部ここで足す (test が $ を呼んだ後は足せない) */
const boot = async ($: Engine, on: On, saved?: Partial<AquaTank>, opts: { failTool?: () => boolean; now?: number; theme?: () => string } = {}) => {
  const clock = mock.clock(on, { now: opts.now ?? NOW })
  const theme = opts.theme
  if (theme) {
    on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme(), provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
    on('config.set', (_$, e) => ({ value: e.value }))
  }
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

// ---- 0.1.1 で直した物 ----

test('別のセッションが進めた turns・濁り・名前を、このセッションの古い写しで巻き戻さない', async ($, on) => {
  const m = new Map<string, unknown>([['tank', { turns: 4, murk: 0, name: '', fullness: 70, fedAt: NOW, bornAt: NOW }]])
  mock.clock(on, { now: NOW })
  on('store.get', ($, e) => ({ value: m.get(e.key) }))
  on('store.set', ($, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  // 別の窓が 36 ターン進め、濁らせ、名前を付けた
  m.set('tank', { ...(m.get('tank') as object), turns: 40, murk: 3, name: 'べつ' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const saved = () => m.get('tank') as Partial<AquaTank>
  expect(saved()).toMatchObject({ turns: 41, murk: 3, name: 'べつ' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await infoOf(ui)).toContain('べつ / 育てた日数 1日 / 累計 41ターン / 濁り 3')
  // 掃除は 0 にする操作なので、その時の値に関わらず 0
  await ui.press({ key: 'clean' })
  expect(saved()).toMatchObject({ turns: 41, murk: 0, name: 'べつ' })
})

test('store を読めない時は書かない', async ($, on) => {
  const m = new Map<string, unknown>([['tank', { turns: 30, murk: 2, name: 'たま', fullness: 70, fedAt: NOW, bornAt: NOW }]])
  let failGet = false
  mock.clock(on, { now: NOW })
  on('store.get', ($, e) => (failGet ? { deny: '読めない' } : { value: m.get(e.key) }))
  on('store.set', ($, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  failGet = true
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(m.get('tank')).toMatchObject({ turns: 30, murk: 2, name: 'たま' })
  // 形の違う値 (配列) も読めない扱いで、既定値で上書きしない
  failGet = false
  m.set('tank', [1, 2])
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(m.get('tank')).toEqual([1, 2])
})

test('サブエージェントのツールのエラーでは濁らない', async ($, on) => {
  const { tank, writes } = await boot($, on, undefined, { failTool: () => true })
  const before = writes()
  // agentId はエンジンが付ける値なので、型の上では広げて渡す (session-recap のテストと同じ形)
  const sub = { agentId: 'sub' }
  await $.tool.call({ tool: 'Read', file_path: '/tmp/demo/a.ts', ...sub })
  expect(writes()).toBe(before)
  expect((await tank()).murk).toBe(0)
})

test('同時に来たエラー 2 回は濁り 2 (書き込みを 1 本ずつ流す)', async ($, on) => {
  const { store } = await boot($, on, undefined, { failTool: () => true })
  await Promise.all([$.tool.call({ tool: 'Read', file_path: '/tmp/demo/a.ts' }), $.tool.call({ tool: 'Read', file_path: '/tmp/demo/b.ts' })])
  expect(store.saved()?.murk).toBe(2)
})

test('初めて開いた時に生まれた時刻を store に残す', async ($, on) => {
  const { store } = await boot($, on)
  expect(store.saved()).toMatchObject({ turns: 0, bornAt: NOW })
})

// ---- 0.2.0 時刻と季節で変わる背景 ----

const jst = (s: string) => Date.parse(`${s}+09:00`)
/** 状態を決めて描く (時刻と季節は now から) */
const drawAt = (now: number, over: Partial<AquaTank> = {}) => {
  const t: AquaTank = { ...INITIAL, fedAt: now, bornAt: now, ...over }
  return drawTank({ ...t, view: viewAt(t, now) })
}
const count = (s: string, part: string) => s.split(part).length - 1
const waterTop = (svg: string) => /<linearGradient id="water"[^>]*><stop offset="0" stop-color="(#[0-9a-f]{6})"/.exec(svg)?.[1]

test('季節は JST の月で決まる (春 3-5 / 夏 6-8 / 秋 9-11 / 冬 12-2)', () => {
  const days = ['02-28', '03-01', '05-31', '06-01', '08-31', '09-01', '11-30', '12-01', '01-15']
  expect(days.map(d => seasonAt(jst(`2026-${d}T12:00:00`)))).toEqual(['冬', '春', '春', '夏', '夏', '秋', '秋', '冬', '冬'])
  // UTC ではまだ 2/28 でも、JST で 3/1 なら春
  expect(seasonAt(jst('2026-03-01T00:30:00'))).toBe('春')
  expect(seasonAt(jst('2026-02-28T23:59:00'))).toBe('冬')
})

test('15 分刻みの番号は JST で 0-95', () => {
  expect(['00:00', '00:14', '00:15', '12:00', '23:59'].map(h => slotAt(jst(`2026-10-20T${h}:00`)))).toEqual([0, 0, 1, 48, 95])
})

test('朝昼夕夜で水の色・光の筋が変わり、夜は月と光る目が出る', () => {
  const at = (h: string) => drawAt(jst(`2026-10-20T${h}:00`), { turns: 25 })
  const [morning, noon, evening, night] = [at('08:00'), at('12:00'), at('17:30'), at('22:00')]
  const tops = [morning, noon, evening, night].map(waterTop)
  expect(new Set(tops).size).toBe(4)
  // 昼は筋が多く強い、夜は月明かりの 1 本
  expect(count(noon, 'fill="url(#ray)"')).toBe(4)
  expect(count(night, 'fill="url(#ray)"')).toBe(1)
  expect(count(evening, 'fill="url(#ray)"')).toBe(2)
  for (const s of [morning, noon, evening]) {
    expect(s).not.toContain('id="moon"')
    expect(s).not.toContain('eye-glow')
  }
  expect(night).toContain('id="moon"')
  expect(count(night, 'class="eye-glow"')).toBe(4) // 魚 4 匹ぶん
  expect(noon).toContain('秋の昼')
  expect(night).toContain('秋の夜')
})

test('季節ごとに飾りが変わる (春 花びら・夏 泡ときらめき・秋 落ち葉・冬 雪)', () => {
  const at = (d: string) => drawAt(jst(`2026-${d}T12:00:00`))
  const [spring, summer, autumn, winter] = [at('04-10'), at('07-20'), at('10-20'), at('01-20')]
  const ids = ['id="petals"', 'id="glints"', 'id="leaves"', 'id="snow"']
  ;[spring, summer, autumn, winter].forEach((s, i) => ids.forEach((id, k) => expect(s.includes(id)).toBe(i === k)))
  const bubbles = (s: string) => count(s, 'stroke="#e6f6ff" stroke-width="1" ')
  expect(bubbles(summer)).toBeGreaterThan(bubbles(autumn))
  // 同じ時刻でも季節で水の色味が違う
  expect(new Set([spring, summer, autumn, winter].map(waterTop)).size).toBe(4)
  expect(waterAt(48, '秋')).toEqual(waterAt(48, '秋'))
  // 飾りは魚・えさの目印を使わない
  for (const s of [spring, summer, autumn, winter]) {
    expect(count(s, 'animateMotion')).toBe(1)
    expect(s).not.toContain('fill="freeze"')
  }
})

test('どの季節・時刻帯でも、一番重い状態で SVG は上限内で、毎回同じ', () => {
  for (const d of ['04-10', '07-20', '10-20', '01-20'])
    for (const h of ['08:00', '12:00', '17:30', '22:00']) {
      const now = jst(`2026-${d}T${h}:00`)
      const t: AquaTank = { ...INITIAL, turns: 500, murk: 10, isRunning: true, fedAt: now, bornAt: now }
      const full = { ...t, view: { ...viewAt(t, now), isFeeding: true, isUpset: true } }
      expect(drawTank(full)).toBe(drawTank(full))
      expect(drawTank(full).length).toBeLessThan(131_072)
    }
})

test('描き直しは 15 分ごと (その間は state を書かない)', async ($, on) => {
  const { clock, writes, tank } = await boot($, on, { fullness: 70, fedAt: NOW })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const before = writes()
  const svg0 = await svgOf(ui)
  await clock.advance(14 * 60_000)
  expect(writes()).toBe(before)
  await clock.advance(60_000)
  expect(writes()).toBe(before + 1)
  expect((await tank()).view.slot).toBe(49)
  expect(await svgOf(ui)).not.toBe(svg0)
})

test('時計が進んで夜になり、日付が変わって季節も変わる', async ($, on) => {
  // 2/28 18:50 JST (冬の夕)
  const start = jst('2026-02-28T18:50:00')
  const { clock, tank } = await boot($, on, { fullness: 100, fedAt: start }, { now: start })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await tank()).view).toMatchObject({ period: '夕', season: '冬' })
  expect(await svgOf(ui)).toContain('id="snow"')
  expect(await svgOf(ui)).not.toContain('id="moon"')
  await clock.advance(15 * 60_000)
  expect((await tank()).view).toMatchObject({ period: '夜', season: '冬' })
  expect(await svgOf(ui)).toContain('id="moon"')
  expect(await infoOf(ui)).toContain('冬の夜')
  // 3/1 0:05 JST
  await clock.advance(5 * 3_600_000)
  expect((await tank()).view).toMatchObject({ period: '夜', season: '春' })
  expect(await svgOf(ui)).toContain('id="petals"')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await infoOf(term)).toContain('春の夜')
})

// ---- 0.3.0 魚が 1 匹ずつ育つ ----

const aFish = (id: number, kind: FishKind, turnsSeen: number, bornAt = NOW): AquaFish => ({ id, kind, bornAt, turnsSeen })

test('段階は来てからのターンで 稚魚 → 若魚 → 成魚 → 大物', () => {
  expect([0, 4, 5, 19, 20, 59, 60, 999].map(stageOf)).toEqual(['稚魚', '稚魚', '若魚', '若魚', '成魚', '成魚', '大物', '大物'])
})

test('種類: 最初はまる魚、節目が進むほど珍しい種類まで来る (同じ水槽なら同じ魚)', () => {
  const seen = (i: number) => new Set(Array.from({ length: 300 }, (_, k) => kindFor(i, NOW + k * 86_400_000)))
  expect([...seen(0)]).toEqual(['maru'])
  // 2 匹目は先頭の 3 種だけ、8 匹目は 10 種すべて
  expect([...seen(1)].every(k => KINDS.indexOf(k) <= 2)).toBe(true)
  expect(seen(1).size).toBe(3)
  expect(seen(7).size).toBe(KINDS.length)
  expect(KINDS).toHaveLength(10)
  // 0.3.x までの 6 種は並びを変えない (記録の魚の種類が変わらない)
  expect(KINDS.slice(0, 6)).toEqual(['maru', 'shima', 'mizutama', 'hirenaga', 'ougi', 'akari'])
  // 一番珍しいりゅうぐうは 8 匹目だけ
  for (const i of [1, 2, 3, 4, 5, 6]) expect(seen(i).has('ryugu')).toBe(false)
  expect(seen(7).has('ryugu')).toBe(true)
  // 一番珍しいあかり魚は 5 匹目より前には来ない
  for (const i of [1, 2, 3]) expect(seen(i).has('akari')).toBe(false)
  expect(kindFor(5, NOW)).toBe(kindFor(5, NOW))
})

test('古い記録 (魚の欄が無い) は今の数の魚に移し、来てからのターンは節目から数える', () => {
  expect(migrateFish(25, NOW).map(f => f.turnsSeen)).toEqual([25, 20, 10, 0])
  const saved = fromSaved({ turns: 25, bornAt: NOW, fullness: 70, fedAt: NOW, murk: 0, name: '' }, NOW)
  expect(saved.fish.map(f => f.id)).toEqual([0, 1, 2, 3])
  expect(saved.fish.map(f => stageOf(f.turnsSeen))).toEqual(['成魚', '成魚', '若魚', '稚魚'])
  expect(saved.fish.length).toBe(fishCount(25))
  // 壊れた魚 (番号や種類が無い) は落とし、全部壊れていれば作り直す。名前の制御文字は落とす。
  // 知らない種類 (新しい版の魚) は落とさず、種類の文字列のまま残す
  const mixed = fromSaved(
    { turns: 30, bornAt: NOW, fish: [aFish(0, 'ougi', 3), { id: 'x', kind: 'maru' }, { id: 2, kind: 'unknown' }, { id: 3, kind: 7 }, null, { ...aFish(4, 'shima', 1), name: 'ぶち\x07丸' }] },
    NOW,
  )
  expect(mixed.fish.map(f => [f.id, f.kind])).toEqual([
    [0, 'ougi'],
    [2, 'unknown'],
    [4, 'shima'],
  ])
  expect(mixed.fish[2]?.name).toBe('ぶち丸')
  expect(fromSaved({ turns: 30, bornAt: NOW, fish: [null] }, NOW).fish).toHaveLength(fishCount(30))
  expect(fromSaved({ turns: 30, bornAt: NOW, fish: Array.from({ length: 12 }, (_, i) => aFish(i, 'maru', 0)) }, NOW).fish).toHaveLength(8)
})

test('1 ターンでみんな 1 つ育ち、節目で新しい魚が来る (最大 8 匹)', () => {
  const three = stepFish(migrateFish(14, NOW), 15, NOW, NOW + 5)
  expect(three.map(f => f.turnsSeen)).toEqual([15, 10, 0])
  expect(three[2]).toMatchObject({ id: 2, bornAt: NOW + 5, kind: kindFor(2, NOW) })
  expect(stepFish(three, 16, NOW, NOW)).toHaveLength(3)
  expect(stepFish(migrateFish(500, NOW), 501, NOW, NOW)).toHaveLength(8)
})

test('ターンを重ねると store の魚が育ち、節目で 1 匹増えて残る', async ($, on) => {
  const { store, tank } = await boot($, on, { turns: 4, bornAt: NOW })
  // 魚の欄の無い古い記録は、開いた時に移して書く
  expect(store.saved()?.fish).toEqual([{ id: 0, kind: 'maru', bornAt: NOW, turnsSeen: 4 }])
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(store.saved()?.fish?.map(f => [f.id, f.turnsSeen])).toEqual([
    [0, 5],
    [1, 0],
  ])
  expect((await tank()).fish).toHaveLength(2)
  // 中断したターンでは育たない
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' })
  expect(store.saved()?.fish?.map(f => f.turnsSeen)).toEqual([5, 0])
})

test('別のセッションが足した魚を、こちらのターンで消さず、二重にも来させない', async ($, on) => {
  const { store } = await boot($, on, { turns: 14, bornAt: NOW, fish: migrateFish(14, NOW) })
  // 別の窓で 15 ターン目が終わり、3 匹目が来た
  store.put({ ...store.saved(), turns: 15, fish: stepFish(migrateFish(14, NOW), 15, NOW, NOW + 1) })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const fish = store.saved()?.fish ?? []
  expect(store.saved()?.turns).toBe(16)
  expect(fish.map(f => [f.id, f.turnsSeen])).toEqual([
    [0, 16],
    [1, 11],
    [2, 1],
  ])
  expect(fish[2]?.bornAt).toBe(NOW + 1)
})

test('大きさは段階で決まり、種類ごとに形が違う', () => {
  const at = (fish: AquaFish[]) => drawTank({ ...INITIAL, fish, view: viewAt({ ...INITIAL, fedAt: NOW, bornAt: NOW }, NOW) })
  const svg = at([aFish(0, 'maru', 0), aFish(1, 'maru', 5), aFish(2, 'maru', 20), aFish(3, 'maru', 60)])
  for (const sc of ['0.55', '0.8', '1.1', '1.5']) expect(svg).toContain(`transform="scale(${sc})"`)
  expect(count(svg, 'animateMotion')).toBe(4)
  // 一匹ずつ描いて、10 種とも違う絵。あかり魚だけ提灯が光る
  const one = KINDS.map(k => at([aFish(0, k, 30)]))
  expect(new Set(one).size).toBe(KINDS.length)
  one.forEach((s, i) => expect(s.includes('class="lure"')).toBe(KINDS[i] === 'akari'))
  // 魚が配列で渡されれば turns の数ではなく配列の数
  expect(count(at([aFish(0, 'shima', 1)]), 'animateMotion')).toBe(1)
  // 0.2.x の state (fish が無い) が残ったまま描かれても、turns の数で描く
  expect(count(drawTank({ ...INITIAL, turns: 25, fish: undefined as never }), 'animateMotion')).toBe(4)
})

test('魚の一覧の SVG: 種類・段階・来た日を並べ、幅を付けない', () => {
  const day = Date.parse('2026-10-18T15:30:00Z') // JST 10/19 0:30
  expect(dayOf(day)).toBe('10月19日')
  const svg = fishListSvg([aFish(0, 'ougi', 70, day), { ...aFish(1, 'akari', 2, NOW), name: '<ぴか>' }])
  expect(svg).toMatch(/魚の一覧[\s\S]*2 匹/)
  expect(svg).toMatch(/おうぎ尾[\s\S]*大物[\s\S]*10月19日に来た \/ 70ターン/)
  expect(svg).toContain('あかり魚 &lt;ぴか&gt;')
  expect(svg).toContain('稚魚')
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
  expect(fishListSvg(migrateFish(500, NOW)).length).toBeLessThan(131_072)
})

for (const surface of SURFACES) {
  test(`${surface}: 一覧ボタンで魚の一覧に切り替わり、もう一度で水槽に戻る`, async ($, on) => {
    await boot($, on, { turns: 25, bornAt: NOW, fullness: 70, fedAt: NOW })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'list' }))?.props.label).toBe('一覧')
    await ui.press({ key: 'list' })
    expect((await ui.find({ key: 'list' }))?.props.label).toBe('水槽')
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toMatch(/魚の一覧[\s\S]*4 匹/)
      expect(svg).toMatch(/まる魚[\s\S]*成魚[\s\S]*10月20日に来た \/ 25ターン/)
      expect(svg).not.toContain('animateMotion')
    } else {
      expect(await ui.find({ type: 'Text', text: /^まる魚/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '成魚' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '  10月20日に来た / 0ターン' })).toBeDefined()
      expect(await summaryOf(ui)).toBe('魚 4 匹 / 満腹度 70%')
    }
    await ui.press({ key: 'list' })
    if (surface === 'vscode') expect(count(await svgOf(ui), 'animateMotion')).toBe(4)
    else expect(await ui.find({ type: 'Text', text: /来た/ })).toBeUndefined()
  })
}

test('/config の theme が light 系なら枠と HUD を明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  await boot($, on, { turns: 5 }, { theme: () => theme })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgOf(ui)).toContain('rx="14" fill="#ffffff"')
  expect(await svgOf(ui)).toContain('fill="#f6f8fa" opacity=".88"')
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await svgOf(ui)).toContain('rx="14" fill="#0d1117"')
  expect(await svgOf(ui)).not.toContain('rx="14" fill="#ffffff"')
})

// ---- 0.4.0 夕は橙・魚 10 種・知らない欄を消さない ----

test('夕方は水が橙で日が沈みかけ、夜は月 (どちらも HUD の上に描く)', () => {
  const at = (h: string) => drawAt(jst(`2026-10-20T${h}:00`), { turns: 25 })
  const [noon, evening, night] = [at('12:00'), at('17:30'), at('22:00')]
  expect(evening).toContain('id="sunset"')
  for (const s of [noon, night]) expect(s).not.toContain('id="sunset"')
  // 赤が青より強い (橙)
  const rgb = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  const [r = 0, , b = 0] = rgb(waterTop(evening) ?? '#000000')
  expect(r).toBeGreaterThan(b + 60)
  // HUD の地より後に描く (前だと隠れる)
  for (const [s, id] of [[evening, 'id="sunset"'], [night, 'id="moon"']] as const) expect(s.indexOf(id)).toBeGreaterThan(s.indexOf('opacity=".88"'))
})

test('新しい版が足した欄は、水槽の中も魚の中も消さずに書き戻す', async ($, on) => {
  const fish = [{ ...aFish(0, 'maru', 4), futureFish: 'x' }]
  const { store } = await boot($, on, { turns: 4, bornAt: NOW, fullness: 70, fedAt: NOW, murk: 0, name: '', fish, futureField: 1 } as Partial<AquaTank>)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const saved = store.saved() as Record<string, unknown> & Partial<AquaTank>
  expect(saved.turns).toBe(5)
  expect(saved.futureField).toBe(1)
  expect(saved.fish?.[0]).toMatchObject({ id: 0, turnsSeen: 5, futureFish: 'x' })
  expect(saved.fish).toHaveLength(2)
  // 知っている欄の壊れた値は直す (名前の制御文字)
  expect(fromSaved({ turns: 1, fish: [{ ...aFish(0, 'maru', 1), name: 'a\x07', more: 2 }] }, NOW).fish[0]).toEqual({ ...aFish(0, 'maru', 1, NOW), name: 'a', more: 2 })
})

test('知らない種類の魚は残って、まる魚の形で描かれ、一覧では「なぞの魚」', async ($, on) => {
  const odd = { ...aFish(1, 'maru', 30), kind: 'kirin' } as AquaFish
  const draw = (fish: AquaFish[]) => drawTank({ ...INITIAL, fish, view: viewAt({ ...INITIAL, fedAt: NOW, bornAt: NOW }, NOW) })
  // 番号 1 の魚を、まる魚として描いた時と同じ絵
  expect(draw([odd])).toBe(draw([aFish(1, 'maru', 30)]))
  expect(fishListSvg([odd])).toContain('なぞの魚')
  // ターンをまたいでも store に種類の文字列のまま残る
  const { store } = await boot($, on, { turns: 5, bornAt: NOW, fullness: 70, fedAt: NOW, murk: 0, name: '', fish: [aFish(0, 'maru', 5), odd] })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(store.saved()?.fish?.map(f => [f.id, f.kind, f.turnsSeen])).toEqual([
    [0, 'maru', 6],
    [1, 'kirin', 31],
  ])
})
