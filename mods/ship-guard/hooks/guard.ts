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

// ── 公開前のチェック (git push の時だけ)

// 引用符の付いた所も含めた 1 語 (credential.helper='!gh auth git-credential' も 1 語)
const WORD = String.raw`(?:[^\s'";&|()]+|'[^']*'|"(?:[^"\\]|\\.)*")+`
const dequote = (w: string) => w.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_, a: string | undefined, b: string | undefined) => a ?? b ?? '')

/**
 * push を読むリポジトリの場所。push の git -C <dir> か、push より前の最後の cd / Set-Location / pushd。
 * 書かれていなければ無し (セッションの場所で読む)
 */
export function repoDirOf(command: string): string | undefined {
  const push = new RegExp(String.raw`\bgit(?:\.exe)?((?:\s+(?:-[cC]\s+${WORD}|--?[\w-]+(?:=\S+)?))*)\s+push\b`, 'i').exec(command)
  if (!push) return undefined
  const dashC = new RegExp(String.raw`-C\s+(${WORD})`).exec(push[1] ?? '')
  if (dashC?.[1]) return dequote(dashC[1])
  const cds = [...command.slice(0, push.index).matchAll(new RegExp(String.raw`(?:^|[;&|\n({]\s*)(?:cd|Set-Location|sl|pushd|chdir)\s+(?:/d\s+|-(?:Literal)?Path\s+)?(${WORD})`, 'gi'))]
  const last = cds.at(-1)?.[1]
  return last === undefined ? undefined : dequote(last)
}

/** 場所をセッションの場所から決める。/d/x の形は Windows では D:/x にする */
export function resolveDir(dir: string | undefined, cwd: string) {
  if (dir === undefined || dir === '' || dir === '.') return cwd
  const isWindows = /^[A-Za-z]:/.test(cwd)
  const msys = /^\/([A-Za-z])(\/|$)/.exec(dir)
  if (isWindows && msys) return `${msys[1]?.toUpperCase()}:/${dir.slice(3)}`
  if (/^[A-Za-z]:[\\/]/.test(dir) || dir.startsWith('/') || dir.startsWith('\\\\')) return dir
  return `${cwd.replace(/[\\/]+$/, '')}/${dir}`
}

/** 送るコミットの範囲 (どのリモートにもまだ無い物)。--tags / --all ならブランチとタグ全部 */
export const rangeOf = (command: string) => (/\s--(?:tags|all|mirror)\b/.test(unquote(command)) ? ['--branches', '--tags', '--not', '--remotes'] : ['HEAD', '--not', '--remotes'])

/** git log に渡す書式。コミットの頭に \x01、作者名・メール・コミッター名・メールを \x00 で区切る */
export const LOG_FORMAT = '--format=%x01%H%x00%an%x00%ae%x00%cn%x00%ce'

export type CheckConfig = { allowed: string[]; words: string[] }

/** 設定の「a, b、c」を分ける */
export const listOf = (raw: unknown) =>
  String(raw ?? '')
    .split(/[,、\n]/)
    .map(s => s.trim())
    .filter(s => s !== '')

const isAllowedEmail = (email: string, allowed: string[]) => {
  const e = email.toLowerCase()
  if (/noreply|no-reply/.test(e)) return true
  if (/@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|localhost|test|invalid|example)$/.test(e)) return true
  return allowed.some(a => {
    const x = a.toLowerCase()
    return x.startsWith('@') ? e.endsWith(x) : e === x
  })
}

