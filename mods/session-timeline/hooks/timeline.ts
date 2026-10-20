// ターンとツールの区間から、SVG と terminal 用の行を組む。どれも純関数(shots.mts が node で直に読む)
import type { TimelineTurn } from '../types'
import { C, HEADER_H, W, clean, esc, frame, growBar, header, panel, short } from './style'

/** 描く行の数。古い物は「ほか n ターン」 */
export const SHOW = 12
/** これより長いターンは目立たせる */
export const LONG_MS = 60_000
/** 1 行に描く区間の上限 (SVG の source を 131,072 字に収める) */
const MAX_SEGS = 60

export type KindId = 'run' | 'edit' | 'look' | 'agent' | 'other'

/** ツールの種類。赤は失敗の印に取っておく。色は呼ぶたびに C から読む (テーマで変わる) */
export const KINDS: { id: KindId; label: string; color: () => string; tools: string[] }[] = [
  { id: 'run', label: '実行', color: () => C.orange, tools: ['Bash', 'PowerShell'] },
  { id: 'edit', label: '編集', color: () => C.blue, tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] },
  { id: 'look', label: '調べ', color: () => C.purple, tools: ['Read', 'Grep', 'Glob'] },
  { id: 'agent', label: 'エージェント', color: () => C.green, tools: ['Agent', 'Task'] },
  { id: 'other', label: 'その他', color: () => C.dim, tools: [] },
]

export const kindOf = (tool: string): KindId => KINDS.find(k => k.tools.includes(tool))?.id ?? 'other'
const kind = (id: KindId) => KINDS.find(k => k.id === id) ?? KINDS[KINDS.length - 1]!

/** 時刻 10:42 (動いている環境のローカル時刻) */
export const hm = (ms: number) => {
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 所要時間 8秒 / 1分5秒 / 1時間5分 */
export const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}分${s % 60}秒` : `${m}分`
  return `${Math.floor(m / 60)}時間${m % 60}分`
}

const endOf = (x: { end?: number }, now: number) => x.end ?? now
export const lenOf = (t: TimelineTurn, now: number) => Math.max(0, endOf(t, now) - t.start)

export type Totals = { totalMs: number; turns: number; tools: number; subs: number; errors: number; isRunning: boolean }

/** ターン数は reason が 'answer' の物だけ。時間は全部の行の長さの和 */
export const totalsOf = (turns: readonly TimelineTurn[], now: number): Totals => ({
  totalMs: turns.reduce((n, t) => n + lenOf(t, now), 0),
  turns: turns.filter(t => t.reason === 'answer').length,
  tools: turns.reduce((n, t) => n + t.tools.length, 0),
  subs: turns.reduce((n, t) => n + t.tools.filter(x => x.isSub).length, 0),
  errors: turns.reduce((n, t) => n + t.tools.filter(x => x.isError).length, 0),
  isRunning: turns.some(t => t.end === undefined),
})

export const totalsText = (t: Totals) =>
  `合計 ${dur(t.totalMs)} ターン ${t.turns} ツール ${t.tools}${t.subs ? `(サブ ${t.subs})` : ''} 失敗 ${t.errors}`

/** 新しい順に SHOW 行と、描かない古い行の数 */
export const visible = (turns: readonly TimelineTurn[]) => ({
  rows: [...turns].reverse().slice(0, SHOW),
  hidden: Math.max(0, turns.length - SHOW),
})

/** 全幅にあたる長さ: 描く行の一番長いターン (10 秒より短くはしない) */
export const scaleOf = (rows: readonly TimelineTurn[], now: number) => Math.max(10_000, ...rows.map(t => lenOf(t, now)))

export type Seg = { x: number; w: number; kind: KindId; isSub: boolean; isError: boolean }

/**
 * 1 行の区間を x の位置にする。同じ種類で 1px 以内に続く区間は 1 つにまとめ、多ければ後ろの MAX_SEGS 個だけ
 * (失敗の印はまとめた区間のどれかが失敗なら付く)
 */
export function segments(t: TimelineTurn, now: number, x0: number, pxPerMs: number): Seg[] {
  const out: Seg[] = []
  for (const sub of [false, true]) {
    const tools = t.tools.filter(x => x.isSub === sub).sort((a, b) => a.start - b.start)
    for (const x of tools) {
      const a = x0 + Math.max(0, x.start - t.start) * pxPerMs
      const w = Math.max(3, Math.max(0, endOf(x, now) - x.start) * pxPerMs)
      const k = kindOf(x.tool)
      const prev = out[out.length - 1]
      if (prev && prev.isSub === sub && prev.kind === k && a <= prev.x + prev.w + 1) {
        prev.w = Math.max(prev.w, a + w - prev.x)
        prev.isError ||= x.isError
      } else {
        out.push({ x: a, w, kind: k, isSub: sub, isError: x.isError })
      }
    }
  }
  return out.slice(-MAX_SEGS)
}

const X0 = 16
const X1 = W - 16
const ROW_H = 40
const TOP = HEADER_H + 64

const txt = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra ? ` ${extra}` : ''}>${esc(s)}</text>`

