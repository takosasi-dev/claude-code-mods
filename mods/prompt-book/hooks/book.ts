// 依頼文の並び・絞り込み・読み戻しと画面の SVG。$ に触らない純関数だけ置く
import type { PromptBookItem, PromptBookSort } from '../types'

export const MAX_TAGS = 3
const MAX_TAG_LEN = 16
const MAX_TITLE_LEN = 40
/** SVG に並べるタグのチップの数。残りは「ほか N」にまとめる */
const MAX_CHIPS = 30

export const SORTS: readonly { value: PromptBookSort; label: string }[] = [
  { value: 'uses', label: 'よく使う順' },
  { value: 'new', label: '新しい順' },
  { value: 'title', label: '題の順' },
]

export const isSort = (v: string): v is PromptBookSort => SORTS.some(s => s.value === v)

export const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** カンマ区切り (読点・全角カンマも) を、重なりを除いて 3 つまで */
export function parseTags(s: string): string[] {
  const out: string[] = []
  for (const raw of s.split(/[,、，]/)) {
    const t = raw.trim().slice(0, MAX_TAG_LEN)
    if (t !== '' && !out.includes(t)) out.push(t)
  }
  return out.slice(0, MAX_TAGS)
}

/** 題が空の時は本文の 1 行目から */
export const titleOf = (title: string, body: string) =>
  short(title.trim() !== '' ? title.trim() : (body.trim().split('\n')[0] ?? '').trim(), MAX_TITLE_LEN)

