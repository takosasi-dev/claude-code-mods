// compact の合図を決めて、帯・ペインの文と SVG を組む。どれも純関数
import type { CueBreak, CueContext, CuePhase } from '../types'
import { C, HEADER_H, esc, frame, header, panel } from './style'

/** 合図の段階。ok は何も出さない */
export type Level = 'ok' | 'wait' | 'good' | 'soon' | 'now'

export type Advice = { level: Level; word: string; reason: string }

export const DEFAULT_NOTIFY = 50
export const DEFAULT_URGENT = 75

/** 区切りの印の名前 */
const BREAK_LABEL: Record<CueBreak['kind'], string> = { commit: 'コミットの後', test: 'テストが通った後', memo: '引き継ぎメモを書いた後' }

/** $.session.usage() の context の形 (内訳は使う所だけ) */
export type UsageContext = {
  tokens?: number
  window: number
  percent?: number
  breakdown?: { rawMaxTokens: number; autoCompactThreshold?: number }
}

/**
 * 使用量を、自動 compact が走る位置を 100% として数え直す。モデルの窓 (window) より手前で
 * 自動 compact が走る時に、合図が間に合わなくならないように。内訳が無ければ window に対する割合のまま
 */
export function contextOf(c: UsageContext): CueContext {
  const b = c.breakdown
  const limit = b ? (b.autoCompactThreshold ?? b.rawMaxTokens) : 0
  if (!b || !(limit > 0)) return { percent: c.percent, tokens: c.tokens, window: c.window }
  const percent = c.tokens === undefined ? undefined : Math.round((c.tokens / limit) * 100)
  return { percent, tokens: c.tokens, window: limit, ...(b.autoCompactThreshold !== undefined ? { isAutoLimit: true } : {}) }
}

/** 今の使用量と作業の様子から合図を決める */
export function advise(ctx: CueContext | null, phase: CuePhase, lastBreak: CueBreak | null, notifyAt: number, urgentAt: number): Advice {
  const p = ctx?.percent
  if (p === undefined || p < notifyAt) return { level: 'ok', word: '', reason: '' }
  const isUrgent = p >= urgentAt
  if (phase === 'clean') {
    const reason = lastBreak ? BREAK_LABEL[lastBreak.kind] : 'まだ編集していません'
    return isUrgent
      ? { level: 'now', word: '今 /compact してください', reason }
      : { level: 'good', word: '区切りです。今が /compact のよい時です', reason }
  }
  return isUrgent
    ? { level: 'soon', word: '残りが少ないです。次の区切りで必ず /compact', reason: '編集の途中です' }
    : { level: 'wait', word: '区切り(テスト・コミット)まで進めてから /compact', reason: '編集の途中です' }
}

/** トーストを出す段階 (同じ段階では 1 回だけ) */
export const isToastLevel = (level: Level) => level === 'good' || level === 'now'

/** 帯の文字の色 (Text の color はテーマの名前で書く) */
export const bandColor = (level: Level) => ({ ok: undefined, wait: undefined, good: 'success', soon: 'error', now: 'warning' })[level]

/** 帯の 1 行 */
export const bandText = (ctx: CueContext | null, a: Advice) => `コンテキスト ${ctx?.percent ?? '─'}% ─ ${a.word}`

/** トーストの文 */
export const toastText = (ctx: CueContext | null, a: Advice) => `${a.word}(コンテキスト ${ctx?.percent ?? '─'}%、${a.reason})`

// ── 区切りの見分け方

/** 引用符の中身とヒアドキュメントの本文を Q に置き換える (コミットの文の中の言葉を拾わない) */
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

const GIT_OPTS = String.raw`(?:\s+(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?))*`
const GIT = String.raw`^(?:\S*[\\/])?git(?:\.exe)?\b`

/** git commit か */
export const isCommit = (command: string) => segments(command).some(s => new RegExp(`${GIT}${GIT_OPTS}\\s+commit\\b`, 'i').test(s))

