// 外に出す操作の見分けと、確認の読み取り、ペインの SVG と文。どれも純関数
import type { GuardEntry, GuardOutcome, GuardPermit } from '../types'
import { C, HEADER_H, esc, frame, header, panel, short } from './style'

export const LOG_MAX = 20

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

// 名前の前のパス (C:\x\git.exe や /usr/bin/git) と拡張子を許す
const bin = (names: string) => String.raw`^(?:\S*[\\/])?(?:${names})(?:\.exe|\.cmd)?\b`
// サブコマンドの前のオプション (-c a=b、-C dir、--flag、--flag=値)
const OPTS = String.raw`(?:\s+(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?))*`

const RULES: [RegExp, string][] = [
  [new RegExp(`${bin('git')}${OPTS}\\s+push\\b`, 'i'), 'git push'],
  [new RegExp(`${bin('gh')}${OPTS}\\s+release\\s+(?:create|upload|edit|delete)\\b`, 'i'), 'gh release'],
  [new RegExp(`${bin('gh')}${OPTS}\\s+repo\\s+create\\b`, 'i'), 'gh repo create'],
  [new RegExp(`${bin('npm|pnpm|yarn')}${OPTS}\\s+publish\\b`, 'i'), 'npm publish'],
]

/** 外に出す操作なら、その名前 (git push など)。違えば無し */
export function outwardOf(command: string): string | undefined {
  for (const s of segments(command)) for (const [re, label] of RULES) if (re.test(s)) return label
  return undefined
}

/** 公開の話か */
export const PUBLISH_TALK = /push|プッシュ|公開|リリース|release|publish|アップロード|upload|デプロイ|deploy/i
/** 断る返事か */
export const NEGATIVE = /やめ|止め|しない|しません|中止|キャンセル|見送|待って|後で|まだ|\bno\b|cancel|don't|not now|skip/i

/** AskUserQuestion の答えの文から「問い」=「答え」の組を拾う */
export function answersOf(text: string) {
  return [...text.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)].map(m => ({ question: m[1] ?? '', answer: m[2] ?? '' }))
}

/**
 * 公開してよいと答えたか。問いか答えが公開の話で、答えが断りでない組が 1 つあれば許す。
 * 答えが読めない時は許さない (見張りがその場で聞き直す)
 */
export function approvedIn(text: string) {
  const pair = answersOf(text).find(p => PUBLISH_TALK.test(`${p.question} ${p.answer}`) && !NEGATIVE.test(p.answer))
  return pair ? short(pair.question, 60) : undefined
}

/** 確認が今のターンで効くか (確認したターンと、その次のターンまで) */
export const isValid = (permit: GuardPermit | null, turn: number) => permit !== null && turn <= permit.turn + 1

export const YES = '実行する'
export const NO = 'やめる'

/** その場で聞く文 */
export const askText = (label: string, command: string) => `外に出す操作 (${label}) を実行しようとしています。実行しますか？\n\n${short(command.trim(), 300)}`

/** 止めた時に Claude へ返す文 */
export function denyText(label: string, outcome: GuardOutcome, answer = '') {
  if (outcome === 'asked-no') {
    const said = answer !== '' && answer !== NO ? `(ユーザーの返事:「${short(answer, 200)}」)` : ''
    return `ship-guard: ユーザーが実行しないと答えたので ${label} を止めました${said}。返事に従ってください。`
  }
  return `ship-guard: ${label} は外に出す操作です。ユーザーの確認が取れなかったので止めました。AskUserQuestion で実行してよいか確かめてから、もう一度実行してください。`
}

const OUTCOME: Record<GuardOutcome, { word: string; color: () => string; term?: string }> = {
  confirmed: { word: '確認済みで通した', color: () => C.green, term: 'success' },
  'asked-yes': { word: 'その場で聞いて通した', color: () => C.blue },
  'asked-no': { word: '断られたので止めた', color: () => C.yellow, term: 'warning' },
  'no-ask': { word: '聞けないので止めた', color: () => C.red, term: 'error' },
}

const clock = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}

export type PaneInput = { isOff: boolean; log: GuardEntry[]; permit: GuardPermit | null; turn: number }

const permitWord = (i: PaneInput) => (isValid(i.permit, i.turn) ? `確認済み: ${i.permit?.about ?? ''}` : '確認はまだありません')

/** ペインの SVG 1 枚。新しい順に 8 件 */
export function paneSvg(i: PaneInput) {
  const rows = i.log.slice(-8).reverse()
  const accent = i.isOff ? C.dim : C.green
  let s = panel(8, 8, 364, 72)
  s += `<text x="20" y="34" font-size="15" font-weight="bold" fill="${accent}">${i.isOff ? 'このセッションは見張っていません' : '見張り中'}</text>`
  s += `<text x="20" y="58" font-size="12" fill="${C.dim}">${esc(short(permitWord(i), 30))}</text>`
  const h = Math.max(1, rows.length) * 40 + 40
  s += panel(8, 90, 364, h)
  s += `<text x="20" y="114" font-size="13" font-weight="bold" fill="${C.text}">最近の記録</text>`
  if (rows.length === 0) s += `<text x="20" y="144" font-size="12" fill="${C.dim}">git push・gh release・npm publish などはまだありません</text>`
  rows.forEach((r, k) => {
    const y = 130 + k * 40
    const o = OUTCOME[r.outcome]
    s += `<rect x="20" y="${y}" width="4" height="30" rx="2" fill="${o.color()}"/>`
    s += `<text x="32" y="${y + 13}" font-size="13" font-weight="bold" fill="${C.text}">${esc(r.label)}</text>`
    s += `<text x="360" y="${y + 13}" font-size="12" text-anchor="end" fill="${C.dim}">${clock(r.at)}</text>`
    s += `<text x="32" y="${y + 28}" font-size="12" fill="${o.color()}">${o.word}</text>`
  })
  return frame(HEADER_H + 100 + h, header('外に出す操作の見張り', `${i.log.length} 件`, accent) + `<g transform="translate(0 ${HEADER_H})">${s}</g>`)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(i: PaneInput): Line[] {
  const lines: Line[] = [
    { text: i.isOff ? 'このセッションは見張っていません' : '見張り中', isBold: true, color: i.isOff ? undefined : 'success' },
    { text: permitWord(i), isDim: true },
  ]
  if (i.log.length === 0) lines.push({ text: 'git push・gh release・npm publish などはまだありません', isDim: true })
  for (const r of i.log.slice(-8).reverse()) lines.push({ text: `${clock(r.at)} ${r.label} ─ ${OUTCOME[r.outcome].word}`, color: OUTCOME[r.outcome].term })
  return lines
}
