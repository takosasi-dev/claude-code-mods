import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { RpgBattle, RpgHero, RpgSaved } from '../types'
import { BOSSES, ENEMIES, act, battleSvg, canUse, endBattle, enemyOf, growthSvg, nextBoss, spawnBoss, startBattle, winBattle } from '../hooks/battle'
import {
  ACHIEVEMENTS,
  BOSS_IDS,
  INITIAL_SAVED,
  MAX_ENCOUNTERS,
  REST_MS,
  SKILLS,
  fromSaved,
  learnSkill,
  levelInfo,
  mergeSaved,
  onTurnEnd,
  onTurnStart,
  raiseStat,
  respec,
  spOf,
  startSession,
  statsOf,
  statusSvg,
  toSaved,
  xpToReach,
} from '../hooks/rpg'

const NOW = Date.parse('2026-10-21T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'dev-rpg',
  component: 'Pane',
  requestId: 'dev-rpg',
  props: { title: '冒険の書', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** そのレベルの勇者 (store から読んだ形) */
const heroAt = (level: number, extra: Partial<RpgSaved> = {}): RpgHero => startSession(fromSaved({ xp: xpToReach(level), ...extra }), NOW)

const boot = async ($: Engine, on: On, saved?: Partial<RpgSaved>) => {
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
  on('ui.toast', () => ({ value: undefined }))
  let last: RpgBattle | null | undefined
  on('state.set', async (_$, e, next) => {
    const r = await next(e)
    if (e.plugin === 'dev-rpg' && e.key === 'battle' && r.value?.isSet) last = e.value as RpgBattle | null
    return r
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return { stored: () => m.get('hero') as RpgSaved, battle: () => last }
}

let turnNo = 0
const turn = async ($: Engine) => {
  const turnId = `b${++turnNo}`
  await $.turn.start({ text: 'hi', turnId })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
}

// ---------------------------------------------------------------- 成長 (SP)

test('SP はレベル・実績・勝利・ボスから入る。0.2 の勇者にもさかのぼって入る', () => {
  // 0.2.0 の store (戦いと成長の値が無い): Lv 8 で実績 7 個
  const old = fromSaved({ xp: 940, achievements: Object.fromEntries(ACHIEVEMENTS.slice(0, 7).map(a => [a.id, NOW])) })
  expect(levelInfo(old.xp).level).toBe(8)
  expect(old).toMatchObject({ encounters: 3, wins: 0, battles: 0, alloc: { str: 0, vit: 0, int: 0, agi: 0 }, learned: {}, defeated: {} })
  expect(spOf(old)).toMatchObject({ fromLevel: 14, fromAchievements: 7, fromWins: 0, fromBosses: 0, earned: 21, used: 0, free: 21 })
  // 3 勝で 1、ボス 1 体で 3
  expect(spOf({ ...old, wins: 7, defeated: { loop: NOW } })).toMatchObject({ fromWins: 2, fromBosses: 3, earned: 26 })
  // 壊れた値は捨てる
  const bad = fromSaved({ alloc: { str: 2.7, vit: -1, int: 'x' }, learned: { slash: NOW, nope: 1 }, defeated: { loop: 'x', outage: NOW }, encounters: 99 })
  expect(bad).toMatchObject({ alloc: { str: 2, vit: 0, int: 0, agi: 0 }, learned: { slash: NOW }, defeated: { outage: NOW }, encounters: MAX_ENCOUNTERS })
  expect(BOSSES.map(b => b.id)).toEqual([...BOSS_IDS])
  expect(new Set([...ENEMIES, ...BOSSES].map(e => e.id)).size).toBe(ENEMIES.length + BOSSES.length)
  expect(new Set(SKILLS.map(s => s.id)).size).toBe(SKILLS.length)
})

test('能力に振ると強さが上がり、スキルはレベルと SP が要る。振り直しは能力だけ', () => {
  let h = heroAt(5)
  const base = statsOf(h)
  expect(spOf(h).free).toBe(8)
  for (const k of ['str', 'vit', 'int', 'agi'] as const) h = raiseStat(h, k)!
  const st = statsOf(h)
  expect([st.attack - base.attack, st.maxHp - base.maxHp, st.defense - base.defense, st.magic - base.magic, st.maxMp - base.maxMp, st.speed - base.speed, st.crit - base.crit]).toEqual([
    2, 10, 2, 2, 4, 2, 1,
  ])
  expect(spOf(h)).toMatchObject({ used: 4, free: 4 })
  // Lv が足りない・覚えた・SP が足りない
  expect(learnSkill(h, 'rollback', NOW)).toBe('「ロールバック」は Lv 18 で覚えられます')
  h = learnSkill(h, 'lint', NOW) as RpgHero
  expect(h.learned.lint).toBe(NOW)
  expect(learnSkill(h, 'lint', NOW)).toBe('「静的解析」はもう覚えています')
  expect(spOf(h).free).toBe(1)
  expect(learnSkill(h, 'slash', NOW)).toBe('SP が足りません (「リファクタ斬り」は 2 SP)')
  h = raiseStat(h, 'str')!
  expect(raiseStat(h, 'str')).toBeUndefined()
  // コードレビューは会心 +10
  const rv = { ...heroAt(6), learned: { review: NOW } }
  expect(statsOf(rv).crit - statsOf(heroAt(6)).crit).toBe(10)
  h = respec(h)
  expect(spOf(h)).toMatchObject({ used: 3, free: 5 })
  expect(h.learned.lint).toBe(NOW)
})

test('2 つのセッションの振り分け・スキル・ボス・遭遇も、増えた分だけ足す', () => {
  const base: RpgSaved = { ...INITIAL_SAVED, alloc: { str: 1, vit: 0, int: 0, agi: 0 }, encounters: 2 }
  const store: RpgSaved = { ...base, alloc: { str: 3, vit: 0, int: 0, agi: 0 }, learned: { heal: NOW - 5 }, encounters: 4 }
  const mine: RpgSaved = { ...base, alloc: { str: 1, vit: 2, int: 0, agi: 0 }, learned: { slash: NOW }, defeated: { loop: NOW }, encounters: 5, wins: 2 }
  const out = mergeSaved(store, base, mine)
  expect(out.alloc).toEqual({ str: 3, vit: 2, int: 0, agi: 0 })
  expect(out.learned).toEqual({ heal: NOW - 5, slash: NOW })
  expect(out.defeated).toEqual({ loop: NOW })
  // 4 + (5 - 2) = 7 でも 5 まで
  expect(out.encounters).toBe(MAX_ENCOUNTERS)
  expect(out.wins).toBe(2)
  // 振り直しは減る差分として届く
  expect(mergeSaved(store, base, { ...base, alloc: { str: 0, vit: 0, int: 0, agi: 0 } }).alloc.str).toBe(2)
  // ターンの終わりに遭遇が 1 つたまる (5 まで)
  let h = heroAt(1, { encounters: 4 })
  h = onTurnEnd(h, NOW)
  expect(h.encounters).toBe(5)
  expect(onTurnEnd(h, NOW).encounters).toBe(5)
  expect(toSaved(h).encounters).toBe(5)
})

// ---------------------------------------------------------------- 戦い

test('同じ種なら同じ敵と同じ結果。勝つと経験値・勝ち数、ボスは倒した時刻', () => {
  const h = heroAt(8)
  const a = startBattle(h, 12345, false)
  expect(startBattle(h, 12345, false)).toEqual(a)
  expect(a.enemy.level).toBeGreaterThanOrEqual(6)
  expect(a.enemy.level).toBeLessThanOrEqual(9)
  expect(ENEMIES.filter(k => k.level <= 8).map(k => k.id)).toContain(a.enemy.id)
  expect(a.me).toMatchObject({ hp: statsOf(h).hp, atk: statsOf(h).attack })
  expect(act(a, { kind: 'attack' }, {})).toEqual(act(a, { kind: 'attack' }, {}))

  // とても強い勇者は普通の敵に勝つ
  let b: RpgBattle = { ...a, me: { ...a.me, atk: 999, spd: 999 } }
  b = act(b, { kind: 'attack' }, {})
  expect(b.result).toBe('won')
  expect(b.gainedXp).toBe(a.enemy.xp)
  expect(b.hitEnemy).toBeGreaterThan(0)
  expect(b.log.at(-1)).toContain('やっつけた')
  // 終わった戦いは動かない
  expect(act(b, { kind: 'attack' }, {})).toBe(b)
  const won = winBattle(h, b, NOW)
  expect(won).toMatchObject({ xp: h.xp + a.enemy.xp, wins: 1, defeated: {} })

  // ボス: 逃げられない。倒すと時刻が付く (2 回目は最初の時刻のまま)
  const boss = startBattle(heroAt(10), 1, true)
  expect(boss.enemy).toMatchObject({ id: 'loop', isBoss: true, level: 10 })
  const fled = act(boss, { kind: 'flee' }, {})
  expect(fled.log).toContain('ボスからは逃げられない!')
  expect(fled.result).not.toBe('fled')
  const bw = act({ ...boss, me: { ...boss.me, atk: 9999, spd: 999 } }, { kind: 'attack' }, {})
  const hb = winBattle(heroAt(10), bw, NOW)
  expect(hb.defeated.loop).toBe(NOW)
  expect(winBattle(hb, bw, NOW + 1).defeated.loop).toBe(NOW)
  expect(nextBoss(hb).id).toBe('outage')
  expect(nextBoss({ ...hb, defeated: { loop: 1, outage: 1, legacy: 1 } }).id).toBe('legacy')
})

test('ボスはレベルが届けば、20 ターンごとと 5% で湧く。湧いたボスは経験値 1.5 倍', () => {
  // Lv 9 では湧かない (次のボスは Lv 10)
  expect(spawnBoss(heroAt(9, { turns: 20 }), NOW).bossSign).toBe(0)
  // 20 ターンごとに必ず。もう湧いていればそのまま
  const h = heroAt(10, { turns: 20 })
  expect(spawnBoss(h, NOW).bossSign).toBe(1)
  const up = { ...h, bossSign: 1 }
  expect(spawnBoss(up, NOW)).toBe(up)
  // 20 の倍数でない時は 5% 前後 (時刻とターン数で決まる)
  let n = 0
  let tries = 0
  for (let t = 1; t <= 4000; t++) {
    if (t % 20 === 0) continue
    tries++
    if (spawnBoss(heroAt(10, { turns: t }), NOW + t * 61_000).bossSign > 0) n++
  }
  expect(n / tries).toBeGreaterThan(0.03)
  expect(n / tries).toBeLessThan(0.07)
  // 全部倒した後も、最後のボスが湧く
  expect(spawnBoss(heroAt(45, { turns: 40, defeated: { loop: NOW, outage: NOW, legacy: NOW } }), NOW).bossSign).toBe(1)
  // 湧いたボスは経験値 1.5 倍
  const normal = startBattle(h, 1, true)
  const spawned = startBattle(h, 1, true, true)
  expect(spawned.enemy.xp).toBe(Math.round(normal.enemy.xp * 1.5))
  expect(spawned.log[0]).toBe('無限ループ・ドラゴンが立ちはだかった! (経験値 1.5 倍)')
  // 保存は 0 か 1。2 つのセッションで湧いても 1、片方で挑めば 0
  expect(fromSaved({}).bossSign).toBe(0)
  expect(fromSaved({ bossSign: 5 }).bossSign).toBe(1)
  const one = { ...INITIAL_SAVED, bossSign: 1 }
  expect(mergeSaved(one, INITIAL_SAVED, one).bossSign).toBe(1)
  expect(mergeSaved(one, one, INITIAL_SAVED).bossSign).toBe(0)
})

test('弱い勇者はボスに負ける。経験値は減らない', () => {
  const h = heroAt(1)
  let b = startBattle(h, 7, true)
  for (let i = 0; i < 50 && b.result === 'fight'; i++) b = act(b, { kind: 'attack' }, {})
  expect(b.result).toBe('lost')
  expect(b.me.hp).toBe(0)
  expect(b.log.at(-1)).toContain('力尽きた')
  expect(winBattle(h, b, NOW)).toBe(h)
})

test('スキル: MP が要り、覚えていないと使えない。回復・盾・ロールバックは 1 度', () => {
  const h = heroAt(20)
  const all = Object.fromEntries(SKILLS.map(s => [s.id, NOW]))
  const b0 = startBattle(h, 99, false)
  // 覚えていない
  const no = act(b0, { kind: 'skill', id: 'slash' }, {})
  expect(no.round).toBe(b0.round)
  expect(no.log.at(-1)).toBe('そのスキルは覚えていない')
  // MP が足りない
  const dry = act({ ...b0, me: { ...b0.me, mp: 0 } }, { kind: 'skill', id: 'slash' }, all)
  expect(dry.log.at(-1)).toBe('MP が足りない')
  // 回復
  const hurt = { ...b0, me: { ...b0.me, hp: 10, def: 999 }, enemy: { ...b0.enemy, hp: 99999, maxHp: 99999, trait: 'none' as const } }
  const healed = act(hurt, { kind: 'skill', id: 'heal' }, all)
  expect(healed.me.mp).toBe(hurt.me.mp - 6)
  expect(healed.log.some(t => t.startsWith('HP が') && t.endsWith('回復した'))).toBe(true)
  // ロールバックは 1 回の戦いで 1 度
  const rb = act(hurt, { kind: 'skill', id: 'rollback' }, all)
  expect(rb.usedRollback).toBe(true)
  expect(act({ ...rb, me: { ...rb.me, mp: 999 } }, { kind: 'skill', id: 'rollback' }, all).log.at(-1)).toBe('ロールバックはもう使った')
  // 常に効くスキルはコマンドにならない
  const passive = act(hurt, { kind: 'skill', id: 'review' }, all)
  expect(passive.round).toBe(hurt.round)
  expect(passive.log.at(-1)).toBe('コードレビューは常に効いている')
  // CI: ラウンドの終わりに HP が戻る
  const ci = act({ ...hurt, me: { ...hurt.me, regen: 5 } }, { kind: 'defend' }, all)
  expect(ci.log.some(t => t.startsWith('CI が回って'))).toBe(true)
})

test('盾は勇者と敵のどちらが先でも 3 回分効く', () => {
  const all = Object.fromEntries(SKILLS.map(s => [s.id, NOW]))
  const b0 = startBattle(heroAt(20), 99, false)
  // 盾が無い時の傷は 850〜1150、盾があると 425〜575
  const base: RpgBattle = {
    ...b0,
    enemy: { ...b0.enemy, hp: 99999, maxHp: 99999, atk: 1000, spd: 500, trait: 'none' },
    me: { ...b0.me, def: 0, hp: 999999, maxHp: 999999, mp: 99, crit: 0 },
  }
  for (const spd of [999, 0]) {
    let b = act({ ...base, me: { ...base.me, spd } }, { kind: 'skill', id: 'guard' }, all)
    const hits = [b.hitMe]
    for (let i = 0; i < 5; i++) {
      b = act(b, { kind: 'attack' }, all)
      hits.push(b.hitMe)
    }
    expect(hits.filter(n => n > 0 && n < 700).length).toBe(3)
  }
})

test('HP が満タンなら回復とロールバックは使えない。ボスから逃げようとしてもラウンドは進まない', () => {
  const all = Object.fromEntries(SKILLS.map(s => [s.id, NOW]))
  const b0 = startBattle(heroAt(20), 99, false)
  const full: RpgBattle = { ...b0, me: { ...b0.me, hp: b0.me.maxHp, mp: 99 } }
  for (const id of ['heal', 'rollback']) {
    expect(canUse(full, id, all)).toBe(false)
    expect(canUse({ ...full, me: { ...full.me, hp: 1 } }, id, all)).toBe(true)
    const nope = act(full, { kind: 'skill', id }, all)
    expect(nope).toMatchObject({ round: full.round, me: full.me, usedRollback: false })
    expect(nope.log.at(-1)).toBe('HP は減っていない')
  }
  const boss = startBattle(heroAt(10), 1, true)
  const stay = act(boss, { kind: 'flee' }, {})
  expect(stay).toMatchObject({ round: boss.round, me: boss.me, seed: boss.seed, result: 'fight' })
  expect(stay.log.at(-1)).toBe('ボスからは逃げられない!')
})

test('戦いで減った HP は終わった後も残り、休むと戻る。負けると一番下まで減る', () => {
  const h = heroAt(8)
  const b = startBattle(h, 5, false)
  const half: RpgBattle = { ...b, me: { ...b.me, hp: Math.round(b.me.maxHp / 2) }, result: 'fled' }
  const after = endBattle(h, half, NOW)
  expect(after).toMatchObject({ hpPct: 50, xp: h.xp, wins: 0 })
  // 次の戦いはその HP から
  expect(startBattle(after, 6, false).me.hp).toBe(Math.round(b.me.maxHp / 2))
  // 戦いの中で回復して終われば戻る
  expect(endBattle(after, { ...half, me: { ...half.me, hp: half.me.maxHp } }, NOW).hpPct).toBe(100)
  // 戦っている間の疲れ (10 分で 5) は二重に数えない
  expect(endBattle(h, half, NOW + 10 * 60_000).hpPct).toBe(50)
  // 負けると一番下 (10%)。経験値は減らない
  const lost = endBattle(h, { ...b, me: { ...b.me, hp: 0 }, result: 'lost' }, NOW)
  expect(lost).toMatchObject({ hpPct: 10, xp: h.xp })
  // 勝てば経験値と勝ち数も
  expect(endBattle(h, { ...b, result: 'won', gainedXp: 30 }, NOW)).toMatchObject({ xp: h.xp + 30, wins: 1, hpPct: 100 })
  // 休む (15 分あく) と傷は消える
  expect(onTurnStart(lost, NOW + REST_MS).hpPct).toBe(100)
  // 戦いの途中は何もしない
  expect(endBattle(h, b, NOW)).toBe(h)
})

test('絵: 戦い・気配・成長の SVG は幅と上限を守る', () => {
  const h = heroAt(12, { wins: 4, battles: 6, encounters: 2, defeated: { loop: NOW }, learned: { slash: NOW } })
  const b = startBattle(h, 3, false)
  const hit = act(b, { kind: 'attack' }, {})
  for (const svg of [battleSvg(h, null), battleSvg(h, b), battleSvg(h, hit), growthSvg(h), statusSvg(h)]) {
    expect(svg.length).toBeLessThan(131_072)
    expect(svg).toContain('font-family="sans-serif"')
    expect(svg).not.toMatch(/<svg[^>]* width=/)
  }
  expect(battleSvg(h, null)).toContain('魔物の気配')
  expect(battleSvg(h, null)).toContain('撃破')
  expect(battleSvg(h, b)).toContain(b.enemy.name)
  expect(growthSvg(h)).toContain('習得済み')
  expect(growthSvg(h)).toContain('Lv 18 から')
  expect(statusSvg(h)).toContain('防御力')
  // 敵はどのレベルでも作れる
  for (const k of [...ENEMIES, ...BOSSES]) expect(enemyOf(k, 50, false).hp).toBeGreaterThan(0)
})

// ---------------------------------------------------------------- 画面

for (const surface of SURFACES) {
  test(`${surface}: 「戦う」で魔物を探し、ボタンで戦い、勝てば store に残る`, async ($, on) => {
    const { stored, battle } = await boot($, on, { xp: xpToReach(8), encounters: 2 })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Button', key: 'battle' }))?.text).toBe('戦う (気配 2)')
    await ui.press({ key: 'battle' })
    expect(await ui.find({ type: 'Button', key: 'act:attack' })).toBeUndefined()
    // Lv 10 まではボスのボタンは出ない
    expect(await ui.find({ type: 'Button', key: 'boss' })).toBeUndefined()
    await ui.press({ key: 'find' })
    expect(stored()).toMatchObject({ encounters: 1, battles: 1 })
    expect(battle()?.result).toBe('fight')
    expect(await ui.find({ type: 'Button', key: 'act:flee' })).toBeDefined()
    if (surface === 'vscode') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: /あらわれた!$/ })).toBeDefined()
    for (let i = 0; i < 60 && battle()?.result === 'fight'; i++) await ui.press({ key: 'act:attack' })
    const end = battle()
    expect(end?.result).not.toBe('fight')
    if (end?.result === 'won') {
      expect(stored()).toMatchObject({ wins: 1, xp: xpToReach(8) + end.gainedXp })
      expect(stored().achievements['battle-first']).toBe(NOW)
    } else expect(stored()).toMatchObject({ wins: 0, xp: xpToReach(8) })
    await ui.press({ key: 'close' })
    expect(battle()).toBeNull()
    expect(await ui.find({ type: 'Button', key: 'find' })).toBeDefined()
    // もう一度で、気配は 0 になる。0 なら探せない
    await ui.press({ key: 'find' })
    await ui.press({ key: 'act:flee' })
    for (let i = 0; i < 60 && battle()?.result === 'fight'; i++) await ui.press({ key: 'act:attack' })
    await ui.press({ key: 'close' })
    expect(stored().encounters).toBe(0)
    await ui.press({ key: 'find' })
    expect(battle()).toBeNull()
    expect(await ui.find({ type: 'Text', text: 'まだ魔物の気配がない。ターンを終えると現れる' })).toBeDefined()
    // ターンを終えると気配がたまる
    await turn($)
    expect(stored().encounters).toBe(1)
  })

  test(`${surface}: 「成長」で能力に振り、スキルを覚える。戦いのコマンドに出る`, async ($, on) => {
    const { stored } = await boot($, on, { xp: xpToReach(10) })
    const ui = await $.ui.mount({ ...PANE, surface })
    // Lv 10: レベルで 18、実績「二桁の壁」で 1
    expect((await ui.find({ type: 'Button', key: 'growth' }))?.text).toBe('成長 (SP 19)')
    await ui.press({ key: 'growth' })
    await ui.press({ key: 'up:str' })
    await ui.press({ key: 'up:str' })
    expect(stored().alloc.str).toBe(2)
    expect(await ui.find({ type: 'Text', text: '力が 1 上がった (攻撃力 +2)' })).toBeDefined()
    // Lv 12 の並列実行はまだ出ない
    expect(await ui.find({ type: 'Button', key: 'learn:multi' })).toBeUndefined()
    await ui.press({ key: 'learn:slash' })
    expect(stored().learned.slash).toBe(NOW)
    expect(stored().achievements['skill-first']).toBe(NOW)
    // 実績で 1 SP 増えた: 19 - 2 - 2 + 1
    expect((await ui.find({ type: 'Button', key: 'growth' }))?.text).toBe('ステータスに戻る')
    expect(await ui.find({ type: 'Button', key: 'learn:slash' })).toBeUndefined()
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /^SP 16 / })).toBeDefined()
    else expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.press({ key: 'respec' })
    expect(stored().alloc.str).toBe(0)
    // 戦いに出る。ボスにも挑める
    await ui.press({ key: 'battle' })
    expect(await ui.find({ type: 'Button', key: 'boss' })).toBeDefined()
    await ui.press({ key: 'boss' })
    expect((await ui.find({ type: 'Button', key: 'skill:slash' }))?.text).toBe('リファクタ斬り (MP 4)')
    expect(await ui.find({ type: 'Button', key: 'skill:heal' })).toBeUndefined()
  })
}

