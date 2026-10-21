// 戦い (敵・1 手ずつの計算) と、戦いと成長の画面の SVG / terminal 用の行。どれも純関数
import type { RpgBattle, RpgEnemy, RpgFighter, RpgHero, RpgTrait } from '../types'
import {
  BOSS_IDS,
  K,
  MAX_ENCOUNTERS,
  MONO,
  SKILLS,
  SP_RULE,
  STATS,
  STAT_LABEL,
  STAT_NOTE,
  bar,
  fatigueAt,
  gain,
  hpPctAt,
  levelInfo,
  paint,
  skillOf,
  sprite,
  statsOf,
  svgDoc,
  win,
} from './rpg'
import type { Line } from './rpg'
import { esc, short } from './style'

// ---------------------------------------------------------------- 敵

type Kind = {
  id: string
  name: string
  /** 普通の敵: このレベルから出る。ボス: このレベルで戦う */
  level: number
  shape: Shape
  color: string
  /** 基本の値に掛ける倍率 */
  hp: number
  atk: number
  def: number
  spd: number
  trait: RpgTrait
}

/** 普通の敵。勇者のレベルの前後で出る */
export const ENEMIES: readonly Kind[] = [
  { id: 'nullpo', name: 'ヌルポスライム', level: 1, shape: 'slime', color: '#3fb950', hp: 0.8, atk: 0.9, def: 0.8, spd: 0.8, trait: 'none' },
  { id: 'typo', name: 'タイポバット', level: 1, shape: 'bat', color: '#bc8cff', hp: 0.7, atk: 0.9, def: 0.7, spd: 1.5, trait: 'none' },
  { id: 'offby1', name: 'オフバイワン・ゴブリン', level: 3, shape: 'goblin', color: '#d29922', hp: 1, atk: 1.05, def: 1, spd: 1, trait: 'none' },
  { id: 'leak', name: 'メモリリーク・ゴースト', level: 5, shape: 'ghost', color: '#9fb3e6', hp: 1.1, atk: 1, def: 0.6, spd: 1, trait: 'drain' },
  { id: 'race', name: 'レースコンディション', level: 8, shape: 'bat', color: '#f85149', hp: 0.8, atk: 0.7, def: 0.8, spd: 1.6, trait: 'double' },
  { id: 'heisen', name: 'ハイゼンバグ', level: 11, shape: 'ghost', color: '#39c5cf', hp: 0.9, atk: 1, def: 0.8, spd: 1.3, trait: 'evade' },
  { id: 'deadlock', name: 'デッドロック・ゴーレム', level: 14, shape: 'golem', color: '#8b949e', hp: 1.4, atk: 1.05, def: 1.8, spd: 0.5, trait: 'heavy' },
  { id: 'spaghetti', name: 'スパゲッティ・ヒドラ', level: 20, shape: 'dragon', color: '#f78166', hp: 1.5, atk: 1.1, def: 1.1, spd: 0.9, trait: 'none' },
]

/** ボス。並びは rpg.ts の BOSS_IDS と同じ。倒すたびに次が出る */
export const BOSSES: readonly Kind[] = [
  { id: 'loop', name: '無限ループ・ドラゴン', level: 10, shape: 'dragon', color: '#58a6ff', hp: 4, atk: 1.35, def: 1.2, spd: 1, trait: 'heavy' },
  { id: 'outage', name: '本番障害の魔王', level: 25, shape: 'demon', color: '#bc8cff', hp: 4.5, atk: 1.4, def: 1.3, spd: 1.1, trait: 'drain' },
  { id: 'legacy', name: 'レガシーコードの古竜', level: 45, shape: 'dragon', color: '#d29922', hp: 5, atk: 1.45, def: 1.4, spd: 1, trait: 'heavy' },
]

export const TRAIT_NOTE: Record<RpgTrait, string> = {
  none: '',
  drain: '攻撃で MP を吸う',
  double: '1 ラウンドに 2 回動く',
  evade: '物理攻撃をかわすことがある',
  heavy: '力をためて大技を出す',
}

/** レベル L の敵の値 (倍率を掛ける前) */
const baseOf = (L: number) => ({ hp: 18 + 8 * L, atk: 5 + 1.8 * L, def: 1 + L, spd: 2 + L, xp: 6 + 3 * L })

