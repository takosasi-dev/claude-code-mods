// SVG を文字列で組む関数。描画面は <img> なので動きは SMIL だけ
import type { TokenMeterTurn, TokenMeterUsage } from '../types'

export const C = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  dim: '#8b949e',
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
  orange: '#f78166',
}

/** 4 種の名前と色。積み上げは下からこの順 */
export const SERIES: { key: keyof TokenMeterUsage; label: string; color: string }[] = [
  { key: 'cacheRead', label: 'キャッシュ読み', color: C.green },
  { key: 'cacheWrite', label: 'キャッシュ書き', color: C.purple },
  { key: 'input', label: '入力', color: C.blue },
  { key: 'output', label: '出力', color: C.orange },
]

const W = 360
const FONT = 'font-family="sans-serif"'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 1234 → 1.2k、3456789 → 3.5M。1000 未満はそのまま */
export const short = (n: number) => {
  const one = (v: number, unit: string) => `${v < 100 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}${unit}`
  if (n < 1000) return String(Math.round(n))
  if (n < 999_950) return one(n / 1000, 'k')
  return one(n / 1_000_000, 'M')
}

export const sum = (u: TokenMeterUsage) => u.input + u.output + u.cacheRead + u.cacheWrite

/** キャッシュの当たり率 (0〜1)。入力が 1 つも無ければ null */
export const hitRate = (u: TokenMeterUsage) => {
  const all = u.input + u.cacheRead + u.cacheWrite
  return all > 0 ? u.cacheRead / all : null
}

export const rateColor = (r: number) => (r >= 0.7 ? C.green : r >= 0.4 ? C.yellow : C.red)

const svg = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" ${FONT}>` +
  `<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="12" fill="${C.face}" stroke="${C.line}"/>` +
  body +
  `</svg>`

const text = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`

const title = (s: string, right = '') =>
  text(16, 28, s, 14, C.text, 'font-weight="bold"') + (right ? text(W - 16, 28, right, 12, C.dim, 'text-anchor="end"') : '')

// ---- 合計とリング ----

export const summarySvg = (total: TokenMeterUsage, sub: TokenMeterUsage & { runs: number }) => {
  const cells: [string, number, string][] = [
    ['入力', total.input, C.blue],
    ['出力', total.output, C.orange],
    ['キャッシュ読み', total.cacheRead, C.green],
    ['キャッシュ書き', total.cacheWrite, C.purple],
  ]
  const nums = cells
    .map(([label, n, color], i) => {
      const x = 16 + (i % 2) * 104
      const y = 56 + Math.floor(i / 2) * 64
      return text(x, y, label, 12, C.dim) + text(x, y + 30, short(n), 26, color, 'font-weight="bold"')
    })
    .join('')

  // リング: 上から時計回りに当たり率の分だけ塗る。描くたびに 0 から伸ばす
  const cx = 288
  const cy = 98
  const r = 46
  const len = 2 * Math.PI * r
  const rate = hitRate(total)
  const ring =
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.line}" stroke-width="12"/>` +
    (rate === null
      ? text(cx, cy + 8, '─', 22, C.dim, 'text-anchor="middle"')
      : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${rateColor(rate)}" stroke-width="12" stroke-linecap="round" ` +
        `stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${(len * (1 - rate)).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})">` +
        `<animate attributeName="stroke-dashoffset" from="${len.toFixed(1)}" to="${(len * (1 - rate)).toFixed(1)}" dur="0.9s" fill="freeze"/></circle>` +
        text(cx, cy + 8, `${Math.round(rate * 100)}%`, 22, rateColor(rate), 'text-anchor="middle" font-weight="bold"')) +
    text(cx, cy + r + 26, 'キャッシュ当たり', 12, C.dim, 'text-anchor="middle"')

  const subLine =
    sub.runs > 0
      ? text(16, 196, `サブエージェント ${sub.runs}回  計 ${short(sum(sub))}`, 12, C.dim)
      : text(16, 196, 'サブエージェントの分は別に数えます', 12, C.dim)

  return svg(212, title('トークン', 'セッション合計') + nums + ring + `<line x1="16" y1="176" x2="${W - 16}" y2="176" stroke="${C.line}"/>` + subLine)
}

// ---- ターンごとの積み上げ棒 ----

export const barsSvg = (turns: TokenMeterTurn[], heaviest: TokenMeterTurn | null) => {
  const shown = turns.slice(-20)
  const H = 262
  if (shown.length === 0) {
    return svg(H, title('ターンごと') + text(W / 2, 140, 'まだターンがありません', 13, C.dim, 'text-anchor="middle"'))
  }

  // 凡例
  let lx = 16
  const legend = SERIES.map(s => {
    const part = `<rect x="${lx}" y="44" width="12" height="12" rx="2" fill="${s.color}"/>` + text(lx + 16, 55, s.label, 12, C.text)
    lx += 16 + s.label.length * 12 + 10
    return part
  }).join('')

  const top = 84
  const base = 206
  const plotH = base - top
  const left = 16
  const slot = (W - 32) / 20
  const bw = Math.max(4, slot - 5)
  const max = Math.max(1, ...shown.map(sum))

  const grid =
    `<line x1="${left}" y1="${top}" x2="${W - 16}" y2="${top}" stroke="${C.line}" stroke-dasharray="3 4"/>` +
    `<line x1="${left}" y1="${base}" x2="${W - 16}" y2="${base}" stroke="${C.line}"/>` +
    text(left, top - 6, short(max), 12, C.dim)

  const bars = shown
    .map((t, i) => {
      const isLast = i === shown.length - 1
      const x = left + i * slot + (slot - bw) / 2
      let y = base
      const segs = SERIES.map(s => {
        const h = (t[s.key] / max) * plotH
        if (h <= 0) return ''
        y -= h
        // 最新の棒だけ基線から伸ばす (y と height を一緒に動かして積み上げを崩さない)
        const grow = isLast
          ? `<animate attributeName="y" from="${base}" to="${y.toFixed(1)}" dur="0.7s" fill="freeze"/>` +
            `<animate attributeName="height" from="0" to="${h.toFixed(1)}" dur="0.7s" fill="freeze"/>`
          : ''
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}">${grow}</rect>`
      }).join('')
      return `<g opacity="${isLast ? 1 : 0.5}">${segs}</g>`
    })
    .join('')

  const last = shown[shown.length - 1]!
  const lastX = left + (shown.length - 1) * slot + slot / 2
  const lastTop = base - (sum(last) / max) * plotH
  const marker =
    `<path d="M${(lastX - 5).toFixed(1)} ${(lastTop - 10).toFixed(1)} l5 6 l5 -6 z" fill="${C.text}">` +
    `<animate attributeName="opacity" values="0;0;1" dur="0.9s" fill="freeze"/></path>`

  const first = shown[0]!
  const axis =
    text(left, base + 18, `#${first.n}`, 12, C.dim) + text(W - 16, base + 18, `#${last.n} 最新 ${short(sum(last))}`, 12, C.text, 'text-anchor="end"')

  const heavy = heaviest
    ? text(16, 248, '一番重かったターン', 12, C.dim) +
      text(W - 16, 248, `#${heaviest.n}  ${short(sum(heaviest))}`, 13, C.yellow, 'text-anchor="end" font-weight="bold"')
    : ''

  return svg(
    H,
    title('ターンごと', `直近 ${shown.length} ターン`) +
      legend +
      grid +
      bars +
      marker +
      axis +
      `<line x1="16" y1="228" x2="${W - 16}" y2="228" stroke="${C.line}"/>` +
      heavy,
  )
}
