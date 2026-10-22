import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { RpgGachaCard, RpgHero, RpgSaved } from '../types'
import {
  ACHIEVEMENTS,
  INITIAL,
  INITIAL_SAVED,
  achievementsSvg,
  fromSaved,
  gearBonus,
  gearSvg,
  mergeSaved,
  ownedCards,
  claimedFrom,
  questRewards,
  setGear,
  statsOf,
  wear,
  withUnknown,
  wornOf,
  levelInfo,
  onTool,
  startSession,
  statusSvg,
  titleOf,
  toolKind,
  xpToReach,
} from '../hooks/rpg'

const NOW = Date.parse('2026-10-20T03:00:00Z')

/** turn-gacha の state の形 (save.book と cards) */
type Gacha = { save: unknown; cards: unknown }
const CARD = (id: string, rarity: RpgGachaCard['rarity'], slot: RpgGachaCard['slot'], name: string): RpgGachaCard => ({ id, rarity, slot, name })
const GACHA_CARDS: RpgGachaCard[] = [
  CARD('x01', 'SSR', 'weapon', '一発で通ったテスト'),
  CARD('r01', 'R', 'weapon', 'きれいな差分'),
  CARD('s02', 'SR', 'armor', '競合なしのマージ'),
  CARD('n02', 'N', 'charm', 'TODO: あとで直す'),
  CARD('x02', 'SSR', 'charm', 'つかまえた幽霊バグ'),
]
const bookOf = (ids: string[]) => ({ book: Object.fromEntries(ids.map(id => [id, { count: 1, firstAt: NOW }])), total: ids.length })
const MIN = 60_000
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'dev-rpg',
  component: 'Pane',
  requestId: 'dev-rpg',
  props: {
    title: '冒険の書',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** 下の hook は全部ここで足す (test が $ を呼んだ後は足せない) */
const boot = async ($: Engine, on: On, saved?: Partial<RpgSaved>, opts: { failTool?: () => boolean; gacha?: () => Gacha; quest?: () => unknown; claimed?: string[] } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  // turn-gacha の state の代わり (無ければ turn-gacha が入っていない)
  const gacha = opts.gacha
  if (gacha) {
    on('state.get', { plugin: 'turn-gacha', key: 'save' }, () => ({ value: { value: gacha().save as never, version: 1 } }))
    on('state.get', { plugin: 'turn-gacha', key: 'cards' }, () => ({ value: { value: gacha().cards as never, version: 1 } }))
  }
  // daily-quest の state の代わり (無ければ daily-quest が入っていない)
  const quest = opts.quest
  if (quest) on('state.get', { plugin: 'daily-quest', key: 'today' }, () => ({ value: { value: quest() as never, version: 1 } }))
  const m = new Map<string, unknown>(saved ? [['hero', saved]] : [])
  if (opts.claimed) m.set('questClaimed', opts.claimed)
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  const failTool = opts.failTool
  on('tool.call', () => (failTool?.() ? { isError: true as const, result: 'boom', text: 'boom' } : { result: 'ok' }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // test の $ に state は無いので、書かれた値を下で拾う
  let last: RpgHero | undefined
  on('state.set', async (_$, e, next) => {
    const r = await next(e)
    if (e.plugin === 'dev-rpg' && e.key === 'hero' && r.value?.isSet) last = e.value as RpgHero
    return r
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const hero = () => {
    if (!last) throw new Error('hero が書かれていない')
    return last
  }
  return { clock, hero, toasts, stored: () => m.get('hero') as RpgSaved | undefined, put: (v: unknown) => m.set('hero', v), claimed: () => m.get('questClaimed') }
}

const tool = ($: Engine, name: string) => $.tool.call({ tool: name, input: {} } as never)
let turnNo = 0
const turn = async ($: Engine, body: () => Promise<void> = async () => {}) => {
  const turnId = `t${++turnNo}`
  await $.turn.start({ text: 'hi', turnId })
  await body()
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
}

type Drawn = { find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }
const svgOf = async (ui: Drawn) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const textOf = async (ui: Drawn, re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text ?? ''

test('レベルの式・称号・ツールの種類・store の読み戻し', () => {
  expect([0, 59, 60, 139, 140].map(x => levelInfo(x).level)).toEqual([1, 1, 2, 2, 3])
  expect(levelInfo(100)).toMatchObject({ level: 2, into: 40, need: 80 })
  // 必要経験値は少しずつ増える
  for (let l = 1; l < 98; l++) expect(xpToReach(l + 2) - xpToReach(l + 1)).toBeGreaterThan(xpToReach(l + 1) - xpToReach(l))
  expect(levelInfo(10_000_000).level).toBe(99)
  const titles = new Set(Array.from({ length: 99 }, (_, i) => titleOf(i + 1)))
  expect(titles.size).toBeGreaterThanOrEqual(10)
  expect([titleOf(1), titleOf(3), titleOf(12), titleOf(60), titleOf(99)]).toEqual([
    '見習いコーダー',
    '駆け出しデバッガー',
    'テストの守り人',
    '伝説のリファクタラー',
    '伝説のリファクタラー',
  ])
  expect(['Edit', 'Bash', 'PowerShell', 'Grep', 'Agent', 'mcp__x__y'].map(toolKind)).toEqual(['edit', 'shell', 'shell', 'read', 'agent', 'other'])
  expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(10)
  expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(ACHIEVEMENTS.length)

  const s = fromSaved({ xp: 'x', turns: 12.7, edits: -3, achievements: { 'first-bash': NOW, nope: 1, 'first-edit': 'x' }, day: 5 })
  expect(s).toMatchObject({ xp: 0, turns: 12, edits: 0, day: '', achievements: { 'first-bash': NOW } })
  expect(fromSaved(null)).toMatchObject({ xp: 0, sessions: 0 })

  // エラーの後、同じターンで成功すると立ち直り
  let h = startSession(fromSaved({}), NOW)
  h = onTool(h, 'Bash', true, NOW)
  expect(h.xp).toBe(0)
  h = onTool(h, 'Bash', false, NOW)
  expect(h).toMatchObject({ xp: 19, recoveries: 1, errors: 1, shells: 1 })
  h = onTool(h, 'Read', false, NOW)
  expect(h.xp).toBe(21)

  const all = { ...h, xp: 500_000, achievements: Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, NOW])) }
  for (const svg of [statusSvg(all), achievementsSvg(all), statusSvg(INITIAL)]) {
    expect(svg.length).toBeLessThan(131_072)
    expect(svg).toContain('font-family="sans-serif"')
    expect(svg).not.toMatch(/<svg[^>]* width=/)
  }
})

for (const surface of SURFACES) {
  test(`${surface}: ステータス窓 — レベル・称号・バー・実績の列`, async ($, on) => {
    await boot($, on, { xp: 150, sessions: 3, turns: 40, achievements: { 'first-bash': NOW - 86_400_000 } })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'tab' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'reset' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'reset-cancel' })).toBeUndefined()
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('Lv 3')
      expect(svg).toContain('駆け出しデバッガー')
      expect(svg).toContain('冒険 4 回目 / 累計 40 ターン')
      expect(svg).toContain('>HP<')
      expect(svg).toContain('>MP<')
      expect(svg).toContain('>EX<')
      expect(svg).toContain('10/100')
      expect(svg).toContain(`1 / ${ACHIEVEMENTS.length}`)
      expect((svg.match(/stroke-dasharray="3 2"/g) ?? []).length).toBe(ACHIEVEMENTS.length - 1)
      expect(svg).toContain('stroke="#ffffff" stroke-width="3"')
      expect(await ui.find({ key: 'lines' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await textOf(ui, /^勇者 Lv/)).toBe('勇者 Lv 3 駆け出しデバッガー')
      expect(await textOf(ui, /^HP /)).toBe('HP 70/70  MP 35/35')
      expect(await textOf(ui, /^経験値 /)).toBe('経験値 10/100 (つぎまで 90)')
      expect(await textOf(ui, /^実績 /)).toBe(`実績 1/${ACHIEVEMENTS.length} ●${'○'.repeat(ACHIEVEMENTS.length - 1)}`)
    }
  })

  test(`${surface}: 「実績を見る」で一覧に切り替わり、もう一度で戻る`, async ($, on) => {
    await boot($, on, { achievements: { 'first-edit': NOW } })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab' })
    expect((await ui.find({ type: 'Button', key: 'tab' }))?.text).toBe('ステータスに戻る')
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('実績の書')
      expect(svg).toContain('初めての一太刀')
      expect(svg).toContain('エラーから 3 回立ち直る')
      expect(svg).toContain('まだ')
    } else {
      expect((await ui.find({ type: 'Text', text: /^● 初めての一太刀/ }))?.props.color).toBe('yellow')
      expect(await ui.find({ type: 'Text', text: '○ 初めての Bash ─ 初めてコマンドを実行する' })).toBeDefined()
    }
    await ui.press({ key: 'tab' })
    expect((await ui.find({ type: 'Button', key: 'tab' }))?.text).toBe('実績を見る')
  })

  test(`${surface}: 「冒険をやり直す」は 2 段押しで消える`, async ($, on) => {
    const { hero, stored } = await boot($, on, { xp: 5000, turns: 300, achievements: { 'first-bash': NOW } })
    const ui = await $.ui.mount({ ...PANE, surface })
    const level = levelInfo(5000).level
    await ui.press({ key: 'reset' })
    expect(levelInfo(hero().xp).level).toBe(level)
    expect((await ui.find({ type: 'Button', key: 'reset' }))?.text).toBe('本当にやり直す(すべて消えます)')
    await ui.press({ key: 'reset-cancel' })
    expect((await ui.find({ type: 'Button', key: 'reset' }))?.text).toBe('冒険をやり直す')
    // 別のボタンを押しても確認は下りる
    await ui.press({ key: 'reset' })
    await ui.press({ key: 'tab' })
    expect((await ui.find({ type: 'Button', key: 'reset' }))?.text).toBe('冒険をやり直す')
    await ui.press({ key: 'tab' })

    await ui.press({ key: 'reset' })
    await ui.press({ key: 'reset' })
    expect(hero()).toMatchObject({ xp: 0, turns: 0, sessions: 1, achievements: {} })
    expect(stored()).toMatchObject({ xp: 0, turns: 0, sessions: 1, achievements: {} })
    expect(await ui.find({ type: 'Text', text: '冒険をやり直しました。Lv 1 から' })).toBeDefined()
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('Lv 1')
    else expect(await textOf(ui, /^勇者 Lv/)).toBe('勇者 Lv 1 見習いコーダー')
  })
}