export function enemyOf(kind: Kind, level: number, isBoss: boolean): RpgEnemy {
  const b = baseOf(level)
  const maxHp = Math.round(b.hp * kind.hp)
  return {
    id: kind.id,
    name: kind.name,
    level,
    isBoss,
    maxHp,
    hp: maxHp,
    atk: Math.round(b.atk * kind.atk),
    def: Math.round(b.def * kind.def),
    spd: Math.round(b.spd * kind.spd),
    xp: Math.round(b.xp * (isBoss ? 4 : 1)),
    trait: kind.trait,
    shape: kind.shape,
    color: kind.color,
  }
}

/** 次に挑めるボス (まだ倒していない最初の 1 体)。全部倒したら最後のボスにもう一度 */
export const nextBoss = (h: RpgHero) => BOSSES.find(b => h.defeated[b.id] === undefined) ?? BOSSES[BOSSES.length - 1]!
export const isAllBossesDown = (h: RpgHero) => BOSS_IDS.every(id => h.defeated[id] !== undefined)

// ---------------------------------------------------------------- 乱数 (種から決まる)

/** mulberry32。同じ種なら同じ並び。戦いの種は 1 手ごとに進めて state に置く */
function rngOf(seed: number) {
  let t = seed >>> 0
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  return { next, seed: () => t }
}

// ---------------------------------------------------------------- 戦いを始める

/** 戦いの始めの勇者の強さ。HP と MP は今の値 (疲れていれば減ったまま) から */
export function fighterOf(h: RpgHero): RpgFighter {
  const st = statsOf(h)
  return {
    maxHp: st.maxHp,
    hp: st.hp,
    maxMp: st.maxMp,
    mp: st.mp,
    atk: st.attack,
    def: st.defense,
    mag: st.magic,
    spd: st.speed,
    crit: st.crit,
    regen: h.learned.ci !== undefined ? 5 : 0,
  }
}

/** 魔物を探す (boss なら次のボスに挑む)。seed で敵の種類とレベルが決まる */
export function startBattle(h: RpgHero, seed: number, isBoss: boolean): RpgBattle {
  const r = rngOf(seed)
  const L = levelInfo(h.xp).level
  let enemy: RpgEnemy
  if (isBoss) {
    const kind = nextBoss(h)
    enemy = enemyOf(kind, kind.level, true)
  } else {
    const pool = ENEMIES.filter(k => k.level <= L)
    const kind = pool[Math.floor(r.next() * pool.length)] ?? ENEMIES[0]!
    // 勇者のレベルの -2 〜 +1
    const level = Math.max(1, L + [-2, -1, 0, 0, 1][Math.floor(r.next() * 5)]!)
    enemy = enemyOf(kind, level, false)
  }
  const me = fighterOf(h)
  return {
    enemy,
    me,
    round: 1,
    guard: 0,
    isExposed: false,
    isCharging: false,
    usedRollback: false,
    seed: r.seed(),
    log: [isBoss ? `${enemy.name}が立ちはだかった!` : `${enemy.name}があらわれた!`],
    result: 'fight',
    gainedXp: 0,
    hitEnemy: 0,
    hitMe: 0,
  }
}

// ---------------------------------------------------------------- 1 手

export type Command = { kind: 'attack' } | { kind: 'skill'; id: string } | { kind: 'defend' } | { kind: 'flee' }

const LOG_MAX = 6

/** HP を戻すスキル (HP が満タンなら使えない) */
const HEALS: readonly string[] = ['heal', 'rollback']

/** 使えるスキルか (覚えていて、常に効く物でなく、ロールバックは 1 度だけ、回復は HP が減っている時、MP が足りる) */
export function canUse(b: RpgBattle, id: string, learned: Record<string, number>) {
  const sk = skillOf(id)
  if (!sk || sk.isPassive || learned[id] === undefined) return false
  if (id === 'rollback' && b.usedRollback) return false
  if (HEALS.includes(id) && b.me.hp >= b.me.maxHp) return false
  return b.me.mp >= sk.mp
}

/**
 * 1 ラウンド進める: 素早い方から動く (同じなら勇者)。
 * 勝った・負けた・逃げたら result が変わる。
 * 終わった戦い・使えないスキル・ボスから逃げる手は、ラウンドを進めない (できない時はログに一言)
 */
