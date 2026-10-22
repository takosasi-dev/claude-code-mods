// 約束ごとの見分けと、帯・ペインの文と SVG。どれも純関数
import type { RuleEvent, RuleKind, RuleMiss } from '../types'
import { C, HEADER_H, esc, frame, growBar, header, jstDay, panel, short } from './style'

export const HISTORY_MAX = 20
export const KINDS: readonly RuleKind[] = ['english', 'question', 'memo', 'log', 'logLine', 'closing']
/** ファイルを書くまで帯に残す約束 (次のターンの頭で下ろさない) */
export const STICKY: readonly RuleKind[] = ['memo', 'log']

/** 約束ごとの名前と、外れた時の短い言葉。tell は「Claude に伝える」で足す直し方 */
export const RULE: Record<RuleKind, { name: string; miss: string; tell?: string }> = {
  english: { name: '日本語で答える', miss: '返事が英語でした' },
  question: { name: '確認は選択肢で聞く', miss: '選択肢を使わずに文で質問しました' },
  memo: { name: '区切りで引き継ぎメモ', miss: 'コミットの後、引き継ぎメモが未更新です' },
  log: { name: '区切りで開発ログ', miss: 'コミットの後、今日の開発ログが未記入です', tell: '今日の日付の開発ログに、この作業のブロックを書いてください' },
  logLine: { name: '開発ログの報告の 1 行', miss: '開発ログを書いたのに、記録しましたの 1 行がありません', tell: '返事に「📝 Obsidianに開発ログを記録しました(ファイル名)」の 1 行を入れてください' },
  closing: { name: '締めの言葉で開発ログ', miss: '締めの言葉があったのに、開発ログを書いていません', tell: '今日の開発ログを書き、その日の総括も書き直してください' },
}

// ── 開発ログの見分け

const CLOSING = /ありがと|お疲れ|おつかれ|一旦ここまで|いったんここまで|今日はここまで/

/** 依頼者の入力に締めの言葉があるか */
export const isClosing = (text: string) => CLOSING.test(text)

/** 返事に「📝」と「開発ログ」を含む行があるか */
export const hasLogLine = (answer: string) => answer.split('\n').some(l => l.includes('📝') && l.includes('開発ログ'))

// ── 返事の読み方

/** コードブロック・インラインのコード・URL・パス・HTML のタグを落とした、地の文だけ */
export function proseOf(answer: string) {
  return answer
    .replace(/```[\s\S]*?(?:```|$)/g, '\n')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/\bhttps?:\/\/\S+/g, ' ')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/]+){2,}[\\/]?/g, ' ')
}

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]/gu
const LATIN = /[A-Za-z]/g

/** 英語の返事か。地の文の英字が 40 字以上あって、日本語の字がその 1 割に届かない時 */
export function isEnglish(answer: string) {
  const prose = proseOf(answer)
  const latin = prose.match(LATIN)?.length ?? 0
  const jp = prose.match(JAPANESE)?.length ?? 0
  return latin >= 40 && jp * 10 < latin
}

const ASKING = /(?:[?？]|ますか|でしょうか|ませんか|しょうか|ですか)[」』)）]*[。.!！]?\s*$/

/**
 * 文で質問して終わっているか。地の文の最後の 2 行のどれかが問いの形で終わる時。
 * 引用 (>) と、表の行は見ない
 */
export function endsWithQuestion(answer: string) {
  const lines = proseOf(answer)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('>') && !l.startsWith('|'))
  return lines.slice(-2).some(l => ASKING.test(l))
}

/** 問いの行 (帯とペインに出す) */
export function questionLine(answer: string) {
  const lines = proseOf(answer)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('>') && !l.startsWith('|'))
  return [...lines.slice(-2)].reverse().find(l => ASKING.test(l)) ?? ''
}

// ── コミットとメモの見分け (compact-cue と同じ形。mod は別々に入れるので写して持つ)

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

/** パスを比べる形にする (区切りを / に、大文字小文字を無視、末尾の / を落とす) */
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** 絶対パスか (C:\ や / で始まる)。C: だけや相対パスは未設定と同じに扱う */
export const isAbsolute = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

/** path が dir の下か */
export const isUnder = (path: string, dir: string) => dir !== '' && norm(path).startsWith(`${norm(dir)}/`)

/** シェルのコマンドが dir の下 (tail を足した物) を指しているか (D:\x と /d/x の両方の書き方を見る) */
export function mentionsDir(command: string, dir: string, tail = '') {
  if (dir === '') return false
  const d = `${norm(dir)}/${tail.toLowerCase()}`
  const msys = d.replace(/^([a-z]):/, (_, x: string) => `/${x}`)
  const c = command.replace(/\\/g, '/').toLowerCase()
  return c.includes(d) || c.includes(msys)
}

/** 今日の開発ログのファイル名 (JST の YYYY-MM-DD.md) */
export const logName = (now: number) => `${jstDay(now)}.md`

/** path が dir の直下の、今日の開発ログか */
export const isTodayLog = (path: string, dir: string, now: number) => dir !== '' && norm(path) === `${norm(dir)}/${logName(now)}`

// ── 帯とペイン

/** 帯の 1 行 */
export const bandText = (misses: readonly RuleMiss[]) => `約束ごと: ${misses.map(m => RULE[m.rule].miss).join(' ・ ')}`

