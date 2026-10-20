// SpecStatus の出力を読み、ペインの SVG と terminal 用の行を組む。どれも純関数
import type { SpecBoardItem, SpecBoardNext, SpecBoardSnap } from '../types'

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

/** 呼んでよいサブコマンド。データを書く物 (mark・update・schedule・notify・build・gui・shortcut) は呼ばない */
export const READ_ONLY = new Set(['list', 'next', 'show'])
export const WAITING_ARGS = ['list', '--waiting', '--json']
export const PROGRESS_ARGS = ['list', '--state', '着手済', '--state', '一部未実装', '--json']
export const NEXT_ARGS = ['next']
// 名前が - で始まっても引数として読まれないよう -- を挟む
export const showArgs = (name: string) => ['show', '--', name]

export const UNSET_HINT = '未設定。/config で spec-board の pythonPath (python の場所) と specstatusScript (specstatus.py の場所) に絶対パスを入れてください'

/** 絶対パスか。C: のようなドライブだけ・相対パスは違う */
export const isAbsolute = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')
/** python の指定: 絶対パスか、区切りを含まないコマンド名 (python3 など。PATH から探す) */
export const isPythonOk = (p: string) => isAbsolute(p) || /^[\w.-]+$/.test(p)

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
/** 1 行にする: 制御文字を落とし、タブ・改行は空白に */
export const clean = (s: unknown) =>
  String(s ?? '')
    .replace(ANSI, '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(CTRL, '')
    .trim()
/** 複数行のまま制御文字を落とす (Code に出す物) */
export const cleanBlock = (s: string) => s.replace(ANSI, '').replace(/\r\n?/g, '\n').replace(CTRL, '')

/** 出力の頭 n 行 (失敗した時に見せる) */
export function headOf(out: string, n = 12) {
  return cleanBlock(out)
    .split('\n')
    .filter(l => l.trim() !== '')
    .slice(0, n)
    .join('\n')
    .slice(0, 2000)
}

const wide = (ch: string) => /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
/** 全角 2・半角 1 の幅で max に収め、はみ出たら末尾を … にする */
export function cut(s: string, max: number) {
  if ([...s].reduce((n, ch) => n + (wide(ch) ? 2 : 1), 0) <= max) return s
  let out = ''
  let n = 1
  for (const ch of s) {
    n += wide(ch) ? 2 : 1
    if (n > max) break
    out += ch
  }
  return `${out}…`
}

const str = (v: unknown) => (typeof v === 'string' ? clean(v) : '')
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** list --json の出力を読む。配列でなければ例外 */
export function parseList(stdout: string): SpecBoardItem[] {
  const data: unknown = JSON.parse(stdout)
  if (!Array.isArray(data)) throw new Error('JSON の形が違います (配列ではありません)')
  const items: SpecBoardItem[] = []
  for (const x of data) {
    if (typeof x !== 'object' || x === null) continue
    const r = x as Record<string, unknown>
    const name = str(r.name)
    if (name === '') continue
    const done = int(r.done_phase)
    const last = int(r.last_phase)
    const phase = last !== undefined ? `Phase ${done ?? 0}/${last}` : ''
    const waiting = str(r.waiting)
    items.push({ name, state: str(r.state), waiting: waiting === 'なし' ? '' : waiting, note: str(r.note), phase })
  }
  return items
}

/** 確認待ち (依頼者が動く物) を先に。ほかは元の順 */
export const sortWaiting = (items: SpecBoardItem[]) =>
  [...items].sort((a, b) => Number(b.waiting === '確認待ち') - Number(a.waiting === '確認待ち'))

/** next の出力 (「 170  名前  (状態)  理由」の行) を読む。合わない行は飛ばす */
export function parseNext(stdout: string): SpecBoardNext[] {
  const out: SpecBoardNext[] = []
  for (const line of cleanBlock(stdout).split('\n')) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s{2,}(.+?)\s{2,}\((.+?)\)(?:\s{2,}(.*))?$/.exec(line)
    if (!m) continue
    out.push({ score: Number(m[1]), name: clean(m[2]), state: clean(m[3]), reasons: clean(m[4] ?? '') })
  }
  return out
}

/** 標準エラーの最初の行 (GitHub の回数の上限などの知らせ) */
export const noticeOf = (stderr: string) => cut(clean(cleanBlock(stderr).split('\n').find(l => l.trim() !== '') ?? ''), 80)

export const clockLabel = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}

const esc = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const svgDoc = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<rect width="${W}" height="${h}" fill="${C.bg}"/>${body}</svg>`

const count = (items: SpecBoardItem[], f: (i: SpecBoardItem) => boolean) => items.filter(f).length

function tile(x: number, label: string, value: string, sub: string, color: string, isPulsing: boolean) {
  const pulse = isPulsing
    ? `<circle cx="${x + 100}" cy="26" r="4" fill="${color}"><animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite"/></circle>`
    : ''
  return (
    `<rect x="${x}" y="10" width="114" height="84" rx="8" fill="${C.face}" stroke="${C.line}"/>` +
    `<rect x="${x}" y="10" width="4" height="84" rx="2" fill="${color}"/>` +
    `<text x="${x + 14}" y="30" font-size="12" fill="${C.weak}">${label}</text>` +
    pulse +
    `<text x="${x + 14}" y="64" font-size="${value.length > 3 ? 22 : 28}" font-weight="bold" fill="${color}">${esc(value)}</text>` +
    `<text x="${x + 14}" y="84" font-size="12" fill="${C.weak}">${esc(cut(sub, 15))}</text>`
  )
}

