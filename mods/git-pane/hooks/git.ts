// git の出力を表示用のデータに変え、SVG と terminal 用の行を組む。どれも純関数
import type { GitPaneCommit, GitPaneFile, GitPaneSnapshot } from '../types'

type Repo = Extract<GitPaneSnapshot, { kind: 'repo' }>

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
export const TOP = 12
const W = 380
const MID = 190
const HALF = 170
const MONO = 'ui-monospace, Consolas, monospace'

/** 制御文字を落とす (タブと改行は残す)。エンジンは制御文字を含む Text・alt を描かない */
export const plain = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')

// core.quotePath=false でも " や \ や制御文字を含む名前は C の文字列の形で囲まれる。
// 戻すと \b などが本物の制御文字になるので、表示用に落とす
const unquote = (s: string) => plain(rawUnquote(s))
const rawUnquote = (s: string) => {
  if (!(s.length > 1 && s.startsWith('"') && s.endsWith('"'))) return s
  try {
    return JSON.parse(s) as string
  } catch {
    return s.slice(1, -1)
  }
}

function parseHead(line: string) {
  let s = line.slice(3)
  let ahead = 0
  let behind = 0
  const m = /\s\[([^\]]*)\]$/.exec(s)
  if (m) {
    s = s.slice(0, m.index)
    ahead = Number(/ahead (\d+)/.exec(m[1] ?? '')?.[1] ?? 0)
    behind = Number(/behind (\d+)/.exec(m[1] ?? '')?.[1] ?? 0)
  }
  const fresh = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(s)
  if (fresh) return { branch: plain(fresh[1] ?? ''), upstream: '', ahead, behind }
  if (s.startsWith('HEAD (no branch)')) return { branch: '(切り離し HEAD)', upstream: '', ahead, behind }
  const [branch = '', upstream = ''] = s.split('...')
  return { branch: plain(branch), upstream: plain(upstream), ahead, behind }
}

/**
 * `git status --porcelain=v1 -b`・`git diff --numstat`(未ステージ)・`git diff --cached --numstat`・
 * `git log --format=%h%x09%ct%x09%s` の出力から表示用のデータを作る (どれも --no-renames 前提)
 */
export function toRepo(status: string, unstaged: string, staged: string, log: string): Omit<Repo, 'kind' | 'cwd' | 'loadedAt'> {
  let head = { branch: '', upstream: '', ahead: 0, behind: 0 }
  const map = new Map<string, GitPaneFile>()
  const get = (path: string) => {
    let f = map.get(path)
    if (!f) map.set(path, (f = { path, add: 0, del: 0, isStaged: false, isUnstaged: false, isUntracked: false, isBinary: false }))
    return f
  }
  for (const line of status.split(/\r?\n/)) {
    if (line.startsWith('## ')) head = parseHead(line)
    else if (line.length > 3) {
      const x = line[0]
      const y = line[1]
      const f = get(unquote(line.slice(3)))
      if (x === '?' || x === '!') f.isUntracked = true
      else {
        f.isStaged = x !== ' '
        f.isUnstaged = y !== ' '
      }
    }
  }
  for (const out of [unstaged, staged]) {
    for (const line of out.split(/\r?\n/)) {
      const [a, d, ...rest] = line.split('\t')
      if (rest.length === 0) continue
      const f = get(unquote(rest.join('\t')))
      if (a === '-' || d === '-') f.isBinary = true
      else {
        f.add += Number(a) || 0
        f.del += Number(d) || 0
      }
    }
  }
  const files = [...map.values()].sort((p, q) => q.add + q.del - (p.add + p.del) || p.path.localeCompare(q.path))
  const commits: GitPaneCommit[] = []
  for (const line of log.split(/\r?\n/)) {
    const [hash, ct, ...subject] = line.split('\t')
    if (hash && ct) commits.push({ hash, time: Number(ct) * 1000, subject: plain(subject.join('\t')) })
  }
  return { ...head, files, commits }
}

/** 何分前の形 */
export function ago(ms: number, now: number) {
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 60) return 'たった今'
  if (s < 3600) return `${Math.floor(s / 60)}分前`
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}日前`
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}か月前`
  return `${Math.floor(s / (86400 * 365))}年前`
}

// 全角は 2、半角は 1 と数えた幅
const wide = (ch: string) => /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
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

