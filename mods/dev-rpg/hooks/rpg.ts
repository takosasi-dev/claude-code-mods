// 経験値・レベル・実績の計算と、ステータス窓の SVG / terminal 用の行。どれも純関数
import type { RpgHero, RpgSaved, RpgSession } from '../types'

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

const TITLES: [number, string][] = [
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

// ---------------------------------------------------------------- 実績

type Check = { h: RpgHero; level: number; isTurnEnd: boolean }
export type Achievement = { id: string; name: string; glyph: string; hint: string; test: (c: Check) => boolean }

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
]

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
}

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

const SAVED_KEYS = ['xp', 'turns', 'tools', 'edits', 'reads', 'shells', 'recoveries', 'errors', 'sessions', 'dayTurns'] as const

export const toSaved = (h: RpgHero): RpgSaved => {
  const out = { ...INITIAL_SAVED, achievements: { ...h.achievements }, day: h.day }
  for (const k of SAVED_KEYS) out[k] = h[k]
  return out
}

/** store の中身は信用しない: 数と文字だけ拾う */
export function fromSaved(raw: unknown): RpgSaved {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const out = { ...INITIAL_SAVED, achievements: {} as Record<string, number> }
  for (const k of SAVED_KEYS) {
    const v = o[k]
    out[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  }
  out.day = typeof o.day === 'string' ? o.day.slice(0, 10) : ''
  const a = o.achievements
  if (typeof a === 'object' && a !== null) {
    for (const { id } of ACHIEVEMENTS) {
      const at = (a as Record<string, unknown>)[id]
      if (typeof at === 'number' && Number.isFinite(at)) out.achievements[id] = at
    }
  }
  return out
}

/**
 * 今の store に、このセッションで増えた分 (mine − base) だけを足す。
 * 数は足し算、実績は和集合 (早い方の時刻)、日付は新しい方。同じ store を使う別のセッションの分を消さない
 */
export function mergeSaved(store: RpgSaved, base: RpgSaved, mine: RpgSaved): RpgSaved {
  const out = { ...store, achievements: { ...store.achievements } }
  for (const k of SAVED_KEYS) out[k] = Math.max(0, store[k] + mine[k] - base[k])
  for (const [id, at] of Object.entries(mine.achievements)) out.achievements[id] = Math.min(at, store.achievements[id] ?? at)
  const day = mine.day > store.day ? mine.day : store.day
  const mineToday = mine.day === day ? mine.dayTurns - (base.day === day ? base.dayTurns : 0) : 0
  out.day = day
  out.dayTurns = Math.max(0, (store.day === day ? store.dayTurns : 0) + mineToday)
  return out
}

/** その時刻の日付 (この環境の時刻帯で YYYY-MM-DD) */
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const hpPctAt = (h: RpgHero, now: number) => Math.max(HP_MIN, 100 - Math.floor(Math.max(0, now - h.s.restedAt) / HP_STEP_MS))

/** 間が空いていたら休んだことにする */
const touch = (s: RpgSession, now: number): RpgSession =>
  now - s.lastActiveAt >= REST_MS ? { ...s, restedAt: now, lastActiveAt: now } : { ...s, lastActiveAt: now }

const gain = (h: RpgHero, xp: number): RpgHero => ({ ...h, xp: h.xp + xp, xpFrom: levelInfo(h.xp).frac })

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
  const next = { ...gain(h, XP.turn), s, turns: h.turns + 1, day, dayTurns: (h.day === day ? h.dayTurns : 0) + 1 }
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
export function grant(h: RpgHero, now: number, isTurnEnd: boolean): { hero: RpgHero; gained: Achievement[] } {
  const level = levelInfo(h.xp).level
  const gained = ACHIEVEMENTS.filter(a => h.achievements[a.id] === undefined && a.test({ h, level, isTurnEnd }))
  if (gained.length === 0) return { hero: h, gained }
  const achievements = { ...h.achievements }
  for (const a of gained) achievements[a.id] = now
  return { hero: { ...h, achievements }, gained }
}

export function statsOf(h: RpgHero) {
  const info = levelInfo(h.xp)
  const maxHp = 40 + info.level * 10
  const maxMp = 20 + info.level * 5
  const tries = h.s.toolOk + h.s.toolErr
  return {
    ...info,
    title: titleOf(info.level),
    maxHp,
    hp: Math.max(1, Math.round((maxHp * h.hpPct) / 100)),
    maxMp,
    mp: tries === 0 ? maxMp : Math.round((maxMp * h.s.toolOk) / tries),
    attack: h.s.edits,
    magic: h.s.reads,
    speed: h.s.shells,
    grit: h.s.recoveries,
    earned: ACHIEVEMENTS.filter(a => h.achievements[a.id] !== undefined).length,
  }
}

export const levelUpText = (level: number) => `レベルアップ! Lv ${level} ${titleOf(level)}`

// ---------------------------------------------------------------- SVG

const W = 380
const C = {
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
}
const MONO = 'ui-monospace, Consolas, monospace'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const svgDoc = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<defs><linearGradient id="win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.winTop}"/><stop offset="1" stop-color="${C.win}"/></linearGradient></defs>` +
  `<rect width="${W}" height="${h}" fill="${C.bg}"/>${body}</svg>`

/** 昔の RPG の窓: 青い地に白い二重の枠 */
const win = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="url(#win)" stroke="${C.frame}" stroke-width="3"/>` +
  `<rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="5" fill="none" stroke="${C.frame}" stroke-opacity="0.45" stroke-width="1"/>`

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

function sprite(x: number, y: number, px: number) {
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
function bar(x: number, y: number, w: number, frac: number, color: string, from?: number) {
  const fw = Math.max(0, Math.min(1, frac)) * w
  const anim =
    from !== undefined && Math.abs(from - frac) > 0.001
      ? `<animate attributeName="width" from="${(Math.max(0, Math.min(1, from)) * w).toFixed(1)}" to="${fw.toFixed(1)}" dur="0.9s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>`
      : ''
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="12" fill="#06103a" stroke="${C.frame}" stroke-opacity="0.6"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, fw - 2).toFixed(1)}" height="10" fill="${color}">${anim}</rect>` +
    `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, fw - 2).toFixed(1)}" height="3" fill="#ffffff" opacity="0.25">${anim}</rect>`
  )
}