/** 件数のタイル 3 枚と、おすすめの点数の棒 */
function okSvg(snap: Extract<SpecBoardSnap, { kind: 'ok' }>) {
  const ask = count(snap.waiting, i => i.waiting === '確認待ち')
  const real = count(snap.waiting, i => i.waiting === '実物待ち')
  const part = count(snap.progress, i => i.state === '一部未実装')
  let s =
    tile(8, '待ち', String(snap.waiting.length), `確認 ${ask}・実物 ${real}`, C.yellow, ask > 0) +
    tile(133, '途中', String(snap.progress.length), `着手 ${snap.progress.length - part}・一部 ${part}`, C.blue, false) +
    tile(258, '次のおすすめ', String(snap.next.length), snap.next[0]?.name ?? 'なし', C.green, false)
  const rows = snap.next.slice(0, 5)
  if (rows.length === 0) return svgDoc(104, s)
  const y0 = 104
  const h = 34 + rows.length * 34
  s += `<rect x="8" y="${y0}" width="364" height="${h}" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  s += `<text x="20" y="${y0 + 22}" font-size="13" font-weight="bold" fill="${C.text}">おすすめ (点数の高い順)</text>`
  const max = Math.max(1, ...rows.map(r => r.score))
  rows.forEach((r, i) => {
    const y = y0 + 34 + i * 34
    const bw = Math.max(4, (Math.max(0, r.score) / max) * 250)
    s += `<text x="20" y="${y + 12}" font-size="12" fill="${C.text}">${esc(cut(r.name, 34))}</text>`
    s += `<text x="360" y="${y + 12}" font-size="12" fill="${C.weak}" text-anchor="end">${esc(cut(r.state, 10))}</text>`
    s += `<rect x="20" y="${y + 18}" width="250" height="8" rx="4" fill="${C.bg}"/>`
    s +=
      `<rect x="20" y="${y + 18}" width="${bw}" height="8" rx="4" fill="${C.green}">` +
      `<animate attributeName="width" from="0" to="${bw}" dur="0.6s" fill="freeze"/></rect>`
    s += `<text x="280" y="${y + 26}" font-size="12" fill="${C.green}">${r.score}</text>`
  })
  return svgDoc(y0 + h + 8, s)
}

/** 未設定・失敗・まだ読んでいない時の札 */
function messageSvg(title: string, color: string, lines: string[]) {
  const shown = lines.slice(0, 8)
  let s = `<rect x="8" y="8" width="364" height="${52 + shown.length * 20}" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  s += `<rect x="8" y="8" width="4" height="${52 + shown.length * 20}" rx="2" fill="${color}"/>`
  s += `<text x="24" y="38" font-size="18" font-weight="bold" fill="${color}">${esc(title)}</text>`
  shown.forEach((l, i) => (s += `<text x="24" y="${64 + i * 20}" font-size="12" fill="${C.text}">${esc(cut(l, 54))}</text>`))
  return svgDoc(68 + shown.length * 20, s)
}

/** 54 桁ずつに折る */
function wrap(s: string, max = 54) {
  const out: string[] = []
  let line = ''
  let n = 0
  for (const ch of s) {
    const w = wide(ch) ? 2 : 1
    if (n + w > max) {
      out.push(line)
      line = ''
      n = 0
    }
    line += ch
    n += w
  }
  if (line !== '') out.push(line)
  return out
}

export function paneSvg(snap: SpecBoardSnap) {
  if (snap.kind === 'ok') return okSvg(snap)
  if (snap.kind === 'unset') return messageSvg('未設定', C.yellow, wrap(UNSET_HINT.replace(/^未設定。/, '')))
  if (snap.kind === 'error') return messageSvg(`${snap.step} が失敗しました`, C.red, wrap(snap.message))
  return messageSvg('読み込み中', C.weak, ['SpecStatus を読んでいます'])
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** terminal と Svg の alt に使う、上の部分の文 */
export function summaryLines(snap: SpecBoardSnap): Line[] {
  if (snap.kind === 'unset') return [{ text: UNSET_HINT, color: 'yellow' }]
  if (snap.kind === 'error') return [{ text: `${snap.step} が失敗しました: ${snap.message}`, color: 'red' }]
  if (snap.kind === 'idle') return [{ text: '読み込み中', isDim: true }]
  const ask = count(snap.waiting, i => i.waiting === '確認待ち')
  return [
    { text: `待ち ${snap.waiting.length} (確認待ち ${ask}) / 途中 ${snap.progress.length} / おすすめ ${snap.next.length}`, isBold: true },
    ...snap.next.slice(0, 5).map(r => ({ text: `${r.score} ${r.name} (${r.state})` })),
  ]
}

/** 一覧の行の右に出す小さい文 */
export const tagOf = (i: SpecBoardItem) => [i.state, i.waiting, i.phase].filter(Boolean).join('・')