test('作業で経験値が入り、レベルアップの時だけトーストが出る', async ($, on) => {
  const { hero, toasts, stored } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await turn($, async () => {
    await tool($, 'Bash')
    await tool($, 'Edit')
    await tool($, 'Read')
  })
  // 4 + 5 + 2 + ターン 10
  expect(hero().xp).toBe(21)
  expect(hero().s).toMatchObject({ shells: 1, edits: 1, reads: 1, toolOk: 3 })
  expect(toasts).toEqual([])
  expect(Object.keys(hero().achievements).sort()).toEqual(['first-bash', 'first-edit'])
  // 一言は最後の出来事だけ
  expect(await ui.find({ type: 'Text', text: '実績「初めての一太刀」を手に入れた' })).toBeDefined()

  await turn($, async () => {
    for (let i = 0; i < 6; i++) await tool($, 'Write')
  })
  expect(hero().xp).toBe(61)
  expect(toasts).toEqual(['レベルアップ! Lv 2 見習いコーダー'])
  expect(await ui.find({ type: 'Text', text: 'レベルアップ! Lv 2 見習いコーダー' })).toBeDefined()
  // Lv 2: 攻撃力 6 + 2x2 + 編集 7 / 防御力 1 + 2 / 魔力 4 + 2x2 + 調べ 1 / 素早さ 2 + 2 + コマンド 1
  expect(await textOf(ui, /^攻撃力/)).toBe('攻撃力 17  防御力 3  魔力 9  素早さ 5  根性 0')
  expect(stored()).toMatchObject({ xp: 61, turns: 2, edits: 7 })

  // サブエージェントのターンと中断したターンは数えない
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1', agentId: 'sub', reason: 'answer' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'x', reason: 'aborted' })
  expect(hero().turns).toBe(2)
  expect(toasts).toHaveLength(1)
})

