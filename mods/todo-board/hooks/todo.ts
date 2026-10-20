// git grep の出力を表示用のデータに変え、SVG と terminal 用の行を組む。どれも純関数
import type { TodoFile, TodoItem, TodoKind, TodoPoint, TodoSnapshot } from '../types'

type Repo = Extract<TodoSnapshot, { kind: 'repo' }>
export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

export const KINDS: readonly TodoKind[] = ['FIXME', 'TODO', 'HACK', 'XXX']
/** 持っておく件数の上限 */
export const LIMIT = 500
/** 横棒に出すファイルの数 */
export const TOP = 10
/** git grep -E に渡す形 */
export const PATTERN = '\\b(TODO|FIXME|HACK|XXX)\\b'
const KIND_RE = /\b(TODO|FIXME|HACK|XXX)\b/

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
export const KIND_COLOR: Record<TodoKind, string> = { FIXME: C.red, TODO: C.blue, HACK: C.orange, XXX: C.purple }
const W = 380

const zero = (): Record<TodoKind, number> => ({ FIXME: 0, TODO: 0, HACK: 0, XXX: 0 })

/** `git grep -n -z` の出力 (`ファイル\0行\0本文\n` の並び) から表示用のデータを作る */
export function parseGrep(out: string, limit = LIMIT): Omit<Repo, 'kind' | 'cwd' | 'isCut' | 'loadedAt'> {
  const counts = zero()
  const per = new Map<string, TodoFile>()
  const items: TodoItem[] = []
  let total = 0
  for (const raw of out.split('\n')) {
    const [path = '', ln = '', ...rest] = raw.split('\0')
    if (path === '' || rest.length === 0) continue
    const text = rest.join(' ').replace(/\r$/, '')
    const kind = KIND_RE.exec(text)?.[1] as TodoKind | undefined
    if (!kind) continue
    total++
    counts[kind]++
    let f = per.get(path)
    if (!f) per.set(path, (f = { path, count: 0, byKind: zero() }))
    f.count++
    f.byKind[kind]++
    if (items.length < limit) items.push({ path, line: Number(ln) || 0, kind, text: text.trim().slice(0, 300) })
  }
  const files = [...per.values()].sort((p, q) => q.count - p.count || p.path.localeCompare(q.path))
  return { items, total, counts, files: files.slice(0, TOP), fileCount: files.length }
}

export const itemId = (it: TodoItem) => `${it.path}:${it.line}`

/** 前回より何件減ったか (増えたら負)。比べる相手が無ければ undefined */
export function delta(history: readonly TodoPoint[]) {
  const last = history[history.length - 1]
  const prev = history[history.length - 2]
  return last && prev ? prev.total - last.total : undefined
}

const deltaText = (d: number | undefined) =>
  d === undefined ? '' : d > 0 ? `${d} 件減りました` : d < 0 ? `${-d} 件増えました` : '前回と同じです'

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

/** 幅に収まらなければ頭を残して末尾を … にする */
export function headFit(s: string, max: number) {
  if (units(s) <= max) return s
  let out = ''
  let n = 1
  for (const ch of s) {
    n += wide(ch) ? 2 : 1
    if (n > max) break
    out += ch
  }
  return `${out}…`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

const svgDoc = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<rect width="${W}" height="${h}" fill="${C.bg}"/>${body}</svg>`

function messageSvg(title: string, color: string, sub: string, hint: string) {
  return svgDoc(
    120,
    `<rect x="8" y="8" width="364" height="104" rx="8" fill="${C.face}" stroke="${C.line}"/>` +
      `<circle cx="34" cy="40" r="12" fill="none" stroke="${color}" stroke-width="2"/>` +
      `<line x1="34" y1="34" x2="34" y2="41" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
      `<circle cx="34" cy="46" r="1.5" fill="${color}"/>` +
      `<text x="56" y="45" font-size="15" font-weight="bold" fill="${color}">${esc(title)}</text>` +
      `<text x="20" y="76" font-size="12" fill="${C.weak}">${esc(tailFit(sub, 52))}</text>` +
      `<text x="20" y="98" font-size="12" fill="${C.weak}">${esc(headFit(hint, 52))}</text>`,
  )
}

