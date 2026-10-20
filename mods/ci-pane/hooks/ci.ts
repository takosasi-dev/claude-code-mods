// gh の出力を読み、ペインの SVG と terminal 用の行を組む。どれも純関数
import type { CiCheck, CiKind, CiPr, CiProblem, CiRun, CiSnap } from '../types'

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
}
const W = 380

export const PR_FIELDS = 'number,title,state,isDraft,url,reviewDecision,statusCheckRollup'
export const RUN_FIELDS = 'databaseId,name,status,conclusion,url,createdAt,event,headSha'
export const RUN_LIMIT = 8

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
/** 1 行にする: 制御文字を落とし、タブ・改行は空白に */
export const clean = (s: unknown) =>
  String(s ?? '')
    .replace(ANSI, '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(CTRL, '')
    .trim()
const str = (v: unknown) => (typeof v === 'string' ? clean(v) : '')
/** https の URL だけ通す */
export const httpsOnly = (v: unknown) => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length <= 2000 ? v : '')

/** 標準エラーの 1 行目 (画面に出す時) */
export const firstLine = (s: string) => clean(s.split(/\r?\n/).find(l => l.trim() !== '') ?? '').slice(0, 200)

export type GhFail = CiProblem | 'no-pr' | 'other'

/** gh・git の失敗を、標準エラーの文で分ける。順番が大事 (GitHub でない時の文にも gh auth login が出る) */
export function classify(stderr: string): GhFail {
  if (/dubious ownership/i.test(stderr)) return 'unsafe'
  if (/not a git repository/i.test(stderr)) return 'not-git'
  if (/no git remotes found|none of the git remotes|known GitHub host|determine base repo/i.test(stderr)) return 'not-github'
  if (/no pull requests found/i.test(stderr)) return 'no-pr'
  if (/gh auth login|GH_TOKEN|not logged in|authentication|HTTP 401|bad credentials/i.test(stderr)) return 'no-login'
  return 'other'
}

/** 起動できなかった (例外) 時の理由。見つからないなら gh が無い */
export const missingOrError = (message: string): CiProblem => (/ENOENT|not found|cannot find|no such file/i.test(message) ? 'no-gh' : 'error')

export const PROBLEM_TEXT: Record<CiProblem, string> = {
  'no-gh': 'gh (GitHub CLI) が見つかりません。入れてから「読み直す」を押してください',
  'no-login': 'gh にログインしていません。ターミナルで gh auth login を実行してください',
  'not-git': 'このフォルダは git のリポジトリではありません',
  'not-github': 'GitHub のリポジトリではありません (GitHub を指す remote がありません)',
  unsafe: 'git が所有者の確認で止めました (safe.directory に入れると読めます)',
  error: 'git・gh を実行できませんでした',
}
export const NO_PR = 'このブランチの PR はありません'
export const DETACHED = 'ブランチにいません (HEAD が外れています)'

const FAIL_WORDS = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])

/** statusCheckRollup の 1 件 (CheckRun か StatusContext) */
export function checkOf(x: unknown): CiCheck | undefined {
  if (typeof x !== 'object' || x === null) return undefined
  const r = x as Record<string, unknown>
  const name = str(r.name) || str(r.context) || '(名前なし)'
  if (typeof r.state === 'string' && r.status === undefined) {
    // StatusContext
    const s = r.state.toUpperCase()
    return { name, kind: s === 'SUCCESS' ? 'pass' : FAIL_WORDS.has(s) ? 'fail' : s === 'PENDING' || s === 'EXPECTED' ? 'run' : 'skip' }
  }
  const status = str(r.status).toUpperCase()
  const c = str(r.conclusion).toUpperCase()
  if (status !== 'COMPLETED') return { name, kind: 'run' }
  return { name, kind: c === 'SUCCESS' ? 'pass' : FAIL_WORDS.has(c) ? 'fail' : 'skip' }
}