test('エラーから同じターンで立ち直ると根性と経験値、MP は成功率', async ($, on) => {
  let fail = false
  const { hero } = await boot($, on, undefined, { failTool: () => fail })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (let i = 0; i < 3; i++) {
    await turn($, async () => {
      fail = true
      await tool($, 'Bash')
      fail = false
      await tool($, 'Bash')
    })
  }
  expect(hero()).toMatchObject({ recoveries: 3, errors: 3 })
  expect(hero().achievements['recover-3']).toBe(NOW)
  expect(await textOf(ui, /^HP /)).toBe('HP 60/60  MP 15/30')
  // 次のターンまで持ち越さない
  fail = true
  await turn($, () => tool($, 'Read').then(() => {}))
  fail = false
  await turn($, () => tool($, 'Read').then(() => {}))
  expect(hero().recoveries).toBe(3)
})

test('1 ターンの連撃と無傷の勝利、同じ日に 50 ターン', async ($, on) => {
  const { hero } = await boot($, on, { dayTurns: 48, day: '2026-10-20', turns: 48 })
  await turn($, async () => {
    for (let i = 0; i < 20; i++) await tool($, 'Grep')
  })
  expect(Object.keys(hero().achievements).sort()).toEqual(['combo-20', 'flawless'])
  await turn($)
  expect(hero().dayTurns).toBe(50)
  expect(hero().achievements['day-50']).toBe(NOW)
})

