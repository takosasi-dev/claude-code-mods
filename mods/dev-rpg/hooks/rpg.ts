// 経験値・レベル・実績・成長 (SP) の計算と、ステータス窓の SVG / terminal 用の行。どれも純関数
import type { RpgEquip, RpgGachaCard, RpgHero, RpgSaved, RpgSession, RpgSlot, RpgStat } from '../types'
import { clean, esc, isLight, short } from './style'

// ---------------------------------------------------------------- 決まりごと

export const XP = { turn: 10, recovery: 15, edit: 5, shell: 4, read: 2, agent: 6, other: 2 } as const
/** これだけ間が空いたら「休んだ」として HP が戻る */
export const REST_MS = 15 * 60_000
/** HP は休んでから 2 分ごとに 1% 減る。10% より下には減らない */
const HP_STEP_MS = 2 * 60_000
const HP_MIN = 10
export const MAX_LEVEL = 99

/** レベル L から L+1 に上がるのに要る経験値。少しずつ増える */
export const needFor = (level: number) => 40 + 20 * level
/** レベル L になるまでの累計 */
export const xpToReach = (level: number) => 40 * (level - 1) + 10 * level * (level - 1)

export function levelInfo(xp: number) {
  let level = 1
  while (level < MAX_LEVEL && xp >= xpToReach(level + 1)) level++
  const into = xp - xpToReach(level)
  const need = needFor(level)
  return { level, into, need, frac: level >= MAX_LEVEL ? 1 : Math.min(1, into / need) }
}

export const TITLES: [number, string][] = [
  [1, '見習いコーダー'],
  [3, '駆け出しデバッガー'],
  [5, '一人前のプログラマー'],
  [8, 'バグハンター'],
  [12, 'テストの守り人'],
  [16, 'リファクタ剣士'],
  [20, 'コードの魔術師'],
  [25, '設計の賢者'],
  [30, 'ビルドの錬金術師'],
  [38, 'マージの聖騎士'],
  [47, '千のコミットの勇者'],
  [60, '伝説のリファクタラー'],
]
export const titleOf = (level: number) => TITLES.filter(([lv]) => level >= lv).pop()?.[1] ?? TITLES[0]![1]

export type ToolKind = 'edit' | 'shell' | 'read' | 'agent' | 'other'
const KINDS: Record<string, ToolKind> = {
  Edit: 'edit',
  Write: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  PowerShell: 'shell',
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  LSP: 'read',
  Agent: 'agent',
  Task: 'agent',
}
export const toolKind = (tool: string): ToolKind => KINDS[tool] ?? 'other'

// ---------------------------------------------------------------- 装備 (turn-gacha のカード)

export const SLOTS: readonly RpgSlot[] = ['weapon', 'armor', 'charm']
export const SLOT_LABEL: Record<RpgSlot, string> = { weapon: '武器', armor: '防具', charm: 'お守り' }
const RARITIES = ['SSR', 'SR', 'R', 'N'] as const
type Rarity = (typeof RARITIES)[number]
/** レア度ごとの上がり幅。武器は攻撃力に、防具は最大 HP に 5 倍、お守りは魔力と最大 MP に 3 倍で足す */
export const GEAR_POINTS: Record<Rarity, number> = { N: 1, R: 2, SR: 4, SSR: 7 }
const isRarity = (v: unknown): v is Rarity => typeof v === 'string' && (RARITIES as readonly string[]).includes(v)
const isSlot = (v: unknown): v is RpgSlot => typeof v === 'string' && (SLOTS as readonly string[]).includes(v)

/** 外から来たカード 1 枚を確かめる (名前は制御文字を落として 40 字まで) */
function cardFrom(v: unknown): RpgGachaCard | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id === '' || o.id.length > 32 || !isRarity(o.rarity) || !isSlot(o.slot) || typeof o.name !== 'string') return undefined
  return { id: clean(o.id), rarity: o.rarity, slot: o.slot, name: short(clean(o.name), 40) }
}

/**
 * turn-gacha の state (save と cards) から、持っているカードの一覧を作る。
 * turn-gacha が無い・まだ読み込む前・形が違う時は undefined
 */
export function ownedCards(save: unknown, cards: unknown): RpgGachaCard[] | undefined {
  if (typeof save !== 'object' || save === null || !Array.isArray(cards)) return undefined
  const book = (save as Record<string, unknown>).book
  if (typeof book !== 'object' || book === null) return undefined
  const has = (id: string) => {
    const n = ((book as Record<string, unknown>)[id] as Record<string, unknown> | undefined)?.count
    return typeof n === 'number' && n > 0
  }
  return cards.map(cardFrom).filter((c): c is RpgGachaCard => c !== undefined && has(c.id))
}

/** 装備のうち、今も持っている物だけ。ガチャが無ければ何も着けていない扱い */
export const wornOf = (equip: RpgEquip, owned: RpgGachaCard[] | undefined): RpgEquip => {
  const out: RpgEquip = {}
  for (const k of SLOTS) {
    const c = equip[k]
    if (c && owned?.some(o => o.id === c.id)) out[k] = c
  }
  return out
}

/** 画面に出す前に、持っていない装備を外した姿にする (store の equip は残す) */
export const wear = (h: RpgHero, owned: RpgGachaCard[] | undefined): RpgHero => ({ ...h, worn: wornOf(h.equip, owned) })

/** 枠に着ける (card が無ければ外す) */
export const setGear = (h: RpgHero, slot: RpgSlot, card: RpgGachaCard | undefined): RpgHero => {
  const equip = { ...h.equip }
  if (card) equip[slot] = { id: card.id, rarity: card.rarity, slot, name: card.name }
  else delete equip[slot]
  return { ...h, equip }
}

/** 装備で上がる分 */
export function gearBonus(equip: RpgEquip) {
  const p = (k: RpgSlot) => {
    const c = equip[k]
    return c ? GEAR_POINTS[c.rarity] : 0
  }
  return { attack: p('weapon'), hp: p('armor') * 5, magic: p('charm'), mp: p('charm') * 3 }
}

/** その枠の効き目の言い方 */
export const gearEffect = (slot: RpgSlot, rarity: Rarity) => {
  const n = GEAR_POINTS[rarity]
  return slot === 'weapon' ? `攻撃力 +${n}` : slot === 'armor' ? `最大HP +${n * 5}` : `魔力 +${n} 最大MP +${n * 3}`
}

const sameEquip = (a: RpgEquip, b: RpgEquip) => SLOTS.every(k => a[k]?.id === b[k]?.id)