export function act(b0: RpgBattle, cmd: Command, learned: Record<string, number>): RpgBattle {
  if (b0.result !== 'fight') return b0
  const refuse = (why: string): RpgBattle => ({ ...b0, log: [...b0.log, why].slice(-LOG_MAX), hitEnemy: 0, hitMe: 0 })
  if (cmd.kind === 'flee' && b0.enemy.isBoss) return refuse('ボスからは逃げられない!')
  if (cmd.kind === 'skill' && !canUse(b0, cmd.id, learned)) {
    const sk = skillOf(cmd.id)
    return refuse(
      !sk || learned[cmd.id] === undefined
        ? 'そのスキルは覚えていない'
        : sk.isPassive
          ? `${sk.name}は常に効いている`
          : cmd.id === 'rollback' && b0.usedRollback
            ? 'ロールバックはもう使った'
            : HEALS.includes(cmd.id) && b0.me.hp >= b0.me.maxHp
              ? 'HP は減っていない'
              : 'MP が足りない',
    )
  }
  const r = rngOf(b0.seed)
  const b: RpgBattle = { ...b0, me: { ...b0.me }, enemy: { ...b0.enemy }, log: [...b0.log], hitEnemy: 0, hitMe: 0 }
  const me = b.me
  const en = b.enemy
  const say = (t: string) => b.log.push(t)
  const spread = () => 0.85 + r.next() * 0.3
  const isDefending = cmd.kind === 'defend'
  const isHeroFirst = me.spd >= en.spd

  /** 物理で 1 回。守りは半分だけ効く。ログ解読の後は守りを 4 割下げる */
  const physical = (mult: number) => {
    if (en.trait === 'evade' && r.next() < 0.25) {
      say(`${en.name}はすり抜けた!`)
      return
    }
    const isCrit = r.next() * 100 < me.crit
    const def = en.def * (b.isExposed ? 0.6 : 1)
    const dmg = Math.max(1, Math.round((me.atk * mult * spread() - def * 0.5) * (isCrit ? 1.5 : 1)))
    en.hp = Math.max(0, en.hp - dmg)
    b.hitEnemy += dmg
    say(isCrit ? `会心の一撃! ${en.name}に ${dmg} のダメージ` : `${en.name}に ${dmg} のダメージ`)
  }
  /** 魔法。守りも回避も効かない */
  const magical = (mult: number) => {
    const dmg = Math.max(1, Math.round(me.mag * mult * spread()))
    en.hp = Math.max(0, en.hp - dmg)
    b.hitEnemy += dmg
    say(`${en.name}に ${dmg} のダメージ`)
  }

  const heroTurn = () => {
    switch (cmd.kind) {
      case 'attack':
        say('勇者の攻撃!')
        physical(1)
        return
      case 'defend': {
        const mp = Math.min(me.maxMp - me.mp, Math.round(me.maxMp * 0.1))
        me.mp += mp
        say(mp > 0 ? `勇者は身を守っている (MP +${mp})` : '勇者は身を守っている')
        return
      }
      case 'flee': {
        const chance = Math.min(0.95, Math.max(0.2, 0.5 + (me.spd - en.spd) * 0.05))
        if (r.next() < chance) {
          say('勇者は逃げ出した')
          b.result = 'fled'
        } else say('逃げられなかった!')
        return
      }
      case 'skill': {
        const sk = skillOf(cmd.id)!
        me.mp -= sk.mp
        say(`勇者の${sk.name}!`)
        if (sk.id === 'slash') physical(1.7)
        else if (sk.id === 'multi') for (let i = 0; i < 3 && en.hp > 0; i++) physical(0.7)
        else if (sk.id === 'lint') magical(1.6)
        else if (sk.id === 'deploy') magical(3)
        else if (sk.id === 'heal') {
          const n = Math.min(me.maxHp - me.hp, Math.round(me.maxHp * 0.35 + me.mag))
          me.hp += n
          say(`HP が ${n} 回復した`)
        } else if (sk.id === 'rollback') {
          const n = me.maxHp - me.hp
          me.hp = me.maxHp
          b.usedRollback = true
          say(`HP が全部戻った (+${n})`)
        } else if (sk.id === 'guard') {
          // 盾はラウンドの終わりに 1 減る。敵が先に動いた回は守れていないので 1 つ多く持たせる
          b.guard = isHeroFirst ? 3 : 4
          say('3 ラウンドの間、受ける傷が半分になる')
        } else if (sk.id === 'scan') {
          b.isExposed = true
          say(`${en.name}の弱点を見抜いた! 守りが下がった`)
        }
      }
    }
  }

  const enemyHit = () => {
    if (en.trait === 'heavy' && !b.isCharging && r.next() < 0.3) {
      b.isCharging = true
      say(`${en.name}は力をためている…`)
      return
    }
    const mult = b.isCharging ? 2 : 1
    if (b.isCharging) say(`${en.name}の大技!`)
    b.isCharging = false
    let dmg = Math.max(1, Math.round((en.atk * mult * spread() - me.def * 0.5) * (isDefending ? 0.5 : 1) * (b.guard > 0 ? 0.5 : 1)))
    dmg = Math.min(dmg, me.hp)
    me.hp -= dmg
    b.hitMe += dmg
    say(`勇者は ${dmg} のダメージを受けた`)
    if (en.trait === 'drain' && me.mp > 0) {
      const mp = Math.min(me.mp, 3)
      me.mp -= mp
      say(`MP を ${mp} 吸い取られた`)
    }
  }
  const enemyTurn = () => {
    for (let i = 0; i < (en.trait === 'double' ? 2 : 1) && me.hp > 0; i++) enemyHit()
  }

  const isOver = () => b.result !== 'fight' || en.hp <= 0 || me.hp <= 0
  const order = isHeroFirst ? [heroTurn, enemyTurn] : [enemyTurn, heroTurn]
  for (const step of order) {
    if (isOver()) break
    step()
  }

  if (en.hp <= 0) {
    b.result = 'won'
    b.gainedXp = en.xp
    say(`${en.name}をやっつけた! 経験値 ${en.xp}`)
  } else if (me.hp <= 0) {
    b.result = 'lost'
    say('勇者は力尽きた… (経験値は減らない)')
  } else if (b.result === 'fight') {
    if (me.regen > 0 && me.hp < me.maxHp) {
      const n = Math.min(me.maxHp - me.hp, Math.max(1, Math.round((me.maxHp * me.regen) / 100)))
      me.hp += n
      say(`CI が回って HP +${n}`)
    }
    if (b.guard > 0) b.guard -= 1
    b.round += 1
  }
  b.log = b.log.slice(-LOG_MAX)
  b.seed = r.seed()
  return b
}