test('冒険の回数と累計は store から読み戻し、10 回目で実績', async ($, on) => {
  const { hero, stored } = await boot($, on, { xp: 140, sessions: 9 })
  expect(hero()).toMatchObject({ xp: 140, sessions: 10 })
  expect(hero().achievements['sessions-10']).toBe(NOW)
  expect(stored()?.sessions).toBe(10)
})

test('HP は時間で減り、間が空くと休んで戻る', async ($, on) => {
  const { clock, hero } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(60 * MIN)
  expect(hero().hpPct).toBe(70)
  expect(await textOf(ui, /^HP /)).toBe('HP 35/50  MP 25/25')
  await clock.advance(10 * 60 * MIN)
  expect(hero().hpPct).toBe(10)
  expect((await ui.find({ type: 'Text', text: /^HP / }))?.props.color).toBe('red')
  await turn($)
  expect(hero().hpPct).toBe(100)
})

const presentation = { isFullscreen: false, columns: 80 }

test('/rpg を登録できればそれで開き、拒まれたら /dev-rpg で開いて /rpg は横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    if (e.name === 'rpg') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(`${e.id}:${e.title}`)
    return { value: { isPlaced: true as const } }
  })
  on('command.run', { command: 'rpg' }, () => ({ text: '組み込みの rpg' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['dev-rpg'])
  const own = await $.command.run({ command: 'dev-rpg', args: '', origin: { kind: 'composer' }, presentation })
  expect(own).toMatchObject({ text: '冒険の書を開きました。' })
  const builtin = await $.command.run({ command: 'rpg', args: '', origin: { kind: 'composer' }, presentation })
  expect(builtin).toMatchObject({ text: '組み込みの rpg' })
  expect(opened).toEqual(['dev-rpg:冒険の書'])
})

test('/rpg が取れればそれで開く', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  // 予備名の /dev-rpg は登録していないので、同じ名前の別のコマンドを横取りしない
  on('command.run', { command: 'dev-rpg' }, () => ({ text: '別の dev-rpg' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const r = await $.command.run({ command: 'rpg', args: '', origin: { kind: 'composer' }, presentation })
  expect(r).toMatchObject({ text: '冒険の書を開きました。' })
  const other = await $.command.run({ command: 'dev-rpg', args: '', origin: { kind: 'composer' }, presentation })
  expect(other).toMatchObject({ text: '別の dev-rpg' })
  expect(opened).toEqual(['dev-rpg'])
})

const end = ($: Engine, reason: 'answer' | 'error' | 'aborted', turnId = 'te') =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId, reason } as never)