// ---------------------------------------------------------------- 成長 (SP で能力とスキル)

export const STATS: readonly RpgStat[] = ['str', 'vit', 'int', 'agi']
export const STAT_LABEL: Record<RpgStat, string> = { str: '力', vit: '体力', int: '知恵', agi: '敏捷' }
/** 1 振りで上がる分 */
export const STAT_NOTE: Record<RpgStat, string> = {
  str: '攻撃力 +2',
  vit: '最大HP +10 防御力 +2',
  int: '魔力 +2 最大MP +4',
  agi: '素早さ +2 会心 +1%',
}

export type Skill = {
  id: string
  name: string
  /** 覚えられるレベル */
  level: number
  /** 覚えるのに要る SP */
  sp: number
  /** 戦いで使う時の MP (常に効くスキルは 0) */
  mp: number
  isPassive?: true
  note: string
}

export const SKILLS: readonly Skill[] = [
  { id: 'slash', name: 'リファクタ斬り', level: 2, sp: 2, mp: 4, note: '攻撃力の 1.7 倍で斬る' },
  { id: 'heal', name: 'デバッグの光', level: 3, sp: 2, mp: 6, note: '最大 HP の 35% と魔力の分だけ回復' },
  { id: 'scan', name: 'ログ解読', level: 4, sp: 1, mp: 3, note: '弱点を見抜き、敵の守りを 4 割下げる' },
  { id: 'lint', name: '静的解析', level: 5, sp: 3, mp: 7, note: '魔力の 1.6 倍。守りも回避も効かない' },
  { id: 'review', name: 'コードレビュー', level: 6, sp: 3, mp: 0, isPassive: true, note: '常に会心の確率 +10%' },
  { id: 'guard', name: 'テストの盾', level: 7, sp: 3, mp: 5, note: '3 ラウンドの間、受ける傷が半分' },
  { id: 'ci', name: '継続的インテグレーション', level: 10, sp: 4, mp: 0, isPassive: true, note: '常に毎ラウンド最大 HP の 5% 回復' },
  { id: 'multi', name: '並列実行', level: 12, sp: 4, mp: 10, note: '攻撃力の 0.7 倍で 3 回斬る' },
  { id: 'rollback', name: 'ロールバック', level: 18, sp: 5, mp: 15, note: 'HP を全部戻す (1 回の戦いで 1 度)' },
  { id: 'deploy', name: '本番デプロイ', level: 25, sp: 6, mp: 24, note: '魔力の 3 倍。守りも回避も効かない' },
]
export const skillOf = (id: string) => SKILLS.find(s => s.id === id)

/** ボスの id (並びは battle.ts の BOSSES と同じ)。倒すと SP がもらえる */
export const BOSS_IDS = ['loop', 'outage', 'legacy'] as const
/** SP の入り方: レベル 1 つで 2、実績 1 つで 1、3 勝ごとに 1、ボスを初めて倒すと 3 */
export const SP_RULE = { level: 2, achievement: 1, winsPer: 3, boss: 3 } as const

const allocSum = (h: Pick<RpgSaved, 'alloc'>) => STATS.reduce((n, k) => n + h.alloc[k], 0)

// ---------------------------------------------------------------- 実績

/** owned: ガチャで持っているカード (turn-gacha が無ければ undefined) */
type Check = { h: RpgHero; level: number; isTurnEnd: boolean; owned: RpgGachaCard[] | undefined }
export type Achievement = { id: string; name: string; glyph: string; hint: string; isGacha?: true; test: (c: Check) => boolean }
const worn = (c: Check) => Object.values(wornOf(c.h.equip, c.owned))

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-bash', name: '初めての Bash', glyph: '初', hint: '初めてコマンドを実行する', test: c => c.h.shells >= 1 },
  { id: 'first-edit', name: '初めての一太刀', glyph: '刃', hint: '初めてファイルを編集する', test: c => c.h.edits >= 1 },
  { id: 'recover-3', name: '七転び八起き', glyph: '起', hint: 'エラーから 3 回立ち直る', test: c => c.h.recoveries >= 3 },
  { id: 'day-50', name: '一日 50 ターン', glyph: '日', hint: '同じ日に 50 ターン', test: c => c.h.dayTurns >= 50 },
  { id: 'turns-100', name: '百戦錬磨', glyph: '百', hint: '累計 100 ターン', test: c => c.h.turns >= 100 },
  { id: 'edits-100', name: '鍛冶屋の常連', glyph: '鍛', hint: '累計 100 回編集する', test: c => c.h.edits >= 100 },
  { id: 'reads-300', name: '図書館の主', glyph: '書', hint: '累計 300 回調べる', test: c => c.h.reads >= 300 },
  { id: 'combo-20', name: '怒涛の連撃', glyph: '撃', hint: '1 ターンでツールを 20 回使う', test: c => c.h.s.turnTools >= 20 },
  {
    id: 'flawless',
    name: '無傷の勝利',
    glyph: '盾',
    hint: '1 ターンでツール 10 回以上、エラー 0',
    test: c => c.isTurnEnd && c.h.s.turnTools >= 10 && c.h.s.turnErrors === 0,
  },
  { id: 'level-10', name: '二桁の壁', glyph: '十', hint: 'Lv 10 になる', test: c => c.level >= 10 },
  { id: 'level-30', name: '歴戦の勇者', glyph: '勇', hint: 'Lv 30 になる', test: c => c.level >= 30 },
  { id: 'sessions-10', name: '旅の常連', glyph: '旅', hint: '10 回目の冒険に出る', test: c => c.h.sessions >= 10 },
  // ここから turn-gacha と連動
  { id: 'gear-first', name: '初めての装備', glyph: '装', hint: 'ガチャのカードを 1 枚装備する', isGacha: true, test: c => worn(c).length >= 1 },
  { id: 'gear-full', name: '完全武装', glyph: '鎧', hint: '武器・防具・お守りを全部着ける', isGacha: true, test: c => worn(c).length >= SLOTS.length },
  { id: 'gear-ssr', name: '虹の装備', glyph: '虹', hint: 'SSR のカードを装備する', isGacha: true, test: c => worn(c).some(x => x.rarity === 'SSR') },
  { id: 'book-20', name: '収集家', glyph: '集', hint: 'ガチャの図鑑を 20 種集める', isGacha: true, test: c => (c.owned?.length ?? 0) >= 20 },
  // ここから戦いと成長 (0.3.0)
  { id: 'battle-first', name: '初陣', glyph: '陣', hint: '魔物に初めて勝つ', test: c => c.h.wins >= 1 },
  { id: 'battle-30', name: '歴戦の剣', glyph: '剣', hint: '魔物に 30 回勝つ', test: c => c.h.wins >= 30 },
  { id: 'boss-first', name: '竜殺し', glyph: '竜', hint: 'ボスを初めて倒す', test: c => Object.keys(c.h.defeated).length >= 1 },
  { id: 'boss-all', name: '世界を救う', glyph: '救', hint: 'ボスを全部倒す', test: c => BOSS_IDS.every(id => c.h.defeated[id] !== undefined) },
  { id: 'skill-first', name: '新しい技', glyph: '技', hint: 'スキルを初めて覚える', test: c => Object.keys(c.h.learned).length >= 1 },
  { id: 'train-10', name: '鍛錬の成果', glyph: '錬', hint: '能力に SP を 10 振る', test: c => allocSum(c.h) >= 10 },
]

