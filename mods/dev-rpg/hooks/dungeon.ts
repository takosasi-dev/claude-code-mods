// ダンジョン: ターンで潜る階・階ごとの敵 (戦いは battle.ts の act をそのまま使って自動で進める)・袋と持ち帰り・絵。どれも純関数
import type { RpgBattle, RpgDelve, RpgDelveFight, RpgEnemy, RpgHero } from '../types'
import type { Command } from './battle'
import { BOSSES, ENEMIES, act, canUse, enemyOf, fighterOf, monster, openBattle, rngOf } from './battle'
import type { Line } from './rpg'
import { K, MONO, SP_RULE, bar, gain, paint, sprite, svgDoc, win } from './rpg'
import { esc, isLight, short } from './style'

// ---------------------------------------------------------------- 釣り合いの表 (数はここだけ)

/**
 * ふつうの 1 日 (60〜120 ターン) で 7〜15 階ほど進む (steps)。
 * 敵のレベルは階の 2 倍、10 階ごとの番人はボスの姿。勇者のレベル・振った SP・装備・スキルで、どこまで勝ち抜けるかが決まる。
 * 試しの数 (1 ターン 22 経験値・90 ターンの日・毎日帰る): 1 日目 6 階、SP を全部使うと 7 日で 41 階・28 日で 126 階、
 * スキルだけだと 29 階・79 階、SP を使わないと 19 階・29 階で番人に止まる。Lv 99 でも 150 階ほどで止まる
 */
export const DELVE = {
  /** 次の階の敵まで、これだけターンを終える */
  steps: 8,
  /** 1 歩ごとに戻る HP と MP (%) */
  regenHp: 5,
  regenMp: 8,
  /** 敵のレベル = 階 × これ (端数は切り上げ) */
  levelPerFloor: 2,
  /** この階ごとに休み場。勝ち抜いた一番深い休み場の次の階から潜り直せる */
  restEvery: 5,
  /** この階ごとに番人 (ボスの姿) */
  guardEvery: 10,
  /** 番人の HP はボスの何倍か (ボスは普通の敵の 4〜5 倍) */
  guardHp: 0.6,
  /** 袋に入る経験値 = 敵の経験値 × これ (ターンの経験値の 2〜3 割になるように) */
  lootRate: 0.3,
  /** 力尽きた時に持ち帰れる袋の割合 */
  lostKeep: 0.5,
  /** 1 つの戦いのラウンドの上限 (超えたら力尽きた扱い) */
  maxRounds: 300,
} as const

// ---------------------------------------------------------------- 階と敵

export const isGuardFloor = (floor: number) => floor % DELVE.guardEvery === 0

/** 勝ち抜いた一番深い休み場の次の階 (潜り直せる階)。まだなら 1 */
export const checkpoint = (deepest: number) => Math.floor(deepest / DELVE.restEvery) * DELVE.restEvery + 1

/** その階の敵。種と階で決まる (同じ潜りの同じ階なら同じ敵) */
export function floorEnemy(floor: number, seed: number): RpgEnemy {
  const level = Math.max(1, Math.ceil(floor * DELVE.levelPerFloor))
  const r = rngOf((seed ^ Math.imul(floor, 2654435761)) >>> 0)
  if (isGuardFloor(floor)) {
    const kind = BOSSES[(floor / DELVE.guardEvery - 1) % BOSSES.length]!
    const e = enemyOf(kind, level, true)
    const maxHp = Math.max(1, Math.round(e.maxHp * DELVE.guardHp))
    return { ...e, name: `番人 ${kind.name}`, maxHp, hp: maxHp }
  }
  const pool = ENEMIES.filter(k => k.level <= level)
  const kind = pool[Math.floor(r.next() * pool.length)] ?? ENEMIES[0]!
  return enemyOf(kind, level, false)
}

export const lootOf = (enemy: RpgEnemy) => Math.max(1, Math.round(enemy.xp * DELVE.lootRate))

// ---------------------------------------------------------------- 自動の戦い