test('2 つのセッションが同じ store を使っても、もう一方の進み具合を消さない', async ($, on) => {
  const { hero, stored, put } = await boot($, on, { xp: 100, turns: 10 })
  // 別のセッション (VS Code とターミナル) がその間に進めた
  put({ ...stored(), xp: 600, turns: 60, achievements: { 'turns-100': NOW - 1 } })
  await $.turn.start({ text: 'hi', turnId: 'm1' })
  await tool($, 'Read')
  // ツールのたびには書かない
  expect(stored()).toMatchObject({ xp: 600, turns: 60 })
  await end($, 'answer', 'm1')
  // 600 + Read 2 + ターン 10
  expect(stored()).toMatchObject({ xp: 612, turns: 61, reads: 1, sessions: 1 })
  expect(stored()?.achievements['turns-100']).toBe(NOW - 1)
  // 画面の方も store に合わせる
  expect(hero()).toMatchObject({ xp: 612, turns: 61 })

  // 同じ時に 2 回保存しても二重に足さない
  await $.turn.start({ text: 'hi', turnId: 'm2' })
  await tool($, 'Read')
  await Promise.all([end($, 'answer', 'm2'), $.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } } as never)])
  expect(stored()).toMatchObject({ xp: 624, turns: 62, reads: 2 })
})

test('エラーや拒否で終わったターンは経験値もターン数も付けない (ツールの分は残す)', async ($, on) => {
  const { hero, stored } = await boot($, on)
  await $.turn.start({ text: 'hi', turnId: 'e1' })
  await tool($, 'Bash')
  await end($, 'error', 'e1')
  await $.turn.start({ text: 'hi', turnId: 'e2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'e2', reason: 'refusal', refusal: {} } as never)
  expect(hero()).toMatchObject({ xp: 4, turns: 0, shells: 1 })
  expect(stored()).toMatchObject({ xp: 4, turns: 0, shells: 1 })
})

test('store が読めない形なら上書きせず、画面で知らせる', async ($, on) => {
  const { stored } = await boot($, on, 'broken' as never)
  await turn($, () => tool($, 'Edit').then(() => {}))
  expect(stored()).toBe('broken' as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /記録を読めなかった/ })).toBeDefined()
})

test('state が空のまま (/clear の後など) でも、store から読み直して足す', async ($, on) => {
  mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>([['hero', { xp: 500, turns: 50, sessions: 4 }]])
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok' }))
  await turn($, () => tool($, 'Read').then(() => {}))
  expect(m.get('hero')).toMatchObject({ xp: 512, turns: 51 })
})

// ---------------------------------------------------------------- 装備 (turn-gacha のカード)

test('ガチャの state を読む: 形の違う物は捨て、持っているカードだけ。ガチャが無ければ undefined', () => {
  expect(ownedCards(undefined, undefined)).toBeUndefined()
  expect(ownedCards(bookOf(['x01']), undefined)).toBeUndefined()
  expect(ownedCards({ total: 1 }, GACHA_CARDS)).toBeUndefined()
  const cards = [...GACHA_CARDS, { id: 'zz', rarity: 'UR', slot: 'weapon', name: 'x' }, { id: 'yy', rarity: 'N', slot: 'boots', name: 'y' }, 'x', null]
  const save = { book: { x01: { count: 2, firstAt: NOW }, r01: { count: 0, firstAt: NOW }, zz: { count: 1 }, yy: { count: 1 }, n02: { count: 1 } } }
  expect(ownedCards(save, cards)?.map(c => c.id)).toEqual(['x01', 'n02'])
  // 外から来た名前の制御文字は落とす
  expect(ownedCards(bookOf(['a']), [{ id: 'a', rarity: 'N', slot: 'charm', name: `ab${String.fromCharCode(7)}c` }])?.[0]?.name).toBe('abc')
})