/** SP: もらった分 (内訳つき)・使った分・残り。使った分がもらった分を超えても (別のセッションと同時に使った時) 残りは 0 */
export function spOf(h: RpgSaved) {
  const level = levelInfo(h.xp).level
  const fromLevel = (level - 1) * SP_RULE.level
  const fromAchievements = ACHIEVEMENTS.filter(a => h.achievements[a.id] !== undefined).length * SP_RULE.achievement
  const fromWins = Math.floor(h.wins / SP_RULE.winsPer)
  const fromBosses = BOSS_IDS.filter(id => h.defeated[id] !== undefined).length * SP_RULE.boss
  const earned = fromLevel + fromAchievements + fromWins + fromBosses
  const used = allocSum(h) + SKILLS.reduce((n, s) => n + (h.learned[s.id] !== undefined ? s.sp : 0), 0)
  return { earned, used, free: Math.max(0, earned - used), fromLevel, fromAchievements, fromWins, fromBosses }
}

/** 能力に 1 振る。SP が無ければそのまま */
export function raiseStat(h: RpgHero, stat: RpgStat): RpgHero | undefined {
  if (spOf(h).free < 1) return undefined
  return { ...h, alloc: { ...h.alloc, [stat]: h.alloc[stat] + 1 } }
}

/** スキルを覚える。覚えられない理由があれば文字で返す */
export function learnSkill(h: RpgHero, id: string, now: number): RpgHero | string {
  const sk = skillOf(id)
  if (!sk) return 'そのスキルはありません'
  if (h.learned[id] !== undefined) return `「${sk.name}」はもう覚えています`
  if (levelInfo(h.xp).level < sk.level) return `「${sk.name}」は Lv ${sk.level} で覚えられます`
  if (spOf(h).free < sk.sp) return `SP が足りません (「${sk.name}」は ${sk.sp} SP)`
  return { ...h, learned: { ...h.learned, [id]: now } }
}

/** 振った SP を全部戻す (覚えたスキルはそのまま) */
export const respec = (h: RpgHero): RpgHero => ({ ...h, alloc: { str: 0, vit: 0, int: 0, agi: 0 } })

// ---------------------------------------------------------------- 値

export const INITIAL_SAVED: RpgSaved = {
  xp: 0,
  turns: 0,
  tools: 0,
  edits: 0,
  reads: 0,
  shells: 0,
  recoveries: 0,
  errors: 0,
  sessions: 0,
  achievements: {},
  day: '',
  dayTurns: 0,
  equip: {},
  battles: 0,
  wins: 0,
  encounters: 0,
  alloc: { str: 0, vit: 0, int: 0, agi: 0 },
  learned: {},
  defeated: {},
}

/** 遭遇はここまでためられる */
export const MAX_ENCOUNTERS = 5
/** 0.3.0 より前の store から来た時の遭遇 (すぐ戦えるように) */
const FIRST_ENCOUNTERS = 3

export const freshSession = (now: number): RpgSession => ({
  startedAt: now,
  restedAt: now,
  lastActiveAt: now,
  toolOk: 0,
  toolErr: 0,
  edits: 0,
  reads: 0,
  shells: 0,
  recoveries: 0,
  turnTools: 0,
  turnErrors: 0,
  isErrorPending: false,
})

export const INITIAL: RpgHero = { ...INITIAL_SAVED, s: freshSession(0), hpPct: 100, xpFrom: 0, synced: INITIAL_SAVED }

const SAVED_KEYS = ['xp', 'turns', 'tools', 'edits', 'reads', 'shells', 'recoveries', 'errors', 'sessions', 'dayTurns', 'battles', 'wins', 'encounters'] as const

export const toSaved = (h: RpgHero): RpgSaved => {
  const out = {
    ...INITIAL_SAVED,
    achievements: { ...h.achievements },
    day: h.day,
    equip: { ...h.equip },
    alloc: { ...h.alloc },
    learned: { ...h.learned },
    defeated: { ...h.defeated },
  }
  for (const k of SAVED_KEYS) out[k] = h[k]
  return out
}

/** id → 時刻 の表を、知っている id の数だけ拾う */
function stamps(v: unknown, ids: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof v !== 'object' || v === null) return out
  for (const id of ids) {
    const at = (v as Record<string, unknown>)[id]
    if (typeof at === 'number' && Number.isFinite(at)) out[id] = at
  }
  return out
}

/** 2 つの id → 時刻 の表を合わせる (早い方の時刻) */
const unionStamps = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a }
  for (const [id, at] of Object.entries(b)) out[id] = Math.min(at, a[id] ?? at)
  return out
}

