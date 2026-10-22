// 週のカードの純関数(他の mod の state を確かめる・日ごとの写しの足し方・増えた数・SVG・terminal の行・週報の文)
import type { WeekSnap, WeekSnaps, WeekUsageDay } from '../types'
import { C, HEADER_H, W, countUp, esc, fadeIn, frame, growColumn, header, panel } from './style'

const DAY = 86_400_000
/** store に残す日数 */
export const KEEP_DAYS = 30
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const WEEK = ['日', '月', '火', '水', '木', '金', '土']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** 日本時間の 'YYYY-MM-DD' */
export const dayKey = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10)

/** 'YYYY-MM-DD' → '10/18(土)' */
export function dayLabel(key: string, withWeek = true) {
  const d = new Date(`${key}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}${withWeek ? `(${WEEK[d.getUTCDay()]})` : ''}`
}

/** 1 万を超えたら「万」、1 億を超えたら「億」で 1 桁 */
export function fmtNum(n: number) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}億`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return Number.isInteger(n) || n >= 100 ? String(Math.round(n)) : n.toFixed(1)
}

/** 分 → '5 時間 12 分' / '45 分' */
export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} 時間 ${Math.round(m % 60)} 分` : `${Math.round(m)} 分`)

// dev-rpg の hooks/rpg.ts の xpToReach と MAX_LEVEL の写し。dev-rpg が式を変えたら合わせる
const MAX_LEVEL = 99
const xpToReach = (level: number) => 40 * (level - 1) + 10 * level * (level - 1)
export function levelOf(xp: number) {
  let level = 1
  while (level < MAX_LEVEL && xp >= xpToReach(level + 1)) level++
  return level
}

// ---------------------------------------------------------------- 他の mod の state を確かめる

/** 他の mod から読んだ生の値。読めなかった物は undefined */
export type WeekRaw = {
  week?: unknown
  hero?: unknown
  save?: unknown
  cards?: unknown
  tank?: unknown
  streak?: unknown
  totalDone?: unknown
}

/** 生の値から今の累計の数を作る。形の合わない mod は「入っていない」と同じに扱い、欄を作らない */
export function snapOf(raw: WeekRaw): WeekSnap {
  const s: WeekSnap = {}
  const hero = raw.hero
  if (isObj(hero) && typeof hero.xp === 'number') {
    s.level = levelOf(num(hero.xp))
    // 一番深い階は dev-rpg 0.6.0 から。無い版では読まない
    if (typeof hero.deepest === 'number') s.deepest = num(hero.deepest)
  }
  const save = raw.save
  if (isObj(save) && isObj(save.book)) {
    const book = Object.entries(save.book).filter(([, o]) => isObj(o) && num(o.count) > 0).map(([id]) => id)
    // カードの表が読めれば表にある物だけを数える(消えたカードは数えない)
    const ids = Array.isArray(raw.cards) ? new Set(raw.cards.filter(isObj).map(c => String(c.id))) : undefined
    s.cards = ids && ids.size > 0 ? book.filter(id => ids.has(id)).length : book.length
  }
  const tank = raw.tank
  if (isObj(tank) && Array.isArray(tank.fish)) s.fish = tank.fish.filter(isObj).length
  if (typeof raw.totalDone === 'number') s.quests = num(raw.totalDone)
  if (typeof raw.streak === 'number') s.streak = num(raw.streak)
  return s
}

/**
 * usage-history の week から、今日で終わる 7 日 (古い順) を作る。日付で合わせるので、week が昨日のままでも今日は 0。
 * usage-history が入っていない (week が配列でない) 時は undefined
 */
export function usageOf(week: unknown, now: number): WeekUsageDay[] | undefined {
  if (!Array.isArray(week)) return undefined
  const byDay = new Map(week.filter(isObj).filter(d => typeof d.day === 'string' && DATE_RE.test(d.day)).map(d => [d.day as string, d]))
  return Array.from({ length: 7 }, (_, k) => {
    const day = dayKey(now - (6 - k) * DAY)
    const d = byDay.get(day) ?? {}
    return { day, turns: num(d.turns), tools: num(d.tools), inputTokens: num(d.inputTokens), outputTokens: num(d.outputTokens), minutes: num(d.minutes) }
  })
}

// ---------------------------------------------------------------- 日ごとの写し

const SNAP_KEYS = ['level', 'deepest', 'cards', 'fish', 'quests', 'streak'] as const

