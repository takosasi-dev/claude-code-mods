import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { addFirst, asFirstAt, freshIds, judge, levelOf, shelfLines, shelfSvg, snapshotOf, TROPHIES } from '../hooks/shelf'
import type { ShelfRaw } from '../hooks/shelf'
import { setTheme } from '../hooks/style'

// 2026-10-21 12:00 (日本時間 21:00)
const NOW = Date.parse('2026-10-21T12:00:00Z')
const DAY = 86_400_000
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'trophy-shelf',
  component: 'Pane',
  requestId: 'trophy-shelf',
  props: {
    title: '実績帳',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

// 架空の記録。Lv 12 (xp 1760)、実績 3、ボス 1。図鑑 4 / 6 種 (半分を超え、SSR 1)。魚 3 種。ゲーム 4 種。お題 7 日連続
const CARDS = [
  { id: 'c1', rarity: 'N', slot: 'weapon', name: '木の剣' },
  { id: 'c2', rarity: 'N', slot: 'armor', name: '布の服' },
  { id: 'c3', rarity: 'R', slot: 'charm', name: '小石' },
  { id: 'c4', rarity: 'SR', slot: 'weapon', name: '鉄の槍' },
  { id: 'c5', rarity: 'SSR', slot: 'armor', name: '星の鎧' },
  { id: 'c6', rarity: 'SSR', slot: 'charm', name: '月の鈴' },
]
const own = (ids: string[]) => Object.fromEntries(ids.map(id => [id, { count: 1, firstAt: NOW - DAY }]))
const RICH = {
  hero: { xp: 1760, achievements: { 'first-bash': 1, 'first-edit': 2, 'level-10': 3 }, wins: 12, defeated: { slime: 4 } },
  save: { book: { ...own(['c1', 'c2', 'c4', 'c5']), gone: { count: 1, firstAt: 1 } }, total: 30 },
  cards: CARDS,
  tank: { fish: [{ kind: 'maru' }, { kind: 'maru' }, { kind: 'shima' }, { kind: 'akari' }], view: { days: 12 } },
  stats: { best2048: 1024, wins2048: 0, winsMines: 2, puzzles: { fifteen: { wins: 1 }, sudoku4: { wins: 1 }, sudoku9: { wins: 2 }, lights: { wins: 0 } } },
  streak: 7,
  totalDone: 21,
}
type Others = Partial<Record<keyof typeof RICH, unknown>>

type Boot = { others?: () => Others; store?: Record<string, unknown>; taken?: boolean; theme?: () => string }

/** 下の hook を全部置いてセッションを始める。others に無い mod は「入っていない」(state.get に答えない) */
const boot = async ($: Engine, on: On, opts: Boot = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  let writes = 0
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    writes++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  const others = opts.others
  if (others) {
    // 他の mod の state は { value: { value, version } } の二重の形で答える
    const answer = (k: keyof typeof RICH) => () => {
      const v = others()[k]
      return { value: { value: v as never, version: v === undefined ? 0 : 1 } }
    }
    on('state.get', { plugin: 'dev-rpg', key: 'hero' }, answer('hero'))
    on('state.get', { plugin: 'turn-gacha', key: 'save' }, answer('save'))
    on('state.get', { plugin: 'turn-gacha', key: 'cards' }, answer('cards'))
    on('state.get', { plugin: 'aqua-pet', key: 'tank' }, answer('tank'))
    on('state.get', { plugin: 'wait-games', key: 'stats' }, answer('stats'))
    on('state.get', { plugin: 'daily-quest', key: 'streak' }, answer('streak'))
    on('state.get', { plugin: 'daily-quest', key: 'totalDone' }, answer('totalDone'))
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (opts.taken && e.name === 'trophies' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  on('command.run', { command: 'trophies' }, () => ({ text: '別の /trophies' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const theme = opts.theme
  if (theme) {
    on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme(), provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
    on('config.set', (_$, e) => ({ value: e.value }))
  }
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return { clock, firstAt: () => asFirstAt(m.get('firstAt')) ?? {}, raw: m, writes: () => writes }
}

const turn = ($: Engine, turnId: string, extra: Record<string, unknown> = {}) =>
  $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId, reason: 'answer', ...extra } as never)

const doneIds = (raw: ShelfRaw, firstAt = {}) => judge(snapshotOf(raw), firstAt).filter(j => j.isDone).map(j => j.trophy.id)

test('他の mod の値の確かめ方とトロフィーの判定 (純関数)', () => {
  // dev-rpg の式の写し: Lv 5 は 360、Lv 10 は 1260、Lv 12 は 1760
  expect([levelOf(0), levelOf(359), levelOf(360), levelOf(1260), levelOf(1760), levelOf(1e9)]).toEqual([1, 4, 5, 10, 12, 99])

  const s = snapshotOf(RICH)
  expect(s.rpg).toEqual({ level: 12, achievements: 3, wins: 12, bosses: 1 })
  // 表に無いカード (gone) は数えない
  expect(s.gacha).toEqual({ owned: 4, total: 6, ssr: 1, pulls: 30 })
  expect(s.aqua).toEqual({ kinds: 3, fish: 4, days: 12 })
  // 2048 (最高点あり)・マインスイーパー・15 パズル・数独 (4 と 9 で 1 種)。ライツアウトは勝ちが 0
  expect(s.games).toEqual({ kinds: 4, best2048: 1024, wins2048: 0, wins: 6 })
  expect(s.quest).toEqual({ streak: 7, totalDone: 21 })

  // 入っていない・形の違う mod は無い物として扱う
  expect(snapshotOf({})).toEqual({})
  expect(snapshotOf({ hero: { level: 3 }, save: 'x', tank: null, stats: [1], streak: '7' })).toEqual({})
  // 古い記録 (魚が空・puzzles が無い) でも落ちない
  expect(snapshotOf({ tank: { fish: [] }, stats: { best2048: 0, wins2048: 0, winsMines: 0 } })).toEqual({
    aqua: { kinds: 0, fish: 0, days: 0 },
    games: { kinds: 0, best2048: 0, wins2048: 0, wins: 0 },
  })

  expect(TROPHIES.length).toBeGreaterThanOrEqual(12)
  expect(new Set(TROPHIES.map(t => t.id)).size).toBe(TROPHIES.length)
  expect(doneIds(RICH).sort()).toEqual(
    ['rpg-lv5', 'rpg-lv10', 'rpg-boss', 'gacha-half', 'gacha-ssr', 'aqua-3', 'games-1', 'games-4', 'quest-1', 'quest-7', 'all-shelves'].sort(),
  )
  // 図鑑の半分は表の大きさに付いていく (6 種なら 3 種で半分)
  expect(doneIds({ ...RICH, save: { book: own(['c1', 'c2', 'c3']), total: 3 } })).toContain('gacha-half')
  expect(doneIds({ ...RICH, cards: [...CARDS, ...CARDS.map(c => ({ ...c, id: `${c.id}x` }))], save: { book: own(['c1', 'c2', 'c3']), total: 3 } })).not.toContain(
    'gacha-half',
  )
  // 棚がそろうのは 5 つの棚に 1 つずつ。一度取った物は mod を外しても取ったまま
  expect(doneIds({ hero: RICH.hero })).not.toContain('all-shelves')
  expect(doneIds({}, { 'quest-1': 5 })).toEqual(['quest-1'])

  const judged = judge(snapshotOf(RICH), { 'rpg-lv5': 1 })
  expect(freshIds(judged)).not.toContain('rpg-lv5')
  expect(freshIds(judged)).toContain('rpg-lv10')

  // 先に記録した時刻を残し、知らない id と壊れた値は捨てる
  expect(addFirst({ 'rpg-lv5': 1 }, ['rpg-lv5', 'aqua-3'], 9)).toEqual({ 'rpg-lv5': 1, 'aqua-3': 9 })
  expect(asFirstAt({ 'rpg-lv5': 1, nope: 2, 'aqua-3': 'x' })).toEqual({ 'rpg-lv5': 1 })
  expect(asFirstAt([1])).toBeUndefined()

  setTheme(false)
  const svg = shelfSvg(snapshotOf(RICH), { 'rpg-lv5': NOW - DAY })
  expect(svg).toContain('Lv 12 / 実績 3 / 勝ち 12')
  expect(svg).toContain('10/20 に取得')
  expect(svg).toContain('<animate')
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
  const empty = shelfSvg({}, {})
  expect(empty.match(/入っていません/g)?.length).toBeGreaterThanOrEqual(5)
  expect(empty).toContain(`トロフィー 0 / ${TROPHIES.length} 個`)
  expect(shelfLines({}, {})[1]?.text).toBe('dev-rpg: 入っていません')
})

test('他の mod が 1 つも入っていない時も落ちず、全部の棚に「入っていません」と出し、何も書かない', async ($, on) => {
  const s = await boot($, on)
  expect((await $.command.run({ command: 'trophies', ...RUN })).text).toBe('実績帳を開きました。')
  await turn($, 't1')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.alt)).toBe(`実績帳 トロフィー 0 / ${TROPHIES.length} 個`)
      expect(String(svg?.props.source).match(/入っていません/g)?.length).toBeGreaterThanOrEqual(5)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      for (const mod of ['dev-rpg', 'turn-gacha', 'aqua-pet', 'wait-games', 'daily-quest']) {
        expect(await ui.find({ type: 'Text', text: `${mod}: 入っていません` })).toBeDefined()
      }
    }
    await ui.unmount()
  }
  expect(s.writes()).toBe(0)
})