/** テストを走らせるコマンドか */
export const TEST_COMMAND =
  /^(?:\S*[\\/])?(?:(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?test\b|npx\s+(?:vitest|jest)\b|vitest\b|jest\b|pytest\b|python\d*(?:\.exe)?\s+-m\s+pytest\b|cargo\s+test\b|go\s+test\b|node(?:\.exe)?\s+--test\b|dotnet\s+test\b|(?:\.[\\/])?gradlew?(?:\.bat)?\s+test\b|mvn\s+test\b|ctest\b|claude(?:\.exe)?\s+plugin\s+test\b)/i
export const isTest = (command: string) => segments(command).some(s => TEST_COMMAND.test(s))

/** パスを比べる形にする (区切りを / に、大文字小文字を無視、末尾の / を落とす) */
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** 絶対パスか (C:\ や / で始まる)。C: だけや相対パスは未設定と同じに扱う */
export const isAbsolute = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

/** path が dir の下か */
export const isUnder = (path: string, dir: string) => dir !== '' && norm(path).startsWith(`${norm(dir)}/`)

// ── ペイン

const LEVEL_COLOR = (level: Level) => ({ ok: C.green, wait: C.dim, good: C.green, soon: C.red, now: C.yellow })[level]

const clock = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}

/** 使用量のリング。0 から伸びて止まる */
function ring(cx: number, cy: number, r: number, percent: number | undefined, notifyAt: number, urgentAt: number, color: string) {
  const len = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, percent ?? 0))
  const on = (len * p) / 100
  const tick = (at: number, c: string) => {
    const a = (at / 100) * 2 * Math.PI - Math.PI / 2
    const x1 = cx + Math.cos(a) * (r - 9)
    const y1 = cy + Math.sin(a) * (r - 9)
    const x2 = cx + Math.cos(a) * (r + 9)
    const y2 = cy + Math.sin(a) * (r + 9)
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="2"/>`
  }
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.line}" stroke-width="12"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" ` +
    `stroke-dasharray="${on.toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})">` +
    `<animate attributeName="stroke-dasharray" from="0 ${len.toFixed(1)}" to="${on.toFixed(1)} ${len.toFixed(1)}" dur="0.8s" fill="freeze"/></circle>` +
    tick(notifyAt, C.dim) +
    tick(urgentAt, C.red) +
    `<text x="${cx}" y="${cy + 8}" font-size="26" font-weight="bold" fill="${C.text}" text-anchor="middle">${percent === undefined ? '─' : `${percent}%`}</text>`
  )
}

export type PaneInput = {
  ctx: CueContext | null
  phase: CuePhase
  lastBreak: CueBreak | null
  notifyAt: number
  urgentAt: number
  memoDir: string
}

/** 全角を 2、半角を 1 と数えて max までの行に分ける。半角の続き (/compact など) と句読点の前では切らない */
export function wrap(text: string, max: number) {
  const lines: string[] = []
  let line = ''
  let n = 0
  for (const tok of text.match(/[\x21-\x7e]+|[^\x21-\x7e]/g) ?? []) {
    const w = [...tok].reduce((k, ch) => k + (/[\x20-\x7e]/.test(ch) ? 1 : 2), 0)
    if (n + w > max && line.trim() !== '' && !/^[。、)]$/.test(tok)) {
      lines.push(line.trim())
      line = ''
      n = 0
    }
    line += tok
    n += w
  }
  if (line.trim() !== '') lines.push(line.trim())
  return lines
}

/** 合図が出ていない時の一言 */
const calmWord = (ctx: CueContext | null) => (ctx?.percent === undefined ? '次の返事で使用量を読みます' : 'まだ余裕があります')

