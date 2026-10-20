// git の出力を読んで項目ごとの信号を決め、SVG と行を組む。どれも純関数
import type { PreCheckFile, PreCheckHit, PreCheckReport, PreCheckTest } from '../types'

const C = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  weak: '#8b949e',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
}
const W = 380

/** 大きいファイルとみなす大きさ */
export const LARGE_BYTES = 1024 * 1024
/** 見つけた物はこの数まで持つ */
export const MAX_HITS = 50

export const UNSET_HINT = '未設定。/config で pre-check の testCommand に npm test のように入れると、テストも走らせられます'

/** 制御文字を落とす (タブと改行は残す)。エンジンは制御文字を含む Text・alt を描かない */
export const plain = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
const esc = (s: string) => plain(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const cut = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s)

// core.quotePath=false でも " や \ や制御文字を含む名前は C の文字列の形で囲まれる。戻した後に制御文字を落とす
export const unquote = (s: string) => {
  if (!(s.length > 1 && s.startsWith('"') && s.endsWith('"'))) return plain(s)
  try {
    return plain(JSON.parse(s) as string)
  } catch {
    return plain(s.slice(1, -1))
  }
}

/** `diff-index --cached --numstat` と `diff-files --numstat` から変わったファイルの一覧 (行数の多い順) */
export function parseNumstat(staged: string, unstaged: string): PreCheckFile[] {
  const map = new Map<string, PreCheckFile>()
  for (const [out, isStaged] of [[staged, true], [unstaged, false]] as const) {
    for (const line of out.split(/\r?\n/)) {
      const [a, d, ...rest] = line.split('\t')
      if (rest.length === 0) continue
      const path = unquote(rest.join('\t'))
      let f = map.get(path)
      if (!f) map.set(path, (f = { path, add: 0, del: 0, isStaged: false, isUnstaged: false, isBinary: false }))
      if (isStaged) f.isStaged = true
      else f.isUnstaged = true
      if (a === '-' || d === '-') f.isBinary = true
      else {
        f.add += Number(a) || 0
        f.del += Number(d) || 0
      }
    }
  }
  return [...map.values()].sort((p, q) => q.add + q.del - (p.add + p.del) || p.path.localeCompare(q.path))
}

