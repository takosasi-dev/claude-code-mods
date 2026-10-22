// 文字コード・改行の罠の見分けと、ペインの SVG と文。どれも純関数
import type { EncEntry, EncRule } from '../types'
import { C, HEADER_H, esc, frame, growBar, header, panel, short } from './style'

export const LOG_MAX = 30
export const RULES: readonly EncRule[] = ['ps-encoding', 'ps1-bom', 'bat-ascii', 'py-open']

/** 罠の名前と、Claude に伝える直し方 */
export const RULE: Record<EncRule, { name: string; fix: string }> = {
  'ps-encoding': {
    name: 'Set-Content に -Encoding が無い',
    fix: 'PowerShell 5.1 の Set-Content / Add-Content は -Encoding が無いと ANSI (cp932) で書きます。-Encoding utf8 (BOM 付き) を付けるか、BOM なしが要る所では [IO.File]::WriteAllText($p, $s, [Text.UTF8Encoding]::new($false)) を使ってください',
  },
  'ps1-bom': {
    name: '日本語入りの .ps1 に BOM が無い',
    fix: 'PowerShell 5.1 は BOM の無い .ps1 を cp932 として読み、日本語の所で構文エラーになります。ASCII だけで書き直すか、UTF-8 の BOM 付きで保存し直してください (例: $t = Get-Content -Raw -Encoding UTF8 $p; [IO.File]::WriteAllText($p, $t, [Text.UTF8Encoding]::new($true)))',
  },
  'bat-ascii': {
    name: '.bat / .cmd に ASCII 以外の字',
    fix: 'cmd は .bat / .cmd を cp932 で読むので、日本語などは化けます。.bat / .cmd は ASCII だけで書いてください (日本語の表示が要るなら .ps1 に分ける)',
  },
  'py-open': {
    name: 'Python の open に encoding= / newline= が無い',
    fix: "Windows の Python は open(p, 'w') を cp932 で書き、LF を CRLF に変えます。open(p, 'w', encoding='utf-8', newline='') のように両方を指定してください (Path.write_text も encoding='utf-8' を付ける)",
  },
}

// ── コマンドの読み方 (ship-guard・compact-cue と同じ形。mod は別々に入れるので写して持つ)

/** 引用符の中身とヒアドキュメントの本文を Q に置き換える (文字列の中の言葉を拾わない) */
export function unquote(command: string) {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, ' Q')
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'Q')
}

