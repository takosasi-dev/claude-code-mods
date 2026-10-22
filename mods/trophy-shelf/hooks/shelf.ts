// 実績帳の純関数(他の mod の state を確かめる・トロフィーの判定・SVG と terminal の行)
import type { ShelfFirstAt, ShelfMod, ShelfSnapshot } from '../types'
import { C, HEADER_H, W, esc, fadeIn, frame, growBar, header, panel, short } from './style'

// ---------------------------------------------------------------- 他の mod の state を確かめる

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const keysOf = (v: unknown) => (isObj(v) ? Object.keys(v) : [])

// dev-rpg の hooks/rpg.ts の xpToReach と MAX_LEVEL の写し。dev-rpg が式を変えたら合わせる
const MAX_LEVEL = 99
const xpToReach = (level: number) => 40 * (level - 1) + 10 * level * (level - 1)
export function levelOf(xp: number) {
  let level = 1
  while (level < MAX_LEVEL && xp >= xpToReach(level + 1)) level++
  return level
}

/** 他の mod から読んだ生の値。読めなかった物は undefined */
export type ShelfRaw = {
  hero?: unknown
  save?: unknown
  cards?: unknown
  tank?: unknown
  stats?: unknown
  streak?: unknown
  totalDone?: unknown
}

/** 生の値から判定に使う数を作る。形の合わない mod は「入っていない」と同じに扱う */
export function snapshotOf(raw: ShelfRaw): ShelfSnapshot {
  const s: ShelfSnapshot = {}
  const hero = raw.hero
  if (isObj(hero) && typeof hero.xp === 'number') {
    // deepest は dev-rpg 0.6.0 から (古い版なら 0)
    s.rpg = { level: levelOf(num(hero.xp)), achievements: keysOf(hero.achievements).length, wins: num(hero.wins), bosses: keysOf(hero.defeated).length, deepest: num(hero.deepest) }
  }
  const save = raw.save
  if (isObj(save) && isObj(save.book)) {
    const cards = Array.isArray(raw.cards) ? raw.cards.filter(isObj) : []
    const rarity = new Map(cards.map(c => [String(c.id), c.rarity]))
    const book = Object.keys(save.book)
    // カードの表が読めれば表にある物だけを数える(消えたカードは数えない)
    const owned = cards.length > 0 ? book.filter(id => rarity.has(id)) : book
    s.gacha = { owned: owned.length, total: cards.length, ssr: owned.filter(id => rarity.get(id) === 'SSR').length, pulls: num(save.total) }
  }
  const tank = raw.tank
  if (isObj(tank)) {
    const fish = Array.isArray(tank.fish) ? tank.fish.filter(isObj) : []
    s.aqua = { kinds: new Set(fish.map(f => String(f.kind))).size, fish: fish.length, days: isObj(tank.view) ? num(tank.view.days) : 0 }
  }
  const stats = raw.stats
  if (isObj(stats)) {
    const puzzles = isObj(stats.puzzles) ? stats.puzzles : {}
    const won = Object.entries(puzzles).filter(([, p]) => isObj(p) && num(p.wins) > 0)
    // 数独は大きさ別に記録があるが、ゲームとしては 1 種
    const kinds = new Set(won.map(([k]) => (k.startsWith('sudoku') ? 'sudoku' : k)))
    if (num(stats.best2048) > 0 || num(stats.wins2048) > 0) kinds.add('2048')
    if (num(stats.winsMines) > 0) kinds.add('mines')
    s.games = {
      kinds: kinds.size,
      best2048: num(stats.best2048),
      wins2048: num(stats.wins2048),
      wins: num(stats.wins2048) + num(stats.winsMines) + won.reduce((n, [, p]) => n + num(isObj(p) ? p.wins : 0), 0),
    }
  }
  if (typeof raw.streak === 'number' || typeof raw.totalDone === 'number') s.quest = { streak: num(raw.streak), totalDone: num(raw.totalDone) }
  return s
}

