import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { RpgDelve, RpgHero, RpgSaved } from '../types'
import { BOSSES } from '../hooks/battle'
import { DELVE, autoFight, checkpoint, dungeonLines, dungeonSvg, enterDelve, floorEnemy, isGuardFloor, leaveDelve, lootOf, pickCommand, stepDelve } from '../hooks/dungeon'
import { ACHIEVEMENTS, INITIAL_SAVED, SKILLS, delveFrom, fromSaved, mergeSaved, spOf, startSession, statsOf, toSaved, withUnknown, xpToReach } from '../hooks/rpg'
import { setTheme } from '../hooks/style'

const NOW = Date.parse('2026-10-22T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'dev-rpg',
  component: 'Pane',
  requestId: 'dev-rpg',
  props: { title: '冒険の書', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const heroAt = (level: number, extra: Partial<RpgSaved> = {}): RpgHero => startSession(fromSaved({ xp: xpToReach(level), ...extra }), NOW)
const ALL_SKILLS = Object.fromEntries(SKILLS.map(s => [s.id, NOW]))

/** steps 歩を進める (毎歩、強さは同じ勇者から) */
const walk = (h0: RpgHero, steps: number) => {
  let h = h0
  const events = []
  for (let i = 0; i < steps; i++) {
    const r = stepDelve(h, h)
    h = r.hero
    if (r.event && r.event.kind !== 'step') events.push(r.event)
    if (!h.delve) break
  }
  return { h, events }
}

test('階と敵: 種と階で決まり、10 階ごとに番人。休み場は 5 階ごと', () => {
  expect(floorEnemy(7, 123)).toEqual(floorEnemy(7, 123))
  expect(floorEnemy(7, 123).level).toBe(7 * DELVE.levelPerFloor)
  expect(floorEnemy(7, 123).isBoss).toBe(false)
  const g = floorEnemy(10, 1)
  expect(isGuardFloor(10)).toBe(true)
  expect(g).toMatchObject({ isBoss: true, id: BOSSES[0]!.id, name: `番人 ${BOSSES[0]!.name}` })
  expect(floorEnemy(20, 1).id).toBe(BOSSES[1]!.id)
  expect(floorEnemy(40, 1).id).toBe(BOSSES[0]!.id)
  expect(g.hp).toBe(g.maxHp)
  expect([0, 4, 5, 9, 10, 14, 15].map(checkpoint)).toEqual([1, 1, 6, 6, 11, 11, 16])
  expect(lootOf(floorEnemy(3, 1))).toBeGreaterThan(0)
})

test('潜る: 1 歩ずつ HP と MP が戻り、8 歩でその階の敵と戦う。勝てば次の階へ、袋と一番深い階', () => {
  let h = enterDelve(heroAt(30), NOW, 1)
  expect(h.delve).toMatchObject({ floor: 1, step: 0, hp: 100, mp: 100, loot: 0, cleared: 0, last: null })
  h = { ...h, delve: { ...h.delve!, hp: 50, mp: 50 } }
  const one = stepDelve(h, h)
  expect(one.event).toEqual({ kind: 'step' })
  expect(one.hero.delve).toMatchObject({ step: 1, hp: 50 + DELVE.regenHp, mp: 50 + DELVE.regenMp })
  const { h: after, events } = walk(h, DELVE.steps)
  expect(events).toHaveLength(1)
  expect(events[0]?.kind).toBe('won')
  const enemy = floorEnemy(1, h.delve!.seed)
  expect(after.delve).toMatchObject({ floor: 2, step: 0, cleared: 1, loot: lootOf(enemy) })
  expect(after.delve?.last).toMatchObject({ floor: 1, name: enemy.name, result: 'won' })
  expect(after.deepest).toBe(1)
  // 経験値は帰るまで入らない
  expect(after.xp).toBe(h.xp)
  const home = leaveDelve(after)
  expect(home.delve).toBeNull()
  expect(home.xp).toBe(h.xp + lootOf(enemy))
  expect(home.deepest).toBe(1)
  // 潜っていなければ何も起きない
  expect(stepDelve(home, home)).toEqual({ hero: home })
  expect(leaveDelve(home)).toBe(home)
  // 休み場より深い所からは潜れない
  expect(enterDelve(heroAt(30, { deepest: 12 }), NOW, 99).delve?.floor).toBe(11)
  expect(enterDelve(heroAt(30, { deepest: 12 }), NOW, 1).delve?.floor).toBe(1)
})

test('力尽きると入口に戻り、袋の半分を持ち帰る。一番深い階は残る', () => {
  const h0 = { ...enterDelve(heroAt(1, { deepest: 30 }), NOW, 31) }
  const h = { ...h0, delve: { ...h0.delve!, loot: 101, step: DELVE.steps - 1 } }
  const r = stepDelve(h, h)
  expect(r.event?.kind).toBe('lost')
  expect(r.hero.delve).toBeNull()
  expect(r.hero.xp).toBe(h.xp + 50)
  expect(r.hero.deepest).toBe(30)
  if (r.event?.kind === 'lost') expect(r.event.kept).toBe(50)
})

test('装備と SP が効く: 同じレベルでも、スキルと振った SP と装備があれば深く潜れる', () => {
  const depth = (h0: RpgHero) => {
    let h = enterDelve(h0, NOW, 1)
    for (let i = 0; i < 400 && h.delve; i++) h = stepDelve(h, h).hero
    return h.deepest
  }
  const plain = heroAt(20)
  const strong: RpgHero = {
    ...plain,
    learned: ALL_SKILLS,
    alloc: { str: 10, vit: 10, int: 10, agi: 0 },
    equip: { weapon: { id: 'w', rarity: 'SSR', slot: 'weapon', name: 'w' }, armor: { id: 'a', rarity: 'SR', slot: 'armor', name: 'a' } },
  }
  expect(statsOf(strong).attack).toBeGreaterThan(statsOf(plain).attack)
  const a = depth(plain)
  const b = depth(strong)
  expect(a).toBeGreaterThan(0)
  expect(b).toBeGreaterThan(a)
})

test('自動の戦い: 危なければ回復、番人には盾、あとは一番効く技。終わらなければ力尽きた扱い', () => {
  const h = { ...heroAt(30), learned: ALL_SKILLS }
  const st = statsOf(h)
  const me = { maxHp: st.maxHp, hp: st.maxHp, maxMp: st.maxMp, mp: st.maxMp, atk: st.attack, def: st.defense, mag: st.magic, spd: st.speed, crit: 0, regen: 0 }
  const base = { enemy: floorEnemy(30, 1), me, round: 1, guard: 3, isExposed: true, isCharging: false, usedRollback: false, seed: 1, log: [], result: 'fight' as const, gainedXp: 0, hitEnemy: 0, hitMe: 0 }
  expect(pickCommand({ ...base, me: { ...me, hp: 1 } }, ALL_SKILLS)).toEqual({ kind: 'skill', id: 'rollback' })
  expect(pickCommand({ ...base, me: { ...me, hp: Math.round(me.maxHp * 0.4) }, usedRollback: true }, ALL_SKILLS)).toEqual({ kind: 'skill', id: 'heal' })
  expect(pickCommand({ ...base, guard: 0 }, ALL_SKILLS)).toEqual({ kind: 'skill', id: 'guard' })
  expect(pickCommand(base, ALL_SKILLS)).toEqual({ kind: 'skill', id: 'deploy' })
  expect(pickCommand(base, {})).toEqual({ kind: 'attack' })
  // MP が無ければ普通に斬る
  expect(pickCommand({ ...base, me: { ...me, mp: 0 } }, ALL_SKILLS)).toEqual({ kind: 'attack' })
  const done = autoFight({ ...base, guard: 0, isExposed: false }, ALL_SKILLS)
  expect(['won', 'lost']).toContain(done.result)
})

test('store: 古い形は入口にいる。壊れた潜りは捨てる。2 つのセッションでは深い記録が勝ち、変えた方の潜りが残る', () => {
  expect(fromSaved({ xp: 10 })).toMatchObject({ deepest: 0, delve: null })
  expect(fromSaved({ deepest: -3, delve: { floor: 'x' } })).toMatchObject({ deepest: 0, delve: null })
  const d: RpgDelve = { startedAt: NOW, floor: 4, step: 3, hp: 80, mp: 60, loot: 40, cleared: 3, seed: 9, last: null }
  expect(delveFrom({ ...d, hp: 500, last: { floor: 3, level: 6, result: 'won', name: `a${String.fromCharCode(7)}b`, color: 'red' } })).toMatchObject({
    hp: 100,
    last: { name: 'ab', color: '#3fb950', shape: 'slime' },
  })
  const base: RpgSaved = { ...INITIAL_SAVED, deepest: 5, delve: d }
  // 別のセッションが深く潜った。こちらは潜りを変えていない
  const store: RpgSaved = { ...base, deepest: 9, delve: { ...d, floor: 9 } }
  expect(mergeSaved(store, base, { ...base, xp: 3 })).toMatchObject({ deepest: 9, delve: { floor: 9 } })
  // こちらで帰った (潜りを変えた) なら、こちらが勝つ。一番深い階は大きい方
  expect(mergeSaved(store, base, { ...base, deepest: 6, delve: null })).toMatchObject({ deepest: 9, delve: null })
  // こちらが帰っても、別のセッションが新しく入った潜りは消さない
  const other: RpgSaved = { ...base, delve: { ...d, startedAt: NOW + 5, floor: 1 } }
  expect(mergeSaved(other, base, { ...base, delve: null }).delve).toMatchObject({ startedAt: NOW + 5 })
  expect(toSaved({ ...heroAt(3), delve: d }).delve).toEqual(d)
  // 知らない欄: 同じ潜りなら中の欄も残す。新しく潜り直したら残さない
  const raw = { ...base, delve: { ...d, futureLamp: 2 } }
  expect(withUnknown(raw, base).delve).toEqual({ ...d, futureLamp: 2 } as never)
  expect(withUnknown(raw, { ...base, delve: { ...d, startedAt: NOW + 1 } }).delve).toEqual({ ...d, startedAt: NOW + 1 })
  expect(withUnknown(raw, { ...base, delve: null }).delve).toBeNull()
})

// 監査の再現 (audit/store/t1.mjs) をそのまま。2 つのセッションが同じ潜りを持っている時
test('2 つのセッションが同じ潜りを持っていても、袋は 1 回分しか持ち帰れない (終わった潜りは書き戻さない)', () => {
  const delve: RpgDelve = { startedAt: 1, floor: 5, step: 3, hp: 80, mp: 80, loot: 100, cleared: 4, seed: 7, last: null }
  let store: RpgSaved = { ...INITIAL_SAVED, xp: 1000, delve }
  let A = startSession(store, 0)
  let B = startSession(store, 0)
  const save = (h: RpgHero): RpgHero => {
    const w = mergeSaved(store, h.synced, toSaved(h))
    store = w
    return { ...h, ...w, synced: w }
  }
  A = save(A)
  B = save(B)
  A = save(leaveDelve(A))
  expect(store).toMatchObject({ xp: 1100, delve: null, doneDelves: [{ id: 1, xp: 100 }] })
  // B が 1 歩進めて保存しても、終わった潜りは書き戻さず、B も入口に戻る
  B = save({ ...B, delve: { ...B.delve!, step: B.delve!.step + 1 } })
  expect(store).toMatchObject({ xp: 1100, delve: null })
  expect(B.delve).toBeNull()
  A = save(A)
  expect(A.delve).toBeNull()
  A = save(leaveDelve(A))
  expect(store.xp).toBe(1100)
  B = save(leaveDelve(B))
  expect(store.xp).toBe(1100)

  // B が保存する前に (同じ潜りを持ったまま) 帰っても、2 度目の持ち帰りは引く
  store = { ...INITIAL_SAVED, xp: 1000, delve }
  A = startSession(store, 0)
  B = startSession(store, 0)
  A = save(leaveDelve(A))
  B = save(leaveDelve(B))
  expect(store).toMatchObject({ xp: 1100, delve: null })
  expect(B.xp).toBe(1100)
  expect(store.doneDelves).toEqual([{ id: 1, xp: 100 }])

  // 力尽きた時の持ち帰りも同じ。A が先に新しい潜りに入っていれば、B の古い潜りでなくそちらが残る
  store = { ...INITIAL_SAVED, xp: 1000, delve: { ...delve, step: DELVE.steps - 1, floor: 999 } }
  A = startSession(store, 0)
  B = startSession(store, 0)
  const lost = stepDelve(A, A)
  expect(lost.event?.kind).toBe('lost')
  A = save(enterDelve(lost.hero, 50, 1))
  expect(store.xp).toBe(1050)
  B = save(stepDelve(B, B).hero)
  expect(store.xp).toBe(1050)
  expect(store.delve?.startedAt).toBe(50)
  expect(B.delve?.startedAt).toBe(50)

  // 終わった潜りの印は 20 件まで。古い物から落ちる
  let many: RpgSaved = INITIAL_SAVED
  for (let i = 1; i <= 25; i++) many = mergeSaved(many, many, toSaved(leaveDelve({ ...startSession(many, 0), delve: { ...delve, startedAt: i } })))
  expect(many.doneDelves.map(d => d.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6))
  expect(fromSaved({ doneDelves: [{ id: 3, xp: 9 }, 'x', { id: 'y', xp: 1 }, null] }).doneDelves).toEqual([{ id: 3, xp: 9 }])
  // 印の中の知らない欄も残す
  const raw = { ...INITIAL_SAVED, doneDelves: [{ id: 3, xp: 9, futureNote: 'n' }] }
  expect(withUnknown(raw, fromSaved(raw)).doneDelves).toEqual([{ id: 3, xp: 9, futureNote: 'n' }] as never)
})

// 監査の再現 (t1.mjs の後半)。やり直し・控えから戻すは世代を上げ、別のセッションはその差分を足さない
test('別のセッションがやり直した後に保存しても、実績・スキル・ボス・最深階を戻さない', () => {
  const full: RpgSaved = { ...INITIAL_SAVED, xp: 50000, achievements: { 'first-bash': 1, 'turns-100': 2 }, learned: { slash: 3 }, defeated: { loop: 4 }, deepest: 30 }
  let Bs = startSession(full, 0)
  const fresh = startSession({ ...INITIAL_SAVED, epoch: 1 }, 0)
  const st2 = toSaved(fresh) // A がやり直した
  Bs = { ...Bs, xp: Bs.xp + 10 } // B が 1 ターン
  const w = mergeSaved(st2, Bs.synced, toSaved(Bs))
  expect(w).toEqual(st2)
  expect(w).toMatchObject({ xp: 0, achievements: {}, learned: {}, defeated: {}, deepest: 0, epoch: 1 })
  // 世代が同じなら今までどおり差分を足す
  expect(mergeSaved(st2, st2, { ...st2, xp: 10 }).xp).toBe(10)
  expect(fromSaved({ epoch: 3 }).epoch).toBe(3)
  expect(fromSaved({ epoch: 'x' }).epoch).toBe(0)
})

// 監査の再現 (t1.mjs の最後)。2 つのセッションで同じ SP を振った時
test('2 つのセッションが同じ SP を使って、もらった分を超えたら、後から書いた方の使った分を取り消す', () => {
  const base: RpgSaved = { ...INITIAL_SAVED, xp: 0, achievements: { 'first-bash': 1, 'first-edit': 1, 'recover-3': 1, 'day-50': 1 } }
  expect(spOf(base).free).toBe(4)
  let s3 = base
  s3 = mergeSaved(s3, base, { ...base, alloc: { ...base.alloc, str: 4 } })
  s3 = mergeSaved(s3, base, { ...base, alloc: { ...base.alloc, vit: 4 } })
  expect(s3.alloc).toEqual({ str: 4, vit: 0, int: 0, agi: 0 })
  expect(spOf(s3).used).toBeLessThanOrEqual(spOf(s3).earned)
  // 振り直し (減る差分) は取り消さない
  const spent = { ...base, alloc: { ...base.alloc, str: 4 } }
  expect(mergeSaved(spent, spent, { ...spent, alloc: { ...spent.alloc, str: 0 } }).alloc.str).toBe(0)
})

test('SP は 10 階ごとに 2 入り、実績が 2 つ増えた', () => {
  expect(spOf({ ...INITIAL_SAVED, deepest: 25 })).toMatchObject({ fromDeep: 4 })
  expect(ACHIEVEMENTS.map(a => a.id)).toContain('deep-10')
})

test('絵: 入口と潜っている時の SVG は幅と上限を守り、明るいテーマにも付いていく', () => {
  const h = { ...heroAt(12, { deepest: 7 }), delve: { startedAt: NOW, floor: 10, step: 5, hp: 64, mp: 40, loot: 88, cleared: 2, seed: 3, last: { floor: 9, name: 'ハイゼンバグ', level: 18, isBoss: false, shape: 'ghost', color: '#39c5cf', result: 'won' as const, hitMe: 31, loot: 26 } } }
  const out = { ...h, delve: null }
  for (const isLight of [false, true]) {
    setTheme(isLight)
    for (const svg of [dungeonSvg(h), dungeonSvg(out), dungeonSvg({ ...h, delve: { ...h.delve, last: null } })]) {
      expect(svg.length).toBeLessThan(131_072)
      expect(svg).toContain('font-family="sans-serif"')
      expect(svg).not.toMatch(/<svg[^>]* width=/)
    }
  }
  setTheme(false)
  expect(dungeonSvg(h)).toContain('地下 10 階')
  expect(dungeonSvg(h)).toContain('番人の階')
  expect(dungeonSvg(h)).toContain('経験値 88')
  expect(dungeonSvg(out)).toContain('ダンジョンの入口')
  expect(dungeonSvg(out)).toContain('6 階から潜れる')
  expect(dungeonLines(h)[0]?.text).toBe('ダンジョン 地下 10 階 (記録 7 階) 番人の階')
  expect(dungeonLines(out).map(l => l.text)).toContain('6 階から潜れる')
})

// ---------------------------------------------------------------- 画面

const boot = async ($: Engine, on: On, saved?: Partial<RpgSaved> & Record<string, unknown>) => {
  mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(saved ? [['hero', saved]] : [])
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return { stored: () => m.get('hero') as RpgSaved & Record<string, unknown>, put: (v: unknown) => m.set('hero', v), toasts }
}

let turnNo = 0
const turn = async ($: Engine) => {
  const turnId = `d${++turnNo}`
  await $.turn.start({ text: 'hi', turnId })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
}

for (const surface of SURFACES) {
  test(`${surface}: 「ダンジョン」で潜り、ターンで階を進み、「帰る」で袋の経験値を持ち帰る`, async ($, on) => {
    const { stored } = await boot($, on, { xp: xpToReach(30), deepest: 5 })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Button', key: 'dungeon' }))?.text).toBe('ダンジョン (記録 5 階)')
    await ui.press({ key: 'dungeon' })
    expect((await ui.find({ type: 'Button', key: 'dungeon' }))?.text).toBe('ステータスに戻る')
    expect((await ui.find({ type: 'Button', key: 'delve:enter' }))?.text).toBe('6 階から潜る')
    expect(await ui.find({ type: 'Button', key: 'delve:enter1' })).toBeDefined()
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('ダンジョンの入口')
    else expect(await ui.find({ type: 'Text', text: 'ダンジョンの入口 (記録 5 階)' })).toBeDefined()
    await ui.press({ key: 'delve:enter' })
    expect(stored().delve).toMatchObject({ floor: 6, step: 0, loot: 0 })
    for (let i = 0; i < DELVE.steps; i++) await turn($)
    const d = stored().delve!
    expect(d).toMatchObject({ floor: 7, step: 0, cleared: 1 })
    expect(d.loot).toBeGreaterThan(0)
    expect(stored().deepest).toBe(6)
    expect(await ui.find({ type: 'Text', text: /^ダンジョン 6 階: .+を倒した \(袋に経験値 \+\d+\)$/ })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'delve:leave' }))?.text).toBe(`帰る (袋の経験値 ${d.loot} を持ち帰る)`)
    const xp = stored().xp
    await ui.press({ key: 'delve:leave' })
    expect(stored().delve).toBeNull()
    expect(stored().xp).toBe(xp + d.loot)
    expect(await ui.find({ type: 'Text', text: `ダンジョンから帰った。袋の経験値 ${d.loot} を持ち帰った` })).toBeDefined()
    // 実績「地下へ」(5 階) も付いている
    expect(stored().achievements['deep-5']).toBe(NOW)
  })
}

