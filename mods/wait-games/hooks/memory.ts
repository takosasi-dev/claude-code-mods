// 神経衰弱 (4×4、8 組) の規則。どれも純関数 (乱数と時刻は引数で受け取る)
import type { Memory } from '../types'
import { shuffle } from './fifteen'

export const CELLS = 16
/** 絵柄は色の名前 1 字 (漢字なので terminal では 2 桁) */
export const FACES = ['赤', '青', '緑', '黄', '紫', '橙', '白', '黒'] as const

export function newMemory(rand: () => number): Memory {
  const cards = shuffle(
    Array.from({ length: CELLS }, (_, i) => i % FACES.length),
    rand,
  )
  return { cards, done: Array(CELLS).fill(false), up: [], moves: 0, startedAt: 0, endedAt: 0, status: 'play' }
}

/**
 * i をめくる。そろった札・表の札・終わった盤は変えない。
 * 2 枚目で同じ絵柄ならそろう。違えば 2 枚とも表のまま残し、次に押した時に伏せる
 */
export function applyMemory(g: Memory, i: number, now: number): Memory {
  if (g.status === 'won' || i < 0 || i >= CELLS || g.done[i]) return g
  const base = g.up.length === 2 ? [] : g.up
  if (base.includes(i)) return g
  const up = [...base, i]
  const startedAt = g.startedAt || now
  if (up.length < 2) return { ...g, up, startedAt }
  const [a, b] = up as [number, number]
  const moves = g.moves + 1
  if (g.cards[a] !== g.cards[b]) return { ...g, up, moves, startedAt }
  const done = g.done.map((d, k) => d || k === a || k === b)
  const next = { ...g, up: [], done, moves, startedAt }
  return done.every(Boolean) ? { ...next, status: 'won', endedAt: now } : next
}

/** 札の字。伏せた札は terminal で「##」(漢字と同じ 2 桁)、vscode で「■」 */
export function look(g: Memory, i: number) {
  const isUp = g.up.includes(i)
  const isShown = isUp || (g.done[i] ?? false)
  const face = FACES[g.cards[i] ?? 0] ?? '?'
  return {
    text: isShown ? face : '##',
    wide: isShown ? face : '■',
    isDone: g.done[i] ?? false,
    /** 表にしている (そろっていない) */
    isUp,
    /** 違う 2 枚を見せている */
    isMiss: isUp && g.up.length === 2,
  }
}

/** そろった組の数 */
export const pairCount = (g: Memory) => g.done.filter(Boolean).length / 2