function snapFrom(v: unknown): WeekSnap {
  const out: WeekSnap = {}
  if (!isObj(v)) return out
  for (const k of SNAP_KEYS) if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k] as number
  return out
}

/** store から読んだ値を確かめる。日付のキーだけ。オブジェクトでなければ undefined */
export function asSnaps(v: unknown): WeekSnaps | undefined {
  if (!isObj(v)) return undefined
  return Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => DATE_RE.test(k))
      .map(([k, s]) => [k, snapFrom(s)]),
  )
}

/** 今日の写しが store の物と同じか (同じなら書かない) */
export const isSameSnap = (a: WeekSnap | undefined, b: WeekSnap) => SNAP_KEYS.every(k => a?.[k] === b[k])

/**
 * store に書く形。書く直前に読んだ raw に今日の写しを重ねる。
 * この版の知らない欄 (日付でないキー・日の中の知らない数) はそのまま残し、新しい KEEP_DAYS 日だけ残す (刈り込んだ古い日は戻さない)。
 * 入っていない mod の欄は今日の写しに無いので、別のセッションが書いた値が残る
 */
export function withSnap(raw: unknown, day: string, snap: WeekSnap): Record<string, unknown> {
  const o = isObj(raw) ? raw : {}
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(o).filter(([k]) => !DATE_RE.test(k)))
  const days = [...new Set([...Object.keys(o).filter(k => DATE_RE.test(k)), day])].sort().slice(-KEEP_DAYS)
  for (const k of days) out[k] = k === day ? { ...(isObj(o[k]) ? o[k] : {}), ...snap } : o[k]
  return out
}

/**
 * 増えた数の比べる元。7 日前の写し (その日の終わり = この 1 週間の始まり)。
 * 無ければ、それより後で今日より前の一番古い写し。それも無ければ undefined
 */
export function baseOf(snaps: WeekSnaps, now: number): { day: string; snap: WeekSnap } | undefined {
  const from = dayKey(now - 7 * DAY)
  const today = dayKey(now)
  const day = Object.keys(snaps)
    .filter(k => k >= from && k < today)
    .sort()[0]
  return day === undefined ? undefined : { day, snap: snaps[day] ?? {} }
}

// ---------------------------------------------------------------- 増えた物の行

export type GrowthRow = { key: (typeof SNAP_KEYS)[number]; label: string; value: string; delta: number | undefined; color: string }

const ROWS: { key: (typeof SNAP_KEYS)[number]; label: string; unit: (n: number) => string; color: () => string; hasDelta: boolean }[] = [
  { key: 'level', label: '冒険の書', unit: n => `Lv ${n}`, color: () => C.purple, hasDelta: true },
  { key: 'deepest', label: 'ダンジョン', unit: n => `${n} 階`, color: () => C.orange, hasDelta: true },
  { key: 'cards', label: 'ガチャの図鑑', unit: n => `${n} 種`, color: () => C.yellow, hasDelta: true },
  { key: 'fish', label: '水槽の魚', unit: n => `${n} 匹`, color: () => C.blue, hasDelta: true },
  { key: 'quests', label: 'こなしたお題', unit: n => `${n} 個`, color: () => C.green, hasDelta: true },
  // 連続日数は途切れると 0 に戻るので、増えた数は出さない
  { key: 'streak', label: 'お題の連続', unit: n => `${n} 日`, color: () => C.green, hasDelta: false },
]

/** 今の写しにある物だけ、行にする。base が無ければ増えた数は出さない (元の写しに無い欄は 0 から) */
export function growthRows(now: WeekSnap, base: WeekSnap | undefined): GrowthRow[] {
  return ROWS.flatMap(r => {
    const v = now[r.key]
    if (v === undefined) return []
    return [{ key: r.key, label: r.label, value: r.unit(v), delta: r.hasDelta && base ? v - (base[r.key] ?? 0) : undefined, color: r.color() }]
  })
}

const deltaText = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `${d}` : '±0')

// ---------------------------------------------------------------- 1 週間の使い方のまとめ

export function usageSummary(days: readonly WeekUsageDay[]) {
  const sum = (f: (d: WeekUsageDay) => number) => days.reduce((a, d) => a + f(d), 0)
  let top: WeekUsageDay | undefined
  for (const d of days) if (d.turns > 0 && (top === undefined || d.turns >= top.turns)) top = d
  return {
    turns: sum(d => d.turns),
    tools: sum(d => d.tools),
    inputTokens: sum(d => d.inputTokens),
    outputTokens: sum(d => d.outputTokens),
    minutes: sum(d => d.minutes),
    activeDays: days.filter(d => d.turns > 0).length,
    top,
  }
}

