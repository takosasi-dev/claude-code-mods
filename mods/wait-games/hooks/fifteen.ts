// 15 パズルの規則。どれも純関数 (乱数と時刻は引数で受け取る)
import type { Fifteen } from '../types'

export const SIDE = 4
export const CELLS = SIDE * SIDE
/** そろった形。0 は空き */
export const SOLVED: readonly number[] = [...Array.from({ length: CELLS - 1 }, (_, i) => i + 1), 0]

/** 混ぜる (Fisher-Yates)。ほかのゲームも使う */
export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** 上下左右のマス */
export function neighbors(i: number, side = SIDE): number[] {
  const r = Math.floor(i / side)
  const c = i % side
  return [r > 0 ? i - side : -1, r < side - 1 ? i + side : -1, c > 0 ? i - 1 : -1, c < side - 1 ? i + 1 : -1].filter(j => j >= 0)
}

export const isSolved = (tiles: readonly number[]) => tiles.every((v, i) => v === SOLVED[i])

/**
 * 解けるか。4 列の盤では「転倒数 + 空きの行 (下から 1, 2, ...)」が奇数なら解ける
 * (そろった形は 0 + 1 で奇数。1 手動かしても偶奇は変わらない)
 */
export function isSolvable(tiles: readonly number[]): boolean {
  const xs = tiles.filter(v => v !== 0)
  let inv = 0
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[i]! > xs[j]!) inv++
  return (inv + SIDE - Math.floor(tiles.indexOf(0) / SIDE)) % 2 === 1
}

/** 新しい盤。並べ替えて、解けない並びなら空きでない 2 枚を入れ替える (偶奇が変わって解ける) */
export function newFifteen(rand: () => number): Fifteen {
  const tiles = shuffle(SOLVED, rand)
  const swap = (a: number, b: number) => ([tiles[a], tiles[b]] = [tiles[b]!, tiles[a]!])
  const nums = tiles.flatMap((v, i) => (v === 0 ? [] : [i]))
  if (!isSolvable(tiles)) swap(nums[0]!, nums[1]!)
  // 偶然そろっていたら 1 手ずらす (合法な手なので解けるまま)
  if (isSolved(tiles)) swap(CELLS - 1, CELLS - 2)
  return { tiles, moves: 0, startedAt: 0, endedAt: 0, status: 'play' }
}

/** i のタイルを押す。空きの隣なら空きへ滑らせる。それ以外・そろった後は変えない */
export function applyFifteen(g: Fifteen, i: number, now: number): Fifteen {
  if (g.status === 'won' || i < 0 || i >= CELLS) return g
  const blank = g.tiles.indexOf(0)
  if (!neighbors(blank).includes(i)) return g
  const tiles = [...g.tiles]
  ;[tiles[blank], tiles[i]] = [tiles[i]!, 0]
  const next = { ...g, tiles, moves: g.moves + 1, startedAt: g.startedAt || now }
  return isSolved(tiles) ? { ...next, status: 'won', endedAt: now } : next
}

/** マスの字。どちらの画面も 2 桁にそろえる (空きは「 .」) */
export const look = (g: Fifteen, i: number) => {
  const v = g.tiles[i] ?? 0
  return { text: v === 0 ? ' .' : String(v).padStart(2, ' '), isBlank: v === 0, isHome: v !== 0 && v === SOLVED[i] }
}
