// SVG を文字列で組む関数。描画面は <img> なので動きは SMIL だけ。
// 描き直しは状態が変わる時と 1 分ごとだけなので、その間のリングの減りと秒の表示は SMIL に任せる
import type { FocusTimerMode } from '../types'
import { C, HEADER_H, W, esc, fadeIn, frame, header } from './style'

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

/** 1 分ごとに描き直すので、減っていく輪と秒のほかに動きは足さない (mod-guide 2 節) */
export const ringSvg = (v: RingView) => {
  const H = 330 + HEADER_H
  const cx = W / 2
  const cy = 178 + HEADER_H
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
    `<rect x="${cx - pillW / 2}" y="${HEADER_H + 14}" width="${pillW}" height="26" rx="13" fill="none" stroke="${accent}"/>` +
    text(cx, HEADER_H + 32, v.status, 14, accent, 'text-anchor="middle" font-weight="bold"')

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

  return frame(H, defs + header('集中タイマー', '', accent) + pill + halo + ring + clock + sub)
}

/** 今日の完了本数を丸の列で。4 個ずつ枠を増やす。本数が変わる時だけ描き直すので、塗った丸は順にふわっと出す */
export const todaySvg = (count: number) => {
  const perRow = 10
  const gap = 32
  const slots = Math.max(4, Math.ceil(count / 4) * 4)
  const rows = Math.ceil(slots / perRow)
  const top = HEADER_H + 34
  const H = top + (rows - 1) * 30 + 26
  const x0 = (W - (perRow - 1) * gap) / 2
  const dots = Array.from({ length: slots }, (_, i) => {
    const x = x0 + (i % perRow) * gap
    const y = top + Math.floor(i / perRow) * 30
    return i < count
      ? fadeIn(`<circle cx="${x}" cy="${y}" r="10" fill="url(#dot)"/>`, i * 0.06)
      : `<circle cx="${x}" cy="${y}" r="9.5" fill="none" stroke="${C.line}" stroke-width="2"/>`
  }).join('')
  const defs =
    `<defs><linearGradient id="dot" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${C.red}"/><stop offset="1" stop-color="${C.orange}"/></linearGradient></defs>`
  return frame(H, defs + header('今日の集中', `${count} 本`, count > 0 ? C.orange : C.dim) + dots)
}