const grow = (attr: string, from: number, to: number, begin = 0) =>
  `<animate attributeName="${attr}" from="${from}" to="${to}" begin="${begin}s" dur="0.7s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>`

/** 推移の折れ線。点が 1 つなら点だけ */
function trendSvg(history: readonly TodoPoint[], y: number) {
  const pts = history.slice(-20)
  let s = `<rect x="8" y="${y}" width="364" height="112" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  const top = y + 18
  const bottom = y + 90
  const left = 44
  const right = 356
  const max = Math.max(1, ...pts.map(p => p.total))
  const min = Math.min(...pts.map(p => p.total))
  const lo = min === max ? 0 : Math.max(0, min - Math.ceil((max - min) * 0.2))
  const py = (v: number) => bottom - ((v - lo) / Math.max(1, max - lo)) * (bottom - top)
  const px = (i: number) => (pts.length < 2 ? (left + right) / 2 : left + (i / (pts.length - 1)) * (right - left))
  s +=
    `<line x1="${left}" y1="${top}" x2="${right}" y2="${top}" stroke="${C.line}" stroke-dasharray="2 3"/>` +
    `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${C.line}"/>` +
    `<text x="${left - 6}" y="${top + 4}" font-size="12" fill="${C.weak}" text-anchor="end">${max}</text>` +
    `<text x="${left - 6}" y="${bottom + 4}" font-size="12" fill="${C.weak}" text-anchor="end">${lo}</text>`
  if (pts.length === 0) return s
  const xy = pts.map((p, i) => `${px(i).toFixed(1)},${py(p.total).toFixed(1)}`)
  const last = pts[pts.length - 1]
  const lastX = px(pts.length - 1)
  if (pts.length > 1) {
    s +=
      `<path d="M${xy[0]} L${xy.slice(1).join(' L')} L${lastX.toFixed(1)},${bottom} L${px(0).toFixed(1)},${bottom} Z" fill="${C.blue}" opacity="0.12"/>` +
      `<path d="M${xy[0]} L${xy.slice(1).join(' L')}" fill="none" stroke="${C.blue}" stroke-width="2.5" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0">` +
      `<animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.9s" calcMode="spline" keySplines="0.3 0.7 0.3 1" keyTimes="0;1" fill="freeze"/></path>`
    xy.slice(0, -1).forEach(p => {
      const [cx, cy] = p.split(',')
      s += `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${C.bg}" stroke="${C.blue}" stroke-width="1.5"/>`
    })
  }
  if (last) {
    const ly = py(last.total)
    s +=
      `<circle cx="${lastX}" cy="${ly}" r="5" fill="${C.blue}"><animate attributeName="r" values="5;8;5" dur="1.6s" repeatCount="indefinite"/></circle>` +
      `<text x="${Math.min(lastX, right - 4)}" y="${Math.max(ly - 10, top - 2)}" font-size="12" font-weight="bold" fill="${C.text}" text-anchor="end">${last.total}</text>`
  }
  return s
}