/** store の中身は信用しない: 数と文字だけ拾う */
export function fromSaved(raw: unknown): RpgSaved {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const out = { ...INITIAL_SAVED, achievements: {} as Record<string, number>, equip: {} as RpgEquip }
  for (const k of SAVED_KEYS) {
    const v = o[k]
    out[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  }
  out.day = typeof o.day === 'string' ? o.day.slice(0, 10) : ''
  out.achievements = stamps(o.achievements, ACHIEVEMENTS.map(a => a.id))
  // 戦いと成長は 0.3.0 から。無い (古い store) なら遭遇を少し持たせて始める
  if (o.encounters === undefined) out.encounters = FIRST_ENCOUNTERS
  out.encounters = Math.min(MAX_ENCOUNTERS, out.encounters)
  const al = typeof o.alloc === 'object' && o.alloc !== null ? (o.alloc as Record<string, unknown>) : {}
  out.alloc = { str: 0, vit: 0, int: 0, agi: 0 }
  for (const k of STATS) {
    const v = al[k]
    out.alloc[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  }
  out.learned = stamps(o.learned, SKILLS.map(s => s.id))
  out.defeated = stamps(o.defeated, BOSS_IDS)
  // 装備は 0.2.0 から。無い (古い store) なら何も着けていない
  const eq = o.equip
  if (typeof eq === 'object' && eq !== null) {
    for (const k of SLOTS) {
      const c = cardFrom({ ...((eq as Record<string, unknown>)[k] as object | undefined), slot: k })
      if (c) out.equip[k] = c
    }
  }
  return out
}

/**
 * 今の store に、このセッションで増えた分 (mine − base) だけを足す。
 * 数は足し算、実績は和集合 (早い方の時刻)、日付は新しい方。同じ store を使う別のセッションの分を消さない。
 * 装備はこのセッションで変えた時だけ mine を書く (最後に書いた方が勝つ)
 */
export function mergeSaved(store: RpgSaved, base: RpgSaved, mine: RpgSaved): RpgSaved {
  const out = {
    ...store,
    achievements: unionStamps(store.achievements, mine.achievements),
    learned: unionStamps(store.learned, mine.learned),
    defeated: unionStamps(store.defeated, mine.defeated),
    equip: { ...(sameEquip(mine.equip, base.equip) ? store.equip : mine.equip) },
    alloc: { ...store.alloc },
  }
  for (const k of SAVED_KEYS) out[k] = Math.max(0, store[k] + mine[k] - base[k])
  out.encounters = Math.min(MAX_ENCOUNTERS, out.encounters)
  // 振った数も差分で足す (振り直しは減る差分)
  for (const k of STATS) out.alloc[k] = Math.max(0, store.alloc[k] + mine.alloc[k] - base.alloc[k])
  const day = mine.day > store.day ? mine.day : store.day
  const mineToday = mine.day === day ? mine.dayTurns - (base.day === day ? base.dayTurns : 0) : 0
  out.day = day
  out.dayTurns = Math.max(0, (store.day === day ? store.dayTurns : 0) + mineToday)
  return out
}

/**
 * 0.2 のまま state に残っている勇者 (開いたまま /reload-plugins した時) に、0.3.0 の値を足す。
 * 今の値 (s・HP・経験値バー) はそのまま。もう新しい形ならそのまま返す
 */
export const upgradeHero = (h: RpgHero): RpgHero =>
  (h as Partial<RpgHero>).alloc !== undefined ? h : { ...h, ...fromSaved(h), synced: fromSaved(h.synced) }

/** その時刻の日付 (この環境の時刻帯で YYYY-MM-DD) */
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const hpPctAt = (h: RpgHero, now: number) => Math.max(HP_MIN, 100 - Math.floor(Math.max(0, now - h.s.restedAt) / HP_STEP_MS))

/** 間が空いていたら休んだことにする */
const touch = (s: RpgSession, now: number): RpgSession =>
  now - s.lastActiveAt >= REST_MS ? { ...s, restedAt: now, lastActiveAt: now } : { ...s, lastActiveAt: now }

export const gain = (h: RpgHero, xp: number): RpgHero => ({ ...h, xp: h.xp + xp, xpFrom: levelInfo(h.xp).frac })

/** セッションの始まり: 冒険の回数を 1 つ増やす */
export const startSession = (saved: RpgSaved, now: number): RpgHero => ({
  ...saved,
  sessions: saved.sessions + 1,
  s: freshSession(now),
  hpPct: 100,
  xpFrom: levelInfo(saved.xp).frac,
  synced: saved,
})

export const onTurnStart = (h: RpgHero, now: number): RpgHero => {
  const s = touch(h.s, now)
  return { ...h, s: { ...s, turnTools: 0, turnErrors: 0, isErrorPending: false }, hpPct: hpPctAt({ ...h, s }, now) }
}

export function onTurnEnd(h: RpgHero, now: number): RpgHero {
  const day = dayKey(now)
  const s = touch(h.s, now)
  // ターンを終えるたびに魔物の気配が 1 つたまる
  const next = {
    ...gain(h, XP.turn),
    s,
    turns: h.turns + 1,
    day,
    dayTurns: (h.day === day ? h.dayTurns : 0) + 1,
    encounters: Math.min(MAX_ENCOUNTERS, h.encounters + 1),
  }
  return { ...next, hpPct: hpPctAt(next, now) }
}

export function onTool(h: RpgHero, tool: string, isError: boolean, now: number): RpgHero {
  const s0 = touch(h.s, now)
  if (isError) {
    const s = { ...s0, toolErr: s0.toolErr + 1, turnTools: s0.turnTools + 1, turnErrors: s0.turnErrors + 1, isErrorPending: true }
    return { ...h, s, tools: h.tools + 1, errors: h.errors + 1, xpFrom: levelInfo(h.xp).frac }
  }
  const kind = toolKind(tool)
  const isRecovery = s0.isErrorPending
  const s = {
    ...s0,
    toolOk: s0.toolOk + 1,
    turnTools: s0.turnTools + 1,
    isErrorPending: false,
    edits: s0.edits + (kind === 'edit' ? 1 : 0),
    reads: s0.reads + (kind === 'read' ? 1 : 0),
    shells: s0.shells + (kind === 'shell' ? 1 : 0),
    recoveries: s0.recoveries + (isRecovery ? 1 : 0),
  }
  return {
    ...gain(h, XP[kind] + (isRecovery ? XP.recovery : 0)),
    s,
    tools: h.tools + 1,
    edits: h.edits + (kind === 'edit' ? 1 : 0),
    reads: h.reads + (kind === 'read' ? 1 : 0),
    shells: h.shells + (kind === 'shell' ? 1 : 0),
    recoveries: h.recoveries + (isRecovery ? 1 : 0),
  }
}

/** まだ取っていない実績のうち、条件を満たした物を取る */
export function grant(h: RpgHero, now: number, isTurnEnd: boolean, owned?: RpgGachaCard[]): { hero: RpgHero; gained: Achievement[] } {
  const level = levelInfo(h.xp).level
  const gained = ACHIEVEMENTS.filter(a => h.achievements[a.id] === undefined && a.test({ h, level, isTurnEnd, owned }))
  if (gained.length === 0) return { hero: h, gained }
  const achievements = { ...h.achievements }
  for (const a of gained) achievements[a.id] = now
  return { hero: { ...h, achievements }, gained }
}

/** このセッションの作業で上がる分 (編集・調べ物・コマンドの回数) の上限 */
export const WORK_CAP = 10

/**
 * 強さ。Lv・振った SP・装備・このセッションの作業 (上限 WORK_CAP) を足す。
 * worn (画面用に持っている物だけにした装備) があればそれ、無ければ equip の分を足す
 */
export function statsOf(h: RpgHero) {
  const info = levelInfo(h.xp)
  const L = info.level
  const a = h.alloc
  const bonus = gearBonus(h.worn ?? h.equip)
  const maxHp = 40 + L * 10 + bonus.hp + a.vit * 10
  const maxMp = 20 + L * 5 + bonus.mp + a.int * 4
  const tries = h.s.toolOk + h.s.toolErr
  const work = { attack: Math.min(WORK_CAP, h.s.edits), magic: Math.min(WORK_CAP, h.s.reads), speed: Math.min(WORK_CAP, h.s.shells) }
  const grit = h.s.recoveries
  return {
    ...info,
    title: titleOf(L),
    maxHp,
    hp: Math.max(1, Math.round((maxHp * h.hpPct) / 100)),
    maxMp,
    mp: tries === 0 ? maxMp : Math.round((maxMp * h.s.toolOk) / tries),
    attack: 6 + 2 * L + 2 * a.str + bonus.attack + work.attack,
    defense: 1 + L + 2 * a.vit + bonus.hp / 5,
    magic: 4 + 2 * L + 2 * a.int + bonus.magic + work.magic,
    speed: 2 + L + 2 * a.agi + work.speed,
    grit,
    /** 会心の確率 (%): 5 + 根性 + 敏捷 (+ コードレビュー 10)。40 まで */
    crit: Math.min(40, 5 + grit + a.agi + (h.learned.review !== undefined ? 10 : 0)),
    bonus,
    work,
    sp: spOf(h),
    earned: ACHIEVEMENTS.filter(x => h.achievements[x.id] !== undefined).length,
  }
}

export const levelUpText = (level: number) => `レベルアップ! Lv ${level} ${titleOf(level)}`

// ---------------------------------------------------------------- SVG

const W = 380
/** 昔の RPG の青い窓の色。暗いテーマ (今までの色) と、/config の theme が light 系の時の色 */
const DARK_K = {
  bg: '#0d1117',
  win: '#0b1f5c',
  winTop: '#14307f',
  frame: '#ffffff',
  text: '#ffffff',
  weak: '#9fb3e6',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  blue: '#58a6ff',
  purple: '#bc8cff',
  off: '#30363d',
  offText: '#8b949e',
  well: '#06103a',
  badge: '#d29922',
  badgeText: '#3b2300',
  /** 装備で上がった分の色 */
  gear: '#39c5cf',
}
const LIGHT_K: typeof DARK_K = {
  bg: '#ffffff',
  win: '#dbe5ff',
  winTop: '#f3f6ff',
  frame: '#1d3a8a',
  text: '#0b1f5c',
  weak: '#4a5f99',
  green: '#1a7f37',
  yellow: '#9a6700',
  red: '#cf222e',
  blue: '#0969da',
  purple: '#8250df',
  off: '#eaeef2',
  offText: '#6e7781',
  well: '#c3d2f7',
  badge: '#f2cc60',
  badgeText: '#3b2300',
  gear: '#0e7c86',
}
// ponytail: 今の色はモジュールの変数。SVG を作る関数の頭で paint() を呼んで、テーマに合わせる
export const K = { ...DARK_K }
export const paint = () => Object.assign(K, isLight() ? LIGHT_K : DARK_K)
export const MONO = 'ui-monospace, Consolas, monospace'
const rarityColor = (r: Rarity) => ({ N: K.offText, R: K.blue, SR: K.yellow, SSR: K.purple })[r]

export const svgDoc = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<defs><linearGradient id="win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K.winTop}"/><stop offset="1" stop-color="${K.win}"/></linearGradient></defs>` +
  `<rect width="${W}" height="${h}" fill="${K.bg}"/>${body}</svg>`

/** 昔の RPG の窓: 青い地に白い二重の枠 */
export const win = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="url(#win)" stroke="${K.frame}" stroke-width="3"/>` +
  `<rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="5" fill="none" stroke="${K.frame}" stroke-opacity="0.45" stroke-width="1"/>`

// 勇者のドット絵 (12x12)。文字ごとに色: h 髪 / s 肌 / e 目 / b 服 / g 剣
const SPRITE = [
  '....hhhh....',
  '...hhhhhh...',
  '...hssssh...',
  '...sesses...',
  '...ssssss..g',
  '....ssss..g.',
  '..bbbbbbbbg.',
  '.sbbbbbbb.s.',
  '.s.bbbbbb...',
  '...bb..bb...',
  '...bb..bb...',
  '..sss..sss..',
]
const SPRITE_COLORS: Record<string, string> = { h: '#f78166', s: '#f2cc8f', e: '#0d1117', b: '#58a6ff', g: '#c9d1d9' }

export function sprite(x: number, y: number, px: number) {
  let s = ''
  SPRITE.forEach((row, r) => {
    ;[...row].forEach((ch, c) => {
      const color = SPRITE_COLORS[ch]
      if (color) s += `<rect x="${x + c * px}" y="${y + r * px}" width="${px}" height="${px}" fill="${color}"/>`
    })
  })
  // その場で小さく跳ねる
  return `<g>${s}<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="1.4s" repeatCount="indefinite"/></g>`
}

/** 横棒。経験値は from から伸びる */
export function bar(x: number, y: number, w: number, frac: number, color: string, from?: number) {
  const fw = Math.max(0, Math.min(1, frac)) * w
  const anim =
    from !== undefined && Math.abs(from - frac) > 0.001
      ? `<animate attributeName="width" from="${(Math.max(0, Math.min(1, from)) * w).toFixed(1)}" to="${fw.toFixed(1)}" dur="0.9s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>`
      : ''
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="12" fill="${K.well}" stroke="${K.frame}" stroke-opacity="0.6"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, fw - 2).toFixed(1)}" height="10" fill="${color}">${anim}</rect>` +
    `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, fw - 2).toFixed(1)}" height="3" fill="#ffffff" opacity="0.25">${anim}</rect>`
  )
}