/** 戦いの 1 手を選ぶ: 危なければ回復、番人には盾、硬い敵には弱点、あとは一番効く技 (回復の MP は残す) */
export function pickCommand(b: RpgBattle, learned: Record<string, number>): Command {
  const can = (id: string) => canUse(b, id, learned)
  const skill = (id: string): Command => ({ kind: 'skill', id })
  const me = b.me
  const en = b.enemy
  const hp = me.hp / me.maxHp
  if (hp < 0.3 && can('rollback')) return skill('rollback')
  if (hp < 0.45 && can('heal')) return skill('heal')
  if (en.isBoss && b.guard === 0 && can('guard')) return skill('guard')
  if (!b.isExposed && en.hp > en.maxHp * 0.5 && en.def * 0.5 > me.atk * 0.15 && can('scan')) return skill('scan')
  // 回復を覚えていれば、その分の MP は残す (とどめなら使い切る)
  const reserve = learned.heal !== undefined ? 6 : 0
  const def = en.def * (b.isExposed ? 0.6 : 1) * 0.5
  const hit = (m: number) => Math.max(1, me.atk * m - def) * (en.trait === 'evade' ? 0.75 : 1)
  const options: [Command, number, number][] = [
    [skill('deploy'), me.mag * 3, 24],
    [skill('multi'), hit(0.7) * 3, 10],
    [skill('lint'), me.mag * 1.6, 7],
    [skill('slash'), hit(1.7), 4],
  ]
  let best: Command = { kind: 'attack' }
  let bestDmg = hit(1)
  for (const [cmd, dmg, mp] of options) {
    if (cmd.kind !== 'skill' || !can(cmd.id) || dmg <= bestDmg) continue
    if (me.mp - mp < reserve && dmg < en.hp) continue
    best = cmd
    bestDmg = dmg
  }
  return best
}

/** 勝つか力尽きるまで自動で戦う */
export function autoFight(b0: RpgBattle, learned: Record<string, number>): RpgBattle {
  let b = b0
  for (let i = 0; i < DELVE.maxRounds && b.result === 'fight'; i++) b = act(b, pickCommand(b, learned), learned)
  return b.result === 'fight' ? { ...b, result: 'lost' } : b
}

// ---------------------------------------------------------------- 潜る・進む・帰る

/** 潜り始める (from の階から)。HP と MP は満タン、袋は空 */
export const enterDelve = (h: RpgHero, now: number, from: number): RpgHero => ({
  ...h,
  delve: {
    startedAt: now,
    floor: Math.max(1, Math.min(from, checkpoint(h.deepest))),
    step: 0,
    hp: 100,
    mp: 100,
    loot: 0,
    cleared: 0,
    seed: (now ^ Math.imul(h.turns + 1, 2654435761)) >>> 0,
    last: null,
  },
})

/** 帰る: 袋の経験値を持ち帰る */
export const leaveDelve = (h: RpgHero): RpgHero => (h.delve ? { ...gain(h, h.delve.loot), delve: null } : h)

/** 1 歩の出来事。won / lost は戦った時だけ */
export type DelveEvent = { kind: 'step' } | { kind: 'won'; fight: RpgDelveFight } | { kind: 'lost'; fight: RpgDelveFight; kept: number }

const pct = (n: number, max: number) => Math.max(0, Math.min(100, Math.round((n / Math.max(1, max)) * 100)))

/**
 * ターンを 1 つ終えた時の 1 歩。潜っていなければ何もしない。
 * 歩みが DELVE.steps に届いたら、その階の敵と自動で戦う (worn: 持っている装備だけにした勇者。強さはこちらから取る)。
 * 勝てば次の階へ、袋に経験値。力尽きたら入口へ戻り、袋の半分を持ち帰る。一番深い階は勝った時に残す
 */