/** ペインの SVG 1 枚 */
export function paneSvg(i: PaneInput) {
  const a = advise(i.ctx, i.phase, i.lastBreak, i.notifyAt, i.urgentAt)
  const color = LEVEL_COLOR(a.level)
  const word = a.level === 'ok' ? calmWord(i.ctx) : a.word
  const tokens = i.ctx?.tokens === undefined ? '' : `${Math.round(i.ctx.tokens / 1000)}k / ${Math.round(i.ctx.window / 1000)}k`
  let s = panel(8, 8, 364, 150)
  s += ring(82, 83, 52, i.ctx?.percent, i.notifyAt, i.urgentAt, color)
  // 言葉は 3 行まで (全角 13 字ほど。/compact の途中では切らない)
  const lines = wrap(word, 26).slice(0, 3)
  lines.forEach((l, k) => (s += `<text x="152" y="${46 + k * 22}" font-size="15" font-weight="bold" fill="${color}">${esc(l)}</text>`))
  if (a.reason !== '') s += `<text x="152" y="${46 + lines.length * 22 + 2}" font-size="12" fill="${C.dim}">${esc(a.reason)}</text>`
  if (i.ctx?.isAutoLimit) s += `<text x="152" y="146" font-size="12" fill="${C.dim}">100% は自動 compact の位置</text>`

  const y = 168
  s += panel(8, y, 364, 132)
  s += `<text x="20" y="${y + 24}" font-size="13" font-weight="bold" fill="${C.text}">作業の様子</text>`
  const phaseWord = i.phase === 'clean' ? '区切り' : '編集の途中'
  s += `<text x="360" y="${y + 24}" font-size="13" text-anchor="end" fill="${i.phase === 'clean' ? C.green : C.yellow}">${phaseWord}</text>`
  const last = i.lastBreak ? `${clock(i.lastBreak.at)} ${BREAK_LABEL[i.lastBreak.kind]}` : 'まだありません'
  s += `<text x="20" y="${y + 50}" font-size="12" fill="${C.dim}">最後の区切り</text><text x="360" y="${y + 50}" font-size="12" text-anchor="end" fill="${C.text}">${esc(last)}</text>`
  s += `<text x="20" y="${y + 74}" font-size="12" fill="${C.dim}">合図</text><text x="360" y="${y + 74}" font-size="12" text-anchor="end" fill="${C.text}">${i.notifyAt}% から / ${i.urgentAt}% で急ぎ</text>`
  s += `<text x="20" y="${y + 98}" font-size="12" fill="${C.dim}">区切りの印</text><text x="360" y="${y + 98}" font-size="12" text-anchor="end" fill="${C.text}">コミット・テスト通過${i.memoDir === '' ? '' : '・メモ'}</text>`
  s += `<text x="20" y="${y + 120}" font-size="12" fill="${C.dim}">compact の前に引き継ぎメモを更新しておくと安心です</text>`
  return frame(HEADER_H + y + 140, header('compact の合図', tokens, color) + `<g transform="translate(0 ${HEADER_H})">${s}</g>`)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(i: PaneInput): Line[] {
  const a = advise(i.ctx, i.phase, i.lastBreak, i.notifyAt, i.urgentAt)
  const lines: Line[] = [
    { text: `コンテキスト ${i.ctx?.percent ?? '─'}%`, isBold: true },
    a.level === 'ok' ? { text: calmWord(i.ctx), isDim: true } : { text: `${a.word}(${a.reason})`, color: bandColor(a.level) },
    { text: `作業の様子: ${i.phase === 'clean' ? '区切り' : '編集の途中'}` },
    { text: `最後の区切り: ${i.lastBreak ? `${clock(i.lastBreak.at)} ${BREAK_LABEL[i.lastBreak.kind]}` : 'まだありません'}`, isDim: true },
    { text: `合図は ${i.notifyAt}% から、${i.urgentAt}% で急ぎ`, isDim: true },
  ]
  if (i.ctx?.isAutoLimit) lines.push({ text: '100% は自動 compact が走る位置です', isDim: true })
  return lines
}