// ---------------------------------------------------------------- トロフィー

export type Trophy = {
  id: string
  /** どの棚の物か。'all' は棚をまたぐ物 */
  mod: ShelfMod | 'all'
  name: string
  /** 丸の中の 1 文字 */
  glyph: string
  hint: string
  /** [今の数, 目標]。その mod が入っていなければ undefined */
  progress: (s: ShelfSnapshot) => [number, number] | undefined
}

const at = <T,>(v: T | undefined, f: (v: T) => [number, number]) => (v === undefined ? undefined : f(v))

export const TROPHIES: Trophy[] = [
  { id: 'rpg-lv5', mod: 'dev-rpg', name: '冒険の始まり', glyph: '始', hint: 'dev-rpg で Lv 5', progress: s => at(s.rpg, r => [r.level, 5]) },
  { id: 'rpg-lv10', mod: 'dev-rpg', name: '二桁の勇者', glyph: '十', hint: 'dev-rpg で Lv 10', progress: s => at(s.rpg, r => [r.level, 10]) },
  { id: 'rpg-lv30', mod: 'dev-rpg', name: '歴戦の勇者', glyph: '勇', hint: 'dev-rpg で Lv 30', progress: s => at(s.rpg, r => [r.level, 30]) },
  { id: 'rpg-ach10', mod: 'dev-rpg', name: '実績の山', glyph: '績', hint: 'dev-rpg の実績を 10 個', progress: s => at(s.rpg, r => [r.achievements, 10]) },
  { id: 'rpg-boss', mod: 'dev-rpg', name: '竜を倒す', glyph: '竜', hint: 'dev-rpg のボスを 1 体倒す', progress: s => at(s.rpg, r => [r.bosses, 1]) },
  // dev-rpg 0.6.0 のダンジョン (勝ち抜いた一番深い階)。10 階ごとに番人がいる
  { id: 'rpg-deep10', mod: 'dev-rpg', name: '番人越え', glyph: '番', hint: 'ダンジョン 10 階の番人を倒す', progress: s => at(s.rpg, r => [r.deepest, 10]) },
  { id: 'rpg-deep30', mod: 'dev-rpg', name: '地下三十階', glyph: '潜', hint: 'ダンジョンの 30 階を勝ち抜く', progress: s => at(s.rpg, r => [r.deepest, 30]) },
  { id: 'rpg-deep100', mod: 'dev-rpg', name: '百階の主', glyph: '淵', hint: 'ダンジョンの 100 階を勝ち抜く', progress: s => at(s.rpg, r => [r.deepest, 100]) },
  { id: 'gacha-10', mod: 'turn-gacha', name: '集め始め', glyph: '集', hint: 'ガチャの図鑑を 10 種', progress: s => at(s.gacha, g => [g.owned, 10]) },
  {
    id: 'gacha-half',
    mod: 'turn-gacha',
    name: '図鑑の半分',
    glyph: '半',
    hint: 'ガチャの図鑑を半分うめる',
    progress: s => at(s.gacha, g => (g.total > 0 ? [g.owned, Math.ceil(g.total / 2)] : [0, 1])),
  },
  {
    id: 'gacha-all',
    mod: 'turn-gacha',
    name: '図鑑の完成',
    glyph: '完',
    hint: 'ガチャの図鑑を全部うめる',
    progress: s => at(s.gacha, g => (g.total > 0 ? [g.owned, g.total] : [0, 1])),
  },
  { id: 'gacha-ssr', mod: 'turn-gacha', name: '虹の一枚', glyph: '虹', hint: 'SSR のカードを引く', progress: s => at(s.gacha, g => [g.ssr, 1]) },
  { id: 'aqua-3', mod: 'aqua-pet', name: 'にぎやかな水槽', glyph: '魚', hint: '水槽の魚を 3 種', progress: s => at(s.aqua, a => [a.kinds, 3]) },
  { id: 'aqua-6', mod: 'aqua-pet', name: '水槽の図鑑', glyph: '鱗', hint: '水槽の魚を 6 種', progress: s => at(s.aqua, a => [a.kinds, 6]) },
  { id: 'aqua-10', mod: 'aqua-pet', name: '水槽の全種', glyph: '海', hint: '水槽の魚を 10 種', progress: s => at(s.aqua, a => [a.kinds, 10]) },
  { id: 'aqua-30d', mod: 'aqua-pet', name: '長い付き合い', glyph: '月', hint: '水槽を 30 日育てる', progress: s => at(s.aqua, a => [a.days, 30]) },
  { id: 'games-1', mod: 'wait-games', name: 'ひと休み', glyph: '休', hint: '待ちゲームで初めて記録', progress: s => at(s.games, g => [g.kinds, 1]) },
  { id: 'games-4', mod: 'wait-games', name: '遊びの達人', glyph: '遊', hint: '待ちゲーム 4 種で記録', progress: s => at(s.games, g => [g.kinds, 4]) },
  { id: 'games-2048', mod: 'wait-games', name: '2048 に届く', glyph: '二', hint: '2048 のタイルを作る', progress: s => at(s.games, g => [g.wins2048, 1]) },
  { id: 'quest-1', mod: 'daily-quest', name: '初めてのお題', glyph: '題', hint: 'お題を 1 つこなす', progress: s => at(s.quest, q => [q.totalDone, 1]) },
  { id: 'quest-7', mod: 'daily-quest', name: '七日の皆勤', glyph: '七', hint: 'お題を 7 日続けて全部こなす', progress: s => at(s.quest, q => [q.streak, 7]) },
  { id: 'quest-50', mod: 'daily-quest', name: 'お題の常連', glyph: '常', hint: 'お題を通算 50 個', progress: s => at(s.quest, q => [q.totalDone, 50]) },
  // 棚をまたぐ物。judge で、他のトロフィーを取った棚の数から決める
  { id: 'all-shelves', mod: 'all', name: '棚がそろう', glyph: '棚', hint: '5 つの棚でトロフィーを 1 つずつ', progress: () => undefined },
]

