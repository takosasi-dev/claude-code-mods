// 入力の確かめと、図の SVG・terminal の行を組む純関数。描画面は <img> なので動きは SMIL だけ
import type { CanvasChart, CanvasItem, CanvasKind, CanvasLine } from '../types'
import { C, W, countUp, frame, isLight } from './style'

export const TOOL_NAME = 'show'
/** 残す枚数 */
export const KEEP = 20

/** 上限。モデルから来る値なので、超えたら断る */
export const LIMIT = {
  title: 80,
  label: 40,
  points: 50,
  series: 6,
  pie: 10,
  columns: 8,
  rows: 50,
  cell: 60,
  text: 20_000,
  svg: 100_000,
} as const
/** Svg の source の上限 (エンジンが拒む長さ) */
export const SVG_SOURCE_MAX = 131_072

export const KINDS = ['bar', 'line', 'pie', 'table', 'markdown', 'svg'] as const
export const KIND_NAME: Record<CanvasKind, string> = {
  bar: '棒グラフ',
  line: '折れ線グラフ',
  pie: '円グラフ',
  table: '表',
  markdown: '文章',
  svg: '図',
}

// 系列の色。赤も使う (棒や線は失敗の印ではないので)。テーマに付いていくよう、呼ぶたびに C から読む
const seriesColor = (j: number) => [C.blue, C.green, C.purple, C.orange, C.yellow, C.red][j % 6]!
// 円グラフは 10 色まで。7 色目からは系列の色の淡い/濃い版 (地の明るさで選ぶ。絵の中身として決めた色)
const pieColor = (i: number) =>
  i < 6 ? seriesColor(i) : (isLight() ? ['#0550ae', '#116329', '#6639ba', '#a40e26'] : ['#79c0ff', '#56d364', '#d2a8ff', '#ffa198'])[(i - 6) % 4]!

// ---- 文字 ----

/** 制御文字 (C0・DEL・C1) を落とす (タブと改行は残す)。エンジンは制御文字を含む Text の子や alt の木を拒む */
export const clean = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
/** 日本時間 (JST) の時:分 */
export const hhmm = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** 1 行にする: タブ・改行も空白に */
export const oneLine = (s: string) => clean(s.replace(/[\t\r\n]+/g, ' ')).trim()
/** Markdown は tab と改行のほかの制御文字を拒むので、\r も改行に直す */
export const mdText = (s: string) => clean(s.replace(/\r\n?/g, '\n'))

export const esc = (s: string) =>
  clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 文字の幅の見積もり (px)。全角は 1 字ぶん、半角は 0.6 字ぶん */
export const textWidth = (s: string, size: number) => {
  let w = 0
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) > 0x2e7f ? 1 : 0.6
  return w * size
}

/** 幅 px に収まるよう末尾を … にする */
export const fit = (s: string, px: number, size: number) => {
  if (textWidth(s, size) <= px) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > px) break
    out += ch
  }
  return out + '…'
}

/** 数の見せ方: 3 桁区切り、小さい数は有効 3 桁 */
export const fmt = (n: number) => {
  const r = Math.abs(n) >= 100 ? Math.round(n * 10) / 10 : Number(n.toPrecision(3))
  const [i = '', d] = String(r).split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? `.${d}` : '')
}