function badge(cx: number, cy: number, a: Achievement, isEarned: boolean) {
  if (!isEarned) {
    return (
      `<circle cx="${cx}" cy="${cy}" r="19" fill="${K.off}" stroke="${K.offText}" stroke-dasharray="3 2"/>` +
      `<text x="${cx}" y="${cy + 6}" font-size="17" fill="${K.offText}" text-anchor="middle">${a.glyph}</text>`
    )
  }
  return (
    `<circle cx="${cx}" cy="${cy}" r="19" fill="${K.badge}" stroke="${K.frame}" stroke-width="2"/>` +
    `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="#ffffff" stroke-opacity="0.5"/>` +
    `<text x="${cx}" y="${cy + 6}" font-size="17" font-weight="bold" fill="${K.badgeText}" text-anchor="middle">${a.glyph}</text>`
  )
}

const SLOT_GLYPH: Record<RpgSlot, string> = { weapon: '武', armor: '防', charm: '守' }

/** 枠の小さな札。着けていればレア度の色で塗る */
function slotChip(x: number, y: number, slot: RpgSlot, card: RpgGachaCard | undefined) {
  if (!card)
    return (
      `<rect x="${x}" y="${y}" width="22" height="22" rx="4" fill="${K.well}" stroke="${K.offText}" stroke-dasharray="2 2"/>` +
      `<text x="${x + 11}" y="${y + 16}" font-size="12" fill="${K.offText}" text-anchor="middle">${SLOT_GLYPH[slot]}</text>`
    )
  const col = rarityColor(card.rarity)
  return (
    `<rect x="${x}" y="${y}" width="22" height="22" rx="4" fill="${col}" stroke="${K.frame}"/>` +
    `<text x="${x + 11}" y="${y + 16}" font-size="12" font-weight="bold" fill="${K.badgeText}" text-anchor="middle">${SLOT_GLYPH[slot]}</text>`
  )
}

