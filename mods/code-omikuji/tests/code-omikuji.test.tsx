import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { OmikujiDay, OmikujiResult } from '../types'
import { RANK_NAMES, WORDS, addDay, fillText, fortune, jstDate, kanji, lastDays, paneSvg, wrap } from '../hooks/omikuji'

// 2026-10-20 12:00 JST
const NOW = Date.parse('2026-10-20T03:00:00Z')
const TODAY = '2026-10-20'
const DAY = 86_400_000
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'code-omikuji',
  component: 'Pane',
  requestId: 'code-omikuji',
  props: {
    title: 'おみくじ',
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
  let writes = 0
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    writes++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return {
    today: () => m.get('today') as OmikujiResult | undefined,
    history: () => m.get('history') as OmikujiDay[] | undefined,
    writes: () => writes,
  }
}

/** 下の hook は全部ここで足す (test が $ を呼んだ後は足せない) */
const boot = async ($: Engine, on: On, init: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const store = fakeStore(on, init)
  const filled: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const open = () =>
    $.command.run({ command: 'omikuji', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  return { clock, store, filled, open }
}

type Drawn = { find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }
const svgOf = async (ui: Drawn) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')

test('乱数: 同じ日なら同じ結果、日が違えばばらける、遊びは別の結果', () => {
  expect(fortune(TODAY)).toEqual(fortune(TODAY))
  expect(fortune(TODAY, 3)).toEqual(fortune(TODAY, 3))
  expect(fortune(TODAY, 1)).not.toEqual(fortune(TODAY))
  const days = Array.from({ length: 120 }, (_, i) => fortune(jstDate(NOW + i * DAY)))
  const ranks = new Set(days.map(f => f.rank))
  expect(ranks.size).toBe(7)
  expect(new Set(days.map(f => f.language)).size).toBeGreaterThan(8)
  for (const f of days) {
    expect(RANK_NAMES).toContain(f.rank)
    expect(f.number).toBeGreaterThanOrEqual(1)
    expect(f.number).toBeLessThanOrEqual(100)
    expect(WORDS.warning).toContain(f.warning)
  }
  // 各項目 10 個以上
  for (const list of Object.values(WORDS)) expect(list.length).toBeGreaterThanOrEqual(10)

  // JST の日付で切り替わる
  expect(jstDate(Date.parse('2026-10-20T14:59:00Z'))).toBe('2026-10-20')
  expect(jstDate(Date.parse('2026-10-20T15:00:00Z'))).toBe('2026-10-21')
  expect(lastDays('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02'])
  expect([1, 10, 17, 20, 86, 100].map(kanji)).toEqual(['一', '十', '十七', '二十', '八十六', '百'])
  expect(wrap('あいうえおabc', 6)).toEqual(['あいう', 'えおab', 'c'])

  // 7 日より古い分は落ちる。同じ日は上書き
  let h: OmikujiDay[] = []
  for (let i = 0; i < 10; i++) h = addDay(h, { date: jstDate(NOW + i * DAY), rank: '吉' })
  h = addDay(h, { date: jstDate(NOW + 9 * DAY), rank: '凶' })
  expect(h).toHaveLength(7)
  expect(h[0]?.date).toBe('2026-10-23')
  expect(h[6]).toEqual({ date: '2026-10-29', rank: '凶' })

  // 入力欄の 1 行
  const f = fortune(TODAY)
  expect(fillText(f)).toMatch(new RegExp(`^今日の運勢は${f.rank}。ラッキー言語は `))
  expect(fillText(f)).not.toMatch(/\n/)

  // 振るアニメは shake の時だけ
  const shake = paneSvg(f, TODAY, [], { isShake: true, isPlay: false })
  const paper = paneSvg(f, TODAY, [], { isShake: false, isPlay: false })
  expect(shake).toMatch(/animateTransform attributeName="transform" type="rotate"/)
  expect(shake).toMatch(/御/)
  expect(paper).not.toMatch(/<animate/)
  expect(paper).toMatch(/#d9381e/)
  expect(paper).toMatch(/#f3ead6/)
  expect(paneSvg(f, TODAY, [], { isShake: false, isPlay: true })).toMatch(/遊び/)
  expect(shake.length).toBeLessThan(131_072)
})

for (const surface of SURFACES) {
  test(`${surface}: 初めは振るアニメ、2 回目からは紙だけ。本番は同じ日なら同じ`, async ($, on) => {
    const { clock, store, open } = await boot($, on)
    const want = fortune(TODAY)
    // 開くまでは store に書かない (引いていない日に丸を付けない)
    expect(store.writes()).toBe(0)
    const ran = await open()
    expect(ran).toMatchObject({ text: 'おみくじを開きました。' })
    expect(store.today()).toEqual(want)
    expect(store.history()).toEqual([{ date: TODAY, rank: want.rank }])

    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const src = await svgOf(ui)
      expect(src).toMatch(/type="rotate"/)
      expect(src).toMatch(/コ/)
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toMatch(new RegExp(want.words))
      expect(await ui.find({ key: 'lines' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: `10/20 のコード運勢  第${want.number}番` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: want.rank })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: `言語: ${want.language}` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: `戒め: ${want.warning}` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^この 7 日: 10\/14 ─ .* 10\/20 / })).toBeDefined()
    }

    // アニメが終わったら紙だけの絵に替わる
    await clock.advance(3600)
    if (surface === 'vscode') expect(await svgOf(ui)).not.toMatch(/<animate/)

    await open()
    expect(store.today()).toEqual(want)
    if (surface === 'vscode') {
      const src = await svgOf(ui)
      expect(src).not.toMatch(/<animate/)
      expect(src).toMatch(new RegExp(`>${[...want.rank][0]}<`))
    } else expect(await ui.find({ type: 'Text', text: want.rank })).toBeDefined()
  })

  test(`${surface}: もう一度振るは遊び。本番の store は変わらない`, async ($, on) => {
    const { clock, store, open, filled } = await boot($, on)
    await open()
    const want = fortune(TODAY)
    const writes = store.writes()
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'back' })).toBeUndefined()

    await ui.press({ key: 'shake' })
    const p1 = fortune(TODAY, 1)
    expect(await ui.find({ type: 'Text', text: '遊びの一回です。本番の運勢は変わりません' })).toBeDefined()
    expect(await ui.find({ key: 'back' })).toBeDefined()
    if (surface === 'vscode') {
      const src = await svgOf(ui)
      expect(src).toMatch(/type="rotate"/)
      expect(src).toMatch(/遊び/)
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toMatch(new RegExp(`第${p1.number}番`))
    } else {
      expect(await ui.find({ type: 'Text', text: `言語: ${p1.language}` })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: `遊びの一回です(本番は${want.rank})` }))?.props.color).toBe('yellow')
    }
    // 振り直すと前の回の「紙に替える」は効かない
    await clock.advance(2000)
    await ui.press({ key: 'shake' })
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: `言語: ${fortune(TODAY, 2).language}` })).toBeDefined()
    await clock.advance(2000)
    if (surface === 'vscode') expect(await svgOf(ui)).toMatch(/type="rotate"/)
    await clock.advance(1700)
    if (surface === 'vscode') expect(await svgOf(ui)).not.toMatch(/<animate/)
    expect(store.writes()).toBe(writes)
    expect(store.today()).toEqual(want)

    // 入力欄へは本番の運勢
    await ui.press({ key: 'fill' })
    expect(filled).toEqual([fillText(want)])
    expect(await ui.find({ type: 'Text', text: '入力欄に入れました(送信はしていません)' })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    if (surface === 'vscode') expect(await svgOf(ui)).not.toMatch(/<animate/)
    else expect(await ui.find({ type: 'Text', text: `言語: ${want.language}` })).toBeDefined()
  })

  test(`${surface}: 直近 7 日の丸。日が変わると次の本番`, async ($, on) => {
    const old = [
      { date: '2026-10-10', rank: '大凶' },
      { date: '2026-10-15', rank: '大吉' },
      { date: '2026-10-18', rank: '凶' },
    ]
    const { clock, store, open } = await boot($, on, { history: old })
    await open()
    const want = fortune(TODAY)
    expect(store.history()).toEqual([old[1], old[2], { date: TODAY, rank: want.rank }])
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const src = await svgOf(ui)
      expect(src).toMatch(/この 7 日/)
      expect(src).toMatch(/>10\/14</)
      expect(src).not.toMatch(/>10\/13</)
      expect(src).toMatch(/fill="#e83929" text-anchor="middle">大吉</)
      expect(src).toMatch(/fill="#bc8cff" text-anchor="middle">凶</)
    } else expect(await ui.find({ type: 'Text', text: /^この 7 日: 10\/14 ─ \/ 10\/15 大吉 \/ 10\/16 ─ \/ 10\/17 ─ \/ 10\/18 凶 / })).toBeDefined()

    await clock.advance(DAY)
    await open()
    const next = fortune('2026-10-21')
    expect(store.today()).toEqual(next)
    expect(store.history()?.map(d => d.date)).toEqual(['2026-10-15', '2026-10-18', TODAY, '2026-10-21'])
  })
}

test('入力欄に入れられなければそう言う', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('prompt.fill', () => ({ isFilled: false }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'omikuji', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'fill' })
  expect(await ui.find({ type: 'Text', text: '入力欄に入れられませんでした' })).toBeDefined()
})

test('/omikuji が取れなければ /code-omikuji を登録する', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const tried: string[] = []
  let isTaken = false
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'omikuji' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['omikuji'])
  isTaken = true
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['omikuji', 'omikuji', 'code-omikuji'])
  const ran = await $.command.run({ command: 'code-omikuji', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(ran).toMatchObject({ text: 'おみくじを開きました。' })
})