test('「魔物を探す」を続けて押しても戦いは 1 つで、気配も 1 つだけ減る', async ($, on) => {
  const { stored, battle } = await boot($, on, { xp: xpToReach(8), encounters: 3 })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'battle' })
  await Promise.all([ui.press({ key: 'find' }), ui.press({ key: 'find' })])
  expect(stored()).toMatchObject({ encounters: 2, battles: 1 })
  expect(battle()?.result).toBe('fight')
})

test('とどめの「攻撃」を続けて押しても、勝ちは 1 回分だけ入る', async ($, on) => {
  const { stored, battle } = await boot($, on, { xp: xpToReach(10), encounters: 3 })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'battle' })
  await ui.press({ key: 'find' })
  const xp = (stored() as { xp: number }).xp
  for (let i = 0; i < 60 && battle()?.result === 'fight'; i++) {
    await Promise.all([ui.press({ key: 'act:attack' }), ui.press({ key: 'act:attack' })])
  }
  expect(battle()?.result).toBe('won')
  expect(stored()).toMatchObject({ wins: 1, xp: xp + (battle()?.gainedXp ?? 0) })
})

test('ボスに負けると HP が減ったまま残る', async ($, on) => {
  const { battle } = await boot($, on, { xp: xpToReach(10), encounters: 1 })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'battle' })
  await ui.press({ key: 'boss' })
  for (let i = 0; i < 60 && battle()?.result === 'fight'; i++) await ui.press({ key: 'act:attack' })
  expect(battle()?.result).toBe('lost')
  expect(await ui.find({ type: 'Text', text: /しばらく休むと HP が戻る/ })).toBeDefined()
  await ui.press({ key: 'battle' })
  // Lv 10 の最大 HP は 140。負けると 10%
  expect(await ui.find({ type: 'Text', text: /^HP 14\/140 / })).toBeDefined()
})