/** 「装備で +n」の小さな字 (0 なら何も出さない) */
const plus = (x: number, y: number, n: number, anchor = 'start') =>
  n > 0 ? `<text x="${x}" y="${y}" font-size="12" font-weight="bold" font-family="${MONO}" fill="${K.gear}" text-anchor="${anchor}">+${n}</text>` : ''

/** ステータスの画面 */
export function statusSvg(h: RpgHero) {
  paint()
  const st = statsOf(h)
  const gear = h.worn ?? h.equip
  let s = ''
  // ── 名前・レベル・称号・装備の札
  s += win(8, 8, 364, 92)
  s += `<rect x="20" y="20" width="68" height="68" fill="${K.well}" stroke="${K.frame}" stroke-opacity="0.5"/>` + sprite(30, 28, 4)
  s += `<text x="102" y="42" font-size="20" font-weight="bold" fill="${K.text}">勇者</text>`
  s += `<text x="160" y="42" font-size="20" font-weight="bold" font-family="${MONO}" fill="${K.text}">Lv ${st.level}</text>`
  SLOTS.forEach((k, i) => (s += slotChip(284 + i * 26, 22, k, gear[k])))
  s +=
    `<text x="102" y="70" font-size="14" fill="${K.yellow}">` +
    `<tspan>▶</tspan><tspan dx="4" fill="${K.text}">${esc(st.title)}</tspan>` +
    `<animate attributeName="opacity" values="1;1;0.4;1" dur="1.6s" repeatCount="indefinite"/></text>`
  s += `<text x="102" y="90" font-size="12" fill="${K.weak}">冒険 ${h.sessions} 回目 / 累計 ${h.turns} ターン</text>`

  // ── HP / MP / 経験値 (装備で上がった最大値は棒の右に色を変えて出す)
  s += win(8, 108, 364, 128)
  const hpColor = h.hpPct > 50 ? K.green : h.hpPct > 25 ? K.yellow : K.red
  const line = (y: number, label: string, frac: number, color: string, value: string, bonus: number, from?: number) =>
    `<text x="24" y="${y + 11}" font-size="14" font-weight="bold" font-family="${MONO}" fill="${K.text}">${label}</text>` +
    bar(64, y, 172, frac, color, from) +
    plus(242, y + 11, bonus) +
    `<text x="358" y="${y + 11}" font-size="13" font-family="${MONO}" fill="${K.text}" text-anchor="end">${value}</text>`
  s += line(126, 'HP', st.hp / st.maxHp, hpColor, `${st.hp}/${st.maxHp}`, st.bonus.hp)
  s += line(154, 'MP', st.mp / st.maxMp, K.blue, `${st.mp}/${st.maxMp}`, st.bonus.mp)
  s += line(182, 'EX', st.frac, K.purple, st.level >= MAX_LEVEL ? 'MAX' : `${st.into}/${st.need}`, 0, h.xpFrom)
  s +=
    `<text x="24" y="222" font-size="12" fill="${K.weak}">` +
    (st.level >= MAX_LEVEL ? 'これ以上は上がりません' : `つぎのレベルまで ${st.need - st.into}`) +
    `</text><text x="358" y="222" font-size="12" fill="${K.weak}" text-anchor="end">HP は休むと戻る</text>`

  // ── 強さ (Lv・振った SP・装備・今回の作業を足した値。装備の分は下の説明の右に色を変えて出す)
  s += win(8, 244, 364, 134)
  const cell = (x: number, y: number, label: string, value: number, note: string, bonus: number, color?: string) =>
    `<text x="${x}" y="${y}" font-size="13" fill="${K.text}">${label}</text>` +
    `<text x="${x + 150}" y="${y}" font-size="15" font-weight="bold" font-family="${MONO}" fill="${color ?? (bonus > 0 ? K.gear : K.text)}" text-anchor="end">${value}</text>` +
    `<text x="${x}" y="${y + 16}" font-size="12" fill="${K.weak}">${note}</text>` +
    (bonus > 0 ? `<text x="${x + 150}" y="${y + 16}" font-size="12" fill="${K.gear}" text-anchor="end">装備で +${bonus}</text>` : '')
  s += cell(24, 270, '攻撃力', st.attack, '力と編集', st.bonus.attack)
  s += cell(204, 270, '防御力', st.defense, '体力と防具', st.bonus.hp / 5)
  s += cell(24, 312, '魔力', st.magic, '知恵と調べ物', st.bonus.magic)
  s += cell(204, 312, '素早さ', st.speed, '敏捷とコマンド', 0)
  s += cell(24, 354, '根性', st.grit, `立ち直り (会心 ${st.crit}%)`, 0)
  s += cell(204, 354, 'SP', st.sp.free, '「成長」で使う', 0, st.sp.free > 0 ? K.yellow : undefined)

  // ── 実績のバッジ (6 個ずつ並べる)
  const rows = Math.ceil(ACHIEVEMENTS.length / 6)
  const top = 386
  s += win(8, top, 364, 34 + rows * 46)
  s += `<text x="24" y="${top + 24}" font-size="13" font-weight="bold" fill="${K.text}">実績</text>`
  s += `<text x="358" y="${top + 24}" font-size="12" fill="${K.weak}" text-anchor="end">${st.earned} / ${ACHIEVEMENTS.length}</text>`
  ACHIEVEMENTS.forEach((a, i) => {
    const cx = 44 + (i % 6) * 58
    const cy = top + 54 + Math.floor(i / 6) * 46
    s += badge(cx, cy, a, h.achievements[a.id] !== undefined)
  })
  return svgDoc(top + 34 + rows * 46 + 8, s)
}