/** ペインに出す SVG 1 枚 */
export function paneSvg(snap: TodoSnapshot, history: readonly TodoPoint[]) {
  if (snap.kind === 'idle') return messageSvg('読み込み中', C.blue, '', '「再読込」で TODO を拾います')
  if (snap.kind === 'not-repo') return messageSvg('git のフォルダでだけ使えます', C.yellow, snap.cwd, 'git のリポジトリの中で開くと TODO を拾います')
  if (snap.kind === 'error') return messageSvg('git grep を実行できません', C.red, snap.message, 'git が入っているか確かめてください')

  let s = ''
  // ── 見出しと合計
  s +=
    `<rect x="8" y="8" width="364" height="56" rx="8" fill="${C.face}" stroke="${C.line}"/>` +
    `<g stroke="${C.weak}" stroke-width="2" fill="none" stroke-linecap="round">` +
    `<rect x="18" y="20" width="18" height="22" rx="3"/><line x1="23" y1="28" x2="31" y2="28"/><line x1="23" y1="34" x2="29" y2="34"/></g>` +
    `<text x="46" y="35" font-size="16" font-weight="bold" fill="${C.text}">TODO ボード</text>` +
    `<text x="46" y="54" font-size="12" fill="${C.weak}">${esc(tailFit(base(snap.cwd), 26))}</text>` +
    `<text x="350" y="46" font-size="28" font-weight="bold" fill="${C.text}" text-anchor="end">${snap.total}</text>` +
    `<text x="364" y="46" font-size="12" fill="${C.weak}" text-anchor="end">件</text>`

  // ── 種類ごとのタイル
  KINDS.forEach((k, i) => {
    const x = 8 + i * 93
    const n = snap.counts[k]
    const color = KIND_COLOR[k]
    const ratio = snap.total ? n / snap.total : 0
    s +=
      `<rect x="${x}" y="74" width="85" height="84" rx="6" fill="${C.face}" stroke="${n ? color : C.line}" stroke-opacity="${n ? 0.6 : 1}"/>` +
      `<rect x="${x}" y="74" width="85" height="4" rx="2" fill="${color}"/>` +
      `<text x="${x + 10}" y="96" font-size="12" font-weight="bold" fill="${color}">${k}</text>` +
      `<text x="${x + 10}" y="134" font-size="${n > 999 ? 20 : 28}" font-weight="bold" fill="${n ? color : C.weak}">${n}</text>` +
      `<rect x="${x + 10}" y="144" width="65" height="5" rx="2.5" fill="${C.bg}"/>` +
      (ratio > 0 ? `<rect x="${x + 10}" y="144" width="${(65 * ratio).toFixed(1)}" height="5" rx="2.5" fill="${color}">${grow('width', 0, Number((65 * ratio).toFixed(1)), i * 0.08)}</rect>` : '')
  })

  // ── 推移
  let y = 186
  const pts = history.slice(-20)
  s += `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">件数の推移</text>`
  s += `<text x="368" y="${y}" font-size="12" fill="${C.weak}" text-anchor="end">直近 ${pts.length} 回</text>`
  y += 10
  s += trendSvg(pts, y)
  y += 112
  const d = delta(pts)
  y += 22
  if (d === undefined) s += `<text x="12" y="${y}" font-size="12" fill="${C.weak}">ファイルを変えると、読み直した件数が並びます</text>`
  else if (d > 0)
    s +=
      `<g><path d="M14 ${y - 11} L26 ${y - 11} L20 ${y - 1} Z" fill="${C.green}"/>` +
      `<animateTransform attributeName="transform" type="translate" values="0 -3;0 1;0 -3" dur="1.4s" repeatCount="indefinite"/></g>` +
      `<text x="32" y="${y}" font-size="13" font-weight="bold" fill="${C.green}">${deltaText(d)}</text>`
  else if (d < 0)
    s += `<path d="M14 ${y - 1} L26 ${y - 1} L20 ${y - 11} Z" fill="${C.orange}"/><text x="32" y="${y}" font-size="13" font-weight="bold" fill="${C.orange}">${deltaText(d)}</text>`
  else s += `<text x="12" y="${y}" font-size="12" fill="${C.weak}">${deltaText(d)}</text>`

  // ── ファイルごとの横棒
  y += 34
  s += `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">多いファイル</text>`
  if (snap.fileCount > 0) s += `<text x="368" y="${y}" font-size="12" fill="${C.weak}" text-anchor="end">${snap.files.length} / ${snap.fileCount} ファイル</text>`
  y += 20
  s += `<g font-size="12" fill="${C.weak}">`
  KINDS.forEach((k, i) => {
    s += `<circle cx="${16 + i * 70}" cy="${y - 4}" r="4" fill="${KIND_COLOR[k]}"/><text x="${24 + i * 70}" y="${y}">${k}</text>`
  })
  s += `</g>`
  y += 12
  if (snap.files.length === 0) {
    s +=
      `<rect x="8" y="${y}" width="364" height="40" rx="6" fill="${C.face}" stroke="${C.line}"/>` +
      `<text x="190" y="${y + 25}" font-size="13" fill="${C.green}" text-anchor="middle">TODO はありません</text>`
    y += 48
  } else {
    const max = Math.max(1, ...snap.files.map(f => f.count))
    const h = snap.files.length * 32
    s += `<clipPath id="tb-grow"><rect x="16" y="${y}" width="0" height="${h}">${grow('width', 0, 348)}</rect></clipPath>`
    let bars = ''
    for (const f of snap.files) {
      s +=
        `<text x="16" y="${y + 12}" font-size="12" fill="${C.text}">${esc(tailFit(f.path, 44))}</text>` +
        `<text x="368" y="${y + 12}" font-size="12" font-weight="bold" fill="${C.text}" text-anchor="end">${f.count}</text>` +
        `<rect x="16" y="${y + 18}" width="348" height="8" rx="4" fill="${C.face}"/>`
      let x = 16
      for (const k of KINDS) {
        const w = (f.byKind[k] / max) * 348
        if (w > 0) bars += `<rect x="${x.toFixed(1)}" y="${y + 18}" width="${Math.max(1.5, w).toFixed(1)}" height="8" fill="${KIND_COLOR[k]}"/>`
        x += w
      }
      y += 32
    }
    s += `<g clip-path="url(#tb-grow)">${bars}</g>`
    y += 4
  }
  if (snap.isCut) {
    s += `<text x="12" y="${y + 12}" font-size="12" fill="${C.yellow}">出力が大きすぎて、途中までしか読めていません</text>`
    y += 20
  }
  return svgDoc(y + 8, s)
}

