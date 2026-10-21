import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { OmikujiDay, OmikujiResult } from '../types'
import { RANK_NAMES, SEASON_WORDS, WORDS, addDay, fillText, fortune, isResult, jstDate, kanji, lastDays, paneSvg, seasonOf, wrap } from '../hooks/omikuji'

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
  const modes: string[] = []
  const world = { isPaneUp: true }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: world.isPaneUp ? [{ id: 'code-omikuji', title: 'おみくじ', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    modes.push(String(e.mode))
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const open = () =>
    $.command.run({ command: 'omikuji', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  return { clock, store, filled, modes, world, open }
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
  // 棒の番号は数が回って止まり、今日の丸は紙が開いてから出る
  expect(shake).toMatch(new RegExp(`opacity="0">第${kanji(f.number)}番<animate attributeName="opacity" from="0" to="1"`))
  expect(shake).toMatch(/<g opacity="1"><animate attributeName="opacity" from="0" to="1" begin="3s"[^>]*\/><text x="12"[^>]*>この 7 日</)
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
      expect(src).toMatch(/fill="#f85149" text-anchor="middle">大吉</)
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

test('/omikuji が取れなかった時は、元の /omikuji を横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (e.name === 'omikuji' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.run', { command: 'omikuji' }, () => ({ text: '組み込みの omikuji' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'omikuji', ...run })).toMatchObject({ text: '組み込みの omikuji' })
  expect(opened).toEqual([])
})

// 2026-10-20 12:00 JST から 12 時間 5 分後 = 10/21 00:05 JST
const PAST_MIDNIGHT = 12 * 3600_000 + 5 * 60_000

test('開いたまま日付をまたぐと、今日の運勢に入れ替わる。入力欄へは今日の分を、下書きを消さずに入れる', async ($, on) => {
  const { clock, store, filled, modes, open } = await boot($, on)
  await open()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(PAST_MIDNIGHT)
  const next = fortune('2026-10-21')
  expect(store.today()).toEqual(next)
  expect(store.history()?.map(d => d.date)).toEqual([TODAY, '2026-10-21'])
  expect(await ui.find({ type: 'Text', text: `10/21 のコード運勢  第${next.number}番` })).toBeDefined()
  await ui.press({ key: 'fill' })
  expect(filled).toEqual([fillText(next)])
  expect(modes).toEqual(['insert'])
  await ui.press({ key: 'shake' })
  expect(await ui.find({ type: 'Text', text: `言語: ${fortune('2026-10-21', 1).language}` })).toBeDefined()
})

test('閉じたまま日付をまたいだら、開くまで store に書かず、昨日の分も今日として出さない', async ($, on) => {
  const { clock, store, world, open } = await boot($, on)
  await open()
  const yesterday = fortune(TODAY)
  world.isPaneUp = false
  await clock.advance(PAST_MIDNIGHT)
  expect(store.today()).toEqual(yesterday)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^10\/20 のコード運勢/ })).toBeUndefined()
  await open()
  expect(store.today()).toEqual(fortune('2026-10-21'))
  expect(await ui.find({ type: 'Text', text: /^10\/21 のコード運勢/ })).toBeDefined()
})

test('store の運勢が壊れていたら作り直す (第undefined番にしない)', async ($, on) => {
  const { store, open } = await boot($, on, {
    today: { date: TODAY, rank: 'ほげ', number: 7 },
    history: [{ date: '2026-10-18', rank: '吉' }, { date: '2026-10-19', rank: 'ほげ' }, 'x', { date: 5, rank: '凶' }],
  })
  await open()
  const want = fortune(TODAY)
  expect(store.today()).toEqual(want)
  expect(store.history()).toEqual([{ date: '2026-10-18', rank: '吉' }, { date: TODAY, rank: want.rank }])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: `10/20 のコード運勢  第${want.number}番` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /undefined/ })).toBeUndefined()
})