function badge(cx: number, cy: number, a: Achievement, isEarned: boolean) {
  if (!isEarned) {
    return (
      `<circle cx="${cx}" cy="${cy}" r="19" fill="${C.off}" stroke="${C.offText}" stroke-dasharray="3 2"/>` +
      `<text x="${cx}" y="${cy + 6}" font-size="17" fill="${C.offText}" text-anchor="middle">${a.glyph}</text>`
    )
  }
  return (
    `<circle cx="${cx}" cy="${cy}" r="19" fill="${C.yellow}" stroke="${C.frame}" stroke-width="2"/>` +
    `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="#ffffff" stroke-opacity="0.5"/>` +
    `<text x="${cx}" y="${cy + 6}" font-size="17" font-weight="bold" fill="#3b2300" text-anchor="middle">${a.glyph}</text>`
  )
}

/** ステータスの画面 */
export function statusSvg(h: RpgHero) {
  const st = statsOf(h)
  let s = ''
  // ── 名前・レベル・称号
  s += win(8, 8, 364, 92)
  s += `<rect x="20" y="20" width="68" height="68" fill="#06103a" stroke="${C.frame}" stroke-opacity="0.5"/>` + sprite(30, 28, 4)
  s += `<text x="102" y="42" font-size="20" font-weight="bold" fill="${C.text}">勇者</text>`
  s += `<text x="160" y="42" font-size="20" font-weight="bold" font-family="${MONO}" fill="${C.text}">Lv ${st.level}</text>`
  s +=
    `<text x="102" y="70" font-size="14" fill="${C.yellow}">` +
    `<tspan>▶</tspan><tspan dx="4" fill="${C.text}">${esc(st.title)}</tspan>` +
    `<animate attributeName="opacity" values="1;1;0.4;1" dur="1.6s" repeatCount="indefinite"/></text>`
  s += `<text x="102" y="90" font-size="12" fill="${C.weak}">冒険 ${h.sessions} 回目 / 累計 ${h.turns} ターン</text>`

  // ── HP / MP / 経験値
  s += win(8, 108, 364, 128)
  const hpColor = h.hpPct > 50 ? C.green : h.hpPct > 25 ? C.yellow : C.red
  const line = (y: number, label: string, frac: number, color: string, value: string, from?: number) =>
    `<text x="24" y="${y + 11}" font-size="14" font-weight="bold" font-family="${MONO}" fill="${C.text}">${label}</text>` +
    bar(64, y, 186, frac, color, from) +
    `<text x="358" y="${y + 11}" font-size="13" font-family="${MONO}" fill="${C.text}" text-anchor="end">${value}</text>`
  s += line(126, 'HP', st.hp / st.maxHp, hpColor, `${st.hp}/${st.maxHp}`)
  s += line(154, 'MP', st.mp / st.maxMp, C.blue, `${st.mp}/${st.maxMp}`)
  s += line(182, 'EX', st.frac, C.purple, st.level >= MAX_LEVEL ? 'MAX' : `${st.into}/${st.need}`, h.xpFrom)
  s +=
    `<text x="24" y="222" font-size="12" fill="${C.weak}">` +
    (st.level >= MAX_LEVEL ? 'これ以上は上がりません' : `つぎのレベルまで ${st.need - st.into}`) +
    `</text><text x="358" y="222" font-size="12" fill="${C.weak}" text-anchor="end">HP は休むと戻る</text>`

  // ── 強さ
  s += win(8, 244, 364, 92)
  const cell = (x: number, y: number, label: string, value: number, note: string) =>
    `<text x="${x}" y="${y}" font-size="13" fill="${C.text}">${label}</text>` +
    `<text x="${x + 150}" y="${y}" font-size="15" font-weight="bold" font-family="${MONO}" fill="${C.text}" text-anchor="end">${value}</text>` +
    `<text x="${x}" y="${y + 16}" font-size="12" fill="${C.weak}">${note}</text>`
  s += cell(24, 270, '攻撃力', st.attack, '編集した回数')
  s += cell(204, 270, '魔力', st.magic, '調べた回数')
  s += cell(24, 312, '素早さ', st.speed, 'コマンドの回数')
  s += cell(204, 312, '根性', st.grit, '立ち直った回数')

  // ── 実績のバッジ
  s += win(8, 344, 364, 126)
  s += `<text x="24" y="368" font-size="13" font-weight="bold" fill="${C.text}">実績</text>`
  s += `<text x="358" y="368" font-size="12" fill="${C.weak}" text-anchor="end">${st.earned} / ${ACHIEVEMENTS.length}</text>`
  ACHIEVEMENTS.forEach((a, i) => {
    const cx = 44 + (i % 6) * 58
    const cy = 398 + Math.floor(i / 6) * 46
    s += badge(cx, cy, a, h.achievements[a.id] !== undefined)
  })
  return svgDoc(478, s)
}

