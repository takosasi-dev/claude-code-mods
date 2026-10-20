// 読み込み結果を表示用データにする純関数と、SVG を組む関数。fs も $ も触らない
import type { ProjectBoardProject, ProjectBoardSort } from '../types'
import { C, HEADER_H, fadeIn, frame, growBar, header } from './style'

const DAY = 86_400_000

// 本文に CR やタブ以外の制御文字が残ると Markdown/Text の検証で木ごと落ちる
export const normalize = (text: string) =>
  text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

// 箇条書きの印・強調・コード・リンクを外して 1 行の文にする
const clean = (line: string) =>
  line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// 引き継ぎメモの書き方(実物 20 本で多い形):
// 「状態: ...」行 / 「## 現状」「## 今どこにいるか」の箇条書き / 「## 次にやること」の番号付き / 「待ち」「未確認」「宿題」を含む行
export const extractLines = (text: string): string[] => {
  let h2 = ''
  let section = ''
  let status = ''
  let now = ''
  let todo = ''
  let wait = ''
  const plain: string[] = []
  for (const raw of text.split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw)
    if (heading) {
      // ### は上の ## と合わせて見る(「## 現状」の下が「### Phase1」で始まるメモがある)
      const text = heading[2] ?? ''
      if ((heading[1] ?? '').length <= 2) h2 = text
      section = (heading[1] ?? '').length <= 2 ? text : `${h2} ${text}`
      continue
    }
    if (/^\s*\|/.test(raw) || /^\s*(?:```|---|>)/.test(raw)) continue
    const line = clean(raw)
    if (line === '' || /^最終更新\s*[:：]/.test(line)) continue
    if (!status && /^状態\s*[:：]/.test(line)) status = line
    else if (!now && /現状|今どこ/.test(section)) now = line
    else if (!todo && /次に|次の|TODO/i.test(section)) todo = `次: ${line}`
    else if (!wait && /待ち|未確認|宿題/.test(line)) wait = line
    if (plain.length < 2) plain.push(line)
  }
  const found = [...new Set([status, now, todo, wait].filter(s => s !== ''))]
  return (found.length > 0 ? found : plain).map(s => cut(s, 80))
}

export const toProject = (fileName: string, path: string, mtimeMs: number, text: string): ProjectBoardProject => {
  const body = normalize(text)
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? ''
  // ファイル名にも制御文字が入りうる(Text の子や SVG に入れると木ごと拒まれる)
  const name = fileName.replace(/\.md$/i, '').replace(/[\x00-\x1f\x7f]/g, '')
  return { name, path, mtimeMs, title: cut(clean(title), 80), lines: extractLines(body) }
}

export const arrange = (list: readonly ProjectBoardProject[], sort: ProjectBoardSort, filter: string) => {
  const q = filter.trim().toLowerCase()
  const hit = q === '' ? [...list] : list.filter(p => p.name.toLowerCase().includes(q))
  if (sort === 'name') return hit.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  if (sort === 'old') return hit.sort((a, b) => a.mtimeMs - b.mtimeMs)
  return hit.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export const ageDays = (mtimeMs: number, now: number) => Math.max(0, Math.floor((now - mtimeMs) / DAY))

export const ageLabel = (mtimeMs: number, now: number) => {
  const d = ageDays(mtimeMs, now)
  if (d > 0) return `${d}日前`
  const h = Math.floor(Math.max(0, now - mtimeMs) / 3_600_000)
  return h > 0 ? `${h}時間前` : '1時間以内'
}

/** 鮮度の色。古い物は弱い色(呼ぶたびに今のテーマの色を引く) */
export const freshColor = (days: number) => (days <= 3 ? C.green : days <= 14 ? C.yellow : C.dim)

export const dateLabel = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// vault の根の下にあるときだけ obsidian:// を作る。外なら undefined
export const obsidianUrl = (path: string, vaultRoot: string, vaultName: string) => {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = norm(vaultRoot)
  // 未設定なら作らない (空の根は "/" から始まる全部に当たってしまう)
  if (root === '' || vaultName === '') return undefined
  const file = norm(path)
  if (!file.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return undefined
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file.slice(root.length + 1))}`
}

const esc = (s: string) =>
  s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 文字幅の目安: 半角 0.55、それ以外 1(font-size 倍)
const width = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) < 0x80 ? 0.55 : 1), 0)

const fit = (s: string, units: number) => {
  if (width(s) <= units) return s
  let out = ''
  for (const c of s) {
    if (width(out + c) > units - 1) break
    out += c
  }
  return `${out}…`
}