/** 勝った戦いを勇者に入れる: 経験値・勝ち数・ボスを倒した時刻 */
export function winBattle(h: RpgHero, b: RpgBattle, now: number): RpgHero {
  if (b.result !== 'won') return h
  const next = gain(h, b.gainedXp)
  const defeated = b.enemy.isBoss && h.defeated[b.enemy.id] === undefined ? { ...h.defeated, [b.enemy.id]: now } : h.defeated
  return { ...next, wins: h.wins + 1, defeated }
}

/**
 * 終わった戦い (勝ち・負け・逃げ) を勇者に入れる。戦いの後の HP を傷として残し (休むと治る)、勝っていれば winBattle。
 * 傷は「今の疲れ」を引いた残りなので、戦っている間に増えた疲れは二重に数えない
 */
export function endBattle(h: RpgHero, b: RpgBattle, now: number): RpgHero {
  if (b.result === 'fight') return h
  const endPct = Math.round((b.me.hp / Math.max(1, b.me.maxHp)) * 100)
  const s = { ...h.s, wound: Math.max(0, 100 - fatigueAt(h, now) - endPct) }
  return winBattle({ ...h, s, hpPct: hpPctAt({ ...h, s }, now) }, b, now)
}

// ---------------------------------------------------------------- ドット絵

type Shape = 'slime' | 'bat' | 'goblin' | 'ghost' | 'golem' | 'dragon' | 'demon'

