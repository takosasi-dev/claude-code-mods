// マインスイーパーの規則。どれも純関数 (乱数と時刻は引数で受け取る)
import type { Mines } from '../types'

export const ROWS = 8
export const COLS = 8
export const CELLS = ROWS * COLS
export const MINE_COUNT = 10

/** まわり 8 マスの位置 */
export function around(i: number): number[] {
  const r = Math.floor(i / COLS)
  const c = i % COLS
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr
      const cc = c + dc
      if ((dr !== 0 || dc !== 0) && rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) out.push(rr * COLS + cc)
    }
  return out
}

export const newMines = (): Mines => ({
  mines: null,
  open: Array(CELLS).fill(false),
  flag: Array(CELLS).fill(false),
  status: 'ready',
  boom: -1,
  startedAt: 0,
  endedAt: 0,
})

/** 地雷を置く。初手のマスとそのまわりには置かない (初手で必ず広く開く) */
export function place(first: number, rand: () => number, count = MINE_COUNT): boolean[] {
  const safe = new Set([first, ...around(first)])
  const pool = Array.from({ length: CELLS }, (_, i) => i).filter(i => !safe.has(i))
  const mines = Array(CELLS).fill(false)
  // 先頭から count 個だけ混ぜる (Fisher-Yates の途中まで)
  for (let k = 0; k < Math.min(count, pool.length); k++) {
    const j = k + Math.min(pool.length - k - 1, Math.floor(rand() * (pool.length - k)))
    ;[pool[k], pool[j]] = [pool[j]!, pool[k]!]
    mines[pool[k]!] = true
  }
  return mines
}

/** まわりの地雷の数 */
export const countAt = (mines: readonly boolean[], i: number) => around(i).filter(j => mines[j]).length

const isEnded = (s: Mines) => s.status === 'won' || s.status === 'lost'

/** 地雷以外が全部開いたか */
export const isCleared = (mines: readonly boolean[], open: readonly boolean[]) => mines.every((m, i) => m || open[i])

/**
 * マスを開ける。旗のマス・開いたマス・終わった盤は変えない。
 * 0 のマスはまわりを連鎖して開ける。初手の前なら先に地雷を置く
 */
export function reveal(s: Mines, i: number, now: number, rand: () => number): Mines {
  if (i < 0 || i >= CELLS || isEnded(s) || s.open[i] || s.flag[i]) return s
  const mines = s.mines ?? place(i, rand)
  const startedAt = s.mines ? s.startedAt : now
  const open = [...s.open]
  if (mines[i]) {
    // 負け: 地雷を全部見せる
    mines.forEach((m, j) => m && (open[j] = true))
    return { ...s, mines, open, status: 'lost', boom: i, startedAt, endedAt: now }
  }
  const queue = [i]
  open[i] = true
  while (queue.length > 0) {
    const j = queue.pop()!
    if (countAt(mines, j) !== 0) continue
    for (const k of around(j)) {
      if (open[k] || s.flag[k] || mines[k]) continue
      open[k] = true
      queue.push(k)
    }
  }
  if (isCleared(mines, open)) {
    // 勝ち: 残りの地雷に旗を立てる
    return { ...s, mines, open, flag: mines.map((m, j) => m || (s.flag[j] ?? false)), status: 'won', startedAt, endedAt: now }
  }
  return { ...s, mines, open, status: 'play', startedAt }
}

/** 旗を立てる・外す。開いたマスと終わった盤は変えない */
export function toggleFlag(s: Mines, i: number): Mines {
  if (i < 0 || i >= CELLS || isEnded(s) || s.open[i]) return s
  const flag = [...s.flag]
  flag[i] = !flag[i]
  return { ...s, flag }
}

/** 残りの地雷の数 (地雷の数 − 旗の数)。旗が多ければ負になる */
export const minesLeft = (s: Mines) => MINE_COUNT - s.flag.filter(Boolean).length

/** マスに出す 1 文字。text は terminal 用 (幅をそろえるため半角だけ)、wide は vscode 用 */
export type CellLook = { text: string; wide: string; isOpen: boolean; isBoom: boolean }

export function look(s: Mines, i: number): CellLook {
  const isBoom = s.boom === i
  if (s.open[i] && s.mines?.[i]) return { text: '*', wide: '●', isOpen: true, isBoom }
  if (s.open[i]) {
    const n = countAt(s.mines ?? [], i)
    return n === 0 ? { text: '.', wide: '・', isOpen: true, isBoom } : { text: String(n), wide: String.fromCharCode(0xff10 + n), isOpen: true, isBoom }
  }
  // 負けた後、地雷でないのに立てた旗
  if (s.flag[i] && s.status === 'lost' && !s.mines?.[i]) return { text: 'x', wide: 'Ｘ', isOpen: false, isBoom }
  if (s.flag[i]) return { text: 'F', wide: '▶', isOpen: false, isBoom }
  return { text: '#', wide: '■', isOpen: false, isBoom }
}