/** '10/16〜10/22' */
export const rangeText = (now: number) => `${dayLabel(dayKey(now - 6 * DAY), false)}〜${dayLabel(dayKey(now), false)}`

/** カードの見出しの下の一文 (Svg の alt・terminal の 1 行目) */
export function summaryText(now: number, usage: WeekUsageDay[] | undefined) {
  if (!usage) return `今週のカード ${rangeText(now)}`
  const u = usageSummary(usage)
  return `今週のカード ${rangeText(now)} ターン ${fmtNum(u.turns)} / 作業 ${fmtMinutes(u.minutes)}`
}

const NO_USAGE = 'usage-history を入れると 1 週間の使い方が出ます'
const NO_GROWTH = 'daily-quest・turn-gacha・dev-rpg・aqua-pet を入れると、増えた物が出ます'
const baseText = (base: { day: string } | undefined) =>
  base ? `${dayLabel(base.day)} の終わりから` : '増えた数は、明日から出ます (写しは今日から)'

// ---------------------------------------------------------------- SVG

/** 1 枚のカード。上に 1 週間の使い方 (3 つの数と日ごとの縦棒)、下にこの 1 週間で増えた物 */
export function cardSvg(now: number, usage: WeekUsageDay[] | undefined, snap: WeekSnap, base: { day: string; snap: WeekSnap } | undefined) {
  const parts: string[] = [header('今週のカード', rangeText(now), C.blue)]
  let y = HEADER_H + 10

  if (usage) {
    const u = usageSummary(usage)
    const tileW = (W - 14 * 2 - 10 * 2) / 3
    const tiles: [string, number, (n: number) => string][] = [
      ['ターン', u.turns, fmtNum],
      ['作業時間', u.minutes, fmtMinutes],
      ['ツール', u.tools, fmtNum],
    ]
    tiles.forEach(([label, n, f], k) => {
      const x = 14 + k * (tileW + 10)
      parts.push(panel(x, y, tileW, 54))
      parts.push(`<text x="${(x + 10).toFixed(1)}" y="${y + 19}" font-size="12" fill="${C.dim}">${esc(label)}</text>`)
      parts.push(countUp(n, `x="${(x + 10).toFixed(1)}" y="${y + 42}" font-size="${k === 1 ? 14 : 20}" font-weight="bold" fill="${C.text}"`, f, k * 0.1))
    })
    y += 54 + 22
    parts.push(`<text x="14" y="${y}" font-size="12" fill="${C.dim}">${esc(`使った日 ${u.activeDays} / 7 日・出力 ${fmtNum(u.outputTokens)} トークン`)}</text>`)

    // 日ごとのターン数。いちばん多かった日は黄色、今日は青、ほかは緑
    const chartH = 64
    const bottom = y + 18 + chartH
    const gap = 8
    const colW = (W - 14 * 2 - gap * 6) / 7
    const max = Math.max(1, ...usage.map(d => d.turns))
    parts.push(`<line x1="14" y1="${bottom}" x2="${W - 14}" y2="${bottom}" stroke="${C.line}"/>`)
    usage.forEach((d, k) => {
      const x = 14 + k * (colW + gap)
      const h = d.turns === 0 ? 0 : Math.max(2, ((chartH - 16) * d.turns) / max)
      const fill = u.top?.day === d.day ? C.yellow : k === usage.length - 1 ? C.blue : C.green
      parts.push(growColumn(x, bottom, colW, h, fill, k * 0.05))
      if (d.turns > 0) parts.push(fadeIn(`<text x="${(x + colW / 2).toFixed(1)}" y="${bottom - h - 4}" font-size="12" fill="${C.text}" text-anchor="middle">${esc(fmtNum(d.turns))}</text>`, 0.5))
      parts.push(`<text x="${(x + colW / 2).toFixed(1)}" y="${bottom + 16}" font-size="12" fill="${C.dim}" text-anchor="middle">${esc(dayLabel(d.day, false))}</text>`)
    })
    y = bottom + 16 + 14
  } else {
    y += 14
    parts.push(`<text x="14" y="${y}" font-size="12" fill="${C.dim}">${esc(NO_USAGE)}</text>`)
    y += 12
  }

  // この 1 週間で増えた物
  const rows = growthRows(snap, base?.snap)
  y += 16
  parts.push(`<text x="14" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">この 1 週間で増えた物</text>`)
  y += 8
  if (rows.length === 0) {
    // 1 行では幅 380 に収まらないので 2 行に分ける
    for (const s of ['daily-quest・turn-gacha・dev-rpg・aqua-pet', 'を入れると、増えた物が出ます']) {
      y += 18
      parts.push(`<text x="14" y="${y}" font-size="12" fill="${C.dim}">${esc(s)}</text>`)
    }
    return frame(y + 16, parts.join(''))
  }
  const rowH = 28
  parts.push(panel(14, y, W - 28, rows.length * rowH + 8))
  rows.forEach((r, k) => {
    const ry = y + 4 + k * rowH
    const body = [
      `<rect x="24" y="${ry + 8}" width="4" height="${rowH - 16}" rx="2" fill="${r.color}"/>`,
      `<text x="36" y="${ry + 19}" font-size="12" fill="${C.dim}">${esc(r.label)}</text>`,
      `<text x="250" y="${ry + 19}" font-size="14" font-weight="bold" fill="${C.text}" text-anchor="end">${esc(r.value)}</text>`,
      r.delta === undefined
        ? ''
        : `<text x="${W - 26}" y="${ry + 19}" font-size="13" font-weight="bold" fill="${r.delta > 0 ? C.green : r.delta < 0 ? C.red : C.dim}" text-anchor="end">${esc(deltaText(r.delta))}</text>`,
    ].join('')
    parts.push(fadeIn(body, 0.3 + k * 0.06))
  })
  y += rows.length * rowH + 8 + 18
  parts.push(`<text x="14" y="${y}" font-size="12" fill="${C.dim}">${esc(baseText(base))}</text>`)
  return frame(y + 14, parts.join(''))
}