export const SHELVES: ShelfMod[] = ['dev-rpg', 'turn-gacha', 'aqua-pet', 'wait-games', 'daily-quest']

export type Judged = {
  trophy: Trophy
  cur: number
  goal: number
  /** その mod が入っていて数が読めた */
  isKnown: boolean
  isDone: boolean
  /** 初めて取った時刻。まだ記録していなければ undefined */
  firstAt?: number
}

/** 全トロフィーの今の進み。一度取った物 (firstAt にある物) は、mod を外しても取ったまま */
export function judge(s: ShelfSnapshot, firstAt: ShelfFirstAt): Judged[] {
  const list = TROPHIES.filter(t => t.mod !== 'all').map(trophy => {
    const p = trophy.progress(s)
    const [cur, goal] = p ?? [0, 1]
    const first = firstAt[trophy.id]
    return { trophy, cur: Math.min(cur, goal), goal, isKnown: p !== undefined, isDone: first !== undefined || (p !== undefined && cur >= goal), firstAt: first }
  })
  const filled = SHELVES.filter(m => list.some(j => j.trophy.mod === m && j.isDone)).length
  const all = TROPHIES.filter(t => t.mod === 'all').map(trophy => {
    const first = firstAt[trophy.id]
    return { trophy, cur: filled, goal: SHELVES.length, isKnown: true, isDone: first !== undefined || filled >= SHELVES.length, firstAt: first }
  })
  return [...list, ...all]
}

/** 今取れている物のうち、まだ時刻を記録していない id */
export const freshIds = (judged: readonly Judged[]) => judged.filter(j => j.isDone && j.firstAt === undefined).map(j => j.trophy.id)