export function stepDelve(h: RpgHero, worn: RpgHero): { hero: RpgHero; event?: DelveEvent } {
  const d0 = h.delve
  if (!d0) return { hero: h }
  const d: RpgDelve = { ...d0, step: d0.step + 1, hp: Math.min(100, d0.hp + DELVE.regenHp), mp: Math.min(100, d0.mp + DELVE.regenMp) }
  if (d.step < DELVE.steps) return { hero: { ...h, delve: d }, event: { kind: 'step' } }
  const enemy = floorEnemy(d.floor, d.seed)
  const f = fighterOf(worn)
  const me = { ...f, hp: Math.max(1, Math.round((f.maxHp * d.hp) / 100)), mp: Math.round((f.maxMp * d.mp) / 100) }
  const start = openBattle(me, enemy, (d.seed ^ Math.imul(d.floor, 40503)) >>> 0, `${enemy.name}があらわれた!`)
  const b = autoFight(start, worn.learned)
  const won = b.result === 'won'
  const loot = won ? lootOf(enemy) : 0
  const fight: RpgDelveFight = {
    floor: d.floor,
    name: enemy.name,
    level: enemy.level,
    isBoss: enemy.isBoss,
    shape: enemy.shape,
    color: enemy.color,
    result: won ? 'won' : 'lost',
    hitMe: Math.max(0, me.hp - b.me.hp),
    loot,
  }
  if (!won) {
    const kept = Math.floor(d.loot * DELVE.lostKeep)
    return { hero: { ...gain(h, kept), delve: null }, event: { kind: 'lost', fight, kept } }
  }
  const next: RpgDelve = {
    ...d,
    floor: d.floor + 1,
    step: 0,
    hp: pct(b.me.hp, b.me.maxHp),
    mp: pct(b.me.mp, b.me.maxMp),
    loot: d.loot + loot,
    cleared: d.cleared + 1,
    last: fight,
  }
  return { hero: { ...h, delve: next, deepest: Math.max(h.deepest, d.floor) }, event: { kind: 'won', fight } }
}

/** 出来事の一言 */
export function eventText(e: DelveEvent | undefined): string | undefined {
  if (!e || e.kind === 'step') return undefined
  const f = e.fight
  if (e.kind === 'won') return `ダンジョン ${f.floor} 階: ${f.name}を倒した (袋に経験値 +${f.loot})`
  return `ダンジョン ${f.floor} 階で${f.name}に敗れた… 入口に戻り、袋の経験値 ${e.kept} を持ち帰った`
}

// ---------------------------------------------------------------- 絵

/** たいまつ (炎が揺れる) */
const torch = (x: number, y: number) =>
  `<rect x="${x - 2}" y="${y}" width="4" height="14" fill="#8b5a2b"/>` +
  `<ellipse cx="${x}" cy="${y - 4}" rx="5" ry="8" fill="#f78166" opacity="0.9">` +
  `<animate attributeName="ry" values="8;6;9;7;8" dur="0.9s" repeatCount="indefinite"/></ellipse>` +
  `<ellipse cx="${x}" cy="${y - 2}" rx="2.5" ry="4" fill="#f2cc60"/>` +
  `<circle cx="${x}" cy="${y - 4}" r="22" fill="#f78166" opacity="0.08"/>`

/** 石の通路 (奥へすぼまる)。y から h の高さ */
function corridor(y: number, h: number) {
  const x0 = 20
  const x1 = 360
  const cx = 190
  const vy = y + h * 0.45
  let s = `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${h}" fill="${K.well}"/>`
  // 奥の暗がり
  s += `<rect x="${cx - 46}" y="${vy - 34}" width="92" height="64" fill="${isLight() ? K.frame : '#000000'}" opacity="${isLight() ? 0.18 : 0.35}"/>`
  // 床と天井の線
  s += `<polygon points="${x0},${y + h} ${x1},${y + h} ${cx + 46},${vy + 30} ${cx - 46},${vy + 30}" fill="${K.win}" opacity="0.7"/>`
  for (const [a, b] of [
    [x0, cx - 46],
    [x1, cx + 46],
  ] as const) {
    s += `<line x1="${a}" y1="${y}" x2="${b}" y2="${vy - 34}" stroke="${K.frame}" stroke-opacity="0.3"/>`
    s += `<line x1="${a}" y1="${y + h}" x2="${b}" y2="${vy + 30}" stroke="${K.frame}" stroke-opacity="0.3"/>`
  }
  // 壁の石 (左右に 3 段)
  for (let i = 0; i < 3; i++) {
    const yy = y + 14 + i * 30
    s += `<rect x="${x0 + 8 + (i % 2) * 14}" y="${yy}" width="34" height="14" fill="none" stroke="${K.frame}" stroke-opacity="0.18"/>`
    s += `<rect x="${x1 - 42 - (i % 2) * 14}" y="${yy}" width="34" height="14" fill="none" stroke="${K.frame}" stroke-opacity="0.18"/>`
  }
  return s + torch(70, y + 26) + torch(310, y + 26)
}