test('装備で強さが上がる: 武器は攻撃力、防具は最大 HP、お守りは魔力と最大 MP。持っていない物は外れた扱い', () => {
  expect(gearBonus({})).toEqual({ attack: 0, hp: 0, magic: 0, mp: 0 })
  let h = startSession(fromSaved({ xp: 150 }), NOW)
  const base = statsOf(h)
  h = setGear(h, 'weapon', GACHA_CARDS[0])
  h = setGear(h, 'armor', GACHA_CARDS[2])
  h = setGear(h, 'charm', GACHA_CARDS[3])
  expect(gearBonus(h.equip)).toEqual({ attack: 7, hp: 20, magic: 1, mp: 3 })
  const st = statsOf(h)
  expect([st.attack - base.attack, st.maxHp - base.maxHp, st.magic - base.magic, st.maxMp - base.maxMp]).toEqual([7, 20, 1, 3])
  // 防具のカードが図鑑から消えた
  const owned = GACHA_CARDS.filter(c => c.id !== 's02')
  expect(Object.keys(wornOf(h.equip, owned)).sort()).toEqual(['charm', 'weapon'])
  expect(statsOf(wear(h, owned)).maxHp).toBe(base.maxHp)
  // ガチャが無ければ何も着けていない
  expect(statsOf(wear(h, undefined))).toMatchObject({ attack: base.attack, maxHp: base.maxHp, maxMp: base.maxMp })
  // 外す
  expect(setGear(h, 'weapon', undefined).equip.weapon).toBeUndefined()
  // 絵: 装備の分は色を変えて「装備で +n」
  const svg = statusSvg(wear(h, GACHA_CARDS))
  expect(svg).toContain('装備で +7')
  expect(svg).toContain('#39c5cf')
  expect(gearSvg(h, GACHA_CARDS)).toContain('攻撃力 +7')
  expect(gearSvg(h, undefined)).toContain('turn-gacha を入れるとカードを装備できます')
  expect(gearSvg(INITIAL, [])).toContain('ガチャでカードを引くと装備できます')
  for (const x of [svg, gearSvg(h, GACHA_CARDS), gearSvg(h, undefined)]) expect(x).not.toMatch(/<svg[^>]* width=/)
})

test('古い store (装備の無い 0.1 の形) も読める。壊れた装備は捨てる。装備は変えた方が勝つ', () => {
  const old = fromSaved({ xp: 300, turns: 20, achievements: { 'first-bash': NOW }, day: '2026-10-19', dayTurns: 3 })
  expect(old).toMatchObject({ xp: 300, turns: 20, equip: {} })
  const bad = fromSaved({ equip: { weapon: { id: 'x01', rarity: 'SSR', name: 'a' }, armor: 'x', charm: { id: 'n02', rarity: 'Z', name: 'b' }, boots: { id: 'q' } } })
  expect(bad.equip).toEqual({ weapon: { id: 'x01', rarity: 'SSR', slot: 'weapon', name: 'a' } })

  const w = (id: string) => ({ weapon: GACHA_CARDS.find(c => c.id === id)! })
  const base = { ...INITIAL_SAVED, equip: w('r01') }
  // このセッションで変えていなければ、別のセッションが書いた装備を残す
  expect(mergeSaved({ ...base, equip: w('x01') }, base, { ...base, xp: 5 }).equip.weapon?.id).toBe('x01')
  // 変えたら、こちらが勝つ
  expect(mergeSaved({ ...base, equip: w('x01') }, base, { ...base, equip: {} }).equip).toEqual({})
})

