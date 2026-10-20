// SVG を文字列で組む関数と、表示用の小さな整形。描画面は <img> なので動きは SMIL だけ
// 合計とタイムラインは 1 分ごと・ツールを呼ぶたびに描き直すので、動きは足さない (mod-guide 2 節)
import type { RecapTurn } from '../types'
import { C, HEADER_H, W, esc, frame, header } from './style'

export type KindId = 'edit' | 'run' | 'look' | 'agent' | 'other' | 'none'

/** ツールの種類。赤はエラー専用なので使わない。色はテーマに付いていくよう読むたびに C から引く */
export const KINDS: { id: KindId; label: string; readonly color: string; tools: string[] }[] = [
  { id: 'edit', label: '編集', get color() { return C.blue }, tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] },
  { id: 'run', label: '実行', get color() { return C.orange }, tools: ['Bash', 'PowerShell', 'Monitor', 'TaskStop', 'Skill'] },
  { id: 'look', label: '調べ', get color() { return C.purple }, tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LSP', 'ToolSearch'] },
  { id: 'agent', label: 'エージェント', get color() { return C.green }, tools: ['Agent', 'Task', 'SendMessage'] },
  { id: 'other', label: 'その他', get color() { return C.yellow }, tools: [] },
  { id: 'none', label: '会話のみ', get color() { return C.dim }, tools: [] },
]

const kindOfTool = (tool: string): KindId => KINDS.find(k => k.tools.includes(tool))?.id ?? 'other'

/** そのターンで一番使ったツールの種類。同数なら KINDS の並びで前の物 */
export const kindOf = (t: RecapTurn): KindId => {
  const sum: Partial<Record<KindId, number>> = {}
  for (const [tool, n] of Object.entries(t.tools)) {
    const k = kindOfTool(tool)
    sum[k] = (sum[k] ?? 0) + n
  }
  let best: KindId = 'none'
  for (const k of KINDS) if ((sum[k.id] ?? 0) > (sum[best] ?? 0)) best = k.id
  return best
}

export const colorOf = (k: KindId) => KINDS.find(x => x.id === k)?.color ?? C.dim

/** 制御文字 (タブ・改行・復帰を除く)。描く木や SVG に入ると拒まれてペインが閉じる */
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export { esc }

/** 先頭 n 字 (サロゲートペアを割らない)。切ったら「…」 */
export const head = (s: string, n: number) => {
  const a = Array.from(s.replace(/\s+/g, ' ').replace(CONTROL, '').trim())
  return a.length > n ? `${a.slice(0, n).join('')}…` : a.join('')
}

/** 時刻 10:42 (動いている環境のローカル時刻) */
export const hm = (ms: number) => {
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 所要時間 8秒 / 4分 / 1時間5分 */
export const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}秒`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`
}

/** 経過 h:mm */
export const clock = (ms: number) => {
  const min = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}

/** 見出しの下から中身を始める y */
const TOP = HEADER_H + 12