// 幅 units に収まるよう折り返す。rows 行を超えたら最後を … で切る
const wrap = (s: string, units: number, rows: number) => {
  const out: string[] = []
  let line = ''
  for (const c of s) {
    if (width(line + c) > units) {
      out.push(line)
      line = c
    } else line += c
  }
  out.push(line)
  if (out.length <= rows) return out
  const kept = out.slice(0, rows)
  kept[rows - 1] = fit(`${kept[rows - 1] ?? ''}${out[rows] ?? ''}`, units)
  return kept
}

// 鮮度のグラフに並べる上限。Svg の source は 131072 字までなので、多いと残りは「ほか N 件」にまとめる
export const FRESH_ROWS = 100

// 一覧の上の「鮮度」横棒グラフ
export const freshnessSvg = (all: readonly ProjectBoardProject[], now: number) => {
  const ROW = 22
  const TOP = HEADER_H + 30
  const list = all.slice(0, FRESH_ROWS)
  const rest = all.length - list.length
  const h = TOP + Math.max(1, list.length) * ROW + (rest > 0 ? ROW : 0) + 12
  const days = list.map(p => ageDays(p.mtimeMs, now))
  const max = Math.max(14, ...days)
  const X = 118
  const W = 206
  const legend = [
    [freshColor(0), '3日以内'],
    [freshColor(14), '14日以内'],
    [freshColor(15), 'それ以上'],
  ] as const
  let out = header('鮮度', '最終更新からの日数', C.green)
  legend.forEach(([c, t], i) => {
    const lx = 14 + i * 84
    out += `<rect x="${lx}" y="${HEADER_H + 10}" width="10" height="6" rx="2" fill="${c}"/>`
    out += `<text x="${lx + 14}" y="${HEADER_H + 17}" fill="${C.dim}" font-size="12">${t}</text>`
  })
  list.forEach((p, i) => {
    const y = TOP + i * ROW
    const d = days[i] ?? 0
    const w = Math.max(3, Math.round((d / max) * W))
    // 動きは上の 20 本だけ(多いと source が重くなる)
    const delay = i < 20 ? Number((0.1 + i * 0.04).toFixed(2)) : -1
    out += `<text x="14" y="${y + 15}" fill="${C.text}" font-size="12">${esc(fit(p.name, 8.5))}</text>`
    out += `<rect x="${X}" y="${y + 5}" width="${W}" height="12" rx="3" fill="${C.face}"/>`
    out +=
      delay < 0
        ? `<rect x="${X}" y="${y + 5}" width="${w}" height="12" rx="3" fill="${freshColor(d)}"/>`
        : growBar(X, y + 5, w, 12, freshColor(d), delay)
    out += `<text x="${X + w + 6}" y="${y + 15}" fill="${C.dim}" font-size="12">${d}日</text>`
  })
  if (rest > 0) out += `<text x="14" y="${TOP + list.length * ROW + 15}" fill="${C.dim}" font-size="12">ほか ${rest} 件</text>`
  return frame(h, out)
}

// 詳細画面のカード: 名前・更新日・抜き出した行
export const cardSvg = (p: ProjectBoardProject, now: number) => {
  const rows = p.lines.slice(0, 4).map(l => wrap(l, 24, 2))
  const body = rows.reduce((n, r) => n + r.length * 18 + 8, 0)
  // 先頭の見出しが名前と違えば名前の下に弱い文字で出す
  const sub = p.title !== '' && p.title !== p.name ? p.title : ''
  const o = sub ? 18 : 0
  const top = HEADER_H + 8
  const h = top + 42 + o + Math.max(28, body)
  const d = ageDays(p.mtimeMs, now)
  let out = header(fit(p.name, 20), ageLabel(p.mtimeMs, now), freshColor(d))
  if (sub) out += `<text x="14" y="${top + 16}" fill="${C.dim}" font-size="12">${esc(fit(sub, 28))}</text>`
  out += `<text x="14" y="${top + 18 + o}" fill="${C.dim}" font-size="12">更新 ${dateLabel(p.mtimeMs)}</text>`
  out += `<line x1="14" y1="${top + 30 + o}" x2="366" y2="${top + 30 + o}" stroke="${C.line}"/>`
  let y = top + 52 + o
  if (rows.length === 0) out += `<text x="14" y="${y}" fill="${C.dim}" font-size="12">状態の行は見つかりませんでした</text>`
  rows.forEach((r, i) => {
    let s = `<circle cx="18" cy="${y - 4}" r="3" fill="${C.blue}"/>`
    for (const t of r) {
      s += `<text x="28" y="${y}" fill="${C.text}" font-size="13">${esc(t)}</text>`
      y += 18
    }
    out += fadeIn(s, Number((0.15 + i * 0.08).toFixed(2)))
    y += 8
  })
  return frame(h, out)
}