/** コマンドの区切り (&& ; | など) で分けた 1 つずつ。頭の VAR=値 と & は落とす */
export function segments(command: string) {
  return unquote(command)
    .split(/&&|\|\||[;|\n`{}]|\$\(|\(/)
    .map(s => s.trim().replace(/^(?:[\w.]+=\S*\s+)*(?:&\s*)?/, ''))
    .filter(s => s !== '')
}

const WRITES = /^(?:Microsoft\.PowerShell\.Management\\)?(?:Set-Content|Add-Content)\b/i
const HAS_ENCODING = /\s-En(?:c(?:o(?:d(?:i(?:n(?:g)?)?)?)?)?)?\b/i

/** PowerShell の文の中の、-Encoding の無い Set-Content / Add-Content の数 */
const countBare = (parts: string[]) => parts.filter(s => WRITES.test(s) && !HAS_ENCODING.test(s)).length

/**
 * -Encoding の無い Set-Content / Add-Content があるか。PowerShell のツールは引用符を外して区切りで分ける。
 * Bash から powershell / pwsh を呼ぶ時は、引用符の中にコマンドがあるので、そのまま ; | で分ける
 */
export function hasBarePsWrite(command: string, isPowerShellTool: boolean) {
  if (isPowerShellTool) return countBare(segments(command)) > 0
  if (!/\b(?:powershell|pwsh)(?:\.exe)?\b/i.test(command)) return false
  // 引用符の中の Set-Content から、文の終わり (; | 改行 ") までを 1 つとして見る
  return [...command.matchAll(/(?:Set|Add)-Content\b[^;|\n"]*/gi)].some(m => !HAS_ENCODING.test(m[0]))
}

/** Python を走らせるコマンドか (python・python3・py・パス付きの python.exe・uv run python) */
export const runsPython = (command: string) => segments(command).some(s => /^(?:\S*[\\/])?(?:python\d*(?:\.\d+)?|py|uv\s+run\s+python\d*)(?:\.exe)?\b/i.test(s))

/** open( の後ろの、対応する ) までの引数 (入れ子の括弧を数える)。閉じていなければ行の終わりまで */
function argsAfter(text: string, at: number) {
  let depth = 1
  for (let i = at; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return text.slice(at, i)
  }
  return text.slice(at, text.indexOf('\n', at) < 0 ? undefined : text.indexOf('\n', at))
}

/**
 * Python のコードの中の、encoding= の無い書き込み。open(..., 'w'/'a'/'x') で encoding= か newline= が無い物と、
 * write_text( で encoding= が無い物。バイナリ ('wb') と読むだけの open は見ない
 */
export function barePyWrites(code: string) {
  const hits: string[] = []
  // x.open( (Image.open・zipfile など) は別物なので、組み込みの open( と .write_text( だけ
  for (const m of code.matchAll(/(?<![\w.])open\(|\.write_text\(/g)) {
    const args = argsAfter(code, (m.index ?? 0) + m[0].length)
    const hasEncoding = /\bencoding\s*=/.test(args)
    if (m[0].includes('write_text')) {
      if (!hasEncoding) hits.push(`write_text(${short(args.trim(), 30)})`)
      continue
    }
    const mode = /(?:^|,)\s*(?:mode\s*=\s*)?[rbuRBU]?(['"])([rwaxbt+]+)\1/.exec(args)?.[2] ?? 'r'
    if (!/[wax]/.test(mode) || mode.includes('b')) continue
    if (!hasEncoding || !/\bnewline\s*=/.test(args)) hits.push(`open(${short(args.trim(), 30)})`)
  }
  return hits
}

// ── ファイルの読み方

const EXT = (path: string) => /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
export const isPs1 = (path: string) => ['ps1', 'psm1', 'psd1'].includes(EXT(path))
export const isBat = (path: string) => ['bat', 'cmd'].includes(EXT(path))
export const isPy = (path: string) => ['py', 'pyw'].includes(EXT(path))

export const hasNonAscii = (text: string) => /[^\x00-\x7f]/.test(text)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** base64 を中身のバイトに戻す ($.fs.read の bytes の答え) */
export function bytesOf(base64: string) {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let n = 0
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map(k => Math.max(0, B64.indexOf(clean[i + k] ?? 'A')))
    const word = ((v[0] ?? 0) << 18) | ((v[1] ?? 0) << 12) | ((v[2] ?? 0) << 6) | (v[3] ?? 0)
    out[n++] = (word >> 16) & 255
    if (i + 2 < clean.length) out[n++] = (word >> 8) & 255
    if (i + 3 < clean.length) out[n++] = word & 255
  }
  return out.slice(0, n)
}

export const hasBom = (bytes: Uint8Array) => bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
export const hasHighByte = (bytes: Uint8Array) => bytes.some(b => b > 0x7f)

// ── ペイン

const clock = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}

const RULE_COLOR = (r: EncRule) => ({ 'ps-encoding': C.blue, 'ps1-bom': C.red, 'bat-ascii': C.yellow, 'py-open': C.green })[r]
const RULE_TERM = (r: EncRule) => ({ 'ps-encoding': 'suggestion', 'ps1-bom': 'error', 'bat-ascii': 'warning', 'py-open': 'success' })[r]
const ACTION = { told: 'Claude に伝えた', blocked: '止めた' } as const

export type PaneInput = { log: EncEntry[]; counts: Record<EncRule, number>; isBlocking: boolean }

const modeWord = (i: PaneInput) => (i.isBlocking ? '見つけたら止めます' : '見つけたら Claude に伝えます')

/** ペインの SVG 1 枚 */
export function paneSvg(i: PaneInput) {
  const total = RULES.reduce((a, r) => a + i.counts[r], 0)
  const accent = total === 0 ? C.green : C.yellow
  let s = panel(8, 8, 364, 52)
  s += `<text x="20" y="32" font-size="15" font-weight="bold" fill="${accent}">${total === 0 ? '罠は踏んでいません' : `このセッションで ${total} 回`}</text>`
  s += `<text x="20" y="50" font-size="12" fill="${C.dim}">${modeWord(i)}</text>`
  const max = Math.max(1, ...RULES.map(r => i.counts[r]))
  const y0 = 68
  s += panel(8, y0, 364, RULES.length * 34 + 16)
  RULES.forEach((r, n) => {
    const y = y0 + 14 + n * 34
    s += `<text x="20" y="${y + 12}" font-size="12" fill="${C.text}">${esc(short(RULE[r].name, 26))}</text>`
    s += `<text x="360" y="${y + 12}" font-size="12" font-weight="bold" text-anchor="end" fill="${C.text}">${i.counts[r]} 回</text>`
    s += `<rect x="20" y="${y + 18}" width="340" height="6" rx="3" fill="${C.line}"/>`
    if (i.counts[r] > 0) s += growBar(20, y + 18, Math.max(6, (340 * i.counts[r]) / max), 6, RULE_COLOR(r), n * 0.08)
  })
  const rows = i.log.slice(-6).reverse()
  const y1 = y0 + RULES.length * 34 + 24
  const h = Math.max(1, rows.length) * 36 + 36
  s += panel(8, y1, 364, h)
  s += `<text x="20" y="${y1 + 22}" font-size="13" font-weight="bold" fill="${C.text}">最近の記録</text>`
  if (rows.length === 0) s += `<text x="20" y="${y1 + 50}" font-size="12" fill="${C.dim}">まだありません</text>`
  rows.forEach((e, n) => {
    const y = y1 + 36 + n * 36
    s += `<rect x="20" y="${y}" width="4" height="28" rx="2" fill="${RULE_COLOR(e.rule)}"/>`
    s += `<text x="32" y="${y + 12}" font-size="12" font-weight="bold" fill="${C.text}">${esc(short(RULE[e.rule].name, 24))}</text>`
    s += `<text x="360" y="${y + 12}" font-size="11" text-anchor="end" fill="${C.dim}">${clock(e.at)} ${ACTION[e.action]}</text>`
    s += `<text x="32" y="${y + 26}" font-size="11" fill="${C.dim}">${esc(short(e.where, 40))}</text>`
  })
  return frame(HEADER_H + y1 + h + 8, header('文字コードの見張り', `${total} 回`, accent) + `<g transform="translate(0 ${HEADER_H})">${s}</g>`)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(i: PaneInput): Line[] {
  const total = RULES.reduce((a, r) => a + i.counts[r], 0)
  const lines: Line[] = [
    { text: total === 0 ? '罠は踏んでいません' : `このセッションで ${total} 回`, isBold: true, color: total === 0 ? 'success' : 'warning' },
    { text: modeWord(i), isDim: true },
  ]
  for (const r of RULES) lines.push({ text: `${RULE[r].name}: ${i.counts[r]} 回` })
  if (i.log.length > 0) lines.push({ text: '最近の記録', isBold: true })
  for (const e of i.log.slice(-6).reverse()) lines.push({ text: `${clock(e.at)} ${RULE[e.rule].name} ─ ${ACTION[e.action]} (${short(e.where, 40)})`, color: RULE_TERM(e.rule) })
  return lines
}

/** Claude に伝える文 */
export const noteText = (rule: EncRule, where: string) => `enc-guard: ${RULE[rule].name} (${short(where, 80)})。${RULE[rule].fix}`
