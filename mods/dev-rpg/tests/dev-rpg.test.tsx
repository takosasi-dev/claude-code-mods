import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { RpgHero, RpgSaved } from '../types'
import {
  ACHIEVEMENTS,
  INITIAL,
  achievementsSvg,
  fromSaved,
  levelInfo,
  onTool,
  startSession,
  statusSvg,
  titleOf,
  toolKind,
  xpToReach,
} from '../hooks/rpg'

const NOW = Date.parse('2026-10-20T03:00:00Z')
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
const boot = async ($: Engine, on: On, saved?: Partial<RpgSaved>, opts: { failTool?: () => boolean } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(saved ? [['hero', saved]] : [])
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
  return { clock, hero, toasts, stored: () => m.get('hero') as RpgSaved | undefined, put: (v: unknown) => m.set('hero', v) }
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
      expect(svg).toContain('1 / 12')
      expect((svg.match(/stroke-dasharray="3 2"/g) ?? []).length).toBe(11)
      expect(svg).toContain('stroke="#ffffff" stroke-width="3"')
      expect(await ui.find({ key: 'lines' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await textOf(ui, /^勇者 Lv/)).toBe('勇者 Lv 3 駆け出しデバッガー')
      expect(await textOf(ui, /^HP /)).toBe('HP 70/70  MP 35/35')
      expect(await textOf(ui, /^経験値 /)).toBe('経験値 10/100 (つぎまで 90)')
      expect(await textOf(ui, /^実績 /)).toBe(`実績 1/12 ●${'○'.repeat(11)}`)
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
  expect(await textOf(ui, /^攻撃力/)).toBe('攻撃力 7  魔力 1  素早さ 1  根性 0')
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
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const r = await $.command.run({ command: 'rpg', args: '', origin: { kind: 'composer' }, presentation })
  expect(r).toMatchObject({ text: '冒険の書を開きました。' })
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