/** 「Claude に伝える」で入力欄に入れる文 */
export function remindText(misses: readonly RuleMiss[]) {
  const lines = misses.map(m => `- ${RULE[m.rule].name}: ${RULE[m.rule].miss}${m.detail ? `(${m.detail})` : ''}${RULE[m.rule].tell ? `。${RULE[m.rule].tell}` : ''}`)
  return `さっきの返事は約束ごとから外れていました。\n${lines.join('\n')}\n約束に沿って直してください。`
}

const clock = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}

const KIND_COLOR = (k: RuleKind) => ({ english: C.blue, question: C.yellow, memo: C.green, log: C.purple, logLine: C.orange, closing: C.red })[k]
const KIND_TERM = (k: RuleKind) => ({ english: 'suggestion', question: 'warning', memo: 'success', log: 'success', logLine: 'warning', closing: 'warning' })[k]

export type PaneInput = {
  misses: RuleMiss[]
  counts: Record<RuleKind, number>
  history: RuleEvent[]
  /** コミットの後でメモを待っているか */
  isMemoPending: boolean
  /** コミットの後で今日の開発ログを待っているか */
  isLogPending: boolean
  /** 見ている約束 */
  watching: RuleKind[]
}

const statusWord = (i: PaneInput) => (i.misses.length === 0 ? '前の返事は約束どおりでした' : `前の返事で ${i.misses.length} つ外れました`)

/** 待っている物の 1 行。無ければ空 */
const waitWord = (i: PaneInput) =>
  i.isMemoPending && i.isLogPending
    ? 'コミットの後、引き継ぎメモと開発ログを待っています'
    : i.isMemoPending
      ? 'コミットの後、引き継ぎメモを待っています'
      : i.isLogPending
        ? 'コミットの後、開発ログを待っています'
        : ''

/** ペインの SVG 1 枚 */
export function paneSvg(i: PaneInput) {
  const accent = i.misses.length === 0 ? C.green : C.yellow
  let s = panel(8, 8, 364, 56)
  s += `<text x="20" y="34" font-size="15" font-weight="bold" fill="${accent}">${esc(statusWord(i))}</text>`
  s += `<text x="20" y="52" font-size="12" fill="${C.dim}">${esc(waitWord(i) || 'このセッションで外れた数')}</text>`
  // 約束ごとの数の棒
  const max = Math.max(1, ...KINDS.map(k => i.counts[k]))
  const y0 = 72
  s += panel(8, y0, 364, KINDS.length * 34 + 16)
  KINDS.forEach((k, n) => {
    const y = y0 + 14 + n * 34
    const isOn = i.watching.includes(k)
    s += `<text x="20" y="${y + 12}" font-size="12" fill="${isOn ? C.text : C.dim}">${esc(RULE[k].name)}${isOn ? '' : '(見ていない)'}</text>`
    s += `<text x="360" y="${y + 12}" font-size="12" font-weight="bold" text-anchor="end" fill="${C.text}">${i.counts[k]} 回</text>`
    s += `<rect x="20" y="${y + 18}" width="340" height="6" rx="3" fill="${C.line}"/>`
    if (i.counts[k] > 0) s += growBar(20, y + 18, Math.max(6, (340 * i.counts[k]) / max), 6, KIND_COLOR(k), n * 0.08)
  })
  // 最近の記録
  const rows = i.history.slice(-6).reverse()
  const y1 = y0 + KINDS.length * 34 + 24
  const h = Math.max(1, rows.length) * 36 + 36
  s += panel(8, y1, 364, h)
  s += `<text x="20" y="${y1 + 22}" font-size="13" font-weight="bold" fill="${C.text}">最近外れたもの</text>`
  if (rows.length === 0) s += `<text x="20" y="${y1 + 50}" font-size="12" fill="${C.dim}">まだありません</text>`
  rows.forEach((r, n) => {
    const y = y1 + 36 + n * 36
    s += `<rect x="20" y="${y}" width="4" height="28" rx="2" fill="${KIND_COLOR(r.rule)}"/>`
    s += `<text x="32" y="${y + 12}" font-size="12" font-weight="bold" fill="${C.text}">${esc(short(RULE[r.rule].miss, 22))}</text>`
    s += `<text x="360" y="${y + 12}" font-size="11" text-anchor="end" fill="${C.dim}">${clock(r.at)}</text>`
    if (r.detail) s += `<text x="32" y="${y + 26}" font-size="11" fill="${C.dim}">${esc(short(r.detail, 32))}</text>`
  })
  const total = KINDS.reduce((a, k) => a + i.counts[k], 0)
  return frame(HEADER_H + y1 + h + 8, header('約束ごとの見張り', `外れ ${total} 回`, accent) + `<g transform="translate(0 ${HEADER_H})">${s}</g>`)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(i: PaneInput): Line[] {
  const lines: Line[] = [{ text: statusWord(i), isBold: true, color: i.misses.length === 0 ? 'success' : 'warning' }]
  for (const m of i.misses) lines.push({ text: `・${RULE[m.rule].miss}${m.detail ? `(${m.detail})` : ''}`, color: 'warning' })
  if (waitWord(i) !== '') lines.push({ text: waitWord(i), isDim: true })
  for (const k of KINDS) lines.push({ text: `${RULE[k].name}${i.watching.includes(k) ? '' : '(見ていない)'}: ${i.counts[k]} 回`, isDim: !i.watching.includes(k) })
  if (i.history.length > 0) lines.push({ text: '最近外れたもの', isBold: true })
  for (const r of i.history.slice(-6).reverse()) lines.push({ text: `${clock(r.at)} ${RULE[r.rule].miss}${r.detail ? ` ─ ${short(r.detail, 40)}` : ''}`, color: KIND_TERM(r.rule) })
  return lines
}