// ---------------------------------------------------------------- terminal の行

export type CardLine = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

export function cardLines(now: number, usage: WeekUsageDay[] | undefined, snap: WeekSnap, base: { day: string; snap: WeekSnap } | undefined): CardLine[] {
  const out: CardLine[] = [{ text: `今週のカード ${rangeText(now)}`, isBold: true }]
  if (usage) {
    const u = usageSummary(usage)
    out.push({ text: `ターン ${fmtNum(u.turns)} / 作業 ${fmtMinutes(u.minutes)} / ツール ${fmtNum(u.tools)}` })
    out.push({ text: `使った日 ${u.activeDays} / 7 日・出力 ${fmtNum(u.outputTokens)} トークン`, isDim: true })
    if (u.top) out.push({ text: `いちばん多かった日 ${dayLabel(u.top.day)} ${fmtNum(u.top.turns)} ターン`, isDim: true })
  } else {
    out.push({ text: NO_USAGE, isDim: true })
  }
  out.push({ text: 'この 1 週間で増えた物', isBold: true })
  const rows = growthRows(snap, base?.snap)
  if (rows.length === 0) out.push({ text: NO_GROWTH, isDim: true })
  for (const r of rows) out.push({ text: `${r.label} ${r.value}${r.delta === undefined ? '' : ` (${deltaText(r.delta)})`}` })
  if (rows.length > 0) out.push({ text: baseText(base), isDim: true })
  return out
}

// ---------------------------------------------------------------- 週報に貼る文

/** 週報に貼る Markdown。入っていない mod の行は出さない */
export function reportMd(now: number, usage: WeekUsageDay[] | undefined, snap: WeekSnap, base: { day: string; snap: WeekSnap } | undefined) {
  const lines = [`## 今週の Claude Code (${rangeText(now)})`, '']
  if (usage) {
    const u = usageSummary(usage)
    const top = u.top ? `、いちばん多かった日 ${dayLabel(u.top.day)} ${fmtNum(u.top.turns)} ターン` : ''
    lines.push(`- ターン ${fmtNum(u.turns)} 回 (1 日平均 ${fmtNum(u.turns / 7)}${top})`)
    lines.push(`- 作業時間 ${fmtMinutes(u.minutes)} / ツール ${fmtNum(u.tools)} 回 / 使った日 ${u.activeDays} 日`)
    lines.push(`- トークン 入力 ${fmtNum(u.inputTokens)} / 出力 ${fmtNum(u.outputTokens)}`)
  }
  const rows = growthRows(snap, base?.snap)
  for (const r of rows) lines.push(`- ${r.label} ${r.value}${r.delta === undefined ? '' : ` (${deltaText(r.delta)})`}`)
  if (rows.length > 0 && base) lines.push('', `増えた数は ${dayLabel(base.day)} の終わりとの比べです。`)
  return lines.join('\n')
}