for (const surface of SURFACES) {
  test(`${surface}: turn-gacha が無ければ装備の画面に入れ方を出し、選ぶ欄は出さない`, async ($, on) => {
    await boot($, on, { xp: 150 })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'gear' })
    expect((await ui.find({ type: 'Button', key: 'gear' }))?.text).toBe('ステータスに戻る')
    expect(await ui.find({ key: 'equip:weapon' })).toBeUndefined()
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('turn-gacha を入れるとカードを装備できます')
    else expect(await ui.find({ type: 'Text', text: 'turn-gacha を入れるとカードを装備できます' })).toBeDefined()
    // 実績の画面へ、そこから戻る
    await ui.press({ key: 'tab' })
    expect((await ui.find({ type: 'Button', key: 'tab' }))?.text).toBe('ステータスに戻る')
    await ui.press({ key: 'tab' })
    expect((await ui.find({ type: 'Button', key: 'gear' }))?.text).toBe('装備')
  })

  test(`${surface}: ガチャのカードを選んで装備し、store に残り、ステータスが上がり、実績が付く`, async ($, on) => {
    const { hero, stored } = await boot($, on, { xp: 150 }, { gacha: () => ({ save: bookOf(['x01', 'r01', 's02', 'n02']), cards: GACHA_CARDS }) })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'gear' })
    const sel = await ui.find({ key: 'equip:weapon' })
    expect((sel?.props.options as { value: string }[]).map(o => o.value)).toEqual(['', 'x01', 'r01'])
    expect(sel?.props.value).toBe('')
    await ui.select({ key: 'equip:weapon', value: 'x01' })
    expect(stored()?.equip.weapon).toMatchObject({ id: 'x01', rarity: 'SSR' })
    expect(hero().achievements['gear-first']).toBe(NOW)
    expect(hero().achievements['gear-ssr']).toBe(NOW)
    expect((await ui.find({ key: 'equip:weapon' }))?.props.value).toBe('x01')
    await ui.select({ key: 'equip:armor', value: 's02' })
    await ui.select({ key: 'equip:charm', value: 'n02' })
    expect(hero().achievements['gear-full']).toBe(NOW)
    expect(stored()?.equip.charm?.id).toBe('n02')
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /^武器: SSR 一発で通ったテスト/ })).toBeDefined()
    await ui.press({ key: 'gear' })
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('装備で +7')
    else expect(await textOf(ui, /^HP /)).toBe('HP 90/90  MP 38/38')
    // 外す
    await ui.press({ key: 'gear' })
    await ui.select({ key: 'equip:weapon', value: '' })
    expect(stored()?.equip.weapon).toBeUndefined()
  })
}

test('ガチャで持っていない装備は外れた扱い (store の装備は残す)。図鑑 20 種で実績', async ($, on) => {
  let g: Gacha = { save: bookOf(['r01']), cards: GACHA_CARDS }
  const twenty = Array.from({ length: 20 }, (_, i) => CARD(`c${i}`, 'N', 'charm', `カード${i}`))
  const { hero, stored } = await boot($, on, { xp: 150, equip: { weapon: GACHA_CARDS[0] } }, { gacha: () => g })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Lv 3 の素の値 (SSR の武器は持っていないので足さない)
  expect(await textOf(ui, /^攻撃力/)).toBe('攻撃力 12  防御力 4  魔力 10  素早さ 5  根性 0')
  expect(stored()?.equip.weapon?.id).toBe('x01')
  expect(hero().achievements['gear-first']).toBeUndefined()
  g = { save: bookOf(twenty.map(c => c.id)), cards: twenty }
  await turn($)
  expect(hero().achievements['book-20']).toBe(NOW)
})

test('/config の theme が light 系なら明るい窓で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await boot($, on, { xp: 150 })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgOf(ui)).toContain('fill="#ffffff"/>')
  expect(await svgOf(ui)).toContain('#dbe5ff')
  expect(await svgOf(ui)).not.toContain('stop-color="#0b1f5c"')
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await svgOf(ui)).toContain('stop-color="#0b1f5c"')
})

// ---------------------------------------------------------------- daily-quest のごほうび

const quest = (id: string, done: boolean, exp: number, title = `お題 ${id}`) => ({ id, title, goal: 5, progress: done ? 5 : 1, done, reward: { exp, pulls: 1 } })

test('お題のごほうび: 形の違う物と受け取り済みは捨て、題名の制御文字は落とす', () => {
  expect(questRewards(undefined, [])).toEqual([])
  expect(questRewards({ date: '2026-10-20', quests: 'x' }, [])).toEqual([])
  const today = {
    date: '2026-10-20',
    quests: [quest('a', true, 30, `ab${String.fromCharCode(7)}c`), quest('b', false, 30), quest('c', true, 99_999), { id: 'd', done: true, reward: { exp: 'x' } }, 'x'],
  }
  expect(questRewards(today, [])).toEqual([
    { key: '2026-10-20:a', title: 'abc', exp: 30 },
    { key: '2026-10-20:c', title: 'お題 c', exp: 500 },
  ])
  expect(questRewards(today, ['2026-10-20:c']).map(r => r.key)).toEqual(['2026-10-20:a'])
  expect(claimedFrom([1, 'a'])).toEqual(['a'])
  expect(claimedFrom({})).toEqual([])
})