export const newId = (now: number) => `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 初めて開いた時に入れておく例 */
export function seeds(now: number): PromptBookItem[] {
  const list: [string, string, string[]][] = [
    ['続けて', '続けて', ['定番']],
    ['テストを走らせる', 'テストを走らせて結果を教えて', ['テスト']],
    ['レビュー', '今の変更をレビューして', ['レビュー']],
    ['3 行で要約', 'ここまでを 3 行で要約して', ['定番', '要約']],
    ['テストを書く', 'この関数にテストを書いて', ['テスト']],
  ]
  return list.map(([title, body, tags], i) => ({ id: `seed${i + 1}`, title, body, tags, uses: 0, lastUsedAt: 0, createdAt: now - i }))
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/** store から読んだ値を形を確かめて戻す。配列でなければ undefined (まだ保存が無い) */
export function fromSaved(v: unknown): PromptBookItem[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: PromptBookItem[] = []
  for (const [i, x] of v.entries()) {
    if (typeof x !== 'object' || x === null) continue
    const r = x as Record<string, unknown>
    if (typeof r.body !== 'string' || r.body.trim() === '') continue
    const id = typeof r.id === 'string' && r.id !== '' && !out.some(o => o.id === r.id) ? r.id : `old${i}`
    const tags = Array.isArray(r.tags) ? parseTags(r.tags.filter(t => typeof t === 'string').join(',')) : []
    out.push({
      id,
      title: titleOf(typeof r.title === 'string' ? r.title : '', r.body),
      body: r.body,
      tags,
      uses: num(r.uses),
      lastUsedAt: num(r.lastUsedAt),
      createdAt: num(r.createdAt),
    })
  }
  return out
}

const byUses = (a: PromptBookItem, b: PromptBookItem) => b.uses - a.uses || b.lastUsedAt - a.lastUsedAt || a.title.localeCompare(b.title, 'ja')

/** タグで絞って並べる。tag が空ならすべて */
export function arrange(items: readonly PromptBookItem[], sort: PromptBookSort, tag: string): PromptBookItem[] {
  const list = tag === '' ? [...items] : items.filter(p => p.tags.includes(tag))
  if (sort === 'uses') return list.sort(byUses)
  if (sort === 'new') return list.sort((a, b) => b.createdAt - a.createdAt)
  return list.sort((a, b) => a.title.localeCompare(b.title, 'ja'))
}

/** よく使う上位 (1 回以上使った物だけ) */
export const topUses = (items: readonly PromptBookItem[], n = 5) => items.filter(p => p.uses > 0).sort(byUses).slice(0, n)

/** タグごとの件数。多い順、同じなら名前順 */
export function tagCounts(items: readonly PromptBookItem[]): { tag: string; count: number }[] {
  const m = new Map<string, number>()
  for (const p of items) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1)
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'))
}

/** terminal 向けの行 */
export function summaryLines(items: readonly PromptBookItem[]): string[] {
  const top = topUses(items)
  const tags = tagCounts(items)
  return [
    `プロンプト帳 ${items.length} 件`,
    ...(top.length === 0 ? ['よく使う: まだありません'] : top.map((p, i) => `${i + 1}. ${short(p.title, 18)} ${p.uses}回`)),
    tags.length === 0 ? 'タグ: なし' : `タグ: ${tags.map(t => `${t.tag} ${t.count}`).join(' / ')}`,
  ]
}

const BG = '#0d1117'
const FACE = '#161b22'
const LINE = '#30363d'
const FG = '#c9d1d9'
const DIM = '#8b949e'
const GREEN = '#3fb950'
const BLUE = '#58a6ff'
const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f78166']

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 12px の文字幅のおおよそ (全角 12、半角 7) */
const textWidth = (s: string, size = 12) => [...s].reduce((w, c) => w + ((c.codePointAt(0) ?? 0) > 0xff ? size : size * 0.6), 0)

/**
 * 上によく使う 5 件の横棒、下にタグごとの件数のチップ。
 * isFlashing の間は右上に「保存しました」が光る (保存のたびに source が変わるのでアニメは頭から)
 */
export function chartSvg(items: readonly PromptBookItem[], selectedTag: string, isFlashing: boolean): string {
  const W = 380
  const pad = 16
  const parts: string[] = []
  const top = topUses(items)
  const max = Math.max(1, ...top.map(p => p.uses))

  parts.push(`<text x="${pad}" y="32" font-size="18" font-weight="bold" fill="${FG}">プロンプト帳</text>`)
  if (!isFlashing) parts.push(`<text x="${W - pad}" y="32" font-size="13" fill="${DIM}" text-anchor="end">${items.length} 件</text>`)

  let y = 66
  parts.push(`<text x="${pad}" y="${y}" font-size="12" fill="${DIM}">よく使う上位 ${top.length} 件</text>`)
  y += 10
  if (top.length === 0) {
    parts.push(`<text x="${pad}" y="${y + 18}" font-size="13" fill="${DIM}">まだ使った依頼文はありません</text>`)
    y += 32
  }
  const barX = 168
  const barMax = W - pad - barX - 34
  top.forEach((p, i) => {
    const w = Math.max(4, Math.round((p.uses / max) * barMax))
    const color = COLORS[i % COLORS.length]
    const cy = y + 6 + i * 28
    parts.push(
      `<text x="${pad}" y="${cy + 12}" font-size="13" fill="${FG}">${esc(short(p.title, 11))}</text>`,
      `<rect x="${barX}" y="${cy}" width="${barMax}" height="16" rx="4" fill="${FACE}"/>`,
      `<rect x="${barX}" y="${cy}" width="${w}" height="16" rx="4" fill="${color}"><animate attributeName="width" from="0" to="${w}" dur="0.7s" begin="${(i * 0.1).toFixed(1)}s" fill="freeze"/></rect>`,
      `<text x="${W - pad}" y="${cy + 13}" font-size="12" fill="${DIM}" text-anchor="end">${p.uses}回</text>`,
    )
  })
  y += top.length * 28 + 22

  const tags = tagCounts(items)
  parts.push(`<text x="${pad}" y="${y}" font-size="12" fill="${DIM}">タグごとの件数</text>`)
  y += 10
  if (tags.length === 0) {
    parts.push(`<text x="${pad}" y="${y + 18}" font-size="13" fill="${DIM}">タグはまだありません</text>`)
    y += 30
  } else {
    let x = pad
    const shown = tags.slice(0, MAX_CHIPS)
    const rest = tags.length - shown.length
    const chips = [...shown.map(t => ({ label: `${short(t.tag, 10)} ${t.count}`, isOn: t.tag === selectedTag })), ...(rest > 0 ? [{ label: `ほか ${rest}`, isOn: false }] : [])]
    for (const { label, isOn } of chips) {
      const w = Math.ceil(textWidth(label)) + 18
      if (x + w > W - pad && x > pad) {
        x = pad
        y += 30
      }
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="22" rx="11" fill="${isOn ? BLUE : FACE}" stroke="${isOn ? BLUE : LINE}"/>`,
        `<text x="${x + w / 2}" y="${y + 15}" font-size="12" fill="${isOn ? BG : FG}" text-anchor="middle">${esc(label)}</text>`,
      )
      x += w + 6
    }
    y += 34
  }

  if (isFlashing) {
    parts.push(
      `<g filter="url(#glow)">`,
      `<rect x="${W - pad - 128}" y="12" width="128" height="28" rx="14" fill="${FACE}" stroke="${GREEN}" stroke-width="2">`,
      `<animate attributeName="stroke-width" values="2;5;2" dur="0.8s" repeatCount="3"/>`,
      `</rect>`,
      `<text x="${W - pad - 64}" y="31" font-size="13" font-weight="bold" fill="${GREEN}" text-anchor="middle">保存しました</text>`,
      `<animate attributeName="opacity" values="0;1;1;1;0.85" dur="2.4s" fill="freeze"/>`,
      `</g>`,
    )
  }

  const H = y
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`,
    `<defs><filter id="glow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`,
    `<rect width="${W}" height="${H}" rx="10" fill="${BG}"/>`,
    ...parts,
    '</svg>',
  ].join('')
}