const text = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`

// ---- 合計 ----

export type Totals = { elapsedMs: number; turns: number; tools: number; errors: number; longest?: RecapTurn; isRunning: boolean }

export const totalsSvg = (t: Totals) => {
  const cell = (i: number, label: string, value: string, fill: string = C.text) => {
    const x = 16 + (i % 2) * 180
    const y = TOP + Math.floor(i / 2) * 54
    return (
      `<rect x="${x}" y="${y}" width="168" height="44" rx="8" fill="${C.face}" stroke="${C.line}"/>` +
      text(x + 10, y + 17, label, 12, C.dim) +
      text(x + 10, y + 36, value, 16, fill, 'font-weight="bold"')
    )
  }
  const status = t.isRunning
    ? `<circle cx="${W - 70}" cy="23" r="4" fill="${C.green}">` +
      `<animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></circle>` +
      text(W - 16, 28, '実行中', 12, C.green, 'text-anchor="end"')
    : text(W - 16, 28, '待機中', 12, C.dim, 'text-anchor="end"')
  const longest = t.longest?.end !== undefined ? dur(t.longest.end - t.longest.start) : '─'
  return frame(
    t.longest ? 186 : 168,
    header('ふりかえり', '', t.isRunning ? C.green : C.blue) +
      status +
      cell(0, '経過', clock(t.elapsedMs)) +
      cell(1, 'ターン', `${t.turns}`) +
      cell(2, 'ツール', `${t.tools}回`) +
      cell(3, 'エラー', `${t.errors}`, t.errors > 0 ? C.red : C.text) +
      (t.longest ? text(16, 174, `最長 ${longest}  ${head(t.longest.label, 18)}`, 12, C.dim) : ''),
  )
}

// ---- 帯のタイムライン ----

const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440]
const MAX_LANES = 8
const LANE_H = 32
const X0 = 60
const X1 = W - 16

/** 1 行の長さ (ms)。行が MAX_LANES に収まる一番細かい刻み */
export const laneStep = (spanMs: number) =>
  (STEPS_MIN.find(m => Math.ceil(spanMs / (m * 60_000)) <= MAX_LANES) ?? STEPS_MIN[STEPS_MIN.length - 1]!) * 60_000

export const timelineSvg = (turns: RecapTurn[], now: number, selected: string | null) => {
  const first = turns[0]
  if (!first) {
    return frame(80, header('タイムライン') + text(16, 68, 'まだターンがありません', 12, C.dim))
  }
  const endOf = (t: RecapTurn) => t.end ?? now
  const last = Math.max(...turns.map(endOf))
  const step = laneStep(last - Math.min(...turns.map(t => t.start)) + 1)
  // 始まりを見ていないターンは後から足されるので、並びの先頭が一番早いとは限らない
  const t0 = Math.floor(Math.min(...turns.map(t => t.start)) / step) * step
  const lanes = Math.max(1, Math.ceil((last - t0) / step))
  const px = (X1 - X0) / step

  // [a, b) を行ごとに切って、行番号と x 範囲を返す
  const pieces = (a: number, b: number) => {
    const out: { lane: number; x: number; w: number }[] = []
    for (let i = Math.floor((a - t0) / step); i < lanes && t0 + i * step < b; i++) {
      const s = Math.max(a, t0 + i * step)
      const e = Math.min(b, t0 + (i + 1) * step)
      out.push({ lane: i, x: X0 + (s - t0 - i * step) * px, w: Math.max(3, (e - s) * px) })
    }
    return out
  }
  const trackY = (lane: number) => TOP + 6 + lane * LANE_H

  let body = header('タイムライン', `1行 = ${dur(step)}`)
  for (let i = 0; i < lanes; i++) {
    const y = trackY(i)
    body +=
      text(16, y + 12, hm(t0 + i * step), 12, C.dim) +
      `<rect x="${X0}" y="${y}" width="${X1 - X0}" height="16" rx="3" fill="${C.face}"/>`
  }
  // 待ち時間: 最初のターンから最後までを薄い破線で引き、その上に帯を重ねる
  for (const p of pieces(t0, last)) {
    const y = trackY(p.lane) + 8
    body += `<line x1="${p.x}" y1="${y}" x2="${p.x + p.w}" y2="${y}" stroke="${C.dim}" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>`
  }
  for (const t of turns) {
    const color = colorOf(kindOf(t))
    const ps = pieces(t.start, endOf(t))
    for (const p of ps) {
      const isSel = t.turnId === selected
      body +=
        `<rect x="${p.x.toFixed(1)}" y="${trackY(p.lane) + 2}" width="${p.w.toFixed(1)}" height="12" rx="2" fill="${color}"` +
        (isSel ? ` stroke="${C.text}" stroke-width="1.5"` : '') +
        (t.end === undefined ? `><animate attributeName="opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite"/></rect>` : '/>')
    }
    const tail = ps[ps.length - 1]
    if (tail && (t.errors > 0 || t.reason === 'error')) {
      body += `<circle cx="${(tail.x + tail.w).toFixed(1)}" cy="${trackY(tail.lane) - 1}" r="4" fill="${C.red}" stroke="${C.bg}" stroke-width="1"/>`
    }
  }

  // 凡例
  const ly = trackY(lanes) + 14
  let x = 16
  let legend = ''
  const item = (row: number, swatch: string, label: string) => {
    const w = 18 + Array.from(label).length * 12 + 12
    if (x + w > W - 8) return
    legend += `<g transform="translate(${x} ${ly + row * 22})">${swatch}${text(16, 11, label, 12, C.dim)}</g>`
    x += w
  }
  for (const k of KINDS.filter(k => k.id !== 'none')) item(0, `<rect x="0" y="1" width="11" height="11" rx="2" fill="${k.color}"/>`, k.label)
  x = 16
  item(1, `<rect x="0" y="1" width="11" height="11" rx="2" fill="${C.dim}"/>`, '会話のみ')
  item(1, `<line x1="0" y1="7" x2="11" y2="7" stroke="${C.dim}" stroke-dasharray="2 3"/>`, '待ち')
  item(1, `<circle cx="5.5" cy="6.5" r="4" fill="${C.red}"/>`, 'エラー')
  return frame(ly + 22 + 22, body + legend)
}

// ---- 要約中 ----

export const busySvg = () =>
  frame(
    HEADER_H,
    header('要約中') +
      [0, 1, 2]
        .map(
          i =>
            `<circle cx="${80 + i * 12}" cy="22" r="3.5" fill="${C.blue}">` +
            `<animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="${(i * 0.3).toFixed(1)}s" repeatCount="indefinite"/></circle>`,
        )
        .join(''),
  )