const esc = (s: string) => plain(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
const sum = (r: Repo) => ({
  files: r.files.length,
  add: r.files.reduce((n, f) => n + f.add, 0),
  del: r.files.reduce((n, f) => n + f.del, 0),
})

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

const UNSAFE = 'git が所有者の確認で止めました'
const UNSAFE_HINT = 'git config の safe.directory に入れると読めます'

/** ペインに出す SVG 1 枚 */
export function paneSvg(snap: GitPaneSnapshot, now: number) {
  if (snap.kind === 'idle') return messageSvg('読み込み中', C.blue, '', '「再読込」で git の様子を読みます')
  if (snap.kind === 'not-repo') return messageSvg('git のフォルダではありません', C.yellow, snap.cwd, 'git のリポジトリの中で開くと表示されます')
  if (snap.kind === 'unsafe') return messageSvg(UNSAFE, C.yellow, snap.cwd, UNSAFE_HINT)
  if (snap.kind === 'error') return messageSvg('git を実行できません', C.red, snap.message, 'git が入っているか確かめてください')

  const t = sum(snap)
  let s = ''
  // ── ヘッダー: ブランチ・ahead/behind・3 つのタイル
  s += `<rect x="8" y="8" width="364" height="128" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  s +=
    `<g stroke="${C.weak}" stroke-width="2" fill="none" stroke-linecap="round">` +
    `<line x1="22" y1="22" x2="22" y2="38"/><path d="M32 25 C32 32 22 30 22 36"/>` +
    `<circle cx="22" cy="21" r="2.6" fill="${C.face}"/><circle cx="22" cy="40" r="2.6" fill="${C.face}"/><circle cx="32" cy="23" r="2.6" fill="${C.face}"/></g>`
  s += `<text x="42" y="37" font-size="17" font-weight="bold" fill="${C.text}">${esc(headFit(snap.branch, 22))}</text>`
  if (snap.upstream) {
    s +=
      `<text x="364" y="37" font-size="15" font-weight="bold" text-anchor="end">` +
      `<tspan fill="${snap.ahead ? C.green : C.weak}">↑${snap.ahead}</tspan>` +
      `<tspan dx="8" fill="${snap.behind ? C.orange : C.weak}">↓${snap.behind}</tspan></text>`
  } else s += `<text x="364" y="36" font-size="12" fill="${C.weak}" text-anchor="end">上流なし</text>`
  const where = snap.upstream ? `${base(snap.cwd)}  →  ${snap.upstream}` : base(snap.cwd)
  s += `<text x="20" y="58" font-size="12" fill="${C.weak}">${esc(tailFit(where, 52))}</text>`
  const tiles: [string, string, string][] = [
    ['変更ファイル', String(t.files), C.blue],
    ['追加した行', `+${t.add}`, C.green],
    ['消した行', `−${t.del}`, C.red],
  ]
  tiles.forEach(([label, value, color], i) => {
    const x = 16 + i * 119
    s +=
      `<rect x="${x}" y="70" width="110" height="58" rx="6" fill="${C.bg}" stroke="${C.line}"/>` +
      `<rect x="${x}" y="70" width="3" height="58" rx="1.5" fill="${color}"/>` +
      `<text x="${x + 12}" y="87" font-size="12" fill="${C.weak}">${label}</text>` +
      `<text x="${x + 12}" y="118" font-size="${value.length > 6 ? 20 : 26}" font-weight="bold" fill="${color}">${value}</text>`
  })

  // ── ファイルごとの差分バー
  let y = 164
  s += `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">ファイルごとの変更</text>`
  if (t.files > 0) s += `<text x="368" y="${y}" font-size="12" fill="${C.weak}" text-anchor="end">${Math.min(TOP, t.files)} / ${t.files}</text>`
  y += 20
  s +=
    `<g font-size="12" fill="${C.weak}">` +
    `<circle cx="16" cy="${y - 4}" r="4" fill="${C.blue}"/><text x="24" y="${y}">ステージ済</text>` +
    `<circle cx="104" cy="${y - 4}" r="4" fill="${C.yellow}"/><text x="112" y="${y}">未ステージ</text>` +
    `<circle cx="192" cy="${y - 4}" r="3.5" fill="none" stroke="${C.purple}" stroke-width="1.5"/><text x="200" y="${y}">未追跡</text></g>`
  y += 12
  const top = snap.files.slice(0, TOP)
  if (top.length === 0) {
    s +=
      `<rect x="8" y="${y}" width="364" height="40" rx="6" fill="${C.face}" stroke="${C.line}"/>` +
      `<text x="190" y="${y + 25}" font-size="13" fill="${C.green}" text-anchor="middle">変更はありません</text>`
    y += 52
  } else {
    const max = Math.max(1, ...top.map(f => Math.max(f.add, f.del)))
    s += `<line x1="${MID}" y1="${y}" x2="${MID}" y2="${y + top.length * 34}" stroke="${C.line}" stroke-dasharray="2 3"/>`
    for (const f of top) {
      const dots = f.isUntracked
        ? `<circle cx="14" cy="${y + 8}" r="3.5" fill="none" stroke="${C.purple}" stroke-width="1.5"/>`
        : (f.isStaged ? `<circle cx="${f.isUnstaged ? 11 : 14}" cy="${y + 8}" r="4" fill="${C.blue}"/>` : '') +
          (f.isUnstaged ? `<circle cx="${f.isStaged ? 20 : 14}" cy="${y + 8}" r="4" fill="${C.yellow}"/>` : '')
      const count = f.isUntracked
        ? `<tspan fill="${C.purple}">新規</tspan>`
        : f.isBinary && f.add + f.del === 0
          ? `<tspan fill="${C.weak}">バイナリ</tspan>`
          : `<tspan fill="${C.green}">+${f.add}</tspan><tspan dx="6" fill="${C.red}">−${f.del}</tspan>`
      s +=
        dots +
        `<text x="30" y="${y + 12}" font-size="12" fill="${f.isUntracked ? C.purple : C.text}">${esc(tailFit(f.path, 38))}</text>` +
        `<text x="368" y="${y + 12}" font-size="12" text-anchor="end">${count}</text>` +
        `<rect x="16" y="${y + 18}" width="348" height="8" rx="4" fill="${C.face}"/>`
      const wl = f.del ? Math.max(2, (f.del / max) * HALF) : 0
      const wr = f.add ? Math.max(2, (f.add / max) * HALF) : 0
      const grow = (from: number, to: number, attr: string) =>
        `<animate attributeName="${attr}" from="${from}" to="${to}" dur="0.6s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>`
      if (wl) s += `<rect x="${MID - wl}" y="${y + 18}" width="${wl}" height="8" rx="2" fill="${C.red}">${grow(MID, MID - wl, 'x')}${grow(0, wl, 'width')}</rect>`
      if (wr) s += `<rect x="${MID}" y="${y + 18}" width="${wr}" height="8" rx="2" fill="${C.green}">${grow(0, wr, 'width')}</rect>`
      y += 34
    }
    if (t.files > TOP) {
      s += `<text x="30" y="${y + 6}" font-size="12" fill="${C.weak}">ほか ${t.files - TOP} ファイル</text>`
      y += 16
    }
    y += 8
  }

  // ── 直近コミットのタイムライン
  y += 16
  s += `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">直近のコミット</text>`
  y += 14
  if (snap.commits.length === 0) {
    s += `<text x="12" y="${y + 14}" font-size="12" fill="${C.weak}">まだコミットがありません</text>`
    y += 28
  } else {
    const n = snap.commits.length
    if (n > 1) s += `<line x1="20" y1="${y + 8}" x2="20" y2="${y + 8 + (n - 1) * 40}" stroke="${C.line}" stroke-width="2"/>`
    snap.commits.forEach((c, i) => {
      s +=
        (i === 0
          ? `<circle cx="20" cy="${y + 8}" r="5.5" fill="${C.blue}"/>`
          : `<circle cx="20" cy="${y + 8}" r="4.5" fill="${C.bg}" stroke="${C.blue}" stroke-width="2"/>`) +
        `<text x="34" y="${y + 12}" font-size="12" font-family="${MONO}" fill="${C.blue}">${esc(c.hash)}</text>` +
        `<text x="368" y="${y + 12}" font-size="12" fill="${C.weak}" text-anchor="end">${ago(c.time, now)}</text>` +
        `<text x="34" y="${y + 29}" font-size="13" fill="${C.text}">${esc(headFit(c.subject, 44))}</text>`
      y += 40
    })
  }
  return svgDoc(y + 8, s)
}

type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行。制御文字を落とす (タブと改行は空白に) */
export const paneLines = (snap: GitPaneSnapshot, now: number): Line[] =>
  rawLines(snap, now).map(l => ({ ...l, text: plain(l.text).replace(/[\t\r\n]/g, ' ') }))

function rawLines(snap: GitPaneSnapshot, now: number): Line[] {
  if (snap.kind === 'idle') return [{ text: '読み込み中', isDim: true }]
  if (snap.kind === 'not-repo') return [{ text: 'git のフォルダではありません', color: 'yellow' }, { text: snap.cwd, isDim: true }]
  if (snap.kind === 'unsafe') return [{ text: UNSAFE, color: 'yellow' }, { text: snap.cwd, isDim: true }, { text: UNSAFE_HINT, isDim: true }]
  if (snap.kind === 'error') return [{ text: `git を実行できません: ${snap.message}`, color: 'red' }]
  const t = sum(snap)
  const lines: Line[] = [
    { text: `ブランチ ${snap.branch}${snap.upstream ? ` ↑${snap.ahead} ↓${snap.behind}` : ' (上流なし)'}`, isBold: true },
    { text: `変更 ${t.files} ファイル +${t.add} -${t.del}` },
  ]
  if (t.files === 0) lines.push({ text: '変更はありません', color: 'green' })
  for (const f of snap.files.slice(0, TOP)) {
    const mark = f.isUntracked ? '?' : `${f.isStaged ? 'S' : ' '}${f.isUnstaged ? 'M' : ' '}`
    const count = f.isUntracked ? '新規' : f.isBinary && f.add + f.del === 0 ? 'バイナリ' : `+${f.add} -${f.del}`
    lines.push({ text: `${mark.padEnd(2)} ${count}  ${f.path}` })
  }
  if (t.files > TOP) lines.push({ text: `ほか ${t.files - TOP} ファイル`, isDim: true })
  lines.push({ text: '直近のコミット', isBold: true })
  if (snap.commits.length === 0) lines.push({ text: 'まだコミットがありません', isDim: true })
  for (const c of snap.commits) lines.push({ text: `${c.hash} ${c.subject} (${ago(c.time, now)})` })
  return lines
}