const tile = (x: number, label: string, value: string, sub: string, color: string) =>
  panel(x, HEADER_H + 10, 112, 46) +
  txt(x + 10, HEADER_H + 27, label, 12, C.dim) +
  txt(x + 10, HEADER_H + 47, value, 16, color, 'font-weight="bold"') +
  (sub ? txt(x + 102, HEADER_H + 47, sub, 12, C.red, 'text-anchor="end"') : '')

/** 1 行: 上に「時刻 長さ 依頼」、下に帯。帯の中にツールの区間 */
function row(t: TimelineTurn, i: number, now: number, scale: number) {
  const y = TOP + i * ROW_H
  const len = lenOf(t, now)
  const isLong = len >= LONG_MS
  const isRunning = t.end === undefined
  const px = (X1 - X0) / scale
  const barW = Math.max(3, len * px)
  const delay = (i * 0.05).toFixed(2)
  const tag = isRunning ? '実行中' : t.reason === 'aborted' ? '中断' : t.reason === 'error' ? 'エラー' : t.reason === 'refusal' ? '断り' : ''

  let s =
    txt(X0, y + 13, hm(t.start), 12, C.dim) +
    txt(X0 + 40, y + 13, dur(len), 12, isLong ? C.yellow : C.text, isLong ? 'font-weight="bold"' : '') +
    (tag ? txt(X0 + 104, y + 13, tag, 12, isRunning ? C.green : C.red) : '') +
    txt(X0 + (tag ? 150 : 104), y + 13, short(t.label || '(依頼の文なし)', tag ? 13 : 17), 12, C.text)
  // 帯の地。長いターンは黄の縁
  s += `<rect x="${X0}" y="${y + 18}" width="${X1 - X0}" height="16" rx="3" fill="${C.face}"/>`
  s += growBar(X0, y + 18, barW, 16, C.line, Number(delay))
  if (isLong) s += `<rect x="${X0}" y="${y + 18}" width="${barW.toFixed(1)}" height="16" rx="3" fill="none" stroke="${C.yellow}" stroke-width="1.5"/>`

  // 区間は帯と一緒に左から見せる (切り抜きの幅を伸ばす)
  const segs = segments(t, now, X0, px)
  const clip = `tl-row-${i}`
  s +=
    `<clipPath id="${clip}"><rect x="${X0}" y="${y + 16}" width="${X1 - X0 + 8}" height="22">` +
    `<animate attributeName="width" from="0" to="${X1 - X0 + 8}" begin="${delay}s" dur="0.6s" fill="freeze"/></rect></clipPath>` +
    `<g clip-path="url(#${clip})">`
  for (const g of segs) {
    const color = kind(g.kind).color()
    s += g.isSub
      ? `<rect x="${g.x.toFixed(1)}" y="${y + 29}" width="${g.w.toFixed(1)}" height="4" rx="1" fill="${color}" stroke="${C.bg}" stroke-width="0.5"/>`
      : `<rect x="${g.x.toFixed(1)}" y="${y + 20}" width="${g.w.toFixed(1)}" height="12" rx="2" fill="${color}"/>`
  }
  for (const g of segs.filter(g => g.isError)) {
    s += `<circle cx="${(g.x + g.w).toFixed(1)}" cy="${y + 19}" r="3.5" fill="${C.red}" stroke="${C.bg}" stroke-width="1"/>`
  }
  s += '</g>'
  if (isRunning) {
    s += `<circle cx="${(X0 + barW).toFixed(1)}" cy="${y + 26}" r="3" fill="${C.green}"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></circle>`
  }
  return s
}