// 12x12。x 体 / d 影 / w 白目 / e 黒目 / r 赤
const SHAPES: Record<Shape, string[]> = {
  slime: [
    '............',
    '............',
    '.....xx.....',
    '....xxxx....',
    '...xxxxxx...',
    '..xxwxxwxx..',
    '..xxexxexx..',
    '.xxxxxxxxxx.',
    '.xxxxddxxxx.',
    'xxxxxxxxxxxx',
    'dxxxxxxxxxxd',
    '.dddddddddd.',
  ],
  bat: [
    '............',
    'x..........x',
    'xx...xx...xx',
    'xxx.xxxx.xxx',
    'xxxxxxxxxxxx',
    'xxxxwexxewxx',
    'dxxxxxxxxxxd',
    'd.xxxrrxxx.d',
    '...xxxxxx...',
    '....d..d....',
    '............',
    '............',
  ],
  goblin: [
    '....xxxx....',
    'x..xxxxxx..x',
    'xxxxwexxewxx',
    '.xxxxxxxxxx.',
    '...xrrrrx...',
    '....xxxx....',
    '..dddddddd..',
    '.xddddddddx.',
    '.x.dddddd.x.',
    '...dd..dd...',
    '...xx..xx...',
    '..xxx..xxx..',
  ],
  ghost: [
    '....xxxx....',
    '..xxxxxxxx..',
    '.xxxxxxxxxx.',
    '.xxeexxeexx.',
    '.xxeexxeexx.',
    'xxxxxxxxxxxx',
    'xxxxxrrxxxxx',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    'xxdxxxxxxdxx',
    'x.dx.xx.xd.x',
    '...x....x...',
  ],
  golem: [
    '...dddddd...',
    '..dxxxxxxd..',
    '..dxrxxrxd..',
    '..dxxxxxxd..',
    'ddddxxxxdddd',
    'dxxxxxxxxxxd',
    'dxxdxxxxdxxd',
    'dxxdxxxxdxxd',
    'ddddxxxxdddd',
    '...dxxxxd...',
    '..ddxddxdd..',
    '..ddd..ddd..',
  ],
  dragon: [
    '.x........x.',
    '.xx......xx.',
    '..xxxxxxxx..',
    '.xxwexxewxx.',
    '.xxxxxxxxxx.',
    'xx.xrrrrx.xx',
    'x..xxxxxx..x',
    '..dxxxxxxd..',
    '.ddxxddxxdd.',
    'dd.xxxxxx.dd',
    '...xx..xx...',
    '..xxx..xxx..',
  ],
  demon: [
    'x..........x',
    'xx..xxxx..xx',
    '.xxxxxxxxxx.',
    '..xrrxxrrx..',
    '..xxxxxxxx..',
    '...xwwwwx...',
    'dddxxxxxxddd',
    'ddxxxxxxxxdd',
    'd.xxxddxxx.d',
    '..xxxxxxxx..',
    '..xx....xx..',
    '.xxx....xxx.',
  ],
}

function monster(shape: string, color: string, x: number, y: number, px: number) {
  const rows = SHAPES[shape as Shape] ?? SHAPES.slime
  const colors: Record<string, string> = { x: color, d: color, w: '#ffffff', e: '#0d1117', r: '#f85149' }
  let s = ''
  rows.forEach((row, r) => {
    ;[...row].forEach((ch, c) => {
      const col = colors[ch]
      if (col) s += `<rect x="${x + c * px}" y="${y + r * px}" width="${px}" height="${px}" fill="${col}"${ch === 'd' ? ' opacity="0.6"' : ''}/>`
    })
  })
  return s
}

// ---------------------------------------------------------------- 戦いの画面

/** 当たった時: 揺れて、数字が上に抜けて消える (1 回きり) */
const shake = (body: string, dx: number) =>
  `<g>${body}<animateTransform attributeName="transform" type="translate" values="0 0;${dx} 0;${-dx} 0;${dx / 2} 0;0 0" dur="0.35s" fill="freeze"/></g>`
const popup = (x: number, y: number, text: string, color: string) =>
  `<text x="${x}" y="${y}" font-size="20" font-weight="bold" font-family="${MONO}" fill="${color}" stroke="${K.bg}" stroke-width="3" paint-order="stroke" text-anchor="middle" opacity="0">${text}` +
  `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.7;1" dur="1.2s" fill="freeze"/>` +
  `<animate attributeName="y" from="${y}" to="${y - 26}" dur="1.2s" fill="freeze"/></text>`

const RESULT_TEXT: Record<RpgBattle['result'], string> = { fight: '', won: '勝利!', lost: '力尽きた…', fled: 'うまく逃げた' }