/** store から読んだ値を確かめる。形の合わない物は捨てる。オブジェクトでなければ undefined */
export function asFirstAt(v: unknown): ShelfFirstAt | undefined {
  if (!isObj(v)) return undefined
  const known = new Set(TROPHIES.map(t => t.id))
  return Object.fromEntries(Object.entries(v).filter(([id, t]) => known.has(id) && typeof t === 'number' && Number.isFinite(t))) as ShelfFirstAt
}

/**
 * store に書く形。書く直前に読んだ raw のうち、この版の知らない欄 (新しい版のトロフィーの時刻など) を残して mine を重ねる。
 * 古い版のまま動いているセッションが、新しい版の記録を消さないように
 */
export function withUnknown(raw: unknown, mine: ShelfFirstAt): Record<string, unknown> {
  const known = new Set(TROPHIES.map(t => t.id))
  return { ...(isObj(raw) ? Object.fromEntries(Object.entries(raw).filter(([id]) => !known.has(id))) : {}), ...mine }
}

/** 保存済みの物に新しく取った物を足す。先に記録した時刻を残す */
export function addFirst(saved: ShelfFirstAt, ids: readonly string[], now: number): ShelfFirstAt {
  const next = { ...saved }
  for (const id of ids) if (next[id] === undefined) next[id] = now
  return next
}

// ---------------------------------------------------------------- 棚の一言

/** 棚ごとの一言。入っていなければ undefined */
export function shelfText(mod: ShelfMod, s: ShelfSnapshot): string | undefined {
  switch (mod) {
    case 'dev-rpg':
      return s.rpg && `Lv ${s.rpg.level} / 実績 ${s.rpg.achievements} / 勝ち ${s.rpg.wins}`
    case 'turn-gacha':
      return s.gacha && `図鑑 ${s.gacha.owned}${s.gacha.total > 0 ? ` / ${s.gacha.total}` : ''} 種 / SSR ${s.gacha.ssr}`
    case 'aqua-pet':
      return s.aqua && `魚 ${s.aqua.kinds} 種 ${s.aqua.fish} 匹 / ${s.aqua.days} 日目`
    case 'wait-games':
      return s.games && `記録 ${s.games.kinds} 種 / 2048 最高 ${s.games.best2048}`
    case 'daily-quest':
      return s.quest && `連続 ${s.quest.streak} 日 / 通算 ${s.quest.totalDone} 個`
  }
}

const NOT_INSTALLED = '入っていません'

const jst = (ms: number) => new Date(ms + 9 * 3600_000)
/** 日本時間の M/D */
export const dayOf = (ms: number) => `${jst(ms).getUTCMonth() + 1}/${jst(ms).getUTCDate()}`

export const countText = (judged: readonly Judged[]) => `トロフィー ${judged.filter(j => j.isDone).length} / ${judged.length} 個`

// ---------------------------------------------------------------- SVG

const ROW = 40
const CARD_W = 172
const CARD_H = 44
const CARD_GAP = 8

/** 上に棚 5 段(mod ごとの数と、その棚のトロフィーの進み)、下にトロフィーのカード 2 列 */
export function shelfSvg(s: ShelfSnapshot, firstAt: ShelfFirstAt) {
  const judged = judge(s, firstAt)
  let y = HEADER_H + 12
  const out: string[] = [header('実績帳', countText(judged), C.yellow)]

  SHELVES.forEach((mod, k) => {
    const text = shelfText(mod, s)
    const mine = judged.filter(j => j.trophy.mod === mod)
    const done = mine.filter(j => j.isDone).length
    out.push(`<text x="14" y="${y + 15}" font-size="12" font-weight="bold" fill="${text ? C.text : C.dim}">${esc(mod)}</text>`)
    out.push(`<text x="${W - 14}" y="${y + 15}" font-size="12" fill="${C.dim}" text-anchor="end">${done} / ${mine.length}</text>`)
    out.push(`<text x="120" y="${y + 15}" font-size="12" fill="${text ? C.text : C.dim}">${esc(short(text ?? NOT_INSTALLED, 24))}</text>`)
    const barW = W - 28
    out.push(`<rect x="14" y="${y + 24}" width="${barW}" height="6" rx="3" fill="${C.face}"/>`)
    if (done > 0) out.push(growBar(14, y + 24, (barW * done) / mine.length, 6, C.yellow, k * 0.08))
    y += ROW
  })

  y += 8
  out.push(`<text x="14" y="${y + 12}" font-size="12" font-weight="bold" fill="${C.dim}">トロフィー</text>`)
  y += 22
  judged.forEach((j, k) => {
    const x = 14 + (k % 2) * (CARD_W + CARD_GAP)
    const cy = y + Math.floor(k / 2) * (CARD_H + CARD_GAP)
    out.push(fadeIn(card(j, x, cy), 0.3 + k * 0.03))
  })
  const rows = Math.ceil(judged.length / 2)
  const h = y + rows * (CARD_H + CARD_GAP) + 6
  return frame(h, out.join(''))
}