const SLOT_NOTE: Record<RpgSlot, string> = { weapon: '攻撃力が上がる', armor: '最大 HP が上がる', charm: '魔力と最大 MP が上がる' }

/** 装備の画面。owned はガチャで持っているカード (turn-gacha が無ければ undefined) */
export function gearSvg(h: RpgHero, owned: RpgGachaCard[] | undefined) {
  paint()
  let s = win(8, 8, 364, 56)
  s += `<text x="24" y="34" font-size="15" font-weight="bold" fill="${K.text}">装備</text>`
  s += `<text x="24" y="52" font-size="12" fill="${K.weak}">ガチャで出たカードを身に着ける</text>`
  if (owned === undefined) {
    s += win(8, 72, 364, 92)
    s += `<text x="190" y="108" font-size="14" font-weight="bold" fill="${K.text}" text-anchor="middle">turn-gacha を入れるとカードを装備できます</text>`
    s += `<text x="190" y="132" font-size="12" fill="${K.weak}" text-anchor="middle">ガチャのカードが武器・防具・お守りになります</text>`
    return svgDoc(172, s)
  }
  const worn = wornOf(h.equip, owned)
  const b = gearBonus(worn)
  const total = b.attack + b.hp + b.magic + b.mp
  s += `<text x="358" y="34" font-size="12" fill="${total > 0 ? K.gear : K.weak}" text-anchor="end">${total > 0 ? '装備で強くなった' : 'まだ何も着けていない'}</text>`
  let y = 72
  for (const k of SLOTS) {
    const card = worn[k]
    const kinds = owned.filter(c => c.slot === k).length
    s += win(8, y, 364, 72)
    s += slotChip(24, y + 16, k, card)
    s += `<text x="56" y="${y + 26}" font-size="13" font-weight="bold" fill="${K.text}">${SLOT_LABEL[k]}</text>`
    s += `<text x="120" y="${y + 26}" font-size="12" fill="${K.weak}">${SLOT_NOTE[k]}</text>`
    if (card) {
      const col = rarityColor(card.rarity)
      s +=
        `<rect x="24" y="${y + 42}" width="36" height="18" rx="4" fill="none" stroke="${col}"/>` +
        `<text x="42" y="${y + 55}" font-size="12" font-weight="bold" fill="${col}" text-anchor="middle">${card.rarity}</text>` +
        `<text x="68" y="${y + 55}" font-size="13" fill="${K.text}">${esc(short(card.name, 15))}</text>` +
        `<text x="358" y="${y + 55}" font-size="12" font-weight="bold" fill="${K.gear}" text-anchor="end">${gearEffect(k, card.rarity)}</text>`
    } else {
      s += `<text x="24" y="${y + 55}" font-size="12" fill="${K.offText}">${kinds > 0 ? `なし (着けられるカード ${kinds} 種)` : 'なし (この枠のカードをまだ持っていない)'}</text>`
    }
    y += 80
  }
  // ── 合計と、レア度ごとの上がり幅
  s += win(8, y, 364, 64)
  const sum = [`攻撃力 +${b.attack}`, `最大HP +${b.hp}`, `魔力 +${b.magic}`, `最大MP +${b.mp}`].join('  ')
  s += `<text x="24" y="${y + 26}" font-size="12" font-weight="bold" fill="${total > 0 ? K.gear : K.weak}">${sum}</text>`
  s += `<text x="24" y="${y + 46}" font-size="12" fill="${K.weak}">${RARITIES.slice().reverse().map(r => `${r} +${GEAR_POINTS[r]}`).join('  ')} (防具 5 倍・MP 3 倍)</text>`
  if (owned.length === 0) s += `<text x="190" y="${y + 90}" font-size="12" fill="${K.weak}" text-anchor="middle">ガチャでカードを引くと装備できます</text>`
  return svgDoc(y + (owned.length === 0 ? 104 : 72), s)
}

