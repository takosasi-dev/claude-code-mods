// 数独 (4×4・9×9) の規則。どれも純関数 (乱数と時刻は引数で受け取る)
import type { Sudoku, SudokuSize } from '../types'
import { shuffle } from './fifteen'

/** 箱の一辺 (4 なら 2、9 なら 3) */
export const boxOf = (n: SudokuSize) => (n === 4 ? 2 : 3)
/** 残す数字の目安。これより少なくすると答えが 1 つに決まらないことが多い */
const GIVENS: Record<SudokuSize, number> = { 4: 6, 9: 30 }

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** i と同じ行・列・箱のマス (i 自身は除く) */
export function peers(n: SudokuSize, i: number): number[] {
  const b = boxOf(n)
  const r = Math.floor(i / n)
  const c = i % n
  const br = r - (r % b)
  const bc = c - (c % b)
  const out = new Set<number>()
  for (let k = 0; k < n; k++) {
    out.add(r * n + k)
    out.add(k * n + c)
    out.add((br + Math.floor(k / b)) * n + bc + (k % b))
  }
  out.delete(i)
  return [...out]
}

/** 完成した盤。決まった形から、数字・帯の中の行・帯・束の中の列・束を混ぜる */
export function solutionFor(n: SudokuSize, rand: () => number): number[] {
  const b = boxOf(n)
  const digits = shuffle(range(n).map(d => d + 1), rand)
  const lines = () => shuffle(range(b), rand).flatMap(band => shuffle(range(b), rand).map(k => band * b + k))
  const rows = lines()
  const cols = lines()
  return range(n * n).map(i => {
    const r = rows[Math.floor(i / n)]!
    const c = cols[i % n]!
    return digits[(b * (r % b) + Math.floor(r / b) + c) % n]!
  })
}

/** 答えの数 (limit で打ち切る)。0 は空き。候補の一番少ないマスから埋める */
export function countSolutions(n: SudokuSize, cells: readonly number[], limit = 2): number {
  const grid = [...cells]
  const peerOf = range(n * n).map(i => peers(n, i))
  let found = 0
  const walk = (): void => {
    let best = -1
    let bestCands: number[] = []
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== 0) continue
      const used = new Set(peerOf[i]!.map(j => grid[j]))
      const cands = range(n).map(d => d + 1).filter(d => !used.has(d))
      if (cands.length === 0) return
      if (best < 0 || cands.length < bestCands.length) {
        best = i
        bestCands = cands
      }
    }
    if (best < 0) {
      found++
      return
    }
    for (const d of bestCands) {
      grid[best] = d
      walk()
      if (found >= limit) break
    }
    grid[best] = 0
  }
  walk()
  return found
}

/** 新しい盤。完成した盤から、答えが 1 つのままのマスだけを消していく */
export function newSudoku(n: SudokuSize, rand: () => number): Sudoku {
  const solution = solutionFor(n, rand)
  const cells = [...solution]
  let left = n * n
  for (const i of shuffle(range(n * n), rand)) {
    if (left <= GIVENS[n]) break
    cells[i] = 0
    if (countSolutions(n, cells) === 1) left--
    else cells[i] = solution[i]!
  }
  return { size: n, givens: cells.map(v => v !== 0), cells, solution, selected: -1, moves: 0, startedAt: 0, endedAt: 0, status: 'play' }
}

/** 同じ行・列・箱に同じ数字がある */
export const clashes = (g: Sudoku, i: number) => (g.cells[i] ?? 0) !== 0 && peers(g.size, i).some(j => g.cells[j] === g.cells[i])

/** 全部埋まっていて、どの行・列・箱にも重なりが無い */
export const isComplete = (g: Pick<Sudoku, 'size' | 'cells'>) => g.cells.every((v, i) => v !== 0 && !peers(g.size, i).some(j => g.cells[j] === v))

/** マスを選ぶ。もう一度押すと外す。初めからある数字と、解き終わった盤は選べない */
export function selectCell(g: Sudoku, i: number): Sudoku {
  if (g.status === 'won' || i < 0 || i >= g.cells.length || g.givens[i]) return g
  return { ...g, selected: g.selected === i ? -1 : i }
}

/** 選んだマスに数字を入れる (0 で消す)。選んでいない・同じ数字・解き終わった盤は変えない */
export function applySudoku(g: Sudoku, digit: number, now: number): Sudoku {
  const i = g.selected
  if (g.status === 'won' || i < 0 || g.givens[i] || digit < 0 || digit > g.size || g.cells[i] === digit) return g
  const cells = [...g.cells]
  cells[i] = digit
  const next = { ...g, cells, moves: g.moves + 1, startedAt: g.startedAt || now }
  return isComplete(next) ? { ...next, status: 'won', selected: -1, endedAt: now } : next
}

/** マスの字。text は terminal 用 (半角)、wide は vscode 用 (全角) */
export function look(g: Sudoku, i: number) {
  const v = g.cells[i] ?? 0
  return {
    text: v === 0 ? '.' : String(v),
    wide: v === 0 ? '・' : String.fromCharCode(0xff10 + v),
    isGiven: g.givens[i] ?? false,
    isSelected: g.selected === i,
    isClash: clashes(g, i),
  }
}

/** 空いているマスの数 */
export const emptyCount = (g: Sudoku) => g.cells.filter(v => v === 0).length