/** 目盛り: 0〜max を 4 つほどに分ける切りのいい刻み */
export const ticks = (lo: number, hi: number, count = 4) => {
  if (lo === hi) {
    if (lo === 0) hi = 1
    else if (lo > 0) lo = 0
    else hi = 0
  }
  const raw = (hi - lo) / count
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p
  const start = Math.floor(lo / step + 1e-9) * step
  const end = Math.ceil(hi / step - 1e-9) * step
  const out: number[] = []
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

// ---- 入力 ----

export type Series = { name: string; values: number[] }
export type Parsed =
  | { item: Omit<CanvasItem, 'id' | 'at'> }
  | { error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** 数は ±1e15 まで (それより大きいと目盛りや 3 桁区切りが崩れる) */
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e15

/** 文字の項目を確かめる。制御文字を落としてから数える */
const str = (v: unknown, what: string, max: number, isText = false): string | { error: string } => {
  if (typeof v !== 'string') return { error: `${what} は文字列にしてください(今は ${typeName(v)})` }
  const s = isText ? mdText(v) : oneLine(v)
  if (s.length > max) return { error: `${what} は ${max} 字までです(今は ${s.length} 字)` }
  return s
}

const typeName = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? '配列' : typeof v === 'object' ? 'オブジェクト' : typeof v)

/** values を系列の並びにする。number[] は 1 系列、[{ name, values }] は複数系列 */
function readSeries(input: Record<string, unknown>, n: number): Series[] | { error: string } {
  const v = input.values
  if (!Array.isArray(v) || v.length === 0) return { error: 'values が要ります(数の配列、または [{ "name": "系列名", "values": [数...] }] の配列)' }
  const list: Series[] = []
  // 中に { name, values } が 1 つも無ければ 1 系列 (数でない物は下で断る)
  if (!v.some(isObj)) {
    list.push({ name: '', values: v as number[] })
  } else {
    if (v.length > LIMIT.series) return { error: `系列は ${LIMIT.series} 本までです(今は ${v.length} 本)` }
    for (const [i, s] of v.entries()) {
      if (!isObj(s) || !Array.isArray(s.values))
        return { error: `values[${i}] は { "name": "系列名", "values": [数...] } の形にしてください(数の配列と混ぜられません)` }
      const name = str(s.name ?? '', `values[${i}].name`, LIMIT.label)
      if (typeof name !== 'string') return name
      list.push({ name, values: s.values as number[] })
    }
  }
  for (const [i, s] of list.entries()) {
    const where = list.length === 1 && s.name === '' ? 'values' : `values[${i}].values`
    const bad = s.values.findIndex(x => !isNum(x))
    if (bad >= 0) return { error: `${where}[${bad}] が数ではありません(±1e15 までの数だけ使えます。今は ${typeName(s.values[bad])})` }
    if (s.values.length !== n) return { error: `labels ${n} 件に対し ${where} が ${s.values.length} 件です。同じ数にしてください` }
  }
  return list
}

function readLabels(input: Record<string, unknown>, max: number): string[] | { error: string } {
  const v = input.labels
  if (!Array.isArray(v) || v.length === 0) return { error: 'labels が要ります(項目名の文字列の配列)' }
  if (v.length > max) return { error: `labels は ${max} 件までです(今は ${v.length} 件)` }
  const out: string[] = []
  for (const [i, x] of v.entries()) {
    const s = str(typeof x === 'number' ? String(x) : x, `labels[${i}]`, LIMIT.label)
    if (typeof s !== 'string') return s
    out.push(s)
  }
  return out
}

/**
 * 検査のための写し。文字参照 (&#104; &#x68;) と CSS のエスケープ (\68 \i) をほどく
 * (h&#116;tps: や @\69mport のように、ほどくと外を指す書き方をすり抜けさせない)。描くのは元の物
 */
export function unescapeForCheck(s: string) {
  const ch = (code: number) => (Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '')
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => ch(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => ch(Number(d)))
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h: string) => ch(parseInt(h, 16)))
    .replace(/\\([^0-9a-f\r\n])/gi, '$1')
}