const dateLabel = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 実績の一覧の画面 */
export function achievementsSvg(h: RpgHero) {
  const rowH = 40
  const top = 46
  const height = top + ACHIEVEMENTS.length * rowH + 16
  let s = win(8, 8, 364, height - 8)
  const earned = ACHIEVEMENTS.filter(a => h.achievements[a.id] !== undefined).length
  s += `<text x="24" y="34" font-size="15" font-weight="bold" fill="${C.text}">▶ 実績の書</text>`
  s += `<text x="358" y="34" font-size="12" fill="${C.weak}" text-anchor="end">${earned} / ${ACHIEVEMENTS.length}</text>`
  ACHIEVEMENTS.forEach((a, i) => {
    const y = top + i * rowH
    const at = h.achievements[a.id]
    const isEarned = at !== undefined
    s +=
      `<g transform="translate(0 ${y})">` +
      `<line x1="20" y1="0" x2="360" y2="0" stroke="${C.frame}" stroke-opacity="0.15"/>` +
      `<circle cx="36" cy="20" r="13" fill="${isEarned ? C.yellow : C.off}" stroke="${isEarned ? C.frame : C.offText}"/>` +
      `<text x="36" y="25" font-size="13" font-weight="bold" fill="${isEarned ? '#3b2300' : C.offText}" text-anchor="middle">${a.glyph}</text>` +
      `<text x="58" y="17" font-size="13" font-weight="bold" fill="${isEarned ? C.text : C.offText}">${esc(a.name)}</text>` +
      `<text x="58" y="33" font-size="12" fill="${isEarned ? C.weak : C.offText}">${esc(a.hint)}</text>` +
      `<text x="358" y="17" font-size="12" fill="${isEarned ? C.yellow : C.offText}" text-anchor="end">${isEarned ? dateLabel(at) : 'まだ'}</text>` +
      `</g>`
  })
  return svgDoc(height + 8, s)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う行 (ステータス) */
export function statusLines(h: RpgHero): Line[] {
  const st = statsOf(h)
  const marks = ACHIEVEMENTS.map(a => (h.achievements[a.id] !== undefined ? '●' : '○')).join('')
  return [
    { text: `勇者 Lv ${st.level} ${st.title}`, isBold: true },
    { text: `HP ${st.hp}/${st.maxHp}  MP ${st.mp}/${st.maxMp}`, color: h.hpPct > 25 ? undefined : 'red' },
    { text: st.level >= MAX_LEVEL ? '経験値 MAX' : `経験値 ${st.into}/${st.need} (つぎまで ${st.need - st.into})`, color: 'magenta' },
    { text: `攻撃力 ${st.attack}  魔力 ${st.magic}  素早さ ${st.speed}  根性 ${st.grit}` },
    { text: `実績 ${st.earned}/${ACHIEVEMENTS.length} ${marks}`, color: 'yellow' },
    { text: `冒険 ${h.sessions} 回目 / 累計 ${h.turns} ターン`, isDim: true },
  ]
}

/** 実績の一覧の行 */
export const achievementLines = (h: RpgHero): Line[] =>
  ACHIEVEMENTS.map(a => {
    const at = h.achievements[a.id]
    return at !== undefined
      ? { text: `● ${a.name} (${dateLabel(at)}) ${a.hint}`, color: 'yellow' }
      : { text: `○ ${a.name} ─ ${a.hint}`, isDim: true }
  })
