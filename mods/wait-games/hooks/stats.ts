// $.store に残す記録の形と合わせ方。純関数
import type { GameStats, PuzzleRecord, RecordKind } from '../types'

export const EMPTY_STATS: GameStats = { best2048: 0, wins2048: 0, winsMines: 0, fastestMines: 0 }
export const RECORD_KINDS: readonly RecordKind[] = ['fifteen', 'lights', 'sudoku4', 'sudoku9', 'memory']
export const EMPTY_RECORD: PuzzleRecord = { wins: 0, bestMoves: 0, fastest: 0 }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** store の値を確かめる。オブジェクトでなければ undefined (読めなかった扱い)。数でない項目は 0 */
export function statsFromSaved(raw: unknown): GameStats | undefined {
  if (raw === undefined) return EMPTY_STATS
  if (!isObj(raw)) return undefined
  const r = raw
  const out: GameStats = { best2048: num(r.best2048), wins2048: num(r.wins2048), winsMines: num(r.winsMines), fastestMines: num(r.fastestMines) }
  // 押して解くゲームの記録は、形の合う物だけ拾う (0.1.x の記録には欄ごと無い)
  const p = isObj(r.puzzles) ? r.puzzles : {}
  const puzzles: Partial<Record<RecordKind, PuzzleRecord>> = {}
  for (const k of RECORD_KINDS) {
    const v = p[k]
    if (isObj(v)) puzzles[k] = { wins: num(v.wins), bestMoves: num(v.bestMoves), fastest: num(v.fastest) }
  }
  return Object.keys(puzzles).length > 0 ? { ...out, puzzles } : out
}

/** 押して解くゲームを 1 回解いた */
export type PuzzleWin = { kind: RecordKind; moves: number; ms: number }

/** このセッションで増えた分。勝ちは足し算、最高点は大きい方、最速・最短は小さい方 */
export type StatsDelta = { best2048?: number; wins2048?: number; winsMines?: number; fastestMines?: number; puzzle?: PuzzleWin }

/** 0 (まだ) を除いた小さい方 */
const least = (a: number, b: number) => (a > 0 && b > 0 ? Math.min(a, b) : Math.max(a, b))

export const recordOf = (s: GameStats, k: RecordKind): PuzzleRecord => s.puzzles?.[k] ?? EMPTY_RECORD

export function addStats(s: GameStats, d: StatsDelta): GameStats {
  const out: GameStats = {
    best2048: Math.max(s.best2048, d.best2048 ?? 0),
    wins2048: s.wins2048 + (d.wins2048 ?? 0),
    winsMines: s.winsMines + (d.winsMines ?? 0),
    fastestMines: least(s.fastestMines, d.fastestMines ?? 0),
  }
  const w = d.puzzle
  if (!w) return s.puzzles ? { ...out, puzzles: s.puzzles } : out
  const r = recordOf(s, w.kind)
  return { ...out, puzzles: { ...s.puzzles, [w.kind]: { wins: r.wins + 1, bestMoves: least(r.bestMoves, w.moves), fastest: least(r.fastest, w.ms) } } }
}