/** gh pr view --json の出力。形が違えば例外 */
export function parsePr(stdout: string): CiPr {
  const r: unknown = JSON.parse(stdout)
  if (typeof r !== 'object' || r === null || Array.isArray(r)) throw new Error('PR の JSON の形が違います')
  const o = r as Record<string, unknown>
  const rollup = Array.isArray(o.statusCheckRollup) ? o.statusCheckRollup : []
  return {
    number: typeof o.number === 'number' ? o.number : 0,
    title: str(o.title),
    state: str(o.state).toUpperCase(),
    isDraft: o.isDraft === true,
    url: httpsOnly(o.url),
    review: str(o.reviewDecision).toUpperCase(),
    checks: rollup.map(checkOf).filter((c): c is CiCheck => c !== undefined),
  }
}

const RUN_LABEL: Record<string, string> = {
  success: '成功',
  failure: '失敗',
  cancelled: '取り消し',
  skipped: '飛ばした',
  timed_out: '時間切れ',
  startup_failure: '起動失敗',
  action_required: '要対応',
  neutral: '中立',
  stale: '古い',
}

/** gh run list --json の出力。配列でなければ例外 */
export function parseRuns(stdout: string): CiRun[] {
  const data: unknown = JSON.parse(stdout)
  if (!Array.isArray(data)) throw new Error('Actions の JSON の形が違います')
  return data
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map(r => {
      const status = str(r.status).toLowerCase()
      const c = str(r.conclusion).toLowerCase()
      const isRunning = status !== 'completed'
      const kind: CiKind = isRunning ? 'run' : c === 'success' ? 'pass' : FAIL_WORDS.has(c.toUpperCase()) ? 'fail' : 'skip'
      const at = Date.parse(str(r.createdAt))
      return {
        name: str(r.name) || '(名前なし)',
        kind,
        label: isRunning ? (status === 'queued' || status === 'waiting' || status === 'pending' ? '待ち' : '実行中') : (RUN_LABEL[c] ?? (c || '終了')),
        url: httpsOnly(r.url),
        createdAt: Number.isFinite(at) ? at : 0,
        event: str(r.event),
      }
    })
}

/** 走っている物があるか (読み直しの間隔を縮める) */
export const isRunning = (snap: CiSnap) => snap.kind === 'ok' && (snap.runs.some(r => r.kind === 'run') || (snap.pr?.checks.some(c => c.kind === 'run') ?? false))

