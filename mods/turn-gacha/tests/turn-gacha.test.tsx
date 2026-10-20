import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { addDraw, bookSvg, CARDS, cardOf, cardSvg, EMPTY, fromSaved, manualLeft, pull, rates, statsSvg, wrap } from '../hooks/gacha'
import type { GachaSave } from '../types'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const DAY = 86_400_000
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'turn-gacha',
  component: 'Pane',
  requestId: 'turn-gacha',
  props: {
    title: 'ガチャ',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** エンジンの代わりに一番下で答える。store は手元の Map、トーストは集める */
const boot = async ($: Engine, on: On, init?: unknown) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(init === undefined ? [] : [['save', init]])
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_$, e) => ((e as unknown as { command?: string }).command === 'fail' ? { isError: true as const, result: 'x', text: 'x' } : { result: 'ok' as never }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return { clock, toasts, saved: () => fromSaved(m.get('save')) }
}

let n = 0
const turn = async ($: Engine, opts: { agentId?: string; isAborted?: boolean; fail?: boolean } = {}) => {
  const turnId = `t${++n}`
  const agent = opts.agentId ? { agentId: opts.agentId } : {}
  await $.turn.start({ text: 'p', turnId, ...agent })
  if (opts.fail) await $.tool.call({ tool: 'Bash', command: 'fail', ...agent } as never)
  await $.turn.complete({ answer: 'a', durationMs: 1000, isAborted: opts.isAborted ?? false, turnId, reason: 'answer', ...agent } as never)
}

/** SR 以上を引いた枚数 (図鑑から数える) */
const highCount = (s: GachaSave) =>
  Object.entries(s.book).reduce((k, [id, v]) => k + (['SR', 'SSR'].includes(cardOf(id)?.rarity ?? '') ? v.count : 0), 0)

test('カードの表・確率・抽選の境目', () => {
  expect(CARDS).toHaveLength(40)
  const count = (r: string) => CARDS.filter(c => c.rarity === r).length
  expect([count('N'), count('R'), count('SR'), count('SSR')]).toEqual([16, 12, 8, 4])
  expect(new Set(CARDS.map(c => c.id)).size).toBe(40)
  expect(new Set(CARDS.map(c => c.name)).size).toBe(40)
  for (const isClean of [false, true]) expect(Object.values(rates(isClean)).reduce((a, b) => a + b, 0)).toBe(100)

  const r = (x: number, isClean = false) => pull(x, 0, isClean).rarity
  expect([r(0), r(0.0199), r(0.02), r(0.1199), r(0.12), r(0.3999), r(0.4), r(0.9999)]).toEqual(['SSR', 'SSR', 'SR', 'SR', 'R', 'R', 'N', 'N'])
  // ノーミスなら SSR 3% / SR 13%
  expect([r(0.029, true), r(0.03, true), r(0.159, true), r(0.16, true), r(0.44, true)]).toEqual(['SSR', 'SR', 'SR', 'R', 'N'])
  expect(pull(0.5, 0.9999, false).id).toBe('n16')
  expect(pull(0.5, 0, false).id).toBe('n01')
  expect(pull(0, 0.5, false).id).toBe('x03')

  // 引いた後の形・手動の日またぎ
  const card = CARDS[0]!
  let s = addDraw(EMPTY, card, NOW, { isClean: false, isManual: true })
  expect(s.history[0]).toMatchObject({ cardId: card.id, isNew: true, isManual: true })
  s = addDraw(s, card, NOW + 1000, { isClean: true, isManual: false })
  expect(s.book[card.id]).toEqual({ count: 2, firstAt: NOW })
  expect(s.history[0]?.isNew).toBe(false)
  expect([s.total, s.manualUsed, manualLeft(s, NOW)]).toEqual([2, 1, 2])
  expect(manualLeft(s, NOW + DAY)).toBe(3)
  for (let i = 0; i < 12; i++) s = addDraw(s, card, NOW, { isClean: false, isManual: false })
  expect(s.history).toHaveLength(10)

  // 壊れた値・知らないカードは捨てる
  expect(fromSaved('x')).toEqual(EMPTY)
  expect(fromSaved({ book: { zzz: { count: 3 }, n01: { count: 2, firstAt: 5 } }, total: -1, history: [{ cardId: 'zzz' }] })).toEqual({
    ...EMPTY,
    book: { n01: { count: 2, firstAt: 5 } },
  })

  expect(wrap('あいうえおかきくけこさしすせそ', 10)).toEqual(['あいうえお', 'かきくけ…'])
  expect(wrap('short', 10)).toEqual(['short'])
})