/** 歩みの点 (DELVE.steps 個) */
function stepPips(x: number, y: number, step: number) {
  let s = ''
  for (let i = 0; i < DELVE.steps; i++) {
    const has = i < step
    s += `<rect x="${x + i * 18}" y="${y}" width="12" height="12" rx="2" fill="${has ? K.yellow : K.off}" stroke="${has ? K.frame : K.offText}" stroke-opacity="0.6"/>`
  }
  return s
}

/** ダンジョンのタブ。入口 (潜っていない) と、潜っている時 */
export function dungeonSvg(h: RpgHero) {
  paint()
  const d = h.delve
  const cp = checkpoint(h.deepest)
  let s = win(8, 8, 364, 56)
  s += `<text x="24" y="34" font-size="15" font-weight="bold" fill="${K.text}">▶ ${d ? `ダンジョン 地下 ${d.floor} 階` : 'ダンジョンの入口'}</text>`
  s += `<text x="358" y="34" font-size="12" fill="${K.weak}" text-anchor="end">記録 ${h.deepest} 階</text>`
  s += `<text x="24" y="54" font-size="12" fill="${K.weak}">${d ? `この潜りで ${d.cleared} 階を勝ち抜いた` : `ターンを終えるたびに 1 歩、${DELVE.steps} 歩で次の階の敵と戦う`}</text>`

  // ── 絵: 石の通路。潜っていれば勇者と、近づいてくるこの階の敵
  s += win(8, 72, 364, 150)
  s += corridor(84, 126)
  if (d) {
    const en = floorEnemy(d.floor, d.seed)
    // 歩むほど敵が手前に来て大きくなる
    const t = d.step / DELVE.steps
    const px = 3 + Math.round(t * 3)
    const ex = 230 - Math.round(t * 30)
    const ey = 168 - px * 12 + Math.round(t * 8)
    s += `<g opacity="${(0.45 + t * 0.55).toFixed(2)}">${monster(en.shape, en.color, ex, ey, px)}</g>`
    if (isGuardFloor(d.floor)) s += `<text x="190" y="102" font-size="13" font-weight="bold" fill="${K.purple}" text-anchor="middle">番人の階</text>`
    s += sprite(60, 150, 4)
  } else {
    // 下りの階段
    for (let i = 0; i < 5; i++) {
      const w = 120 - i * 16
      s += `<rect x="${190 - w / 2}" y="${150 + i * 12}" width="${w}" height="10" fill="${K.win}" stroke="${K.frame}" stroke-opacity="0.35"/>`
    }
    s += sprite(60, 150, 4)
  }

  // ── 潜っている間の HP・MP・歩み・袋
  let y = 230
  if (d) {
    s += win(8, y, 364, 120)
    const row = (yy: number, label: string, frac: number, color: string, value: string) =>
      `<text x="24" y="${yy + 11}" font-size="14" font-weight="bold" font-family="${MONO}" fill="${K.text}">${label}</text>` +
      bar(64, yy, 210, frac, color) +
      `<text x="358" y="${yy + 11}" font-size="13" font-family="${MONO}" fill="${K.text}" text-anchor="end">${value}</text>`
    s += row(y + 16, 'HP', d.hp / 100, d.hp > 50 ? K.green : d.hp > 25 ? K.yellow : K.red, `${d.hp}%`)
    s += row(y + 40, 'MP', d.mp / 100, K.blue, `${d.mp}%`)
    s += `<text x="24" y="${y + 80}" font-size="13" font-weight="bold" fill="${K.text}">歩み</text>`
    s += stepPips(64, y + 69, d.step)
    s += `<text x="358" y="${y + 80}" font-size="12" font-family="${MONO}" fill="${K.weak}" text-anchor="end">${d.step}/${DELVE.steps}</text>`
    s += `<text x="24" y="${y + 106}" font-size="13" fill="${K.text}">袋 <tspan font-weight="bold" fill="${K.yellow}">経験値 ${d.loot}</tspan></text>`
    s += `<text x="358" y="${y + 106}" font-size="12" fill="${K.weak}" text-anchor="end">帰ると持ち帰る</text>`
    y += 128
    // 最後の戦い
    const f = d.last
    s += win(8, y, 364, 56)
    s += f
      ? `<text x="24" y="${y + 24}" font-size="13" fill="${K.text}">${f.floor} 階 ${esc(short(f.name, 14))} Lv ${f.level}</text>` +
        `<text x="358" y="${y + 24}" font-size="13" font-weight="bold" fill="${K.yellow}" text-anchor="end">勝利</text>` +
        `<text x="24" y="${y + 44}" font-size="12" fill="${K.weak}">受けた傷 ${f.hitMe} / 袋に経験値 +${f.loot}</text>`
      : `<text x="24" y="${y + 34}" font-size="12" fill="${K.weak}">まだ戦っていない。作業を進めると敵に近づく</text>`
    y += 64
  } else {
    s += win(8, y, 364, 120)
    s += `<text x="24" y="${y + 24}" font-size="13" font-weight="bold" fill="${K.text}">潜り方</text>`
    s += `<text x="24" y="${y + 46}" font-size="12" fill="${K.weak}">階ごとの敵とは自動で戦う。装備・SP・スキルが効く</text>`
    s += `<text x="24" y="${y + 66}" font-size="12" fill="${K.weak}">${DELVE.guardEvery} 階ごとに番人。勝ち抜くと ${SP_RULE.deepPer} 階ごとに SP +${SP_RULE.deep}</text>`
    s += `<text x="24" y="${y + 86}" font-size="12" fill="${K.weak}">「帰る」で袋の経験値を持ち帰る。力尽きると半分</text>`
    s += `<text x="24" y="${y + 104}" font-size="12" fill="${cp > 1 ? K.gear : K.weak}">${cp > 1 ? `${cp - 1} 階の休み場を越えたので ${cp} 階から潜れる` : `${DELVE.restEvery} 階ごとの休み場から潜り直せる`}</text>`
    y += 128
  }
  return svgDoc(y, s)
}