for (const surface of SURFACES) {
  test(`${surface}: 5 つの棚の数と、取ったトロフィーを日付付きで出す`, async ($, on) => {
    const s = await boot($, on, { others: () => RICH, store: { firstAt: { 'quest-1': NOW - 3 * DAY } } })
    // セッションの始まりに、取れている物へ時刻を付ける (前からある物はそのまま)
    expect(s.firstAt()['quest-1']).toBe(NOW - 3 * DAY)
    expect(s.firstAt()['rpg-lv10']).toBe(NOW)
    expect(Object.keys(s.firstAt()).length).toBe(11)

    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const source = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(source).toContain('図鑑 4 / 6 種 / SSR 1')
      expect(source).toContain('連続 7 日 / 通算 21 個')
      expect(source).toContain('10/18 に取得')
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toBe(`実績帳 トロフィー 11 / ${TROPHIES.length} 個`)
    } else {
      expect(await ui.find({ type: 'Text', text: 'dev-rpg: Lv 12 / 実績 3 / 勝ち 12' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'aqua-pet: 魚 3 種 4 匹 / 12 日目' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '取得 初めてのお題 (10/18)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^未取得 図鑑の完成 4 \/ 6/ })).toBeDefined()
    }
    await ui.unmount()
  })
}

test('ターンの終わりに新しく取った物を足す。書く直前に読み直し、別のセッションの記録を消さない', async ($, on) => {
  let hero = { ...RICH.hero, xp: 360, defeated: {} }
  const s = await boot($, on, { others: () => ({ hero }) })
  expect(Object.keys(s.firstAt())).toEqual(['rpg-lv5'])

  // 別のセッションがお題のトロフィーを記録した
  s.raw.set('firstAt', { ...s.firstAt(), 'quest-1': NOW - DAY })
  hero = { ...hero, xp: 1260 }
  await s.clock.advance(60_000)
  // サブエージェントのターンと、答えずに終わったターンでは見ない
  await turn($, 'sub', { agentId: 'a1' })
  await turn($, 'abort', { reason: 'aborted' })
  expect(s.firstAt()['rpg-lv10']).toBeUndefined()
  await turn($, 't1')
  expect(s.firstAt()).toEqual({ 'rpg-lv5': NOW, 'quest-1': NOW - DAY, 'rpg-lv10': NOW + 60_000 })

  // 一度取った物は、mod を外しても取ったまま
  hero = undefined as never
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'dev-rpg: 入っていません' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '取得 二桁の勇者 (10/21)' })).toBeDefined()
  await ui.unmount()
})