export function ago(at: number, now: number) {
  if (at <= 0) return '─'
  const m = Math.floor((now - at) / 60_000)
  if (m < 1) return '今'
  if (m < 60) return `${m} 分前`
  if (m < 60 * 24) return `${Math.floor(m / 60)} 時間前`
  return `${Math.floor(m / 60 / 24)} 日前`
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

const esc = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const svgDoc = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<rect width="${W}" height="${h}" fill="${C.bg}"/>${body}</svg>`

const KIND_COLOR: Record<CiKind, string> = { pass: C.green, fail: C.red, run: C.blue, skip: C.weak }
export const KIND_MARK: Record<CiKind, string> = { pass: '●', fail: '■', run: '○', skip: '─' }

/** 丸 1 つ。走っている物は青い輪が回る (SMIL) */
function dot(cx: number, cy: number, kind: CiKind) {
  const color = KIND_COLOR[kind]
  if (kind !== 'run') return `<circle cx="${cx}" cy="${cy}" r="7" fill="${color}"/>`
  return (
    `<circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="${C.line}" stroke-width="2.5"/>` +
    `<circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="14 30">` +
    `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="1s" repeatCount="indefinite"/></circle>`
  )
}

export const stateLabel = (pr: CiPr) =>
  pr.state === 'MERGED' ? 'マージ' : pr.state === 'CLOSED' ? '閉' : pr.isDraft ? '下書き' : '開'
const stateColor = (pr: CiPr) => (pr.state === 'MERGED' ? C.purple : pr.state === 'CLOSED' ? C.red : pr.isDraft ? C.weak : C.green)
export const reviewLabel = (review: string) =>
  review === 'APPROVED' ? '承認済み' : review === 'CHANGES_REQUESTED' ? '修正の依頼' : review === 'REVIEW_REQUIRED' ? 'レビュー待ち' : 'レビューなし'
const reviewColor = (review: string) => (review === 'APPROVED' ? C.green : review === 'CHANGES_REQUESTED' ? C.red : review === 'REVIEW_REQUIRED' ? C.yellow : C.weak)

const ORDER: Record<CiKind, number> = { fail: 0, run: 1, pass: 2, skip: 3 }
/** 落ちた・走っている物を先に */
export const sortChecks = (checks: CiCheck[]) => [...checks].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
export const tally = (checks: { kind: CiKind }[]) => ({
  pass: checks.filter(c => c.kind === 'pass').length,
  fail: checks.filter(c => c.kind === 'fail').length,
  run: checks.filter(c => c.kind === 'run').length,
  skip: checks.filter(c => c.kind === 'skip').length,
})

const MAX_CHECK_ROWS = 10

/** 上の SVG: PR の札とチェックの丸。時刻を含めない (読み直しで回る丸を止めない) */
export function prSvg(snap: CiSnap) {
  if (snap.kind !== 'ok') {
    const text = snap.kind === 'problem' ? PROBLEM_TEXT[snap.problem] : '読み込み中'
    const color = snap.kind === 'problem' ? (snap.problem === 'error' ? C.red : C.yellow) : C.weak
    return svgDoc(
      76,
      `<rect x="8" y="8" width="364" height="60" rx="8" fill="${C.face}" stroke="${C.line}"/><rect x="8" y="8" width="4" height="60" rx="2" fill="${color}"/>` +
        `<text x="24" y="34" font-size="15" font-weight="bold" fill="${color}">${snap.kind === 'problem' ? '読めません' : '読み込み中'}</text>` +
        `<text x="24" y="56" font-size="12" fill="${C.text}">${esc(cut(text, 54))}</text>`,
    )
  }
  const branch = snap.branch || '(ブランチなし)'
  const pr = snap.pr
  if (!pr) {
    return svgDoc(
      76,
      `<rect x="8" y="8" width="364" height="60" rx="8" fill="${C.face}" stroke="${C.line}"/>` +
        `<text x="20" y="32" font-size="12" fill="${C.weak}">${esc(cut(branch, 54))}</text>` +
        `<text x="20" y="54" font-size="14" fill="${C.text}">${esc(cut(snap.prNote || NO_PR, 50))}</text>`,
    )
  }
  const color = stateColor(pr)
  const label = stateLabel(pr)
  let s = ''
  // 題は 2 行まで
  const t1 = cut(pr.title, 52)
  const rest = t1.endsWith('…') ? pr.title.slice(t1.length - 1) : ''
  s += `<text x="20" y="32" font-size="20" font-weight="bold" fill="${C.text}">#${pr.number}</text>`
  const bx = 34 + String(pr.number).length * 12
  s += `<rect x="${bx}" y="17" width="${label.length * 13 + 16}" height="20" rx="10" fill="${color}" opacity="0.2" stroke="${color}"/>`
  s += `<text x="${bx + 8}" y="32" font-size="12" fill="${color}">${label}</text>`
  s += `<text x="360" y="32" font-size="12" fill="${reviewColor(pr.review)}" text-anchor="end">${reviewLabel(pr.review)}</text>`
  s += `<text x="20" y="56" font-size="13" fill="${C.text}">${esc(t1)}</text>`
  if (rest !== '') s += `<text x="20" y="74" font-size="13" fill="${C.text}">${esc(cut(rest, 52))}</text>`
  s += `<text x="20" y="96" font-size="12" fill="${C.weak}">${esc(cut(branch, 54))}</text>`
  const n = tally(pr.checks)
  s +=
    `<text x="20" y="120" font-size="12"><tspan fill="${C.green}">通過 ${n.pass}</tspan><tspan dx="10" fill="${C.red}">失敗 ${n.fail}</tspan>` +
    `<tspan dx="10" fill="${C.blue}">実行中 ${n.run}</tspan><tspan dx="10" fill="${C.weak}">他 ${n.skip}</tspan></text>`
  const rows = sortChecks(pr.checks).slice(0, MAX_CHECK_ROWS)
  if (pr.checks.length === 0) s += `<text x="20" y="144" font-size="12" fill="${C.weak}">チェックはありません</text>`
  rows.forEach((c, i) => {
    const y = 144 + i * 22
    s += dot(28, y - 4, c.kind)
    s += `<text x="44" y="${y}" font-size="12" fill="${C.text}">${esc(cut(c.name, 48))}</text>`
  })
  const extra = pr.checks.length - rows.length
  const end = 144 + Math.max(1, rows.length) * 22 + (extra > 0 ? 18 : 0)
  if (extra > 0) s += `<text x="20" y="${end - 14}" font-size="12" fill="${C.weak}">ほか ${extra} 件</text>`
  const card = `<rect x="8" y="8" width="364" height="${end - 8}" rx="8" fill="${C.face}" stroke="${C.line}"/><rect x="8" y="8" width="4" height="${end - 8}" rx="2" fill="${color}"/>`
  return svgDoc(end + 8, card + s)
}

