// $.store に残す記録の形と合わせ方。純関数
import type { GameStats } from '../types'

export const EMPTY_STATS: GameStats = { best2048: 0, wins2048: 0, winsMines: 0, fastestMines: 0 }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/** store の値を確かめる。オブジェクトでなければ undefined (読めなかった扱い)。数でない項目は 0 */
export function statsFromSaved(raw: unknown): GameStats | undefined {
  if (raw === undefined) return EMPTY_STATS
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  return { best2048: num(r.best2048), wins2048: num(r.wins2048), winsMines: num(r.winsMines), fastestMines: num(r.fastestMines) }
}

/** このセッションで増えた分。勝ちは足し算、最高点は大きい方、最速は小さい方 */
export type StatsDelta = { best2048?: number; wins2048?: number; winsMines?: number; fastestMines?: number }

export function addStats(s: GameStats, d: StatsDelta): GameStats {
  const fast = [s.fastestMines, d.fastestMines ?? 0].filter(v => v > 0)
  return {
    best2048: Math.max(s.best2048, d.best2048 ?? 0),
    wins2048: s.wins2048 + (d.wins2048 ?? 0),
    winsMines: s.winsMines + (d.winsMines ?? 0),
    fastestMines: fast.length > 0 ? Math.min(...fast) : 0,
  }
}