export function dungeonLines(h: RpgHero): Line[] {
  const d = h.delve
  if (!d) {
    const cp = checkpoint(h.deepest)
    return [
      { text: `ダンジョンの入口 (記録 ${h.deepest} 階)`, isBold: true },
      { text: `ターンを終えるたびに 1 歩、${DELVE.steps} 歩で次の階の敵と自動で戦う`, isDim: true },
      { text: `${DELVE.guardEvery} 階ごとに番人。「帰る」で袋の経験値を持ち帰る`, isDim: true },
      ...(cp > 1 ? [{ text: `${cp} 階から潜れる`, color: 'cyan' }] : []),
    ]
  }
  const f = d.last
  return [
    { text: `ダンジョン 地下 ${d.floor} 階 (記録 ${h.deepest} 階)${isGuardFloor(d.floor) ? ' 番人の階' : ''}`, isBold: true },
    { text: `HP ${d.hp}%  MP ${d.mp}%  歩み ${d.step}/${DELVE.steps}`, color: d.hp > 25 ? undefined : 'red' },
    { text: `袋 経験値 ${d.loot} (帰ると持ち帰る)`, color: 'yellow' },
    f ? { text: `${f.floor} 階 ${f.name} Lv ${f.level} に勝利 (受けた傷 ${f.hitMe})`, isDim: true } : { text: 'まだ戦っていない', isDim: true },
  ]
}