/** 戦いのタブ。戦っていなければ、魔物の気配 (遭遇) とボスの案内 */
export function battleSvg(h: RpgHero, b: RpgBattle | null) {
  paint()
  if (!b) return lobbySvg(h)
  const en = b.enemy
  const me = b.me
  let s = ''
  // ── 敵
  s += win(8, 8, 364, 176)
  s += `<text x="24" y="34" font-size="15" font-weight="bold" fill="${en.isBoss ? K.purple : K.text}">${esc(short(en.name, 16))}</text>`
  s += `<text x="358" y="34" font-size="14" font-weight="bold" font-family="${MONO}" fill="${K.text}" text-anchor="end">${en.isBoss ? 'BOSS ' : ''}Lv ${en.level}</text>`
  const body = monster(en.shape, en.color, 142, 44, 8)
  const alive = en.hp > 0
  const mon = alive ? body : `<g opacity="1">${body}<animate attributeName="opacity" from="1" to="0.1" dur="0.8s" fill="freeze"/></g>`
  s += b.hitEnemy > 0 ? shake(mon, 6) : `<g>${mon}<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="1.8s" repeatCount="indefinite"/></g>`
  if (b.hitEnemy > 0) s += popup(190, 92, `-${b.hitEnemy}`, K.yellow)
  if (b.isCharging) s += `<text x="358" y="60" font-size="12" font-weight="bold" fill="${K.red}" text-anchor="end">力をためている</text>`
  if (b.isExposed) s += `<text x="24" y="60" font-size="12" font-weight="bold" fill="${K.gear}">守り -40%</text>`
  s += `<text x="24" y="153" font-size="13" font-weight="bold" font-family="${MONO}" fill="${K.text}">HP</text>`
  s += bar(56, 142, 236, en.hp / en.maxHp, en.hp / en.maxHp > 0.3 ? K.red : K.yellow)
  s += `<text x="358" y="153" font-size="12" font-family="${MONO}" fill="${K.text}" text-anchor="end">${en.hp}/${en.maxHp}</text>`
  const trait = TRAIT_NOTE[en.trait]
  s += `<text x="24" y="172" font-size="12" fill="${K.weak}">${trait === '' ? `攻 ${en.atk} 守 ${en.def} 速 ${en.spd}` : `攻 ${en.atk} 守 ${en.def} 速 ${en.spd} / ${trait}`}</text>`

  // ── 勇者
  s += win(8, 192, 364, 92)
  const hero = sprite(22, 210, 4)
  s += b.hitMe > 0 ? shake(hero, 4) : hero
  if (b.hitMe > 0) s += popup(46, 236, `-${b.hitMe}`, K.red)
  const hpFrac = me.hp / me.maxHp
  s += `<text x="86" y="219" font-size="13" font-weight="bold" font-family="${MONO}" fill="${K.text}">HP</text>`
  s += bar(118, 208, 160, hpFrac, hpFrac > 0.5 ? K.green : hpFrac > 0.25 ? K.yellow : K.red)
  s += `<text x="358" y="219" font-size="12" font-family="${MONO}" fill="${K.text}" text-anchor="end">${me.hp}/${me.maxHp}</text>`
  s += `<text x="86" y="243" font-size="13" font-weight="bold" font-family="${MONO}" fill="${K.text}">MP</text>`
  s += bar(118, 232, 160, me.mp / Math.max(1, me.maxMp), K.blue)
  s += `<text x="358" y="243" font-size="12" font-family="${MONO}" fill="${K.text}" text-anchor="end">${me.mp}/${me.maxMp}</text>`
  const marks = [b.guard > 0 ? `盾 残り ${b.guard}` : '', me.regen > 0 ? 'CI' : ''].filter(x => x !== '').join(' / ')
  s += `<text x="86" y="270" font-size="12" fill="${K.weak}">ラウンド ${b.round}  攻 ${me.atk} 守 ${me.def} 魔 ${me.mag} 速 ${me.spd}</text>`
  if (marks !== '') s += `<text x="358" y="270" font-size="12" font-weight="bold" fill="${K.gear}" text-anchor="end">${marks}</text>`

  // ── ログ
  const logTop = 292
  const logH = 22 + LOG_MAX * 20
  s += win(8, logTop, 364, logH)
  b.log.forEach((t, i) => {
    const isLast = i === b.log.length - 1
    s += `<text x="24" y="${logTop + 26 + i * 20}" font-size="13" fill="${isLast ? K.text : K.weak}">${esc(short(t, 26))}</text>`
  })
  let y = logTop + logH + 8
  if (b.result !== 'fight') {
    const col = b.result === 'won' ? K.yellow : b.result === 'lost' ? K.red : K.weak
    s += win(8, y, 364, 56)
    s +=
      `<text x="190" y="${y + 36}" font-size="20" font-weight="bold" fill="${col}" text-anchor="middle">${RESULT_TEXT[b.result]}` +
      (b.result === 'won' ? `<animate attributeName="font-size" values="12;24;20" dur="0.5s" fill="freeze"/>` : '') +
      `</text>`
    y += 64
  }
  return svgDoc(y, s)
}