/** Svg の alt と terminal で使う文の行 */
export function paneLines(snap: TodoSnapshot, history: readonly TodoPoint[]): Line[] {
  if (snap.kind === 'idle') return [{ text: '読み込み中', isDim: true }]
  if (snap.kind === 'not-repo') return [{ text: 'git のフォルダでだけ使えます', color: 'yellow' }, { text: snap.cwd, isDim: true }]
  if (snap.kind === 'error') return [{ text: `git grep を実行できません: ${snap.message}`, color: 'red' }]
  const lines: Line[] = [
    { text: `合計 ${snap.total} 件`, isBold: true },
    { text: KINDS.map(k => `${k} ${snap.counts[k]}`).join(' / ') },
  ]
  const pts = history.slice(-5).map(p => p.total)
  if (pts.length > 0) {
    const d = delta(history)
    const mark = d === undefined ? '' : ` (${d > 0 ? '▼ ' : d < 0 ? '▲ ' : ''}${deltaText(d)})`
    lines.push({ text: `推移 ${pts.join(' → ')}${mark}`, color: d && d > 0 ? 'green' : undefined })
  }
  if (snap.files.length === 0) lines.push({ text: 'TODO はありません', color: 'green' })
  else {
    lines.push({ text: '多いファイル', isBold: true })
    for (const f of snap.files) lines.push({ text: `${String(f.count).padStart(4)}  ${f.path}` })
  }
  if (snap.isCut) lines.push({ text: '出力が大きすぎて、途中までしか読めていません', color: 'yellow' })
  return lines
}

/** 入力欄に入れる文 */
export const fixPrompt = (it: TodoItem) =>
  `${it.path} の ${it.line} 行目にある ${it.kind} を片付けてください。\n該当行: ${it.text}\n` +
  'まわりのコードを読んでから直し、片付いたらこのコメントも消してください。'

export const causePrompt = (it: TodoItem) =>
  `${it.path} の ${it.line} 行目にある ${it.kind} について、原因を調べてください。\n該当行: ${it.text}\n` +
  'なぜこれが書かれたのか、何が問題なのかを調べ、まだ直さずに、分かったことと直し方の案を教えてください。'
