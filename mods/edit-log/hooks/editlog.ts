// 記録の集計と、SVG・terminal 用の行を組む。どれも純関数
import type { EditLogEntry } from '../types'

const C = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  weak: '#8b949e',
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
  orange: '#f78166',
}
const W = 380
const MONO = 'ui-monospace, Consolas, monospace'
/** 横棒に出すファイルの数 */
export const TOP_FILES = 8
/** タイムラインに出す回数 */
export const TOP_EVENTS = 15
/** 詳細の変更履歴に出す回数 */
export const TOP_HISTORY = 30

/** ツールの種類ごとの色。知らないツールは弱い色 */
export const TOOL_COLOR: Record<string, string> = {
  Edit: C.blue,
  Write: C.green,
  MultiEdit: C.purple,
  NotebookEdit: C.orange,
}
const toolColor = (tool: string) => TOOL_COLOR[tool] ?? C.weak

/** 行数。末尾の改行 1 つは数えない */
export const countLines = (s: unknown) => (typeof s !== 'string' || s === '' ? 0 : s.replace(/\r?\n$/, '').split('\n').length)

/** ツールの入力から、置き換えた (書いた) 行数のおおよそ */
export function linesOf(tool: string, input: Record<string, unknown>): number {
  const pair = (x: unknown) => {
    const o = (x ?? {}) as Record<string, unknown>
    return Math.max(countLines(o.old_string), countLines(o.new_string))
  }
  if (tool === 'Edit') return pair(input)
  if (tool === 'MultiEdit') return Array.isArray(input.edits) ? input.edits.reduce((n: number, x) => n + pair(x), 0) : 0
  if (tool === 'Write') return countLines(input.content)
  if (tool === 'NotebookEdit') return countLines(input.new_source)
  return 0
}

/** 制御文字を落とす (タブと改行は残す)。エンジンは制御文字を含む Text・alt を描かない */
export const plain = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')

/** 絶対パスのファイルの親フォルダ。根なら区切りを残す。相対パスなら空 (git は今の作業フォルダで走らせる) */
export function parentDir(file: string) {
  if (!/^(?:[A-Za-z]:)?[\\/]/.test(file)) return ''
  const i = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  const dir = file.slice(0, i)
  return dir === '' || /^[A-Za-z]:$/.test(dir) ? file.slice(0, i + 1) : dir
}

/** 作業フォルダの中なら相対パス、外なら区切りを / にしたパス */
export function relPath(cwd: string, file: string) {
  const f = file.replace(/\\/g, '/')
  const c = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  // ponytail: 大文字小文字を区別しない比較。Linux で大文字違いのフォルダが並ぶと相対にならないだけ
  if (c !== '' && f.toLowerCase().startsWith(`${c.toLowerCase()}/`)) return f.slice(c.length + 1)
  return f
}

export type FileStat = { label: string; file: string; count: number; fails: number; lines: number; last: number }

/** ファイルごとの回数。回数の多い順、同じなら最近触った順 (last は最後の通し番号) */
export function fileStats(entries: readonly EditLogEntry[]): FileStat[] {
  const map = new Map<string, FileStat>()
  for (const e of entries) {
    const s = map.get(e.label) ?? { label: e.label, file: e.file, count: 0, fails: 0, lines: 0, last: 0 }
    s.count++
    if (e.isError) s.fails++
    else s.lines += e.lines
    s.file = e.file
    s.last = Math.max(s.last, e.id)
    map.set(e.label, s)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last)
}

export const summary = (entries: readonly EditLogEntry[]) => ({
  files: new Set(entries.map(e => e.label)).size,
  changes: entries.length,
  fails: entries.filter(e => e.isError).length,
  subs: entries.filter(e => e.isSub).length,
})

/**
 * `git diff` の出力から Code (format: 'diff') に渡す部分を取り出す。
 * 最初の @@ より前 (diff --git・index・---/+++) を落とし、長ければハンクの切れ目で切る。ハンクが無ければ undefined
 */