test('store の運勢に項目が足りない・数がおかしい時も作り直す', async ($, on) => {
  const f = fortune(TODAY)
  const { store, open } = await boot($, on, { today: { date: TODAY, rank: f.rank } })
  await open()
  expect(store.today()).toEqual(f)
  expect(isResult(f)).toBe(true)
  for (const bad of [{ ...f, number: 0 }, { ...f, number: 1.5 }, { ...f, number: 101 }, { ...f, words: 3 }, { ...f, rank: '超吉' }, { ...f, date: 20261020 }, null, 'x'])
    expect(isResult(bad)).toBe(false)
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  const { open } = await boot($, on)
  await open()
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const src = await svgOf(ui)
  expect(src).toMatch(/fill="#ffffff"/)
  // 紙は絵の中身なので、明るいテーマでも和紙と朱のまま
  expect(src).toMatch(/#f3ead6/)
  expect(src).toMatch(/#d9381e/)

  theme = 'dark'
  await $.config.set({
    key: 'theme',
    value: 'dark',
    previous: 'light',
    provider: { plugin: 'core', tier: 'core' } as never,
    origin: { kind: 'composer' },
  })
  expect(await svgOf(ui)).toMatch(/fill="#0d1117"/)
})

test('言葉: どの項目も 0.6 の 2 倍以上で重なりなし、季節の一言はその季節の日だけ出る', () => {
  // 0.6 の時の数 (good 12, bad 12, language 16, command 16, bug 12, review 12, lost 11, warning 12, commit 14)
  const before = { good: 12, bad: 12, language: 16, command: 16, bug: 12, review: 12, lost: 11, warning: 12, commit: 14 }
  for (const [key, n] of Object.entries(before)) {
    const list = WORDS[key as keyof typeof WORDS]
    expect(list.length).toBeGreaterThanOrEqual(n * 2)
    expect(new Set(list).size).toBe(list.length)
  }
  expect(seasonOf('2026-03-01')).toBe('春')
  expect(seasonOf('2026-08-31')).toBe('夏')
  expect(seasonOf('2026-10-20')).toBe('秋')
  expect(seasonOf('2026-12-01')).toBe('冬')
  expect(seasonOf('2027-02-28')).toBe('冬')
  const seasonal = new Map(Object.entries(SEASON_WORDS).flatMap(([s, w]) => [...w.good, ...w.bad].map(t => [t, s] as const)))
  let hits = 0
  for (let i = 0; i < 365; i++) {
    const date = jstDate(NOW + i * DAY)
    for (const n of [0, 1, 2]) {
      const f = fortune(date, n)
      const s = seasonal.get(f.words)
      if (s !== undefined) {
        hits++
        expect(s).toBe(seasonOf(date))
      } else expect([...WORDS.good, ...WORDS.bad]).toContain(f.words)
    }
  }
  expect(hits).toBeGreaterThan(20)
  // 画面の文字に絵文字や記号の飾りを使わない
  const all = [...Object.values(WORDS).flat(), ...seasonal.keys()].join('')
  expect(all).not.toMatch(/[\p{Extended_Pictographic}★☆♪→←↑↓]/u)
})

test('store の今日・この 7 日に知らない欄があっても消さずに書く (新しい版が足した欄)', async ($, on) => {
  const old = { ...fortune('2026-10-19'), futureField: 1 }
  const { store, open } = await boot($, on, {
    today: old,
    history: [{ date: '2026-10-19', rank: old.rank, futureField: 2 }],
  })
  await open()
  const today = store.today() as OmikujiResult & { futureField?: number }
  expect(today.date).toBe(TODAY)
  expect(today.futureField).toBe(1)
  expect(isResult(today)).toBe(true)
  const history = store.history() as (OmikujiDay & { futureField?: number })[]
  expect(history[0]?.futureField).toBe(2)
  expect(history[1]).toEqual({ date: TODAY, rank: today.rank })
  // 同じ日に開き直しても書き換えない
  const writes = store.writes()
  await open()
  expect((store.today() as { futureField?: number }).futureField).toBe(1)
  expect(store.writes()).toBe(writes + 1) // history だけ
})
