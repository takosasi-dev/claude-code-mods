// 読み込み結果を表示用データにする純関数と、SVG を組む関数。fs も $ も触らない
import type { ProjectBoardProject, ProjectBoardSort } from '../types'

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

export const freshColor = (days: number) => (days <= 3 ? '#3fb950' : days <= 14 ? '#d29922' : '#6e7681')

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

const SVG_HEAD = (h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 ${h}" font-family="sans-serif">` +
  `<rect width="360" height="${h}" rx="10" fill="#0d1117"/>`

// 鮮度のグラフに並べる上限。Svg の source は 131072 字までなので、多いと残りは「ほか N 件」にまとめる
export const FRESH_ROWS = 100

// 一覧の上の「鮮度」横棒グラフ
export const freshnessSvg = (all: readonly ProjectBoardProject[], now: number) => {
  const ROW = 22
  const TOP = 46
  const list = all.slice(0, FRESH_ROWS)
  const rest = all.length - list.length
  const h = TOP + Math.max(1, list.length) * ROW + (rest > 0 ? ROW : 0) + 12
  const days = list.map(p => ageDays(p.mtimeMs, now))
  const max = Math.max(14, ...days)
  const X = 118
  const W = 190
  const legend = [
    ['#3fb950', '3日以内'],
    ['#d29922', '14日以内'],
    ['#6e7681', 'それ以上'],
  ] as const
  let out = SVG_HEAD(h)
  out += `<text x="14" y="24" fill="#c9d1d9" font-size="15" font-weight="bold">鮮度</text>`
  out += `<text x="56" y="24" fill="#8b949e" font-size="12">最終更新からの日数</text>`
  legend.forEach(([c, t], i) => {
    const lx = 14 + i * 84
    out += `<rect x="${lx}" y="32" width="10" height="6" rx="2" fill="${c}"/>`
    out += `<text x="${lx + 14}" y="39" fill="#8b949e" font-size="12">${t}</text>`
  })
  list.forEach((p, i) => {
    const y = TOP + i * ROW
    const d = days[i] ?? 0
    const w = Math.max(3, Math.round((d / max) * W))
    out += `<text x="14" y="${y + 15}" fill="#c9d1d9" font-size="12">${esc(fit(p.name, 8.5))}</text>`
    out += `<rect x="${X}" y="${y + 5}" width="${W}" height="12" rx="3" fill="#161b22"/>`
    out += `<rect x="${X}" y="${y + 5}" width="${w}" height="12" rx="3" fill="${freshColor(d)}"/>`
    out += `<text x="${X + w + 6}" y="${y + 15}" fill="#8b949e" font-size="12">${d}日</text>`
  })
  if (rest > 0) out += `<text x="14" y="${TOP + list.length * ROW + 15}" fill="#8b949e" font-size="12">ほか ${rest} 件</text>`
  return `${out}</svg>`
}

// 詳細画面のカード: 名前・更新日・抜き出した行
export const cardSvg = (p: ProjectBoardProject, now: number) => {
  const rows = p.lines.slice(0, 4).map(l => wrap(l, 24, 2))
  const body = rows.reduce((n, r) => n + r.length * 18 + 8, 0)
  // 先頭の見出しが名前と違えば名前の下に弱い文字で出す
  const sub = p.title !== '' && p.title !== p.name ? p.title : ''
  const o = sub ? 18 : 0
  const h = 96 + o + Math.max(18, body)
  const d = ageDays(p.mtimeMs, now)
  let out = SVG_HEAD(h)
  out += `<rect x="6" y="6" width="348" height="${h - 12}" rx="8" fill="#161b22" stroke="#30363d"/>`
  out += `<rect x="6" y="6" width="5" height="${h - 12}" rx="2" fill="${freshColor(d)}"/>`
  out += `<text x="22" y="34" fill="#c9d1d9" font-size="16" font-weight="bold">${esc(fit(p.name, 20))}</text>`
  if (sub) out += `<text x="22" y="54" fill="#8b949e" font-size="12">${esc(fit(sub, 26))}</text>`
  out += `<text x="22" y="${56 + o}" fill="#8b949e" font-size="12">更新 ${dateLabel(p.mtimeMs)}(${ageLabel(p.mtimeMs, now)})</text>`
  out += `<line x1="22" y1="${68 + o}" x2="338" y2="${68 + o}" stroke="#30363d"/>`
  let y = 90 + o
  if (rows.length === 0) out += `<text x="22" y="${y}" fill="#8b949e" font-size="12">状態の行は見つかりませんでした</text>`
  for (const r of rows) {
    out += `<circle cx="26" cy="${y - 4}" r="3" fill="#58a6ff"/>`
    for (const t of r) {
      out += `<text x="36" y="${y}" fill="#c9d1d9" font-size="13">${esc(t)}</text>`
      y += 18
    }
    y += 8
  }
  return `${out}</svg>`
}
