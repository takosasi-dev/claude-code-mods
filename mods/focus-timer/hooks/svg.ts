// SVG を文字列で組む関数。描画面は <img> なので動きは SMIL だけ。
// 描き直しは状態が変わる時と 1 分ごとだけなので、その間のリングの減りと秒の表示は SMIL に任せる
import type { FocusTimerMode } from '../types'

const C = {
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  dim: '#8b949e',
  green: '#3fb950',
  red: '#f85149',
  orange: '#f78166',
}

const W = 360
const FONT = 'font-family="sans-serif"'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const svg = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" ${FONT}>` +
  `<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="12" fill="${C.face}" stroke="${C.line}"/>` +
  body +
  `</svg>`

const text = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`

/** 残りミリ秒 → 12:34 (秒は切り上げ) */
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export type Status = '待機' | '集中中' | '休憩中' | '一時停止'

export type RingView = {
  status: Status
  mode: FocusTimerMode
  leftMs: number
  totalMs: number
  /** 走っていれば SMIL で減らす */
  isRunning: boolean
}

/** 秒の表示を何秒先まで SMIL で用意するか (描き直しは 1 分ごと。遅れても止まらないよう余裕を持たせる) */
const TICK_AHEAD = 75

export const ringSvg = (v: RingView) => {
  const H = 330
  const cx = W / 2
  const cy = 178
  const r = 112
  const len = 2 * Math.PI * r
  const isBreak = v.mode === 'break'
  const stroke = isBreak ? C.green : 'url(#heat)'
  const accent = isBreak ? C.green : v.status === '待機' ? C.dim : C.orange
  const left = Math.max(0, Math.min(v.leftMs, v.totalMs))
  const from = len * (1 - left / Math.max(1, v.totalMs))

  const defs =
    `<defs><linearGradient id="heat" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${C.red}"/><stop offset="1" stop-color="${C.orange}"/></linearGradient></defs>`

  // 状態の札
  const pillW = v.status.length * 15 + 28
  const pill =
    `<rect x="${cx - pillW / 2}" y="16" width="${pillW}" height="26" rx="13" fill="none" stroke="${accent}"/>` +
    text(cx, 34, v.status, 14, accent, 'text-anchor="middle" font-weight="bold"')

  // 走っている間は外側の輪がゆっくり呼吸する
  const halo = v.isRunning
    ? `<circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="none" stroke="${isBreak ? C.green : C.orange}" stroke-width="2" opacity="0.2">` +
      `<animate attributeName="opacity" values="0.08;0.4;0.08" dur="${isBreak ? 6 : 4}s" repeatCount="indefinite"/></circle>`
    : ''

  // 残りのリング。上から時計回りに、残りの分だけ塗る。減りは dur = 残り時間の SMIL
  const ring =
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.line}" stroke-width="16"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="16" ` +
    `stroke-dasharray="${len.toFixed(2)}" stroke-dashoffset="${from.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"` +
    `${v.isRunning ? '' : ` opacity="${v.status === '待機' ? 0.35 : 0.55}"`}>` +
    (v.isRunning
      ? `<animate attributeName="stroke-dashoffset" from="${from.toFixed(2)}" to="${len.toFixed(2)}" dur="${(left / 1000).toFixed(3)}s" fill="freeze"/>`
      : '') +
    `</circle>`

  // 中央の時刻。走っている間は 1 秒ごとの <text> を <set> で順に見せる
  const clockAttrs = `text-anchor="middle" font-weight="bold"`
  let clock: string
  if (v.isRunning && left > 0) {
    const first = Math.ceil(left / 1000)
    const frac = left - (first - 1) * 1000 // 最初の表示が切り替わるまで (1〜1000ms)
    const parts: string[] = []
    const steps = Math.min(first, TICK_AHEAD)
    for (let k = 0; k <= steps; k++) {
      const begin = k === 0 ? 0 : Math.round(frac + (k - 1) * 1000)
      const isLast = k === steps
      const set = isLast
        ? `<set attributeName="visibility" to="visible" begin="${begin}ms" fill="freeze"/>`
        : `<set attributeName="visibility" to="visible" begin="${begin}ms" dur="${Math.round(k === 0 ? frac : 1000)}ms"/>`
      parts.push(
        `<text x="${cx}" y="${cy + 18}" font-size="56" fill="${C.text}" ${clockAttrs} visibility="hidden">${mmss((first - k) * 1000)}${set}</text>`,
      )
    }
    clock = parts.join('')
  } else {
    clock = text(cx, cy + 18, mmss(left), 56, v.status === '待機' ? C.dim : C.text, clockAttrs)
  }

  const sub = text(cx, cy + 50, `${isBreak ? '休憩' : '集中'} ${Math.round(v.totalMs / 60_000)} 分`, 14, C.dim, 'text-anchor="middle"')

  return svg(H, defs + pill + halo + ring + clock + sub)
}

/** 今日の完了本数を丸の列で。4 個ずつ枠を増やす */
export const todaySvg = (count: number) => {
  const perRow = 10
  const slots = Math.max(4, Math.ceil(count / 4) * 4)
  const rows = Math.ceil(slots / perRow)
  const H = 62 + rows * 30
  const dots = Array.from({ length: slots }, (_, i) => {
    const x = 34 + (i % perRow) * 32
    const y = 66 + Math.floor(i / perRow) * 30
    return i < count
      ? `<circle cx="${x}" cy="${y}" r="10" fill="url(#dot)"/>`
      : `<circle cx="${x}" cy="${y}" r="9.5" fill="none" stroke="${C.line}" stroke-width="2"/>`
  }).join('')
  const defs =
    `<defs><linearGradient id="dot" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${C.red}"/><stop offset="1" stop-color="${C.orange}"/></linearGradient></defs>`
  return svg(
    H,
    defs +
      text(16, 30, '今日の集中', 14, C.text, 'font-weight="bold"') +
      text(W - 16, 30, `${count} 本`, 14, count > 0 ? C.orange : C.dim, 'text-anchor="end" font-weight="bold"') +
      dots,
  )
}