test('カードの絵: レア度で枠と光が変わり、めくれる', () => {
  const at = (id: string) => cardSvg({ cardId: id, at: NOW, isNew: true, isClean: true, isManual: false })
  const ssr = at('x01')
  expect(ssr).toMatch(/id="rainbow"/)
  expect(ssr).toMatch(/attributeName="gradientTransform"/)
  expect(ssr).toMatch(/url\(#shine\)/)
  expect(ssr).toMatch(/type="scale"/)
  expect(ssr).toMatch(/一発で通ったテスト/)
  expect(ssr).toMatch(/>NEW</)
  expect(ssr).toMatch(/>ノーミス</)
  const sr = at('s01')
  expect(sr).toMatch(/id="gold"/)
  expect(sr).toMatch(/url\(#shine\)/)
  expect(sr).not.toMatch(/rainbow/)
  const nn = at('n01')
  expect(nn).not.toMatch(/shine|rainbow|gold|filter=/)
  expect(nn).toMatch(/type="scale"/)
  expect(cardSvg(undefined)).toMatch(/まだ引いていません/)
  for (const svg of [ssr, sr, nn, statsSvg(EMPTY, 3), bookSvg(EMPTY)]) expect(svg).not.toMatch(/<svg[^>]*\swidth=/)

  const s = addDraw(EMPTY, CARDS[39]!, NOW, { isClean: false, isManual: false })
  const book = bookSvg(s)
  expect(book).toMatch(/障害ゼロの一年/)
  expect(book.match(/？？？/g)).toHaveLength(39)
  const stats = statsSvg(s, 3)
  expect(stats).toMatch(/>3%</)
  expect(stats).toMatch(/1 \/ 40 種/)
  expect(stats).toMatch(/1\/4種/)
})

for (const surface of SURFACES) {
  test(`${surface}: ターンが終わるたびに 1 回。SR 以上だけトースト。サブエージェントと中断は引かない`, async ($, on) => {
    const { toasts, saved } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/まだ引いていません/)
    else expect(await ui.find({ type: 'Text', text: /^まだ引いていません/ })).toBeDefined()

    await turn($, { agentId: 'sub-1' })
    await turn($, { isAborted: true })
    expect(saved().total).toBe(0)

    for (let i = 0; i < 30; i++) await turn($)
    const s = saved()
    expect(s.total).toBe(30)
    expect(s.history).toHaveLength(10)
    expect(Object.values(s.book).reduce((k, v) => k + v.count, 0)).toBe(30)
    // トーストは SR 以上の枚数と同じだけ、「SR!名前」の形で
    expect(toasts).toHaveLength(highCount(s))
    for (const t of toasts) expect(t).toMatch(/^S?SR!\S/)
    // 乱数なので、SR 以上が 1 枚も出ていなければ出るまで引く
    for (let i = 0; i < 300 && highCount(saved()) === 0; i++) await turn($)
    expect(toasts.length).toBeGreaterThan(0)
    expect(toasts).toHaveLength(highCount(saved()))

    const latest = cardOf(s.history[0]!.cardId)!
    if (surface === 'vscode') {
      const svgs = await ui.findAll({ type: 'Svg' })
      expect(svgs).toHaveLength(2)
      expect(String(svgs[0]?.props.source)).toContain(latest.name.slice(0, 4))
      expect(String(svgs[1]?.props.source)).toMatch(/累計 30 回/)
      expect(String(svgs[1]?.props.alt)).toMatch(/^図鑑 \d+ \/ 40 種/)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: `【${latest.rarity}】${latest.name}` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^累計 30 回 \/ 今日の手動 あと 3 回$/ })).toBeDefined()
    }
  })

  test(`${surface}: もう一回引くは 1 日 3 回まで。図鑑の切り替え`, async ($, on) => {
    const { clock, saved } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'pull' }))?.props.label).toBe('もう一回引く(今日あと 3 回)')
    for (let i = 0; i < 3; i++) await ui.press({ key: 'pull' })
    expect(saved()).toMatchObject({ total: 3, manualUsed: 3 })
    expect(saved().history.every(d => d.isManual)).toBe(true)
    expect((await ui.find({ key: 'pull' }))?.props.label).toBe('今日の手動はおしまい')
    await ui.press({ key: 'pull' })
    expect(saved().total).toBe(3)
    expect(await ui.find({ type: 'Text', text: /^今日の手動はおしまいです/ })).toBeDefined()

    // 次の日はまた 3 回
    await clock.advance(DAY)
    await ui.press({ key: 'pull' })
    expect(saved()).toMatchObject({ total: 4, manualUsed: 1 })
    expect(await ui.find({ type: 'Text', text: /^今日の手動はおしまいです/ })).toBeUndefined()

    await ui.press({ key: 'book' })
    expect((await ui.find({ key: 'book' }))?.props.label).toBe('カードに戻る')
    if (surface === 'vscode') {
      const src = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(src).toMatch(/？？？/)
      expect(src).not.toMatch(/直近/)
    } else {
      expect(await ui.find({ type: 'Text', text: /？？？$/ })).toBeDefined()
      const owned = cardOf(saved().history[0]!.cardId)!
      expect(await ui.find({ type: 'Text', text: new RegExp(`${owned.name} \\d+枚$`) })).toBeDefined()
    }
    await ui.press({ key: 'book' })
    expect((await ui.find({ key: 'book' }))?.props.label).toBe('図鑑')
  })
}