test('ターンを終えてボスが湧くと、魔物の気配を使わずに挑める', async ($, on) => {
  const { stored, battle } = await boot($, on, { xp: xpToReach(10), turns: 19, encounters: 0 })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 20 ターン目で必ず湧く
  await turn($)
  expect(stored()).toMatchObject({ turns: 20, bossSign: 1, encounters: 1 })
  expect(await ui.find({ type: 'Text', text: /^ボスの気配! 無限ループ・ドラゴンが待っている/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'battle' }))?.text).toBe('戦う (気配 1・ボス出現)')
  await ui.press({ key: 'battle' })
  expect(await ui.find({ type: 'Text', text: 'ボスの気配! 気配を使わずに挑めて、経験値 1.5 倍' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'boss' }))?.text).toBe('湧いたボスに挑む: 無限ループ・ドラゴン (経験値 1.5 倍)')
  await ui.press({ key: 'boss' })
  expect(battle()?.enemy).toMatchObject({ id: 'loop', xp: Math.round(enemyOf(BOSSES[0]!, 10, true).xp * 1.5) })
  expect(stored()).toMatchObject({ bossSign: 0, encounters: 1, battles: 1 })
  // 終われば、湧いていない時のボタン (魔物の気配を使う) に戻る
  for (let i = 0; i < 60 && battle()?.result === 'fight'; i++) await ui.press({ key: 'act:attack' })
  await ui.press({ key: 'close' })
  expect((await ui.find({ type: 'Button', key: 'boss' }))?.text).toBe('ボスに挑む: 無限ループ・ドラゴン')
  expect(await ui.find({ type: 'Text', text: /^ボスは時々湧く/ })).toBeDefined()
})