/** 秘密情報らしい文字列。value があればその組を伏せて出す */
const SECRETS: { kind: string; re: RegExp; value?: number }[] = [
  { kind: 'AWS のアクセスキー', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'GitHub のトークン', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/ },
  { kind: 'Anthropic の API キー', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'API キー (sk-)', re: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/ },
  { kind: 'Slack のトークン', re: /\bxox[bp]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Google の API キー', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { kind: '秘密鍵', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
  { kind: 'パスワードらしい値', re: /(?:password|passwd|secret|api_?key)["']?\s*[:=]\s*['"]([^'"]{6,})['"]/i, value: 1 },
]

/** 真ん中を伏せる。頭 4 字…尾 2 字。短い物は頭 1 字だけ */
export const mask = (s: string) => (s.length >= 10 ? `${s.slice(0, 4)}…${s.slice(-2)}` : `${s.slice(0, 1)}…`)

/** 衝突の印。<<<<<<< と >>>>>>> は後ろに空白か何も無い時、======= は行全体の時だけ */
const CONFLICT = /^(?:<{7}|>{7})(?: |$)|^={7}$/

/**
 * `-p -U0` の差分から、足した行の秘密情報らしい文字列と衝突の印を拾う。
 * 見出し (diff --git から最初の @@ まで) の +++ だけをファイル名として読み、中身の行と取り違えない
 */
export function scanPatch(patch: string, isStaged: boolean): { secrets: PreCheckHit[]; conflicts: PreCheckHit[] } {
  const secrets: PreCheckHit[] = []
  const conflicts: PreCheckHit[] = []
  let path = ''
  let line = 0
  let isHead = true
  for (const raw of patch.split('\n')) {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (l.startsWith('diff --git ')) {
      isHead = true
      continue
    }
    if (isHead) {
      // 空白を含む名前の後ろには git がタブを付ける
      if (l.startsWith('+++ ')) path = unquote(l.slice(4).replace(/\t$/, '')).replace(/^b\//, '')
      const m = /^@@ -\S+ \+(\d+)/.exec(l)
      if (m) {
        isHead = false
        line = Number(m[1])
      }
      continue
    }
    const m = /^@@ -\S+ \+(\d+)/.exec(l)
    if (m) {
      line = Number(m[1])
      continue
    }
    if (l.startsWith(' ')) line++
    if (!l.startsWith('+')) continue
    // 1 行は頭 4000 字だけ見る
    const body = l.slice(1, 4001)
    if (secrets.length < MAX_HITS) {
      for (const s of SECRETS) {
        const hit = s.re.exec(body)
        if (!hit) continue
        const text = s.value === undefined ? mask(hit[0]) : `${hit[0].slice(0, hit[0].indexOf(hit[s.value] ?? '')).trim()}${mask(hit[s.value] ?? '')}`
        secrets.push({ path, line, kind: s.kind, text: plain(text), isStaged })
        break
      }
    }
    if (conflicts.length < MAX_HITS && CONFLICT.test(body.trimEnd())) conflicts.push({ path, line, kind: '衝突の印', text: plain(cut(body.trimEnd(), 40)), isStaged })
    line++
  }
  return { secrets, conflicts }
}

export const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

// ── テスト (test-runner と同じ分け方)

/** 空白で区切って argv にする (シェルは通さない) */
export const splitCommand = (s: string) => s.trim().split(/\s+/).filter(Boolean)

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
/** 出力の末尾 n 行 (色と制御文字と末尾の空行は落とす) */
export function tailOf(out: string, n = 40) {
  const lines = plain(out.replace(ANSI, '').replace(/\r(?!\n)/g, '\n')).split(/\r?\n/)
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
  return lines.slice(-n).join('\n')
}

// ── 項目と信号

export type Light = 'green' | 'yellow' | 'red' | 'gray'
export type Item = { id: 'changes' | 'secrets' | 'conflicts' | 'large' | 'test'; label: string; light: Light; summary: string; isBlinking?: boolean }
type Repo = Extract<PreCheckReport, { kind: 'repo' }>

export function itemsOf(r: Repo, test: PreCheckTest, isTestSet: boolean): Item[] {
  const staged = r.files.filter(f => f.isStaged)
  const unstaged = r.files.filter(f => f.isUnstaged)
  const sum = (fs: PreCheckFile[], k: 'add' | 'del') => fs.reduce((n, f) => n + f[k], 0)
  const changes: Item =
    staged.length > 0
      ? // 行数はステージ済みとまだの合計 (済 = ステージ済み、未 = まだ)
        { id: 'changes', label: '変更', light: 'green', summary: `済 ${staged.length} 件・未 ${unstaged.length} 件 +${sum(r.files, 'add')} −${sum(r.files, 'del')}` }
      : unstaged.length + r.untrackedCount > 0
        ? { id: 'changes', label: '変更', light: 'yellow', summary: 'まだステージしていません' }
        : { id: 'changes', label: '変更', light: 'yellow', summary: '変更がありません' }
  const hits = (id: 'secrets' | 'conflicts', label: string, n: number): Item =>
    n > 0 ? { id, label, light: 'red', summary: `${n >= MAX_HITS ? `${MAX_HITS} 件以上` : `${n} 件`}見つかりました` } : { id, label, light: 'green', summary: '見つかりません' }
  const large: Item =
    r.large.length > 0
      ? { id: 'large', label: '大きいファイル', light: 'yellow', summary: `1MB 超が ${r.large.length} 件` }
      : { id: 'large', label: '大きいファイル', light: 'green', summary: '1MB 超はありません' }
  let t: Item
  if (!isTestSet) t = { id: 'test', label: 'テスト', light: 'gray', summary: '未設定 (飛ばしました)' }
  else if (test.kind === 'idle') t = { id: 'test', label: 'テスト', light: 'gray', summary: 'まだ走らせていません' }
  else if (test.kind === 'running') t = { id: 'test', label: 'テスト', light: 'yellow', summary: '実行中', isBlinking: true }
  else if (test.kind === 'error') t = { id: 'test', label: 'テスト', light: 'red', summary: '起動できません' }
  else if (test.status === 'pass') t = { id: 'test', label: 'テスト', light: 'green', summary: '通過' }
  else t = { id: 'test', label: 'テスト', light: 'red', summary: test.status === 'timeout' ? '時間切れ' : `失敗 (終了コード ${test.exitCode})` }
  return [changes, hits('secrets', '秘密情報', r.secrets.length), hits('conflicts', '衝突の印', r.conflicts.length), large, t]
}

/**
 * 全体の判定。赤が 1 つでもあれば赤、黄があれば黄。
 * テストは「未設定」か「通過」の時だけ緑に数える (設定してあって走らせていなければ黄)
 */
export function verdictOf(items: Item[], isTestSet: boolean): { light: Light; text: string } {
  if (items.some(i => i.light === 'red')) return { light: 'red', text: '直してからコミット' }
  const test = items.find(i => i.id === 'test')
  const isTestOk = !isTestSet || test?.light === 'green'
  if (items.some(i => i.light === 'yellow') || !isTestOk) return { light: 'yellow', text: '確かめてからコミット' }
  return { light: 'green', text: 'コミットしてよさそう' }
}

const COLOR: Record<Light, string> = { green: C.green, yellow: C.yellow, red: C.red, gray: C.weak }

function lamp(cx: number, cy: number, r: number, light: Light, isBlinking: boolean) {
  const color = COLOR[light]
  if (light === 'gray') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.weak}" stroke-width="2" stroke-dasharray="3 3"/>`
  const blink = isBlinking ? `<animate attributeName="opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite"/>` : ''
  return (
    `<g>${blink}<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="${color}" opacity="0.6" filter="url(#glow)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#shine)"/></g>`
  )
}

const doc = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<defs><radialGradient id="shine" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
  `<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5"/></filter></defs>` +
  `<rect width="${W}" height="${h}" fill="${C.bg}"/>${body}</svg>`

/** 全体の判定と項目ごとの信号の SVG */
export function paneSvg(items: Item[], verdict: { light: Light; text: string }) {
  const isGo = verdict.light === 'green'
  let s = `<rect x="6" y="6" width="368" height="92" rx="10" fill="${C.face}" stroke="${COLOR[verdict.light]}" stroke-width="${isGo ? 2 : 1}"/>`
  s += lamp(52, 52, 26, verdict.light, false)
  s += `<text x="94" y="${isGo ? 60 : 48}" font-size="${isGo ? 24 : 20}" font-weight="bold" fill="${COLOR[verdict.light]}">${esc(verdict.text)}</text>`
  if (!isGo) {
    const n = items.filter(i => i.light === 'red').length
    const m = items.filter(i => i.light === 'yellow').length
    s += `<text x="94" y="74" font-size="13" fill="${C.weak}">赤 ${n} / 黄 ${m}</text>`
  }
  items.forEach((it, i) => {
    const y = 108 + i * 44
    s += `<rect x="6" y="${y}" width="368" height="38" rx="6" fill="${C.face}" stroke="${C.line}"/>`
    s += lamp(28, y + 19, 10, it.light, it.isBlinking === true)
    s += `<text x="48" y="${y + 24}" font-size="14" font-weight="bold" fill="${C.text}">${esc(it.label)}</text>`
    s += `<text x="366" y="${y + 24}" font-size="12" fill="${it.light === 'gray' ? C.weak : COLOR[it.light]}" text-anchor="end">${esc(cut(it.summary, 26))}</text>`
  })
  return doc(108 + items.length * 44 + 4, s)
}

/** git が読めない時の SVG */
export function messageSvg(title: string, lines: string[], light: Light) {
  let s = `<rect x="6" y="6" width="368" height="${40 + lines.length * 20}" rx="10" fill="${C.face}" stroke="${C.line}"/>`
  s += lamp(30, 30, 10, light, light === 'yellow')
  s += `<text x="50" y="35" font-size="15" font-weight="bold" fill="${COLOR[light]}">${esc(title)}</text>`
  lines.forEach((l, i) => (s += `<text x="20" y="${60 + i * 20}" font-size="12" fill="${C.text}">${esc(l)}</text>`))
  return doc(52 + lines.length * 20, s)
}

const where = (f: { isStaged: boolean; isUnstaged?: boolean }) => (f.isStaged && f.isUnstaged ? '済+未' : f.isStaged ? '済' : '未')

/** 開いた項目の中身の行 */
export function detailLines(id: string, r: Repo): string[] {
  const hitLine = (h: PreCheckHit) => `${cut(h.path, 30)}:${h.line} ${h.kind} ${h.text} (${h.isStaged ? 'ステージ済み' : 'まだ'})`
  if (id === 'changes') {
    const rows = r.files.slice(0, 30).map(f => `[${where(f)}] ${cut(f.path, 40)} ${f.isBinary ? 'バイナリ' : `+${f.add} −${f.del}`}`)
    if (r.files.length > 30) rows.push(`ほか ${r.files.length - 30} 件`)
    if (r.untrackedCount > 0) {
      rows.push(`追跡していない ${r.untrackedCount} 件 (中身は見ていません)`)
      rows.push(...r.untracked.slice(0, 10).map(p => `  ${cut(p, 40)}`))
    }
    if (rows.length === 0) rows.push('変更はありません')
    return rows
  }
  if (id === 'secrets') return r.secrets.length > 0 ? r.secrets.map(hitLine) : ['足した行に秘密情報らしい文字列はありません']
  if (id === 'conflicts') return r.conflicts.length > 0 ? r.conflicts.map(h => `${cut(h.path, 30)}:${h.line} ${h.text} (${h.isStaged ? 'ステージ済み' : 'まだ'})`) : ['足した行に衝突の印はありません']
  if (id === 'large') return r.large.length > 0 ? r.large.map(l => `${cut(l.path, 40)} ${sizeLabel(l.size)}`) : ['1MB を超えるファイルはありません']
  return []
}