test('ダンジョンで力尽きるとトーストで知らせ、入口に戻る', async ($, on) => {
  const { stored, toasts } = await boot($, on, { xp: 0, deepest: 40 })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'dungeon' })
  await ui.press({ key: 'delve:enter' })
  expect(stored().delve?.floor).toBe(41)
  for (let i = 0; i < DELVE.steps; i++) await turn($)
  expect(stored().delve).toBeNull()
  expect(stored().deepest).toBe(40)
  expect(toasts).toContain('ダンジョン 41 階で力尽きた。入口に戻った')
  expect(await ui.find({ type: 'Button', key: 'delve:enter' })).toBeDefined()
})

test('別の窓が先に帰った潜りから「帰る」を押しても、袋の経験値は 2 度入らない', async ($, on) => {
  const delve = { startedAt: NOW - 1000, floor: 3, step: 1, hp: 90, mp: 90, loot: 100, cleared: 2, seed: 4, last: null }
  const { stored, put } = await boot($, on, { ...INITIAL_SAVED, xp: 1000, delve })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'dungeon' })
  // 別の窓が帰った (袋を持ち帰り、終えた印を残した)
  const now = stored()
  put({ ...now, xp: now.xp + 100, delve: null, doneDelves: [{ id: delve.startedAt, xp: 100 }] })
  await ui.press({ key: 'delve:leave' })
  expect(stored()).toMatchObject({ xp: now.xp + 100, delve: null, doneDelves: [{ id: delve.startedAt, xp: 100 }] })
  // 画面の勇者も store に合わせて入口に戻る。もう一度ターンを終えても潜りは戻らない
  expect(await ui.find({ type: 'Button', key: 'delve:enter' })).toBeDefined()
  await turn($)
  expect(stored()).toMatchObject({ xp: now.xp + 100 + 10, delve: null })
})

test('知らない欄 (新しい版が書いた物) は、潜っていても 1 ターン後も store に残る', async ($, on) => {
  const delve = { startedAt: NOW - 1000, floor: 3, step: 1, hp: 90, mp: 90, loot: 5, cleared: 2, seed: 4, last: null, futureLamp: 1 }
  const { stored } = await boot($, on, { ...INITIAL_SAVED, xp: xpToReach(20), deepest: 2, futureField: 1, delve })
  await turn($)
  expect(stored()).toMatchObject({ futureField: 1, deepest: 2, delve: { floor: 3, step: 2, futureLamp: 1 } })
})