/** 下の SVG: Actions の一覧 (名前・結果・何分前) */
export function runsSvg(snap: Extract<CiSnap, { kind: 'ok' }>) {
  const rows = snap.runs.slice(0, RUN_LIMIT)
  const h = 40 + Math.max(1, rows.length) * 40
  let s = `<rect x="8" y="8" width="364" height="${h - 8}" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  s += `<text x="20" y="30" font-size="13" font-weight="bold" fill="${C.text}">Actions</text>`
  s += `<text x="360" y="30" font-size="12" fill="${C.weak}" text-anchor="end">${esc(cut(snap.branch || '全ブランチ', 30))}</text>`
  if (rows.length === 0) s += `<text x="20" y="58" font-size="12" fill="${C.weak}">${esc(cut(snap.runsNote || '実行はありません', 54))}</text>`
  rows.forEach((r, i) => {
    const y = 56 + i * 40
    s += `<circle cx="28" cy="${y}" r="6" fill="${KIND_COLOR[r.kind]}"/>`
    s += `<text x="44" y="${y + 4}" font-size="13" fill="${C.text}">${esc(cut(r.name, 34))}</text>`
    s += `<text x="360" y="${y + 4}" font-size="12" fill="${KIND_COLOR[r.kind]}" text-anchor="end">${esc(r.label)}</text>`
    s += `<text x="44" y="${y + 22}" font-size="12" fill="${C.weak}">${esc(`${ago(r.createdAt, snap.loadedAt)}${r.event !== '' ? ` / ${r.event}` : ''}`)}</text>`
  })
  return svgDoc(h + 8, s)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** terminal と Svg の alt に使う文 */
export function prLines(snap: CiSnap): Line[] {
  if (snap.kind === 'idle') return [{ text: '読み込み中', isDim: true }]
  if (snap.kind === 'problem') {
    const lines: Line[] = [{ text: PROBLEM_TEXT[snap.problem], color: snap.problem === 'error' ? 'red' : 'yellow' }]
    if (snap.detail !== '') lines.push({ text: snap.detail, isDim: true })
    return lines
  }
  const lines: Line[] = [{ text: `ブランチ ${snap.branch || '(なし)'}`, isDim: true }]
  const pr = snap.pr
  if (!pr) return [...lines, { text: snap.prNote || NO_PR }]
  const n = tally(pr.checks)
  lines.push(
    { text: `#${pr.number} [${stateLabel(pr)}] ${pr.title}`, isBold: true },
    { text: `${reviewLabel(pr.review)} / 通過 ${n.pass} 失敗 ${n.fail} 実行中 ${n.run} 他 ${n.skip}`, color: n.fail > 0 ? 'red' : n.run > 0 ? 'blue' : n.pass > 0 ? 'green' : undefined },
  )
  for (const c of sortChecks(pr.checks).slice(0, MAX_CHECK_ROWS)) lines.push({ text: `  ${KIND_MARK[c.kind]} ${c.name}`, color: c.kind === 'fail' ? 'red' : c.kind === 'run' ? 'blue' : undefined })
  return lines
}

export function runLines(snap: Extract<CiSnap, { kind: 'ok' }>): Line[] {
  if (snap.runs.length === 0) return [{ text: snap.runsNote || '実行はありません', isDim: true }]
  return snap.runs.slice(0, RUN_LIMIT).map(r => ({
    text: `${KIND_MARK[r.kind]} ${r.name} ${r.label} ${ago(r.createdAt, snap.loadedAt)}`,
    color: r.kind === 'fail' ? 'red' : r.kind === 'run' ? 'blue' : r.kind === 'pass' ? 'green' : undefined,
  }))
}