function legend(y: number) {
  let s = ''
  let x = X0
  let line = 0
  const item = (swatch: string, label: string) => {
    const w = 18 + Array.from(label).length * 12 + 10
    if (x + w > X1) {
      x = X0
      line++
    }
    s += `<g transform="translate(${x} ${y + line * 20})">${swatch}${txt(16, 11, label, 12, C.dim)}</g>`
    x += w
  }
  for (const k of KINDS) item(`<rect x="0" y="1" width="11" height="11" rx="2" fill="${k.color()}"/>`, k.label)
  item(`<rect x="0" y="8" width="11" height="4" rx="1" fill="${C.green}"/>`, 'サブ')
  item(`<circle cx="5.5" cy="6.5" r="4" fill="${C.red}"/>`, '失敗')
  item(`<rect x="0.5" y="1.5" width="10" height="10" rx="2" fill="none" stroke="${C.yellow}" stroke-width="1.5"/>`, '1分以上')
  return { svg: s, h: (line + 1) * 20 }
}

/** タイムライン全体。turns は古い順 (state のまま) */
export function timelineSvg(turns: readonly TimelineTurn[], now: number): string {
  const totals = totalsOf(turns, now)
  const { rows, hidden } = visible(turns)
  const scale = scaleOf(rows, now)
  let body =
    header('タイムライン', rows.length ? `全幅 ${dur(scale)}` : '', C.blue) +
    tile(X0, '合計', dur(totals.totalMs), '', C.text) +
    tile(X0 + 118, 'ターン', String(totals.turns), '', C.text) +
    tile(X0 + 236, 'ツール', String(totals.tools), totals.errors ? `失敗${totals.errors}` : '', C.text)
  let y = TOP
  if (rows.length === 0) {
    body += txt(X0, y + 16, 'まだターンがありません', 12, C.dim)
    y += 28
  } else {
    rows.forEach((t, i) => (body += row(t, i, now, scale)))
    y += rows.length * ROW_H
    if (hidden) {
      body += txt(X0, y + 10, `ほか ${hidden} ターン`, 12, C.dim)
      y += 22
    }
  }
  const lg = legend(y + 6)
  return frame(y + 6 + lg.h + 8, body + lg.svg)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** terminal 用の要約。新しい順 */
export function timelineLines(turns: readonly TimelineTurn[], now: number): Line[] {
  const totals = totalsOf(turns, now)
  const { rows, hidden } = visible(turns)
  const out: Line[] = [{ text: totalsText(totals), isBold: true, color: totals.isRunning ? 'green' : undefined }]
  if (rows.length === 0) return [...out, { text: 'まだターンがありません', isDim: true }]
  for (const t of rows) {
    const len = lenOf(t, now)
    const counts = new Map<KindId, number>()
    for (const x of t.tools) counts.set(kindOf(x.tool), (counts.get(kindOf(x.tool)) ?? 0) + 1)
    const tools = KINDS.filter(k => counts.has(k.id))
      .map(k => `${k.label}${counts.get(k.id)}`)
      .join(' ')
    const fails = t.tools.filter(x => x.isError).length
    const flags = [
      t.end === undefined ? '実行中' : '',
      len >= LONG_MS ? '長い' : '',
      t.reason === 'aborted' ? '中断' : t.reason === 'error' ? 'エラー' : '',
      fails ? `失敗${fails}` : '',
    ].filter(Boolean)
    out.push({
      text: clean(`${hm(t.start)} ${dur(len)} ${[...flags, tools || 'ツールなし'].join(' ')} ${short(t.label, 16)}`),
      color: fails || t.reason === 'error' ? 'red' : t.end === undefined ? 'green' : len >= LONG_MS ? 'yellow' : undefined,
    })
  }
  if (hidden) out.push({ text: `ほか ${hidden} ターン`, isDim: true })
  return out
}