test('冒険をやり直すと戦いも成長も消える', async ($, on) => {
  const { stored, battle } = await boot($, on, { xp: xpToReach(10), encounters: 3, alloc: { str: 3, vit: 0, int: 0, agi: 0 }, learned: { slash: NOW } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'battle' })
  await ui.press({ key: 'find' })
  expect(battle()?.result).toBe('fight')
  await ui.press({ key: 'reset' })
  await ui.press({ key: 'reset' })
  expect(battle()).toBeNull()
  expect(stored()).toMatchObject({ xp: 0, alloc: { str: 0, vit: 0, int: 0, agi: 0 }, learned: {}, wins: 0, encounters: 0 })
})

test('0.2 の勇者が state に残ったまま読み直しても (/reload-plugins) 落ちずに新しい値を足す', async ($, on) => {
  // 0.2.0 の形: 戦いと成長の値が無い。セッションは始まっている
  const old = { xp: 940, turns: 5, tools: 9, edits: 1, reads: 1, shells: 7, recoveries: 0, errors: 0, sessions: 5, achievements: { 'first-bash': NOW }, day: '2026-10-21', dayTurns: 5, equip: {} }
  const stale = { ...old, s: { ...startSession(INITIAL_SAVED, NOW - 60_000).s }, hpPct: 100, xpFrom: 0, synced: old }
  // 前のモジュールが書いた値の代わり: 新しいモジュールが書くまでは古い勇者を読ませる
  let isWritten = false
  on('state.get', { plugin: 'dev-rpg', key: 'hero' }, async (_$, e, next) => {
    const r = await next(e)
    return isWritten ? r : { value: { value: stale as never, version: r.value?.version ?? 0 } }
  })
  on('state.set', { plugin: 'dev-rpg', key: 'hero' }, async (_$, e, next) => {
    const r = await next(e)
    if (r.value?.isSet) isWritten = true
    return r
  })
  const { stored } = await boot($, on, old)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Lv 8: レベルで 14、実績 2 個 (読み直した時に「初めての一太刀」も付く) で 2
  expect((await ui.find({ type: 'Button', key: 'growth' }))?.text).toBe('成長 (SP 16)')
  expect((await ui.find({ type: 'Button', key: 'battle' }))?.text).toBe('戦う (気配 3)')
  await turn($)
  // セッションの回数は足し直さない (state の方を続ける)。経験値はターンの分だけ
  expect(stored()).toMatchObject({ xp: 950, sessions: 5, turns: 6, encounters: 4, alloc: { str: 0, vit: 0, int: 0, agi: 0 } })
  await ui.press({ key: 'battle' })
  await ui.press({ key: 'find' })
  expect(stored()).toMatchObject({ encounters: 3, battles: 1 })
})