test('知らない欄 (新しい版のトロフィーの時刻など) は、1 ターン後も store に残る', async ($, on) => {
  let hero = { ...RICH.hero, xp: 360, defeated: {} }
  const s = await boot($, on, { others: () => ({ hero }), store: { firstAt: { futureField: 1, 'future-trophy': NOW - DAY } } })
  hero = { ...hero, xp: 1260 }
  await turn($, 't1')
  // 書いたこと (新しく取った物が入った) と、知らない欄が残ったこと
  expect(s.raw.get('firstAt')).toEqual({ futureField: 1, 'future-trophy': NOW - DAY, 'rpg-lv5': NOW, 'rpg-lv10': NOW })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  await boot($, on, { others: () => RICH, theme: () => theme })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/fill="#ffffff"/)
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await source()).toMatch(/fill="#0d1117"/)
})

test('/trophies を持てなかった時は /trophy-shelf にして、/trophies を横取りしない', async ($, on) => {
  await boot($, on, { taken: true })
  expect((await $.command.run({ command: 'trophies', ...RUN })).text).toBe('別の /trophies')
  expect((await $.command.run({ command: 'trophy-shelf', ...RUN })).text).toBe('実績帳を開きました。')
})

test('水槽の魚 10 種のトロフィー (aqua-pet 0.4.0 で 10 種になった)。6 種では取れない', () => {
  const tank = (kinds: string[]) => ({ ...RICH, tank: { fish: kinds.map(kind => ({ kind })), view: { days: 1 } } })
  const ten = ['maru', 'shima', 'mizutama', 'hirenaga', 'ougi', 'akari', 'hoshi', 'tsuno', 'niji', 'ryugu']
  expect(doneIds(tank(ten.slice(0, 6)))).toContain('aqua-6')
  expect(doneIds(tank(ten.slice(0, 6)))).not.toContain('aqua-10')
  expect(doneIds(tank(ten))).toContain('aqua-10')
})