// 見本でよく使う名前 (C:\Users\<名前> の <名前> がこれなら気にしない)
const PLACEHOLDER = /^(?:public|default|default user|all users|user|users|username|yourname|your-name|your_name|name|me|you|someone|runner|shared|admin|administrator|example|foo|bar|xxx+|\.\.\.|…)$/i
const HOME = /(?:\b[A-Za-z]:[\\/]+|(?<![\w.])\/[A-Za-z]\/|(?<![\w.])\/)(?:Users|home)[\\/]+([^\\/\s"'`<>:*?|,;)\]}]+)/g
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g

/** 人に見せる時は頭 2 字だけ残す */
export const mask = (s: string) => (s.length <= 2 ? `${s}***` : `${s.slice(0, 2)}***`)
const maskEmail = (e: string) => {
  const [local = '', domain = ''] = e.split('@')
  return `${mask(local)}@${domain}`
}

type Hit = { what: string; files: Set<string>; commits: Set<string> }

/**
 * git log -p の出力から、公開前に気になる所を拾う。作者・コミッターのメールが noreply でない、
 * 足した行に個人のメール・ユーザー名入りのパス・指定した言葉がある。1 行ずつの文で返す (最大 8)
 */
export function scanPush(out: string, cfg: CheckConfig): string[] {
  const hits = new Map<string, Hit>()
  const hit = (key: string, what: string, commit: string, file?: string) => {
    const h = hits.get(key) ?? { what, files: new Set<string>(), commits: new Set<string>() }
    h.commits.add(commit)
    if (file !== undefined) h.files.add(file)
    hits.set(key, h)
  }
  const words = cfg.words.map(w => w.toLowerCase())
  for (const chunk of out.split('\x01').slice(1)) {
    const [head = '', ...lines] = chunk.split('\n')
    const [hash = '', an = '', ae = '', cn = '', ce = ''] = head.split('\x00')
    for (const email of new Set([ae, ce])) if (email !== '' && !isAllowedEmail(email, cfg.allowed)) hit(`author:${email}`, `作者のメールが noreply ではない: ${maskEmail(email)}`, hash)
    for (const w of words) if (`${an}\n${cn}`.toLowerCase().includes(w)) hit(`author-word:${w}`, `作者名に「${w}」`, hash)
    let file = ''
    for (const line of lines) {
      if (line.startsWith('+++ ')) {
        file = line.slice(4).replace(/^b\//, '')
        continue
      }
      if (!line.startsWith('+')) continue
      const added = line.slice(1)
      for (const m of added.matchAll(EMAIL)) if (!isAllowedEmail(m[0], cfg.allowed)) hit(`email:${m[0].toLowerCase()}`, `個人のメールらしい文字列: ${maskEmail(m[0])}`, hash, file)
      for (const m of added.matchAll(HOME)) {
        const name = m[1] ?? ''
        // 1 字の名前 (/home/a) はテストの見本とみなす
        if (name.length < 2 || PLACEHOLDER.test(name) || /^[<$%{[(*]/.test(name)) continue
        hit(`home:${name.toLowerCase()}`, `ユーザー名入りのパス: ${m[0].slice(0, m[0].length - name.length)}${mask(name)}`, hash, file)
      }
      const low = added.toLowerCase()
      for (const w of words) if (low.includes(w)) hit(`word:${w}`, `気にする言葉「${w}」`, hash, file)
    }
  }
  return [...hits.values()].slice(0, 8).map(h => {
    const files = [...h.files]
    const where = files.length === 0 ? `${h.commits.size} コミット` : files.length === 1 ? files[0] : `${files[0]} ほか ${files.length - 1} 件`
    return `${h.what} (${short(where ?? '', 60)})`
  })
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

const bullets = (findings: readonly string[]) => findings.map(f => `・${f}`).join('\n')

/** その場で聞く文。公開前のチェックで引っかかった所があれば並べる */
export function askText(label: string, command: string, findings: readonly string[] = []) {
  const found = findings.length === 0 ? '' : `公開前のチェックで気になる所がありました。\n${bullets(findings)}\n\n`
  return `外に出す操作 (${label}) を実行しようとしています。${found}実行しますか？\n\n${short(command.trim(), 300)}`
}

/** 止めた時に Claude へ返す文 */
export function denyText(label: string, outcome: GuardOutcome, answer = '', findings: readonly string[] = []) {
  const found = findings.length === 0 ? '' : `\n公開前のチェックで気になった所:\n${bullets(findings)}`
  if (outcome === 'asked-no') {
    const said = answer !== '' && answer !== NO ? `(ユーザーの返事:「${short(answer, 200)}」)` : ''
    return `ship-guard: ユーザーが実行しないと答えたので ${label} を止めました${said}。返事に従ってください。${found}`
  }
  return `ship-guard: ${label} は外に出す操作です。ユーザーの確認が取れなかったので止めました。AskUserQuestion で実行してよいか確かめてから、もう一度実行してください。${found}`
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
    s += `<text x="32" y="${y + 28}" font-size="12" fill="${o.color()}">${o.word}${findingsWord(r)}</text>`
  })
  // 最後に引っかかった公開前チェックの中身
  const found = lastFindings(i.log)
  let fh = 0
  if (found.length > 0) {
    fh = found.length * 20 + 40
    const y0 = 98 + h
    s += panel(8, y0, 364, fh)
    s += `<text x="20" y="${y0 + 24}" font-size="13" font-weight="bold" fill="${C.yellow}">最後の公開前チェックで気になった所</text>`
    found.forEach((f, k) => (s += `<text x="20" y="${y0 + 46 + k * 20}" font-size="12" fill="${C.text}">・${esc(short(f, 30))}</text>`))
    fh += 8
  }
  return frame(HEADER_H + 100 + h + fh, header('外に出す操作の見張り', `${i.log.length} 件`, accent) + `<g transform="translate(0 ${HEADER_H})">${s}</g>`)
}

const findingsWord = (r: GuardEntry) => (r.findings && r.findings.length > 0 ? `・気になる所 ${r.findings.length} 件` : '')

/** 新しい順に見て、最初に公開前チェックで引っかかった記録の中身 (最大 5) */
const lastFindings = (log: readonly GuardEntry[]) => [...log].reverse().find(r => (r.findings?.length ?? 0) > 0)?.findings?.slice(0, 5) ?? []

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(i: PaneInput): Line[] {
  const lines: Line[] = [
    { text: i.isOff ? 'このセッションは見張っていません' : '見張り中', isBold: true, color: i.isOff ? undefined : 'success' },
    { text: permitWord(i), isDim: true },
  ]
  if (i.log.length === 0) lines.push({ text: 'git push・gh release・npm publish などはまだありません', isDim: true })
  for (const r of i.log.slice(-8).reverse()) lines.push({ text: `${clock(r.at)} ${r.label} ─ ${OUTCOME[r.outcome].word}${findingsWord(r)}`, color: OUTCOME[r.outcome].term })
  const found = lastFindings(i.log)
  if (found.length > 0) {
    lines.push({ text: '最後の公開前チェックで気になった所', isBold: true, color: 'warning' })
    for (const f of found) lines.push({ text: `・${f}` })
  }
  return lines
}