export function diffBody(raw: string, max = 60_000): { diff: string; isCut: boolean } | undefined {
  // Code が描けるのはタブと改行だけ。CR や色の制御文字を落とす
  const text = raw.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  const start = text.startsWith('@@') ? 0 : text.indexOf('\n@@') + 1
  if (start === 0 && !text.startsWith('@@')) return undefined
  let body = text.slice(start).replace(/\n+$/, '')
  let isCut = false
  if (body.length > max) {
    const at = body.lastIndexOf('\n@@', max)
    body = at > 0 ? body.slice(0, at) : body.slice(0, max)
    isCut = true
  }
  return { diff: body, isCut }
}

/** 時:分:秒 */
export const clockLabel = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

// 全角は 2、半角は 1 と数えた幅
const wide = (ch: string) => /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
const units = (s: string) => [...s].reduce((n, ch) => n + (wide(ch) ? 2 : 1), 0)

/** 幅に収まらなければ末尾を残して頭を … にする */
export function tailFit(s: string, max: number) {
  if (units(s) <= max) return s
  const chars = [...s]
  let out = ''
  let n = 1
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i] ?? ''
    n += wide(ch) ? 2 : 1
    if (n > max) break
    out = ch + out
  }
  return `…${out}`
}

const esc = (s: string) => plain(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p
const linesText = (e: { tool: string; lines: number }) => (e.tool === 'Write' ? `${e.lines}行` : `約${e.lines}行`)

const svgDoc = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<rect width="${W}" height="${h}" fill="${C.bg}"/>${body}</svg>`

const tile = (x: number, y: number, label: string, value: string, color: string) =>
  `<rect x="${x}" y="${y}" width="110" height="54" rx="6" fill="${C.bg}" stroke="${C.line}"/>` +
  `<rect x="${x}" y="${y}" width="3" height="54" rx="1.5" fill="${color}"/>` +
  `<text x="${x + 12}" y="${y + 17}" font-size="12" fill="${C.weak}">${label}</text>` +
  `<text x="${x + 12}" y="${y + 45}" font-size="24" font-weight="bold" fill="${color}">${value}</text>`

const grow = (from: number, to: number, attr: string) =>
  `<animate attributeName="${attr}" from="${from}" to="${to}" dur="0.6s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>`

/** ツールの色の見本 */
function legend(y: number) {
  const items: [string, string][] = [
    ['Edit', C.blue],
    ['Write', C.green],
    ['MultiEdit', C.purple],
    ['Notebook', C.orange],
    ['失敗', C.red],
  ]
  let x = 14
  let s = `<g font-size="12" fill="${C.weak}">`
  for (const [label, color] of items) {
    s += `<circle cx="${x + 4}" cy="${y - 4}" r="4" fill="${color}"/><text x="${x + 12}" y="${y}">${label}</text>`
    x += 12 + units(label) * 7 + 12
  }
  return `${s}</g>`
}

/** タイムラインの 1 行 (高さ 36)。isNewest は波紋を付ける */
function eventRow(e: EditLogEntry, y: number, isNewest: boolean, withFile: boolean) {
  const color = e.isError ? C.red : toolColor(e.tool)
  let s = ''
  if (isNewest)
    s +=
      `<circle cx="20" cy="${y + 8}" r="6" fill="none" stroke="${color}" stroke-width="2">` +
      `<animate attributeName="r" values="6;13" dur="1.4s" repeatCount="3"/>` +
      `<animate attributeName="opacity" values="1;0" dur="1.4s" repeatCount="3" fill="freeze"/></circle>`
  s += e.isSub
    ? `<circle cx="20" cy="${y + 8}" r="5" fill="${C.bg}" stroke="${color}" stroke-width="2" stroke-dasharray="2 2"/>`
    : `<circle cx="20" cy="${y + 8}" r="5.5" fill="${color}"/>`
  if (e.isError)
    s += `<path d="M17 ${y + 5} L23 ${y + 11} M23 ${y + 5} L17 ${y + 11}" stroke="${C.bg}" stroke-width="2" stroke-linecap="round"/>`
  s +=
    `<text x="34" y="${y + 12}" font-size="12" font-family="${MONO}" fill="${C.weak}">${clockLabel(e.at)}</text>` +
    `<text x="102" y="${y + 12}" font-size="12" font-weight="bold" fill="${color}">${esc(e.tool)}</text>`
  if (e.isSub)
    s +=
      `<rect x="${110 + units(e.tool) * 7}" y="${y}" width="34" height="16" rx="8" fill="none" stroke="${C.purple}"/>` +
      `<text x="${127 + units(e.tool) * 7}" y="${y + 12}" font-size="12" fill="${C.purple}" text-anchor="middle">サブ</text>`
  s += e.isError
    ? `<text x="368" y="${y + 12}" font-size="12" fill="${C.red}" text-anchor="end">失敗</text>`
    : `<text x="368" y="${y + 12}" font-size="12" fill="${C.weak}" text-anchor="end">${linesText(e)}</text>`
  if (withFile) s += `<text x="34" y="${y + 29}" font-size="13" fill="${C.text}">${esc(tailFit(e.label, 46))}</text>`
  return s
}

function messageSvg(title: string, hint: string) {
  return svgDoc(
    96,
    `<rect x="8" y="8" width="364" height="80" rx="8" fill="${C.face}" stroke="${C.line}"/>` +
      `<g stroke="${C.blue}" stroke-width="2" fill="none" stroke-linecap="round">` +
      `<rect x="22" y="24" width="20" height="26" rx="3"/><line x1="27" y1="32" x2="37" y2="32"/><line x1="27" y1="38" x2="37" y2="38"/><line x1="27" y1="44" x2="33" y2="44"/></g>` +
      `<text x="54" y="42" font-size="15" font-weight="bold" fill="${C.text}">${esc(title)}</text>` +
      `<text x="20" y="72" font-size="12" fill="${C.weak}">${esc(hint)}</text>`,
  )
}

/** 一覧の SVG: タイル・ファイルごとの横棒・時刻のタイムライン */
export function overviewSvg(entries: readonly EditLogEntry[]) {
  if (entries.length === 0) return messageSvg('まだ変更はありません', 'Claude がファイルを変えると、ここに時系列で並びます')
  const t = summary(entries)
  let s = `<rect x="8" y="8" width="364" height="104" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  s += `<text x="18" y="32" font-size="15" font-weight="bold" fill="${C.text}">このセッションの変更</text>`
  if (t.subs > 0) s += `<text x="364" y="32" font-size="12" fill="${C.purple}" text-anchor="end">うちサブ ${t.subs} 回</text>`
  s += tile(16, 46, '触ったファイル', `${t.files}本`, C.blue)
  s += tile(135, 46, '変更', `${t.changes}回`, C.green)
  s += tile(254, 46, '失敗', `${t.fails}回`, t.fails > 0 ? C.red : C.weak)

  // ── ファイルごとの回数
  const stats = fileStats(entries)
  const top = stats.slice(0, TOP_FILES)
  const max = Math.max(1, ...top.map(f => f.count))
  let y = 140
  s += `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">ファイルごとの回数</text>`
  s += `<text x="368" y="${y}" font-size="12" fill="${C.weak}" text-anchor="end">${top.length} / ${stats.length}</text>`
  y += 12
  for (const f of top) {
    const wAll = Math.max(4, (f.count / max) * 348)
    const wFail = f.fails ? Math.max(3, (f.fails / f.count) * wAll) : 0
    s +=
      `<text x="16" y="${y + 13}" font-size="12" fill="${C.text}">${esc(tailFit(f.label, 38))}</text>` +
      `<text x="364" y="${y + 13}" font-size="12" text-anchor="end">` +
      (f.fails ? `<tspan fill="${C.red}">失敗${f.fails}</tspan><tspan dx="6" fill="${C.text}">${f.count}回</tspan>` : `<tspan fill="${C.text}">${f.count}回</tspan>`) +
      `</text>` +
      `<rect x="16" y="${y + 19}" width="348" height="8" rx="4" fill="${C.face}"/>` +
      `<rect x="16" y="${y + 19}" width="${wAll}" height="8" rx="4" fill="${C.blue}">${grow(0, wAll, 'width')}</rect>`
    // 失敗の分は棒の頭に赤で重ねる
    if (wFail) s += `<rect x="16" y="${y + 19}" width="${wFail}" height="8" rx="4" fill="${C.red}">${grow(0, wFail, 'width')}</rect>`
    y += 34
  }
  if (stats.length > TOP_FILES) {
    s += `<text x="16" y="${y + 6}" font-size="12" fill="${C.weak}">ほか ${stats.length - TOP_FILES} 本</text>`
    y += 16
  }

  // ── タイムライン (新しい順)
  y += 24
  s += `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">タイムライン</text>`
  y += 22
  s += legend(y)
  y += 14
  const recent = entries.slice(-TOP_EVENTS).reverse()
  if (recent.length > 1) s += `<line x1="20" y1="${y + 8}" x2="20" y2="${y + 8 + (recent.length - 1) * 40}" stroke="${C.line}" stroke-width="2"/>`
  recent.forEach((e, i) => {
    s += eventRow(e, y, i === 0, true)
    y += 40
  })
  if (entries.length > TOP_EVENTS) {
    s += `<text x="34" y="${y + 12}" font-size="12" fill="${C.weak}">ほか ${entries.length - TOP_EVENTS} 回 (古い物)</text>`
    y += 20
  }
  return svgDoc(y + 8, s)
}

/** 詳細の SVG: そのファイルの合計と変更履歴 */
export function detailSvg(label: string, entries: readonly EditLogEntry[]) {
  const mine = entries.filter(e => e.label === label)
  const fails = mine.filter(e => e.isError).length
  const lines = mine.filter(e => !e.isError).reduce((n, e) => n + e.lines, 0)
  let s = `<rect x="8" y="8" width="364" height="126" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  s += `<text x="18" y="34" font-size="17" font-weight="bold" fill="${C.text}">${esc(tailFit(base(label), 40))}</text>`
  s += `<text x="18" y="54" font-size="12" fill="${C.weak}">${esc(tailFit(label, 52))}</text>`
  s += tile(16, 70, '変更', `${mine.length}回`, C.green)
  s += tile(135, 70, '失敗', `${fails}回`, fails > 0 ? C.red : C.weak)
  s += tile(254, 70, '行のめやす', `${lines}`, C.blue)
  let y = 162
  s += `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">このファイルの変更履歴</text>`
  y += 14
  const rows = mine.slice(-TOP_HISTORY).reverse()
  if (rows.length > 1) s += `<line x1="20" y1="${y + 8}" x2="20" y2="${y + 8 + (rows.length - 1) * 24}" stroke="${C.line}" stroke-width="2"/>`
  rows.forEach((e, i) => {
    s += eventRow(e, y, i === 0, false)
    y += 24
  })
  if (mine.length > TOP_HISTORY) {
    s += `<text x="34" y="${y + 4}" font-size="12" fill="${C.weak}">ほか ${mine.length - TOP_HISTORY} 回 (古い物)</text>`
    y += 16
  }
  return svgDoc(y + 8, s)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

const rowText = (e: EditLogEntry) =>
  `${clockLabel(e.at)} ${e.tool}${e.isSub ? '(サブ)' : ''} ${e.isError ? '失敗' : linesText(e)}`

/** Svg の alt と terminal で使う、一覧の行 */
export function overviewLines(entries: readonly EditLogEntry[]): Line[] {
  if (entries.length === 0) return [{ text: 'まだ変更はありません', isDim: true }]
  const t = summary(entries)
  const lines: Line[] = [
    { text: `触ったファイル ${t.files}本 / 変更 ${t.changes}回 / 失敗 ${t.fails}回`, isBold: true },
    { text: 'タイムライン(新しい順)', isBold: true },
  ]
  for (const e of entries.slice(-TOP_EVENTS).reverse())
    lines.push({ text: `${rowText(e)} ${e.label}`, color: e.isError ? 'red' : undefined, isDim: e.isSub })
  if (entries.length > TOP_EVENTS) lines.push({ text: `ほか ${entries.length - TOP_EVENTS} 回`, isDim: true })
  return lines
}

/** Svg の alt と terminal で使う、詳細の行 */
export function detailLines(label: string, entries: readonly EditLogEntry[]): Line[] {
  const mine = entries.filter(e => e.label === label)
  return [
    { text: label, isBold: true },
    { text: `変更 ${mine.length}回 / 失敗 ${mine.filter(e => e.isError).length}回` },
    ...mine.slice(-TOP_HISTORY).reverse().map(e => ({ text: rowText(e), color: e.isError ? 'red' : undefined, isDim: e.isSub })),
  ]
}
