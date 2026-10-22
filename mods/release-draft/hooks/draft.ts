// 前のタグからの変更を集めて、CHANGELOG の下書きとペインの SVG と文を作る。どれも純関数
import type { DraftBump, DraftCommit, DraftReport } from '../types'
import { C, HEADER_H, esc, frame, header, panel, short } from './style'

/** 読むコミットの上限 */
export const MAX_COMMITS = 200
/** 版を読むファイルの上限 */
export const MAX_BUMPS = 60

// ── コマンドの読み方 (ship-guard と同じ形。mod は別々に入れるので写して持つ)

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

// 引用符の付いた所も含めた 1 語
const WORD = String.raw`(?:[^\s'";&|()]+|'[^']*'|"(?:[^"\\]|\\.)*")+`
const dequote = (w: string) => w.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_, a: string | undefined, b: string | undefined) => a ?? b ?? '')

/** git commit をした場所。commit の git -C <dir> か、その前の最後の cd / Set-Location / pushd。書かれていなければ無し */
export function commitDirOf(command: string): string | undefined {
  const at = new RegExp(String.raw`\bgit(?:\.exe)?((?:\s+(?:-[cC]\s+${WORD}|--?[\w-]+(?:=\S+)?))*)\s+commit\b`, 'i').exec(command)
  if (!at) return undefined
  const dashC = new RegExp(String.raw`-C\s+(${WORD})`).exec(at[1] ?? '')
  if (dashC?.[1]) return dequote(dashC[1])
  const cds = [...command.slice(0, at.index).matchAll(new RegExp(String.raw`(?:^|[;&|\n({]\s*)(?:cd|Set-Location|sl|pushd|chdir)\s+(?:/d\s+|-(?:Literal)?Path\s+)?(${WORD})`, 'gi'))]
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

// ── git の答えの読み方

/** git log --format=%h%x00%s の行 */
export const parseLog = (out: string): DraftCommit[] =>
  out
    .split('\n')
    .filter(l => l.includes('\x00'))
    .map(l => {
      const [hash = '', subject = ''] = l.split('\x00')
      return { hash, subject: subject.trim() }
    })

/** 版を持つファイルか (plugin.json・package.json) */
export const isVersionFile = (path: string) => /(?:^|\/)(?:plugin|package)\.json$/.test(path)

/** JSON の文から name と version を読む。読めなければ無し */
export function versionOf(text: string | undefined): { name: string; version: string } | undefined {
  if (text === undefined) return undefined
  try {
    const o = JSON.parse(text) as { name?: unknown; version?: unknown }
    return typeof o.version === 'string' ? { name: typeof o.name === 'string' ? o.name : '', version: o.version } : undefined
  } catch {
    return undefined
  }
}

/** タグの次の版の候補。新しい物 (mod・機能) があれば 2 つ目、無ければ 3 つ目を上げる。読めなければ無し */
export function nextVersion(tag: string | null, hasNew: boolean) {
  const m = /^(v?)(\d+)\.(\d+)\.(\d+)/.exec(tag ?? '')
  if (!m) return undefined
  const [, v = '', major = '0', minor = '0', patch = '0'] = m
  return hasNew ? `${v}${major}.${Number(minor) + 1}.0` : `${v}${major}.${minor}.${Number(patch) + 1}`
}

const ADDED = /^(?:feat|add)\b|追加|足す|足した|足しました|新しい|新規|作った|作りました/i
const FIXED = /^(?:fix|bug)\b|直す|直した|直しました|修正|バグ|不具合|落ちる|落ちた/i

export type Draft = { added: string[]; changed: string[]; fixed: string[]; next?: string }

/** コミットと版の上がり方を、Added / Changed / Fixed に分ける */
export function groupsOf(r: Extract<DraftReport, { kind: 'ready' }>): Draft {
  const added: string[] = []
  const changed: string[] = []
  const fixed: string[] = []
  for (const b of r.bumps) {
    const name = b.name || b.path
    if (b.from === undefined) added.push(`${name} ${b.to}(新しく足した)`)
    else changed.push(`${name} ${b.from} → ${b.to}`)
  }
  for (const c of r.commits) {
    // 前の版のリリースのコミット (v0.8.0: ...) は入れない
    if (/^v?\d+\.\d+\.\d+\b/.test(c.subject)) continue
    if (FIXED.test(c.subject)) fixed.push(c.subject)
    else if (ADDED.test(c.subject)) added.push(c.subject)
    else changed.push(c.subject)
  }
  return { added, changed, fixed, next: nextVersion(r.tag, r.bumps.some(b => b.from === undefined) || r.commits.some(c => ADDED.test(c.subject))) }
}

/** CHANGELOG に貼れる下書き (Keep a Changelog の形) */
export function draftText(r: Extract<DraftReport, { kind: 'ready' }>, today: string) {
  const g = groupsOf(r)
  const section = (title: string, items: string[]) => (items.length === 0 ? '' : `\n### ${title}\n\n${items.map(i => `- ${i}`).join('\n')}\n`)
  const body = section('Added', g.added) + section('Changed', g.changed) + section('Fixed', g.fixed)
  return `## [${(g.next ?? 'Unreleased').replace(/^v/, '')}] - ${today}\n${body || '\n(まだ変更がありません)\n'}`
}

/** 「Claude に書いてもらう」で入力欄に入れる文 */
export function askText(r: Extract<DraftReport, { kind: 'ready' }>, today: string) {
  const g = groupsOf(r)
  const since = r.tag ? `前のタグ ${r.tag} から今まで` : '最近'
  return [
    `${since}の変更で、CHANGELOG.md に次の版${g.next ? ` (${g.next} の候補)` : ''}の節を書いてください。場所は ${r.dir} です。`,
    '下は release-draft が機械で分けた下書きです。コミットと差分を確かめて、言葉を整え、分け方の間違いを直してください。公開 (push・リリース) はしないでください。',
    '',
    draftText(r, today),
  ].join('\n')
}

// ── ペイン

export type PaneInput = { report: DraftReport; today: string; isOverridden: boolean }

const headline = (r: DraftReport) => {
  switch (r.kind) {
    case 'idle':
    case 'loading':
      return '読んでいます…'
    case 'not-repo':
      return 'git のリポジトリではありません'
    case 'error':
      return '読めませんでした'
    case 'ready':
      return r.tag ? `${r.tag} から ${r.commitCount} コミット` : `タグがありません (最近の ${r.commits.length} コミット)`
  }
}

/** ペインの SVG 1 枚 */
export function paneSvg(i: PaneInput) {
  const r = i.report
  const accent = r.kind === 'ready' ? C.blue : r.kind === 'error' || r.kind === 'not-repo' ? C.yellow : C.dim
  let s = panel(8, 8, 364, 56)
  s += `<text x="20" y="32" font-size="15" font-weight="bold" fill="${accent}">${esc(headline(r))}</text>`
  const where = r.kind === 'ready' || r.kind === 'not-repo' ? r.dir : r.kind === 'error' ? r.message : ''
  s += `<text x="20" y="52" font-size="11" fill="${C.dim}">${esc(short(where, 48))}</text>`
  let y = 72
  if (r.kind === 'ready') {
    const g = groupsOf(r)
    // 次の版と、分けた数
    s += panel(8, y, 364, 60)
    s += `<text x="20" y="${y + 24}" font-size="13" fill="${C.dim}">次の版の候補</text>`
    s += `<text x="360" y="${y + 26}" font-size="20" font-weight="bold" text-anchor="end" fill="${C.text}">${esc(g.next ?? '─')}</text>`
    s += `<text x="20" y="${y + 48}" font-size="12" fill="${C.green}">Added ${g.added.length}</text>`
    s += `<text x="120" y="${y + 48}" font-size="12" fill="${C.blue}">Changed ${g.changed.length}</text>`
    s += `<text x="240" y="${y + 48}" font-size="12" fill="${C.yellow}">Fixed ${g.fixed.length}</text>`
    y += 68
    // 版の上がったもの
    const bumps = r.bumps.slice(0, 8)
    if (bumps.length > 0) {
      const h = bumps.length * 20 + 36
      s += panel(8, y, 364, h)
      s += `<text x="20" y="${y + 22}" font-size="13" font-weight="bold" fill="${C.text}">版が上がったもの</text>`
      bumps.forEach((b, n) => {
        const yy = y + 42 + n * 20
        s += `<text x="20" y="${yy}" font-size="12" fill="${C.text}">${esc(short(b.name || b.path, 22))}</text>`
        s += `<text x="360" y="${yy}" font-size="12" text-anchor="end" fill="${b.from === undefined ? C.green : C.blue}">${esc(b.from === undefined ? `新 ${b.to}` : `${b.from} → ${b.to}`)}</text>`
      })
      y += h + 8
    }
    // コミット
    const rows = r.commits.slice(0, 8)
    const h = Math.max(1, rows.length) * 20 + 36
    s += panel(8, y, 364, h)
    s += `<text x="20" y="${y + 22}" font-size="13" font-weight="bold" fill="${C.text}">コミット${r.commitCount > rows.length ? ` (新しい ${rows.length} 件)` : ''}</text>`
    if (rows.length === 0) s += `<text x="20" y="${y + 46}" font-size="12" fill="${C.dim}">まだありません</text>`
    rows.forEach((c, n) => {
      const yy = y + 42 + n * 20
      s += `<text x="20" y="${yy}" font-size="11" fill="${C.dim}">${esc(c.hash)}</text>`
      s += `<text x="76" y="${yy}" font-size="12" fill="${C.text}">${esc(short(c.subject, 25))}</text>`
    })
    y += h + 8
  }
  return frame(HEADER_H + y, header('リリースノートの下書き', i.isOverridden ? 'コミットした場所' : 'セッションの場所', accent) + `<g transform="translate(0 ${HEADER_H})">${s}</g>`)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(i: PaneInput): Line[] {
  const r = i.report
  const lines: Line[] = [{ text: headline(r), isBold: true, color: r.kind === 'ready' ? undefined : 'warning' }]
  if (r.kind === 'ready' || r.kind === 'not-repo') lines.push({ text: r.dir, isDim: true })
  if (r.kind === 'error') lines.push({ text: r.message, isDim: true })
  if (r.kind !== 'ready') return lines
  const g = groupsOf(r)
  lines.push({ text: `次の版の候補: ${g.next ?? '─'}  Added ${g.added.length}・Changed ${g.changed.length}・Fixed ${g.fixed.length}` })
  if (r.isCut) lines.push({ text: `コミットが多いので新しい ${r.commits.length} 件だけ読みました`, isDim: true })
  return lines
}