function card(j: Judged, x: number, y: number) {
  const cx = x + 22
  const cy = y + CARD_H / 2
  const parts = [panel(x, y, CARD_W, CARD_H)]
  if (j.isDone) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="15" fill="${C.yellow}"/>`)
    parts.push(`<text x="${cx}" y="${cy + 5}" font-size="14" font-weight="bold" fill="${C.bg}" text-anchor="middle">${esc(j.trophy.glyph)}</text>`)
  } else {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="14.5" fill="none" stroke="${C.line}" stroke-width="1.5" stroke-dasharray="3 3"/>`)
    parts.push(`<text x="${cx}" y="${cy + 5}" font-size="14" fill="${C.dim}" text-anchor="middle">${esc(j.trophy.glyph)}</text>`)
  }
  parts.push(`<text x="${x + 44}" y="${y + 19}" font-size="12" font-weight="bold" fill="${j.isDone ? C.text : C.dim}">${esc(short(j.trophy.name, 10))}</text>`)
  if (j.isDone) {
    parts.push(`<text x="${x + 44}" y="${y + 36}" font-size="12" fill="${C.green}">${j.firstAt === undefined ? '取得' : `${dayOf(j.firstAt)} に取得`}</text>`)
  } else if (!j.isKnown) {
    parts.push(`<text x="${x + 44}" y="${y + 36}" font-size="12" fill="${C.dim}">${NOT_INSTALLED}</text>`)
  } else {
    const barW = 64
    parts.push(`<rect x="${x + 44}" y="${y + 28}" width="${barW}" height="6" rx="3" fill="${C.line}"/>`)
    if (j.cur > 0) parts.push(growBar(x + 44, y + 28, (barW * j.cur) / j.goal, 6, C.blue, 0.4))
    parts.push(`<text x="${x + CARD_W - 10}" y="${y + 36}" font-size="12" fill="${C.dim}" text-anchor="end">${j.cur} / ${j.goal}</text>`)
  }
  return parts.join('')
}

// ---------------------------------------------------------------- terminal

export type Line = { text: string; color?: 'success' | 'warning'; isDim?: boolean; isBold?: boolean }

export function shelfLines(s: ShelfSnapshot, firstAt: ShelfFirstAt): Line[] {
  const judged = judge(s, firstAt)
  const lines: Line[] = [{ text: `実績帳 ${countText(judged)}`, isBold: true }]
  for (const mod of SHELVES) {
    const text = shelfText(mod, s)
    lines.push({ text: `${mod}: ${text ?? NOT_INSTALLED}`, isDim: text === undefined })
  }
  for (const j of judged) {
    if (j.isDone) lines.push({ text: `取得 ${j.trophy.name}${j.firstAt === undefined ? '' : ` (${dayOf(j.firstAt)})`}`, color: 'success' })
    else lines.push({ text: `未取得 ${j.trophy.name} ${j.isKnown ? `${j.cur} / ${j.goal}` : NOT_INSTALLED} (${j.trophy.hint})`, isDim: true })
  }
  return lines
}