/** Claude が渡した SVG で断る物。img として描かれるので本来は動かないが、念のため。制御文字を落とし、エスケープをほどいてから見る */
export function svgProblem(raw: string): string | undefined {
  if (raw.length > LIMIT.svg) return `svg は ${LIMIT.svg} 字までです(今は ${raw.length} 字)`
  const s = unescapeForCheck(clean(raw))
  // URL の途中のタブ・改行は読み飛ばされるので、外を指すかは詰めた物でも見る
  const flat = s.replace(/[\t\r\n]/g, '')
  if (!/^\s*<svg[\s>]/i.test(s)) return 'svg は <svg で始めてください(<?xml や前置きの文は付けない)'
  if (/<(?:[\w-]+:)?script/i.test(s)) return 'svg に <script> は入れられません'
  if (/[\s"'/]on[a-z]+\s*=/i.test(s)) return 'svg に on で始まる属性 (onload= など) は入れられません'
  if (/(?:href|src)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:|file:)/i.test(flat)) return 'svg から外の物 (href="http..."・file: など) は参照できません。画像は data: で埋め込んでください'
  if (/url\(\s*["']?\s*(?:https?:|\/\/|file:)|image-set\(|@import/i.test(flat)) return 'svg の CSS から外の物 (url(http...)・file:・image-set・@import) は参照できません'
  return undefined
}

/** ツールの入力を確かめて 1 枚に組む。断る時は直し方の分かる理由を返す */
export function parseShow(input: Record<string, unknown>): Parsed {
  const title = str(input.title, 'title', LIMIT.title)
  if (typeof title !== 'string') return title
  if (title === '') return { error: 'title が空です。図の題を入れてください' }
  const kind = input.kind
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind))
    return { error: `kind は ${KINDS.join(' / ')} のどれかにしてください(今は ${typeof kind === 'string' ? JSON.stringify(oneLine(kind).slice(0, 20)) : typeName(kind)})` }
  const k = kind as CanvasKind

  if (k === 'bar' || k === 'line' || k === 'pie') {
    const labels = readLabels(input, k === 'pie' ? LIMIT.pie : LIMIT.points)
    if (!Array.isArray(labels)) return labels
    const series = readSeries(input, labels.length)
    if (!Array.isArray(series)) return series
    if (k === 'pie') {
      if (series.length !== 1) return { error: `pie は系列 1 つだけです(今は ${series.length} 本)。values は数の配列にしてください` }
      const vals = series[0]!.values
      if (vals.some(v => v < 0)) return { error: 'pie の values に負の数は使えません' }
      if (vals.reduce((a, b) => a + b, 0) <= 0) return { error: 'pie の values の合計が 0 です' }
    }
    const chart: CanvasChart = k === 'pie' ? { kind: k, labels, values: series[0]!.values } : { kind: k, labels, series }
    return done({ title, kind: k, svg: drawChart(chart), chart, alt: chartAlt(title, k, labels, series), lines: chartLines(k, labels, series) })
  }

  if (k === 'table') {
    const cols = input.columns
    if (!Array.isArray(cols) || cols.length === 0) return { error: 'columns が要ります(列名の文字列の配列)' }
    if (cols.length > LIMIT.columns) return { error: `columns は ${LIMIT.columns} 列までです(今は ${cols.length} 列)` }
    const columns: string[] = []
    for (const [i, c] of cols.entries()) {
      const s = str(c, `columns[${i}]`, LIMIT.label)
      if (typeof s !== 'string') return s
      columns.push(s)
    }
    const rs = input.rows
    if (!Array.isArray(rs) || rs.length === 0) return { error: 'rows が要ります(行の配列。1 行はセルの配列)' }
    if (rs.length > LIMIT.rows) return { error: `rows は ${LIMIT.rows} 行までです(今は ${rs.length} 行)` }
    const rows: Cell[][] = []
    for (const [i, r] of rs.entries()) {
      if (!Array.isArray(r)) return { error: `rows[${i}] はセルの配列にしてください(今は ${typeName(r)})` }
      if (r.length > columns.length) return { error: `rows[${i}] のセルが ${r.length} 個で、columns の ${columns.length} 列より多いです` }
      const row: Cell[] = []
      for (const [j, c] of r.entries()) {
        if (c === null || c === undefined) row.push('')
        else if (isNum(c)) row.push(c)
        else if (typeof c === 'string') {
          const s = str(c, `rows[${i}][${j}]`, LIMIT.cell)
          if (typeof s !== 'string') return s
          row.push(s)
        } else return { error: `rows[${i}][${j}] は文字列か数 (±1e15 まで) にしてください(今は ${typeName(c)})` }
      }
      while (row.length < columns.length) row.push('')
      rows.push(row)
    }
    const chart: CanvasChart = { kind: k, columns, rows }
    return done({ title, kind: k, svg: drawChart(chart), chart, alt: tableAlt(title, columns, rows), lines: tableLines(columns, rows) })
  }

  if (k === 'markdown') {
    const text = str(input.text, 'text', LIMIT.text, true)
    if (typeof text !== 'string') return text
    if (text.trim() === '') return { error: 'text が空です' }
    return done({ title, kind: k, markdown: text, alt: title, lines: [] })
  }

  if (typeof input.svg !== 'string') return { error: `svg は文字列にしてください(今は ${typeName(input.svg)})` }
  const problem = svgProblem(input.svg)
  if (problem) return { error: problem }
  return done({
    title,
    kind: k,
    svg: clean(input.svg),
    alt: `${title}(Claude が描いた図)`,
    lines: [{ text: 'この図は SVG です。VS Code のペインで見られます', isDim: true }],
  })
}

/** 組んだ SVG が Svg の上限を超えないか最後に見る */
const done = (item: Omit<CanvasItem, 'id' | 'at'>): Parsed =>
  item.svg !== undefined && item.svg.length > SVG_SOURCE_MAX
    ? { error: `データが多くて図が大きくなりすぎました(${item.svg.length} 字。${SVG_SOURCE_MAX} 字まで)。件数を減らしてください` }
    : { item }

// ---- SVG の部品 ----

type Cell = string | number

/** 元のデータから、今のテーマの色で組む (描くたびに呼ぶ。テーマを切り替えると色が付いていく) */
export const drawChart = (c: CanvasChart) =>
  c.kind === 'table' ? tableSvg(c.columns, c.rows) : c.kind === 'pie' ? pieSvg(c.labels, c.values) : c.kind === 'bar' ? barSvg(c.labels, c.series) : lineSvg(c.labels, c.series)

const r1 = (n: number) => Math.round(n * 10) / 10

const text = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" fill="${fill}"${extra ? ` ${extra}` : ''}>${esc(s)}</text>`

/** keyTimes の中の 1 点 (0〜0.99) */
const kt = (x: number) => Math.min(0.99, Math.round(x * 100) / 100)

/** 少し遅れて現れる (0 から始まり、delay 秒後から dur 秒で 1 に) */
const fadeIn = (delay: number, dur = 0.4) =>
  delay <= 0
    ? `<animate attributeName="opacity" values="0;1" dur="${dur}s" fill="freeze"/>`
    : `<animate attributeName="opacity" values="0;0;1" keyTimes="0;${kt(delay / (delay + dur))};1" dur="${r1(delay + dur)}s" fill="freeze"/>`

/** 0 から to へ伸びる。遅れは keyTimes で付ける (begin で遅らせると、始まるまで伸びきった姿が見える) */
const grow = (attr: string, from: number, to: number, delay: number, dur = 0.7) =>
  delay <= 0
    ? `<animate attributeName="${attr}" values="${r1(from)};${r1(to)}" dur="${dur}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"/>`
    : `<animate attributeName="${attr}" values="${r1(from)};${r1(from)};${r1(to)}" keyTimes="0;${kt(delay / (delay + dur))};1" dur="${r1(delay + dur)}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;.2 .8 .2 1"/>`

/** 凡例。複数系列の時だけ。高さを返す */
function legend(series: Series[], y: number): { svg: string; h: number } {
  if (series.length < 2) return { svg: '', h: 0 }
  let x = 16
  let row = 0
  let out = ''
  for (const [i, s] of series.entries()) {
    const name = fit(s.name || `系列${i + 1}`, 140, 12)
    const w = 18 + textWidth(name, 12) + 14
    if (x + w > W - 12 && x > 16) {
      x = 16
      row++
    }
    const yy = y + row * 20
    out += `<rect x="${x}" y="${yy - 9}" width="11" height="11" rx="3" fill="${seriesColor(i)}"/>` + text(x + 16, yy, name, 12, C.text)
    x += w
  }
  return { svg: out, h: (row + 1) * 20 }
}

// ---- 棒グラフ (横向き。狭いペインでも項目名が読める) ----

export function barSvg(labels: string[], series: Series[]): string {
  const all = series.flatMap(s => s.values)
  const t = ticks(Math.min(0, ...all), Math.max(0, ...all))
  const lo = t[0]!
  const hi = t[t.length - 1]!
  const showValues = labels.length * series.length <= 80 && series.length <= 3
  const labelW = Math.min(120, Math.max(...labels.map(l => textWidth(l, 12))) + 8)
  const valueW = showValues ? Math.min(64, Math.max(...all.map(v => textWidth(fmt(v), 12))) + 8) : 8
  const x0 = 16 + labelW
  const x1 = W - 16 - valueW
  const sx = (v: number) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0)
  const zero = sx(0)

  const lg = legend(series, 26)
  const top = 18 + lg.h + 20
  const bar = series.length === 1 ? 16 : series.length <= 3 ? 12 : 8
  const groupH = bar * series.length + 10
  const bottom = top + labels.length * groupH
  const h = bottom + 18

  let out = lg.svg
  for (const v of t) {
    const x = sx(v)
    out += `<line x1="${r1(x)}" y1="${top - 6}" x2="${r1(x)}" y2="${bottom}" stroke="${C.line}"${v === 0 ? '' : ' stroke-dasharray="2 3"'}/>`
    out += text(x, top - 10, fmt(v), 12, C.dim, 'text-anchor="middle"')
  }
  let n = 0
  for (const [i, label] of labels.entries()) {
    const gy = top + i * groupH + 5
    out += text(x0 - 6, gy + (bar * series.length) / 2 + 4, fit(label, labelW - 6, 12), 12, C.text, 'text-anchor="end"')
    for (const [j, s] of series.entries()) {
      const v = s.values[i]!
      const y = gy + j * bar
      const x = Math.min(sx(v), zero)
      const w = Math.max(Math.abs(sx(v) - zero), v === 0 ? 0 : 1)
      const delay = Math.min(0.6, n++ * 0.025)
      const color = seriesColor(j)
      // 負の数は 0 から左へ伸びる (x も動かす)
      out +=
        `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(bar - 1)}" rx="2" fill="${color}">` +
        grow('width', 0, w, delay) +
        (v < 0 ? grow('x', zero, x, delay) : '') +
        `</rect>`
      if (showValues)
        out += `<g opacity="1">${fadeIn(delay + 0.5)}${text(v < 0 ? x - 4 : x + w + 4, y + bar / 2 + 4, fmt(v), 12, C.text, v < 0 ? 'text-anchor="end"' : '')}</g>`
    }
  }
  return frame(h, out)
}

// ---- 折れ線グラフ ----

export function lineSvg(labels: string[], series: Series[]): string {
  const all = series.flatMap(s => s.values)
  const min = Math.min(...all)
  const max = Math.max(...all)
  // 正の数だけで、0 から遠くなければ 0 から描く
  const t = ticks(min >= 0 && min <= max - min ? 0 : min, max)
  const lo = t[0]!
  const hi = t[t.length - 1]!
  const lg = legend(series, 26)
  const top = 18 + lg.h + 12
  const plotH = 190
  const bottom = top + plotH
  const yLabelW = Math.max(...t.map(v => textWidth(fmt(v), 12))) + 8
  const x0 = 16 + yLabelW
  const x1 = W - 22
  const n = labels.length
  const sx = (i: number) => (n === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (n - 1))
  const sy = (v: number) => bottom - ((v - lo) / (hi - lo)) * plotH

  let out = lg.svg
  out += `<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.blue}" stop-opacity=".35"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></linearGradient></defs>`
  for (const v of t) {
    const y = sy(v)
    out += `<line x1="${r1(x0)}" y1="${r1(y)}" x2="${x1}" y2="${r1(y)}" stroke="${C.line}"${v === lo ? '' : ' stroke-dasharray="2 3"'}/>`
    out += text(x0 - 6, y + 4, fmt(v), 12, C.dim, 'text-anchor="end"')
  }
  // 横軸の項目名は重ならない分だけ間引く
  const widest = Math.min(90, Math.max(...labels.map(l => textWidth(l, 12))) + 10)
  const room = n === 1 ? x1 - x0 : (x1 - x0) / (n - 1)
  const every = Math.max(1, Math.ceil(widest / room))
  for (const [i, l] of labels.entries()) {
    if (i % every !== 0 && i !== n - 1) continue
    if (i !== n - 1 && n - 1 - i < every && n > 1) continue
    const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
    out += text(sx(i), bottom + 18, fit(l, Math.max(widest, room * every) - 6, 12), 12, C.dim, `text-anchor="${anchor}"`)
  }
  const pts = (s: Series) => s.values.map((v, i) => `${r1(sx(i))},${r1(sy(v))}`)
  if (series.length === 1 && n > 1) {
    const p = pts(series[0]!)
    out += `<path d="M${r1(sx(0))},${bottom}L${p.join('L')}L${r1(sx(n - 1))},${bottom}Z" fill="url(#area)" opacity="1">${fadeIn(0.6, 0.6)}</path>`
  }
  const showAll = series.length === 1 && n <= 12
  for (const [j, s] of series.entries()) {
    const color = seriesColor(j)
    if (n > 1)
      out +=
        `<path d="M${pts(s).join('L')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0">` +
        `<animate attributeName="stroke-dashoffset" values="1;0" dur="1s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".3 .7 .3 1"/></path>`
    if (n <= 24)
      for (const [i, v] of s.values.entries())
        out += `<circle cx="${r1(sx(i))}" cy="${r1(sy(v))}" r="3.5" fill="${C.face}" stroke="${color}" stroke-width="2" opacity="1">${fadeIn(0.2 + (i / n) * 0.8, 0.3)}</circle>`
    // 数: 1 系列で 12 点までは全部、それより多い時は最後の点だけ
    const idx = showAll ? s.values.map((_, i) => i) : [n - 1]
    for (const i of idx) {
      const v = s.values[i]!
      const anchor = n === 1 ? 'middle' : i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'
      out += `<g opacity="1">${fadeIn(1)}${text(sx(i), sy(v) - 9, fmt(v), 12, showAll ? C.text : color, `text-anchor="${anchor}" font-weight="bold"`)}</g>`
    }
  }
  return frame(bottom + 32, out)
}

// ---- 円グラフ (ドーナツ) ----

export function pieSvg(labels: string[], values: number[]): string {
  const total = values.reduce((a, b) => a + b, 0)
  const cx = W / 2
  const cy = 120
  const R = 78
  const band = 34
  let out = ''
  // 輪っか: 円の線を pathLength=100 で区切る。始まりは 12 時、時計回り
  let start = 0
  for (const [i, v] of values.entries()) {
    const pct = (v / total) * 100
    if (pct <= 0) continue
    const color = pieColor(i)
    const len = Math.max(0.01, pct > 1.5 ? pct - 0.6 : pct)
    const delay = (start / 100) * 0.8
    out +=
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${band}" pathLength="100" stroke-dasharray="${r1(len)} 100" stroke-dashoffset="${r1(-start)}" transform="rotate(-90 ${cx} ${cy})">` +
      `<animate attributeName="stroke-dasharray" values="0 100;0 100;${r1(len)} 100" keyTimes="0;${kt(delay / (delay + 0.5))};1" dur="${r1(delay + 0.5)}s" fill="freeze"/></circle>`
    // 6% 以上は輪の上に割合
    if (pct >= 6) {
      const a = ((start + pct / 2) / 100) * Math.PI * 2 - Math.PI / 2
      out += `<g opacity="1">${fadeIn(1)}${text(cx + Math.cos(a) * R, cy + Math.sin(a) * R + 4, `${Math.round(pct)}%`, 12, C.bg, 'text-anchor="middle" font-weight="bold"')}</g>`
    }
    start += pct
  }
  out += countUp(total, `x="${cx}" y="${cy + 2}" font-size="18" fill="${C.text}" text-anchor="middle" font-weight="bold"`, fmt, 0.2)
  out += text(cx, cy + 20, '合計', 12, C.dim, 'text-anchor="middle"')

  // 凡例: 色・項目名・数・割合
  let y = cy + R + band / 2 + 28
  for (const [i, l] of labels.entries()) {
    const v = values[i]!
    out +=
      `<g opacity="1">${fadeIn(0.3 + i * 0.06)}` +
      `<rect x="20" y="${y - 10}" width="12" height="12" rx="3" fill="${pieColor(i)}"/>` +
      text(40, y, fit(l, 200, 12), 12, C.text) +
      text(W - 72, y, fmt(v), 12, C.text, 'text-anchor="end"') +
      text(W - 20, y, `${((v / total) * 100).toFixed(1)}%`, 12, C.dim, 'text-anchor="end"') +
      `</g>`
    y += 22
  }
  return frame(y + 4, out)
}

// ---- 表 ----

const cellText = (c: Cell) => (typeof c === 'number' ? fmt(c) : c)

export function tableSvg(columns: string[], rows: Cell[][]): string {
  const pad = 8
  const room = W - 32
  // 数だけの列は右寄せ
  const numeric = columns.map((_, j) => rows.some(r => typeof r[j] === 'number') && rows.every(r => typeof r[j] === 'number' || r[j] === ''))
  const natural = columns.map((c, j) =>
    Math.min(160, Math.max(36, textWidth(c, 12) * 1.05, ...rows.map(r => textWidth(cellText(r[j] ?? ''), 12))) + pad * 2),
  )
  const sum = natural.reduce((a, b) => a + b, 0)
  // 枠の幅いっぱいに伸ばす (狭ければ縮める)
  const widths = natural.map(w => (w * room) / sum)
  const xs: number[] = []
  widths.reduce((x, w) => (xs.push(x), x + w), 16)
  const headH = 28
  const rowH = 24
  const top = 14
  let out = `<rect x="16" y="${top}" width="${room}" height="${headH}" rx="6" fill="${C.face}" stroke="${C.line}"/>`
  for (const [j, c] of columns.entries()) {
    const x = numeric[j] ? xs[j]! + widths[j]! - pad : xs[j]! + pad
    out += text(x, top + 18, fit(c, widths[j]! - pad * 2, 12), 12, C.blue, `font-weight="bold"${numeric[j] ? ' text-anchor="end"' : ''}`)
  }
  for (const [i, r] of rows.entries()) {
    const y = top + headH + i * rowH
    let row = i % 2 === 1 ? `<rect x="16" y="${y}" width="${room}" height="${rowH}" fill="${C.face}"/>` : ''
    for (const [j, c] of r.entries()) {
      const x = numeric[j] ? xs[j]! + widths[j]! - pad : xs[j]! + pad
      row += text(x, y + 16, fit(cellText(c), widths[j]! - pad * 2, 12), 12, C.text, numeric[j] ? 'text-anchor="end"' : '')
    }
    out += `<g opacity="1">${fadeIn(Math.min(0.8, i * 0.04), 0.3)}${row}</g>`
  }
  const bottom = top + headH + rows.length * rowH
  out += `<line x1="16" y1="${bottom}" x2="${W - 16}" y2="${bottom}" stroke="${C.line}"/>`
  for (const x of xs.slice(1)) out += `<line x1="${r1(x)}" y1="${top + 4}" x2="${r1(x)}" y2="${bottom}" stroke="${C.line}" stroke-opacity=".6"/>`
  return frame(bottom + 14, out)
}

// ---- alt と terminal の行 ----

const cutAlt = (s: string) => (s.length > 600 ? `${s.slice(0, 598)}…` : s)

function chartAlt(title: string, kind: CanvasKind, labels: string[], series: Series[]) {
  const parts = labels.slice(0, 12).map((l, i) => `${l} ${series.map(s => fmt(s.values[i]!)).join('/')}`)
  return cutAlt(oneLine(`${title}(${KIND_NAME[kind]}): ${parts.join('、')}${labels.length > 12 ? ` ほか ${labels.length - 12} 件` : ''}`))
}

function tableAlt(title: string, columns: string[], rows: Cell[][]) {
  return cutAlt(oneLine(`${title}(表 ${rows.length} 行): ${columns.join(' / ')}`))
}

/** terminal: 棒は ■ の長さ、ほかは数を並べる */
function chartLines(kind: CanvasKind, labels: string[], series: Series[]): CanvasLine[] {
  const out: CanvasLine[] = []
  if (series.length > 1) out.push({ text: `系列: ${series.map((s, i) => s.name || `系列${i + 1}`).join(' / ')}`, isDim: true })
  if (kind === 'pie') {
    const vals = series[0]!.values
    const total = vals.reduce((a, b) => a + b, 0)
    for (const [i, l] of labels.entries())
      out.push({ text: `● ${l} ${fmt(vals[i]!)} (${((vals[i]! / total) * 100).toFixed(1)}%)`, color: pieColor(i) })
    out.push({ text: `合計 ${fmt(total)}`, isBold: true })
    return out
  }
  const max = Math.max(...series.flatMap(s => s.values.map(Math.abs))) || 1
  for (const [i, l] of labels.entries()) {
    if (kind === 'bar' && series.length === 1) {
      const v = series[0]!.values[i]!
      out.push({ text: `${l} ${'■'.repeat(Math.max(v === 0 ? 0 : 1, Math.round((Math.abs(v) / max) * 10)))} ${fmt(v)}`, color: v < 0 ? C.red : C.blue })
    } else out.push({ text: `${l}: ${series.map(s => fmt(s.values[i]!)).join(' / ')}` })
  }
  return out
}

function tableLines(columns: string[], rows: Cell[][]): CanvasLine[] {
  return [
    { text: columns.join(' | '), isBold: true, color: C.blue },
    ...rows.map(r => ({ text: r.map(cellText).join(' | ') })),
  ]
}

// ---- ツールの説明と入力の形 ----

export const DESCRIPTION =
  'ユーザーに図・グラフ・表を見せたい時に使う。ペインに描かれる(直近 20 枚をめくれる)。' +
  'kind ごとに使う項目: bar(横棒)・line(折れ線)・pie(円) は labels と values、table は columns と rows、markdown は text、svg は svg。' +
  `上限: title ${LIMIT.title} 字、labels ${LIMIT.points} 件 (pie は ${LIMIT.pie} 件)・1 つ ${LIMIT.label} 字、系列 ${LIMIT.series} 本、` +
  `columns ${LIMIT.columns} 列、rows ${LIMIT.rows} 行、セル ${LIMIT.cell} 字、text ${LIMIT.text} 字、svg ${LIMIT.svg} 字。` +
  'svg は <svg で始め、<script>・on で始まる属性・外の物を指す href (http など) は入れない(画像は data: で埋め込む)。' +
  '入力が合わない時は理由が返るので、直して呼び直す。' +
  '例: {"title":"月ごとの売上(万円)","kind":"bar","labels":["1月","2月","3月"],"values":[{"name":"2025年","values":[120,135,160]},{"name":"2026年","values":[140,150,190]}]}'

export const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: `図の題 (${LIMIT.title} 字まで)` },
    kind: { type: 'string', enum: [...KINDS], description: 'bar=横棒グラフ、line=折れ線グラフ、pie=円グラフ、table=表、markdown=文章、svg=自分で書いた SVG' },
    labels: { type: 'array', items: { type: 'string' }, description: 'bar・line・pie の項目名' },
    values: {
      description: 'bar・line・pie の数。1 系列なら数の配列、複数系列なら [{ "name": "系列名", "values": [数...] }] (pie は 1 系列だけ)。各系列の数は labels と同じ件数',
      anyOf: [
        { type: 'array', items: { type: 'number' } },
        {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }, required: ['name', 'values'] },
        },
      ],
    },
    columns: { type: 'array', items: { type: 'string' }, description: 'table の列名' },
    rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } }, description: 'table の行。1 行はセル (文字列か数) の配列' },
    text: { type: 'string', description: 'markdown の本文' },
    svg: { type: 'string', description: 'svg の本文 (<svg で始まる。viewBox を付け、width・height は付けないと枠いっぱいに描かれる)' },
  },
  required: ['title', 'kind'],
} as const