/** 戦っていない時: 遭遇の数・次のボス・戦績 */
function lobbySvg(h: RpgHero) {
  const L = levelInfo(h.xp).level
  const boss = nextBoss(h)
  let s = win(8, 8, 364, 112)
  s += `<text x="24" y="34" font-size="15" font-weight="bold" fill="${K.text}">▶ 魔物の気配</text>`
  s += `<text x="358" y="34" font-size="12" fill="${K.weak}" text-anchor="end">${h.wins} 勝 / ${h.battles} 戦</text>`
  for (let i = 0; i < MAX_ENCOUNTERS; i++) {
    const has = i < h.encounters
    s += `<circle cx="${40 + i * 34}" cy="62" r="12" fill="${has ? K.red : K.off}" stroke="${has ? K.frame : K.offText}"${has ? '' : ' stroke-dasharray="3 2"'}/>`
    if (has) s += `<text x="${40 + i * 34}" y="67" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">!</text>`
  }
  s += `<text x="358" y="67" font-size="13" font-weight="bold" font-family="${MONO}" fill="${K.text}" text-anchor="end">${h.encounters}/${MAX_ENCOUNTERS}</text>`
  s += `<text x="24" y="96" font-size="12" fill="${K.weak}">ターンを終えるたびに気配が 1 つたまる (${MAX_ENCOUNTERS} まで)</text>`
  s += `<text x="24" y="112" font-size="12" fill="${K.weak}">戦うと 1 つ使う。勝つと経験値、${SP_RULE.winsPer} 勝ごとに SP +1</text>`

  // ── ボス
  s += win(8, 128, 364, 148)
  s += `<text x="24" y="154" font-size="14" font-weight="bold" fill="${K.text}">ボス</text>`
  s += `<text x="358" y="154" font-size="12" fill="${K.weak}" text-anchor="end">初めて倒すと SP +${SP_RULE.boss}</text>`
  BOSSES.forEach((b, i) => {
    const y = 178 + i * 28
    const isDown = h.defeated[b.id] !== undefined
    const isNext = !isDown && b.id === boss.id
    const col = isDown ? K.yellow : isNext ? K.text : K.offText
    s += `<text x="24" y="${y}" font-size="13" font-family="${MONO}" fill="${col}">Lv${String(b.level).padStart(3, ' ')}</text>`
    s += `<text x="80" y="${y}" font-size="13"${isNext ? ' font-weight="bold"' : ''} fill="${col}">${esc(b.name)}</text>`
    s += `<text x="358" y="${y}" font-size="12" fill="${col}" text-anchor="end">${isDown ? '撃破' : isNext ? (L >= b.level ? '挑める' : `Lv ${b.level} 推奨`) : 'まだ'}</text>`
  })
  s += `<text x="24" y="${178 + BOSSES.length * 28}" font-size="12" fill="${K.weak}">ボスからは逃げられない。スキルと SP で備えよう</text>`
  return svgDoc(284, s)
}

/** 戦いのタブの行 (terminal と Svg の alt) */
export function battleLines(h: RpgHero, b: RpgBattle | null): Line[] {
  if (!b) {
    const boss = nextBoss(h)
    return [
      { text: `魔物の気配 ${h.encounters}/${MAX_ENCOUNTERS} (${h.wins} 勝 / ${h.battles} 戦)`, isBold: true },
      { text: 'ターンを終えるたびに気配が 1 つたまる', isDim: true },
      {
        text: isAllBossesDown(h) ? `ボスは全部倒した (もう一度: ${boss.name})` : `次のボス: Lv ${boss.level} ${boss.name}`,
        color: 'magenta',
      },
    ]
  }
  const en = b.enemy
  const me = b.me
  return [
    { text: `${en.isBoss ? 'BOSS ' : ''}${en.name} Lv ${en.level}  HP ${en.hp}/${en.maxHp}`, isBold: true, color: 'red' },
    { text: `勇者 HP ${me.hp}/${me.maxHp}  MP ${me.mp}/${me.maxMp}  ラウンド ${b.round}`, color: me.hp / me.maxHp > 0.25 ? undefined : 'red' },
    ...b.log.map((t, i): Line => ({ text: t, isDim: i < b.log.length - 1 })),
    ...(b.result !== 'fight' ? [{ text: RESULT_TEXT[b.result], isBold: true, color: b.result === 'won' ? 'yellow' : undefined }] : []),
  ]
}

// ---------------------------------------------------------------- 成長の画面

