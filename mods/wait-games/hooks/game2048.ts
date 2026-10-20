// 2048 の規則。どれも純関数 (乱数は引数で受け取る)
import type { Dir, Game2048, Slide } from '../types'

export const SIZE = 4
export const GOAL = 2048

/** 1 列を先頭の側へ詰める。from/to は列の中の位置。1 手で同じタイルは 1 回しか合わさらない */
export function slideLine(line: readonly number[]) {
  const out: number[] = []
  const moves: { from: number; to: number }[] = []
  const merged: number[] = []
  let score = 0
  let canMerge = false
  line.forEach((v, from) => {
    if (v === 0) return
    const last = out.length - 1
    if (canMerge && out[last] === v) {
      out[last] = v * 2
      score += v * 2
      merged.push(last)
      moves.push({ from, to: last })
      canMerge = false
    } else {
      out.push(v)
      moves.push({ from, to: out.length - 1 })
      canMerge = true
    }
  })
  while (out.length < line.length) out.push(0)
  return { line: out, score, moves, merged }
}

/** 向きごとの列 (盤の位置を、詰める側から並べた物) */
export function linesOf(dir: Dir): number[][] {
  const lines: number[][] = []
  for (let k = 0; k < SIZE; k++) {
    const idx = Array.from({ length: SIZE }, (_, j) => (dir === 'left' || dir === 'right' ? k * SIZE + j : j * SIZE + k))
    lines.push(dir === 'right' || dir === 'down' ? idx.reverse() : idx)
  }
  return lines
}

/** 1 手動かす。盤が変わらなければ moved は false (その時は新しいタイルを出さない) */
export function move(board: readonly number[], dir: Dir) {
  const next = [...board]
  const slides: Slide[] = []
  const merged: number[] = []
  let score = 0
  for (const idx of linesOf(dir)) {
    const r = slideLine(idx.map(i => board[i] ?? 0))
    r.line.forEach((v, j) => (next[idx[j]!] = v))
    for (const m of r.moves) slides.push({ from: idx[m.from]!, to: idx[m.to]!, value: board[idx[m.from]!] ?? 0 })
    for (const j of r.merged) merged.push(idx[j]!)
    score += r.score
  }
  const moved = next.some((v, i) => v !== board[i])
  return { board: next, score, moved, slides, merged }
}

/** 空きマスに 1 枚出す。r1 で場所、r2 で値 (9 割 2、1 割 4)。空きが無ければ -1 */
export function spawn(board: readonly number[], r1: number, r2: number) {
  const empty = board.flatMap((v, i) => (v === 0 ? [i] : []))
  if (empty.length === 0) return { board: [...board], at: -1 }
  const at = empty[Math.min(empty.length - 1, Math.floor(r1 * empty.length))]!
  const next = [...board]
  next[at] = r2 < 0.9 ? 2 : 4
  return { board: next, at }
}

/** まだ動かせるか (空きがある、または縦か横に同じ数が並ぶ) */
export function canMove(board: readonly number[]) {
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = board[i]
    if (v === 0) return true
    if (i % SIZE < SIZE - 1 && board[i + 1] === v) return true
    if (i < SIZE * (SIZE - 1) && board[i + SIZE] === v) return true
  }
  return false
}

/** 新しいゲーム: 空の盤に 2 枚 */
export function newGame(rand: () => number): Game2048 {
  const a = spawn(Array(SIZE * SIZE).fill(0), rand(), rand())
  const b = spawn(a.board, rand(), rand())
  return { board: b.board, score: 0, moves: 0, hasWon: false, isOver: false, slides: [], merged: [], spawned: [a.at, b.at] }
}

/**
 * 1 手進める。動かなければ同じ物を返す。isNewWin はこの手で初めて 2048 ができた時だけ true
 */
export function play(g: Game2048, dir: Dir, rand: () => number): { game: Game2048; isNewWin: boolean } {
  if (g.isOver) return { game: g, isNewWin: false }
  const m = move(g.board, dir)
  if (!m.moved) return { game: g, isNewWin: false }
  const s = spawn(m.board, rand(), rand())
  const isNewWin = !g.hasWon && s.board.some(v => v >= GOAL)
  return {
    game: {
      board: s.board,
      score: g.score + m.score,
      moves: g.moves + 1,
      hasWon: g.hasWon || isNewWin,
      isOver: !canMove(s.board),
      slides: m.slides,
      merged: m.merged,
      spawned: s.at < 0 ? [] : [s.at],
    },
    isNewWin,
  }
}
