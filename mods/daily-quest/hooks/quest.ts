// お題の表・日付から決まる選び方・数え方・保存の形・SVG と terminal 用の行。どれも純関数
import type { Quest, QuestCounts, QuestDay, QuestKind, QuestReward, QuestSave } from '../types'
import { C, countUp, esc, frame, growBar, header, HEADER_H, panel } from './style'

// ---------------------------------------------------------------- 日付 (JST)

/** JST の日付 `YYYY-MM-DD` (Date のタイムゾーンに頼らない) */
export const jstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)

/** date で終わる直近 n 日 (古い順) */
export function lastDays(date: string, n = 7) {
  const t = Date.parse(`${date}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

const prevDay = (date: string) => lastDays(date, 2)[0]!

/** 10/21 の形 */
export const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

// ---------------------------------------------------------------- お題の表

type Kind = { kind: QuestKind; title: (n: number) => string; goals: readonly [number, number, number] }

/** お題の種類。ふつうに作業していればこなせる物だけ。goals は易しい順 */
export const KINDS: readonly Kind[] = [
  { kind: 'turns', title: n => `ターンを ${n} 回終える`, goals: [5, 10, 15] },
  { kind: 'edits', title: n => `ファイルを ${n} 回直す`, goals: [5, 10, 20] },
  { kind: 'tests', title: n => `テストを ${n} 回走らせる`, goals: [1, 2, 3] },
  { kind: 'commits', title: n => `コミットを ${n} 回する`, goals: [1, 2, 3] },
  { kind: 'clean', title: n => `失敗なしのターンを ${n} 回`, goals: [3, 5, 8] },
  { kind: 'newFiles', title: n => `新しいファイルを ${n} 個作る`, goals: [1, 2, 3] },
  { kind: 'reads', title: n => `ファイルを ${n} 回調べる`, goals: [10, 20, 30] },
  { kind: 'shells', title: n => `コマンドを ${n} 回実行する`, goals: [5, 10, 15] },
]

/** ごほうびは難しさ (goals の何番目か) で決まる。経験値は dev-rpg の 1 レベル (60 から) の半分くらいまで */
export const REWARDS: readonly [QuestReward, QuestReward, QuestReward] = [
  { exp: 20, pulls: 1 },
  { exp: 35, pulls: 1 },
  { exp: 50, pulls: 2 },
]

export const PER_DAY = 3

// 乱数 (FNV-1a で種を作り、mulberry32 で回す)
function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type QuestPick = { kind: QuestKind; id: string; title: string; goal: number; reward: QuestReward }

/** その日のお題 3 つ。日付だけから決まる (同じ日なら何度呼んでも同じ) */
export function questsFor(date: string): QuestPick[] {
  const r = rng(hash(`daily-quest|${date}`))
  const pool = [...KINDS]
  const out: QuestPick[] = []
  for (let i = 0; i < PER_DAY && pool.length > 0; i++) {
    const k = pool.splice(Math.floor(r() * pool.length), 1)[0]!
    const tier = Math.min(2, Math.floor(r() * 3))
    const goal = k.goals[tier]!
    out.push({ kind: k.kind, id: `${k.kind}-${goal}`, title: k.title(goal), goal, reward: { ...REWARDS[tier]! } })
  }
  return out
}

/** その日の数からお題の進みを作る (進みは goal で止める) */
export function dayOf(date: string, counts: QuestCounts): QuestDay {
  return {
    date,
    quests: questsFor(date).map(({ id, title, goal, reward, kind }): Quest => {
      const progress = Math.min(goal, counts[kind] ?? 0)
      return { id, title, goal, progress, done: progress >= goal, reward }
    }),
  }
}

// ---------------------------------------------------------------- 数え方

const KIND_IDS = KINDS.map(k => k.kind)
const EDITORS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READERS = new Set(['Read', 'Grep', 'Glob'])
const SHELLS = new Set(['Bash', 'PowerShell'])

/** テストを走らせるコマンドか (中身は見ない。名前の形だけ) */
const TEST_RES = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/,
  /\b(?:cargo|go|dotnet|deno|bun|mix|swift|flutter|zig)\s+test\b/,
  /\b(?:pytest|jest|vitest|mocha|phpunit|rspec|ctest|tox)\b/,
  /\bpython[0-9.]*\s+-m\s+(?:pytest|unittest)\b/,
  /\bnode\s+--test\b/,
  /\bplugin\s+test\b/,
  /\b(?:gradlew?|mvn)\b[^|;&\n]*\btest\b/,
  /\bInvoke-Pester\b/i,
]
export const isTestCommand = (cmd: string) => TEST_RES.some(re => re.test(cmd))
/** git commit (git と commit の間にオプションがあってもよい) */
export const isCommitCommand = (cmd: string) => /\bgit\b[^|;&\n]*\scommit\b/.test(cmd)

/**
 * ツール 1 回で増える数。テストは落ちても「走らせた」に数える。
 * isNew は Write の前にファイルが無かった時だけ true
 */
export function countTool(tool: string, command: string, isError: boolean, isNew: boolean): QuestCounts {
  const out: QuestCounts = {}
  const isShell = SHELLS.has(tool)
  if (isShell && isTestCommand(command)) out.tests = 1
  if (isError) return out
  if (EDITORS.has(tool)) out.edits = 1
  if (tool === 'Write' && isNew) out.newFiles = 1
  if (READERS.has(tool)) out.reads = 1
  if (isShell) {
    out.shells = 1
    if (isCommitCommand(command)) out.commits = 1
  }
  return out
}

/** 答えて終わったメインのターン 1 回で増える数 */
export const countTurn = (errors: number): QuestCounts => (errors === 0 ? { turns: 1, clean: 1 } : { turns: 1 })

export const addCounts = (a: QuestCounts, b: QuestCounts): QuestCounts => {
  const out: QuestCounts = { ...a }
  for (const k of KIND_IDS) if (b[k]) out[k] = (out[k] ?? 0) + b[k]!
  return out
}

/** a から b を引く (0 になった種類は消す) */
export const subCounts = (a: QuestCounts, b: QuestCounts): QuestCounts => {
  const out: QuestCounts = {}
  for (const k of KIND_IDS) {
    const n = (a[k] ?? 0) - (b[k] ?? 0)
    if (n > 0) out[k] = n
  }
  return out
}

export const isEmpty = (c: QuestCounts) => KIND_IDS.every(k => !c[k])

// ---------------------------------------------------------------- 保存の形

export const EMPTY: QuestSave = { days: {}, fullDays: [], totalDone: 0 }
const KEEP_DAYS = 7
const KEEP_FULL = 400
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** store から読んだ値を形にそろえる。知らない種類や壊れた値は捨てる */
export function fromSaved(raw: unknown): QuestSave {
  if (typeof raw !== 'object' || raw === null) return EMPTY
  const o = raw as Record<string, unknown>
  const days: QuestSave['days'] = {}
  if (typeof o.days === 'object' && o.days !== null)
    for (const [date, v] of Object.entries(o.days as Record<string, unknown>)) {
      if (!DATE_RE.test(date) || typeof v !== 'object' || v === null) continue
      const c: QuestCounts = {}
      for (const k of KIND_IDS) if (num((v as Record<string, unknown>)[k]) > 0) c[k] = num((v as Record<string, unknown>)[k])
      days[date] = c
    }
  const fullDays = Array.isArray(o.fullDays) ? [...new Set(o.fullDays.filter((d): d is string => typeof d === 'string' && DATE_RE.test(d)))].sort().slice(-KEEP_FULL) : []
  return { days, fullDays, totalDone: num(o.totalDone) }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** raw のうち known に無い欄 (この版が知らない、新しい版が書いた物)。物でなければ空 */
export function unknownOf(raw: unknown, known: Iterable<string>): Record<string, unknown> {
  if (!isObj(raw)) return {}
  const k = new Set(known)
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !k.has(key)))
}

/**
 * store に書く形。書く直前に読んだ raw のうち、この版の知らない欄 (新しい版の欄・日付でないキー・知らないお題の種類の数) を残して mine を重ねる。
 * 古い版のまま動いているセッションが、新しい版の記録を消さないように。刈り込んだ古い日は戻さない
 */
export function withUnknown(raw: unknown, mine: QuestSave): Record<string, unknown> {
  const o = isObj(raw) ? raw : {}
  const was = isObj(o.days) ? o.days : {}
  const days = unknownOf(was, Object.keys(was).filter(d => DATE_RE.test(d)))
  for (const [d, c] of Object.entries(mine.days)) days[d] = { ...unknownOf(was[d], KIND_IDS), ...c }
  return { ...unknownOf(o, Object.keys(EMPTY)), ...mine, days }
}

/**
 * 今の store に、まだ流していない数 (その日の分) を足す。
 * 新しくこなしたお題と、その日のお題を全部こなしたところかを返す
 */
export function applyPending(save: QuestSave, date: string, pending: QuestCounts) {
  const before = dayOf(date, save.days[date] ?? {})
  const counts = addCounts(save.days[date] ?? {}, pending)
  const after = dayOf(date, counts)
  const newly = after.quests.filter((q, i) => q.done && !before.quests[i]?.done)
  const isFull = after.quests.every(q => q.done) && !before.quests.every(q => q.done)
  const keep = new Set(lastDays(date, KEEP_DAYS))
  const days: QuestSave['days'] = {}
  for (const [d, c] of Object.entries({ ...save.days, [date]: counts })) if (keep.has(d) || d > date) days[d] = c
  const fullDays = isFull ? [...new Set([...save.fullDays, date])].sort().slice(-KEEP_FULL) : save.fullDays
  return { next: { days, fullDays, totalDone: save.totalDone + newly.length } as QuestSave, newly, isFull }
}

/** 全部こなした日が続いている日数。今日がまだなら昨日から数える (今日の途中で 0 にしない) */
export function streakOf(fullDays: readonly string[], today: string) {
  const set = new Set(fullDays)
  let d = set.has(today) ? today : prevDay(today)
  let n = 0
  while (set.has(d)) {
    n++
    d = prevDay(d)
  }
  return n
}

// ---------------------------------------------------------------- 描画

export const rewardText = (r: QuestReward) => `経験値 +${r.exp} / ガチャ ${r.pulls} 回`
export const HINT = 'ごほうびは dev-rpg と turn-gacha が受け取ります'

/** ペインの絵: お題 3 つの進みの棒・ごほうび・連続日数と直近 7 日 */
export function paneSvg(day: QuestDay, streak: number, totalDone: number, fullDays: readonly string[]): string {
  let b = header('きょうのお題', day.date === '' ? '' : `${md(day.date)} 連続 ${streak} 日`, C.yellow)
  let y = HEADER_H + 10
  if (day.quests.length === 0) {
    b += `<text x="190" y="${y + 24}" font-size="13" fill="${C.weak}" text-anchor="middle">お題を読み込んでいます</text>`
    y += 40
  }
  day.quests.forEach((q, i) => {
    const frac = q.goal > 0 ? Math.min(1, q.progress / q.goal) : 0
    b += panel(8, y, 364, 74)
    b += `<rect x="8" y="${y + 12}" width="4" height="50" rx="2" fill="${q.done ? C.green : C.line}"/>`
    b += `<text x="24" y="${y + 25}" font-size="14" font-weight="bold" fill="${C.text}">${esc(q.title)}</text>`
    b += `<text x="358" y="${y + 25}" font-size="13" font-weight="bold" fill="${q.done ? C.green : C.dim}" text-anchor="end">${q.done ? '達成' : `${q.progress} / ${q.goal}`}</text>`
    b += `<rect x="24" y="${y + 35}" width="334" height="10" rx="5" fill="${C.bg}" stroke="${C.line}"/>`
    if (frac > 0) b += growBar(24, y + 35, 334 * frac, 10, q.done ? C.green : C.blue, i * 0.15)
    b += `<text x="24" y="${y + 63}" font-size="12" fill="${C.weak}">ごほうび ${rewardText(q.reward)}</text>`
    y += 82
  })

  // 連続日数と通算、直近 7 日 (全部こなした日を緑に)
  b += panel(8, y, 364, 112)
  b += `<text x="24" y="${y + 22}" font-size="12" fill="${C.weak}">連続</text>`
  b += countUp(streak, `x="24" y="${y + 52}" font-size="26" font-weight="bold" fill="${streak > 0 ? C.yellow : C.dim}"`, n => `${n} 日`)
  b += `<text x="200" y="${y + 22}" font-size="12" fill="${C.weak}">通算でこなしたお題</text>`
  b += countUp(totalDone, `x="200" y="${y + 52}" font-size="26" font-weight="bold" fill="${C.text}"`, n => `${n} 個`)
  const full = new Set(fullDays)
  lastDays(day.date === '' ? '1970-01-01' : day.date, 7).forEach((d, i) => {
    const x = 24 + i * 48
    const isToday = d === day.date
    b +=
      `<rect x="${x}" y="${y + 66}" width="40" height="16" rx="4" fill="${full.has(d) ? C.green : C.bg}" stroke="${isToday ? C.yellow : C.line}"${isToday ? ' stroke-width="2"' : ''}/>` +
      `<text x="${x + 20}" y="${y + 100}" font-size="12" fill="${isToday ? C.text : C.weak}" text-anchor="middle">${md(d)}</text>`
  })
  y += 120
  b += `<text x="190" y="${y + 10}" font-size="12" fill="${C.weak}" text-anchor="middle">${HINT}</text>`
  return frame(y + 24, b)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う行 */
export function paneLines(day: QuestDay, streak: number, totalDone: number, fullDays: readonly string[]): Line[] {
  const week = day.date === '' ? 0 : lastDays(day.date, 7).filter(d => fullDays.includes(d)).length
  return [
    { text: `きょうのお題 ${day.date === '' ? '' : md(day.date)} 連続 ${streak} 日 通算 ${totalDone} 個`, isBold: true },
    ...day.quests.map(
      (q): Line => ({
        text: `${q.done ? '達成' : 'まだ'} ${q.title} ${q.progress}/${q.goal} ごほうび ${rewardText(q.reward)}`,
        color: q.done ? 'green' : undefined,
      }),
    ),
    { text: `この 7 日で全部こなした日 ${week} 日`, isDim: true },
    { text: HINT, isDim: true },
  ]
}