/** 成長のタブ: 残りの SP と内訳、能力の振り分け、スキルの一覧 */
export function growthSvg(h: RpgHero) {
  paint()
  const st = statsOf(h)
  const sp = st.sp
  const L = st.level
  let s = win(8, 8, 364, 84)
  s += `<text x="24" y="34" font-size="15" font-weight="bold" fill="${K.text}">▶ 成長</text>`
  s += `<text x="358" y="40" font-size="26" font-weight="bold" font-family="${MONO}" fill="${sp.free > 0 ? K.yellow : K.offText}" text-anchor="end">${sp.free} SP</text>`
  s += `<text x="24" y="60" font-size="12" fill="${K.weak}">レベル ${sp.fromLevel} + 実績 ${sp.fromAchievements} + 勝利 ${sp.fromWins} + ボス ${sp.fromBosses}</text>`
  s += `<text x="24" y="80" font-size="12" fill="${K.weak}">もらった ${sp.earned} / 使った ${sp.used}</text>`

  // ── 能力
  s += win(8, 100, 364, 36 + STATS.length * 26)
  s += `<text x="24" y="124" font-size="13" font-weight="bold" fill="${K.text}">能力 (1 SP で 1 上がる)</text>`
  STATS.forEach((k, i) => {
    const y = 150 + i * 26
    const n = h.alloc[k]
    s += `<text x="24" y="${y}" font-size="13" font-weight="bold" fill="${K.text}">${STAT_LABEL[k]}</text>`
    s += `<text x="100" y="${y}" font-size="14" font-weight="bold" font-family="${MONO}" fill="${n > 0 ? K.gear : K.offText}" text-anchor="end">${n}</text>`
    s += `<text x="114" y="${y}" font-size="12" fill="${K.weak}">1 につき ${STAT_NOTE[k]}</text>`
  })

  // ── スキル
  let y = 100 + 36 + STATS.length * 26 + 8
  const top = y
  let body = `<text x="24" y="${y + 24}" font-size="13" font-weight="bold" fill="${K.text}">スキル</text>`
  body += `<text x="358" y="${y + 24}" font-size="12" fill="${K.weak}" text-anchor="end">${Object.keys(h.learned).length} / ${SKILLS.length}</text>`
  y += 34
  for (const sk of SKILLS) {
    const has = h.learned[sk.id] !== undefined
    const canLv = L >= sk.level
    const col = has ? K.yellow : canLv ? K.text : K.offText
    const state = has ? '習得済み' : canLv ? (sp.free >= sk.sp ? '覚えられる' : `あと ${sk.sp - sp.free} SP`) : `Lv ${sk.level} から`
    body +=
      `<line x1="20" y1="${y}" x2="360" y2="${y}" stroke="${K.frame}" stroke-opacity="0.15"/>` +
      `<text x="24" y="${y + 17}" font-size="13" font-weight="bold" fill="${col}">${esc(sk.name)}</text>` +
      `<text x="358" y="${y + 17}" font-size="12"${!has && canLv && sp.free >= sk.sp ? ` font-weight="bold" fill="${K.green}"` : ` fill="${col}"`} text-anchor="end">${state}</text>` +
      `<text x="24" y="${y + 33}" font-size="12" fill="${has || canLv ? K.weak : K.offText}">${esc(sk.note)}</text>` +
      `<text x="358" y="${y + 33}" font-size="12" font-family="${MONO}" fill="${has || canLv ? K.weak : K.offText}" text-anchor="end">${sk.isPassive ? '常時' : `MP ${sk.mp}`} ${sk.sp}SP</text>`
    y += 40
  }
  s += win(8, top, 364, y - top + 8) + body
  return svgDoc(y + 16, s)
}

export function growthLines(h: RpgHero): Line[] {
  const st = statsOf(h)
  const sp = st.sp
  return [
    { text: `SP ${sp.free} (もらった ${sp.earned} / 使った ${sp.used})`, isBold: true, color: sp.free > 0 ? 'yellow' : undefined },
    { text: `内訳 レベル ${sp.fromLevel} + 実績 ${sp.fromAchievements} + 勝利 ${sp.fromWins} + ボス ${sp.fromBosses}`, isDim: true },
    { text: STATS.map(k => `${STAT_LABEL[k]} ${h.alloc[k]}`).join('  ') },
    ...SKILLS.map((sk): Line => {
      const has = h.learned[sk.id] !== undefined
      const canLv = st.level >= sk.level
      return {
        text: `${has ? '●' : '○'} ${sk.name} (${sk.isPassive ? '常時' : `MP ${sk.mp}`} / ${sk.sp}SP) ${has ? '' : canLv ? '' : `Lv ${sk.level} から `}${sk.note}`,
        color: has ? 'yellow' : undefined,
        isDim: !has && !canLv,
      }
    }),
  ]
}