test('ノーミス補正はエラーの無いターンだけ。サブエージェントのエラーは数えない', async ($, on) => {
  const { saved } = await boot($, on)
  await turn($)
  expect(saved().history[0]?.isClean).toBe(true)
  await turn($, { fail: true })
  expect(saved().history[0]?.isClean).toBe(false)
  // 次のターンで数え直す
  await $.turn.start({ text: 'p', turnId: 'x1' })
  await $.tool.call({ tool: 'Bash', command: 'fail', agentId: 'sub-1' } as never)
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 'x1', reason: 'answer' } as never)
  expect(saved().history[0]?.isClean).toBe(true)
})

test('store の図鑑はセッションをまたいで読まれる', async ($, on) => {
  await boot($, on, { book: { x01: { count: 2, firstAt: NOW - DAY } }, total: 5, manualDay: '', manualUsed: 0, history: [{ cardId: 'x01', at: NOW - DAY, isNew: true, isClean: false, isManual: false }] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '【SSR】一発で通ったテスト' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^累計 5 回/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^SSR 1\/4種 2枚/ })).toBeDefined()
})

test('/gacha を登録して開く。取れなければ /turn-gacha', async ($, on) => {
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'gacha' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  let opened = ''
  on('ui.open', (_$, e) => {
    opened = e.id
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['gacha'])
  isTaken = true
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['gacha', 'gacha', 'turn-gacha'])
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect((await $.command.run({ command: 'turn-gacha', ...run })).text).toBe('ガチャを開きました。')
  expect(opened).toBe('turn-gacha')
})
