// ライツアウト (5×5) の規則。どれも純関数 (乱数と時刻は引数で受け取る)
import type { Lights } from '../types'
import { neighbors } from './fifteen'

export const SIDE = 5
export const CELLS = SIDE * SIDE

/** i を押す: i と上下左右が切り替わる */
export function press(on: readonly boolean[], i: number): boolean[] {
  const out = [...on]
  for (const j of [i, ...neighbors(i, SIDE)]) out[j] = !out[j]
  return out
}

const bits = (rows: string[]) => rows.join('').split('').map(c => c === '1')
/**
 * 押しても何も変わらない押し方 (5×5 には 2 つある)。
 * 消灯から押して作れる盤は、どちらとも重なりが偶数になる (解けるのはその盤だけ)
 */
export const QUIET = [bits(['01110', '10101', '11011', '10101', '01110']), bits(['10101', '10101', '00000', '10101', '10101'])]

export const isSolvable = (on: readonly boolean[]) => QUIET.every(q => q.filter((v, i) => v && on[i]).length % 2 === 0)

export const isDark = (on: readonly boolean[]) => on.every(v => !v)

/** 新しい盤。全部消えた所から、半分くらいのマスを押して作る (だから必ず解ける) */
export function newLights(rand: () => number): Lights {
  let on: boolean[] = Array(CELLS).fill(false)
  for (let i = 0; i < CELLS; i++) if (rand() < 0.5) on = press(on, i)
  if (isDark(on)) on = press(on, 12)
  return { on, moves: 0, startedAt: 0, endedAt: 0, status: 'play' }
}

/** i を押す。消し終わった盤・範囲の外は変えない */
export function applyLights(g: Lights, i: number, now: number): Lights {
  if (g.status === 'won' || i < 0 || i >= CELLS) return g
  const on = press(g.on, i)
  const next = { ...g, on, moves: g.moves + 1, startedAt: g.startedAt || now }
  return isDark(on) ? { ...next, status: 'won', endedAt: now } : next
}

/** マスの字。text は terminal 用 (半角)、wide は vscode 用 */
export const look = (g: Lights, i: number) => (g.on[i] ? { text: '#', wide: '■', isOn: true } : { text: '.', wide: '・', isOn: false })

/** 点いている数 */
export const litCount = (g: Lights) => g.on.filter(Boolean).length