test('こなしたお題の経験値を 1 回だけ受け取り、一言で知らせて store に残す', async ($, on) => {
  let today = { date: '2026-10-20', quests: [quest('turns-5', true, 30, 'ターンを 5 回終える'), quest('edits-5', false, 50)] }
  const { hero, stored, claimed, toasts } = await boot($, on, undefined, { quest: () => today })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // セッションの始まりで、もうこなしていた分を受け取る
  expect(hero().xp).toBe(30)
  expect(stored()?.xp).toBe(30)
  expect(claimed()).toEqual(['2026-10-20:turns-5'])
  expect(await ui.find({ type: 'Text', text: 'お題「ターンを 5 回終える」のごほうび 経験値 +30' })).toBeDefined()
  // 同じお題では 2 度入らない (ターンの 10 だけ)
  await turn($)
  expect(hero().xp).toBe(40)
  today = { ...today, quests: [today.quests[0]!, { ...today.quests[1]!, done: true, progress: 5 }] }
  await turn($)
  expect(hero().xp).toBe(100)
  expect(stored()?.xp).toBe(100)
  expect(claimed()).toEqual(['2026-10-20:turns-5', '2026-10-20:edits-5'])
  expect(await ui.find({ type: 'Text', text: /^お題「お題 edits-5」のごほうび 経験値 \+50/ })).toBeDefined()
  expect(toasts).toEqual(['レベルアップ! Lv 2 見習いコーダー'])
})

test('別のセッションが受け取ったお題は受け取らない', async ($, on) => {
  const today = { date: '2026-10-20', quests: [quest('turns-5', true, 30)] }
  const { hero, claimed } = await boot($, on, undefined, { quest: () => today, claimed: ['2026-10-20:turns-5'] })
  await turn($)
  expect(hero().xp).toBe(10)
  expect(claimed()).toEqual(['2026-10-20:turns-5'])
})

test('daily-quest が入っていなければ、ごほうびは無く store にも書かない', async ($, on) => {
  const { hero, claimed } = await boot($, on)
  await turn($)
  expect(hero().xp).toBe(10)
  expect(claimed()).toBeUndefined()
})

// ---------------------------------------------------------------- 知らない欄

test('知らない欄 (新しい版が書いた物) は、1 ターン後も store に残る。入れ子の中も', async ($, on) => {
  const weapon = { id: 'x01', rarity: 'SSR', slot: 'weapon', name: '一発で通ったテスト', futurePower: 3 }
  const { stored } = await boot($, on, {
    ...INITIAL_SAVED,
    turns: 4,
    futureField: 1,
    achievements: { 'first-bash': NOW, futureAch: NOW },
    learned: { slash: NOW, futureSkill: NOW },
    defeated: { futureBoss: NOW },
    alloc: { str: 1, vit: 0, int: 0, agi: 0, luck: 2 },
    equip: { weapon, ring: { id: 'z01' } },
  } as Partial<RpgSaved>)
  await turn($)
  // 書いたこと (ターンが増えた) と、知らない欄が残ったこと
  expect(stored() as unknown as object).toMatchObject({
    turns: 5,
    futureField: 1,
    achievements: { 'first-bash': NOW, futureAch: NOW },
    learned: { slash: NOW, futureSkill: NOW },
    defeated: { futureBoss: NOW },
    alloc: { str: 1, luck: 2 },
  })
  expect(stored()?.equip).toEqual({ weapon, ring: { id: 'z01' } } as never)
  // 知っている欄は今の値で書く: 外した枠は戻さない
  const raw = { ...INITIAL_SAVED, equip: { weapon, ring: { id: 'z01' } } }
  expect(withUnknown(raw, { ...fromSaved(raw), equip: {} }).equip).toEqual({ ring: { id: 'z01' } })
})