const dateLabel = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 称号と実績の画面: 今の称号と次の称号、称号の段、取った実績と、まだの実績 (ヒント付き) */
export function achievementsSvg(h: RpgHero) {
  paint()
  const { level } = levelInfo(h.xp)
  const title = titleOf(level)
  const nextTitle = TITLES.find(([lv]) => lv > level)
  const earned = ACHIEVEMENTS.filter(a => h.achievements[a.id] !== undefined)
  const rest = ACHIEVEMENTS.filter(a => h.achievements[a.id] === undefined)
  // ── 見出し: 称号と、実績の集まり具合
  let s = win(8, 8, 364, 92)
  s += `<text x="24" y="34" font-size="15" font-weight="bold" fill="${K.text}">▶ 実績の書</text>`
  s += `<text x="358" y="34" font-size="12" fill="${K.weak}" text-anchor="end">${earned.length} / ${ACHIEVEMENTS.length}</text>`
  s += bar(24, 44, 334, earned.length / ACHIEVEMENTS.length, K.badge)
  s += `<text x="24" y="74" font-size="13" fill="${K.text}">称号 <tspan font-weight="bold" fill="${K.yellow}">${esc(title)}</tspan></text>`
  s += `<text x="24" y="92" font-size="12" fill="${K.weak}">${nextTitle ? `つぎの称号は Lv ${nextTitle[0]} の「${esc(nextTitle[1])}」` : '称号はすべて手に入れた'}</text>`

  // ── 称号の段 (2 列)
  const tRows = Math.ceil(TITLES.length / 2)
  let y = 108
  s += win(8, y, 364, 36 + tRows * 22)
  s += `<text x="24" y="${y + 24}" font-size="13" font-weight="bold" fill="${K.text}">称号の段</text>`
  TITLES.forEach(([lv, name], i) => {
    const x = i % 2 === 0 ? 24 : 196
    const ty = y + 46 + Math.floor(i / 2) * 22
    const isNow = name === title
    const has = level >= lv
    const col = isNow ? K.yellow : has ? K.text : K.offText
    s += `<text x="${x}" y="${ty}" font-size="12" font-family="${MONO}" fill="${col}">Lv${String(lv).padStart(2, ' ')}</text>`
    s += `<text x="${x + 40}" y="${ty}" font-size="12"${isNow ? ' font-weight="bold"' : ''} fill="${col}">${esc(name)}</text>`
  })
  y += 36 + tRows * 22 + 8

  // ── 実績: 取った物、まだの物 (ヒント付き)
  const rowH = 40
  const top = y
  let body = ''
  const row = (a: Achievement, at: number | undefined) => {
    const isEarned = at !== undefined
    body +=
      `<g transform="translate(0 ${y})">` +
      `<line x1="20" y1="0" x2="360" y2="0" stroke="${K.frame}" stroke-opacity="0.15"/>` +
      `<circle cx="36" cy="20" r="13" fill="${isEarned ? K.badge : K.off}" stroke="${isEarned ? K.frame : K.offText}"/>` +
      `<text x="36" y="25" font-size="13" font-weight="bold" fill="${isEarned ? K.badgeText : K.offText}" text-anchor="middle">${a.glyph}</text>` +
      `<text x="58" y="17" font-size="13" font-weight="bold" fill="${isEarned ? K.text : K.offText}">${esc(a.name)}</text>` +
      `<text x="58" y="33" font-size="12" fill="${isEarned ? K.weak : K.offText}">${isEarned ? '' : 'ヒント: '}${esc(a.hint)}</text>` +
      `<text x="358" y="17" font-size="12" fill="${isEarned ? K.yellow : K.offText}" text-anchor="end">${isEarned ? dateLabel(at) : 'まだ'}</text>` +
      (a.isGacha ? `<text x="358" y="33" font-size="12" fill="${K.gear}" text-anchor="end">ガチャ連動</text>` : '') +
      `</g>`
    y += rowH
  }
  const section = (label: string, n: number) => {
    body += `<text x="24" y="${y + 22}" font-size="13" font-weight="bold" fill="${K.text}">${label}</text>`
    body += `<text x="358" y="${y + 22}" font-size="12" fill="${K.weak}" text-anchor="end">${n}</text>`
    y += 32
  }
  y += 4
  section('手に入れた実績', earned.length)
  if (earned.length === 0) {
    body += `<text x="24" y="${y + 14}" font-size="12" fill="${K.offText}">まだひとつもありません</text>`
    y += 24
  }
  for (const a of earned) row(a, h.achievements[a.id])
  section('まだの実績', rest.length)
  for (const a of rest) row(a, undefined)
  if (rest.length === 0) {
    body += `<text x="24" y="${y + 14}" font-size="12" fill="${K.yellow}">全部手に入れた</text>`
    y += 24
  }
  s += win(8, top, 364, y - top + 8) + body
  return svgDoc(y + 16, s)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う行 (ステータス) */
export function statusLines(h: RpgHero): Line[] {
  const st = statsOf(h)
  const marks = ACHIEVEMENTS.map(a => (h.achievements[a.id] !== undefined ? '●' : '○')).join('')
  const gear = h.worn ?? h.equip
  const worn = SLOTS.flatMap(k => {
    const c = gear[k]
    return c ? [`${SLOT_LABEL[k]} ${c.rarity} ${c.name}`] : []
  })
  const b = st.bonus
  return [
    { text: `勇者 Lv ${st.level} ${st.title}`, isBold: true },
    { text: `HP ${st.hp}/${st.maxHp}  MP ${st.mp}/${st.maxMp}`, color: h.hpPct > 25 ? undefined : 'red' },
    { text: st.level >= MAX_LEVEL ? '経験値 MAX' : `経験値 ${st.into}/${st.need} (つぎまで ${st.need - st.into})`, color: 'magenta' },
    { text: `攻撃力 ${st.attack}  防御力 ${st.defense}  魔力 ${st.magic}  素早さ ${st.speed}  根性 ${st.grit}` },
    { text: `SP ${st.sp.free} (「成長」で使う)  会心 ${st.crit}%`, color: st.sp.free > 0 ? 'yellow' : undefined, isDim: st.sp.free === 0 },
    ...(worn.length > 0
      ? [{ text: `装備で 攻撃力 +${b.attack} 最大HP +${b.hp} 魔力 +${b.magic} 最大MP +${b.mp} (${worn.join(' / ')})`, color: 'cyan' }]
      : []),
    { text: `実績 ${st.earned}/${ACHIEVEMENTS.length} ${marks}`, color: 'yellow' },
    { text: `冒険 ${h.sessions} 回目 / 累計 ${h.turns} ターン`, isDim: true },
  ]
}

/** 装備の画面の行 */
export function gearLines(h: RpgHero, owned: RpgGachaCard[] | undefined): Line[] {
  if (owned === undefined)
    return [
      { text: 'turn-gacha を入れるとカードを装備できます', isBold: true },
      { text: 'ガチャのカードが武器・防具・お守りになります', isDim: true },
    ]
  const worn = wornOf(h.equip, owned)
  const b = gearBonus(worn)
  return [
    ...SLOTS.map((k): Line => {
      const c = worn[k]
      return c ? { text: `${SLOT_LABEL[k]}: ${c.rarity} ${c.name} (${gearEffect(k, c.rarity)})`, color: 'cyan' } : { text: `${SLOT_LABEL[k]}: なし`, isDim: true }
    }),
    { text: `装備で 攻撃力 +${b.attack} 最大HP +${b.hp} 魔力 +${b.magic} 最大MP +${b.mp}` },
    ...(owned.length === 0 ? [{ text: 'ガチャでカードを引くと装備できます', isDim: true }] : []),
  ]
}

/** 称号と実績の一覧の行 (取った物が先) */
export function achievementLines(h: RpgHero): Line[] {
  const { level } = levelInfo(h.xp)
  const next = TITLES.find(([lv]) => lv > level)
  const earned = ACHIEVEMENTS.filter(a => h.achievements[a.id] !== undefined)
  const rest = ACHIEVEMENTS.filter(a => h.achievements[a.id] === undefined)
  return [
    { text: `称号 ${titleOf(level)} (実績 ${earned.length}/${ACHIEVEMENTS.length})`, isBold: true },
    { text: next ? `つぎの称号 Lv ${next[0]} ${next[1]}` : '称号はすべて手に入れた', isDim: true },
    ...earned.map((a): Line => ({ text: `● ${a.name} (${dateLabel(h.achievements[a.id] ?? 0)}) ${a.hint}`, color: 'yellow' })),
    ...rest.map((a): Line => ({ text: `○ ${a.name} ─ ${a.hint}`, isDim: true })),
  ]
}
