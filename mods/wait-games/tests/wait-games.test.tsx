import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { canMove, linesOf, move, newGame, play, slideLine, spawn } from '../hooks/game2048'
import { around, CELLS, countAt, isCleared, look, MINE_COUNT, minesLeft, newMines, place, reveal, toggleFlag } from '../hooks/mines'
import { addStats, EMPTY_STATS, keepUnknown, statsFromSaved } from '../hooks/stats'
import { board2048Svg, clean, esc, fifteenSvg, lightsSvg, memorySvg, minesSvg, sudokuSvg } from '../hooks/svg'
import type { Fifteen, Game2048, GameStats, Lights, Memory, Mines, Sudoku } from '../types'
import { applyFifteen, isSolvable as solvable15, isSolved, look as look15, newFifteen, neighbors, SOLVED } from '../hooks/fifteen'
import { applyLights, isDark, isSolvable as solvableLights, look as lookLights, newLights, press, QUIET } from '../hooks/lights'
import { applySudoku, clashes, countSolutions, isComplete, look as lookSudoku, newSudoku, peers, selectCell, solutionFor } from '../hooks/sudoku'
import { applyMemory, FACES, look as lookMemory, newMemory } from '../hooks/memory'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'wait-games',
  component: 'Pane',
  requestId: 'wait-games',
  props: {
    title: 'ミニゲーム',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** 決まった並びの乱数 (線形合同法) */
const seeded = (seed: number) => {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

/** 決まった値を順に返す */
const seq = (...xs: number[]) => {
  let k = 0
  return () => xs[k++ % xs.length]!
}

const game = (board: number[], extra: Partial<Game2048> = {}): Game2048 => ({
  board,
  score: 0,
  moves: 0,
  hasWon: false,
  isOver: false,
  slides: [],
  merged: [],
  spawned: [],
  ...extra,
})

/** 地雷の位置を決めた盤 (初手の後の形) */
const minesAt = (at: number[], extra: Partial<Mines> = {}): Mines => ({
  ...newMines(),
  mines: Array.from({ length: CELLS }, (_, i) => at.includes(i)),
  status: 'play',
  startedAt: NOW,
  ...extra,
})
const opened = (s: Mines) => s.open.flatMap((o, i) => (o ? [i] : []))

// ---------------- 2048 の規則 ----------------

test('2048: 1 列の詰め方と合わせ方 (1 手で同じタイルは 1 回だけ)', () => {
  const at = (line: number[]) => {
    const r = slideLine(line)
    return [r.line, r.score]
  }
  expect(at([2, 2, 2, 2])).toEqual([[4, 4, 0, 0], 8])
  expect(at([2, 2, 4, 0])).toEqual([[4, 4, 0, 0], 4])
  expect(at([4, 4, 8, 8])).toEqual([[8, 16, 0, 0], 24])
  expect(at([2, 2, 2, 0])).toEqual([[4, 2, 0, 0], 4])
  expect(at([2, 0, 0, 2])).toEqual([[4, 0, 0, 0], 4])
  expect(at([4, 0, 4, 8])).toEqual([[8, 8, 0, 0], 8])
  expect(at([0, 0, 0, 2])).toEqual([[2, 0, 0, 0], 0])
  expect(at([2, 4, 8, 16])).toEqual([[2, 4, 8, 16], 0])
  expect(at([0, 0, 0, 0])).toEqual([[0, 0, 0, 0], 0])
  expect(at([8, 4, 4, 0])).toEqual([[8, 8, 0, 0], 8])
  // 動き: どこからどこへ・どこで合わさったか
  const r = slideLine([2, 0, 2, 4])
  expect(r.moves).toEqual([
    { from: 0, to: 0 },
    { from: 2, to: 0 },
    { from: 3, to: 1 },
  ])
  expect(r.merged).toEqual([0])
})

test('2048: 4 つの向きの動きとスコア', () => {
  // prettier-ignore
  const b = [
    2, 0, 0, 2,
    0, 4, 0, 4,
    8, 0, 8, 0,
    0, 0, 0, 16,
  ]
  // prettier-ignore
  expect(move(b, 'left')).toMatchObject({ moved: true, score: 28, board: [
    4, 0, 0, 0,
    8, 0, 0, 0,
    16, 0, 0, 0,
    16, 0, 0, 0,
  ] })
  // prettier-ignore
  expect(move(b, 'right').board).toEqual([
    0, 0, 0, 4,
    0, 0, 0, 8,
    0, 0, 0, 16,
    0, 0, 0, 16,
  ])
  // prettier-ignore
  expect(move(b, 'up')).toMatchObject({ score: 0, board: [
    2, 4, 8, 2,
    8, 0, 0, 4,
    0, 0, 0, 16,
    0, 0, 0, 0,
  ] })
  // prettier-ignore
  expect(move(b, 'down').board).toEqual([
    0, 0, 0, 0,
    0, 0, 0, 2,
    2, 0, 0, 4,
    8, 4, 8, 16,
  ])
  // 列の並び: 詰める側から
  expect(linesOf('left')[1]).toEqual([4, 5, 6, 7])
  expect(linesOf('right')[1]).toEqual([7, 6, 5, 4])
  expect(linesOf('up')[2]).toEqual([2, 6, 10, 14])
  expect(linesOf('down')[2]).toEqual([14, 10, 6, 2])
  // アニメ用: 右上の 2 が左上へ滑って合わさる
  const m = move(b, 'left')
  expect(m.slides).toContainEqual({ from: 3, to: 0, value: 2 })
  expect(m.merged).toEqual([0, 4, 8])
  // 動かない向き
  // prettier-ignore
  const still = [
    2, 4, 0, 0,
    4, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]
  expect(move(still, 'left').moved).toBe(false)
  expect(move(still, 'up').moved).toBe(false)
  expect(move(still, 'right').moved).toBe(true)
})

test('2048: 新しいタイル (場所・2 か 4)・終わりの判定', () => {
  const b = [2, 0, 4, 0, ...Array(12).fill(8)]
  expect(spawn(b, 0, 0)).toEqual({ board: [2, 2, 4, 0, ...Array(12).fill(8)], at: 1 })
  expect(spawn(b, 0.99, 0.89).at).toBe(3)
  expect(spawn(b, 0.99, 0.89).board[3]).toBe(2)
  expect(spawn(b, 0.5, 0.9).board[3]).toBe(4)
  const full = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]
  expect(spawn(full, 0.5, 0.5).at).toBe(-1)
  expect(canMove(full)).toBe(false)
  // 縦に同じ数、横に同じ数、空きがある
  expect(canMove([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 4])).toBe(true)
  const distinct = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2, 4, 8, 16, 32, 64]
  expect(canMove(distinct)).toBe(false)
  expect(canMove(distinct.map((v, i) => (i === 12 ? 512 : v)))).toBe(true)
  expect(canMove([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 0])).toBe(true)
  // 新しいゲームは 2 枚
  for (let k = 0; k < 20; k++) {
    const g = newGame(seeded(k))
    expect(g.board.filter(v => v !== 0)).toHaveLength(2)
    expect(g.board.every(v => [0, 2, 4].includes(v))).toBe(true)
    expect(g.spawned).toHaveLength(2)
  }
})

test('2048: 1 手の流れ (動かない手は数えない・2048 の勝ちは 1 回・詰み)', () => {
  // 動かない手は同じ物を返し、タイルも出さない
  const g0 = game([2, 4, ...Array(14).fill(0)])
  expect(play(g0, 'left', seq(0, 0)).game).toBe(g0)
  // 動けばスコアを足し、1 枚出す
  const r1 = play(game([2, 2, ...Array(14).fill(0)], { score: 10 }), 'left', seq(0, 0))
  expect(r1.game).toMatchObject({ score: 14, moves: 1, isOver: false, merged: [0], spawned: [1] })
  expect(r1.game.board.slice(0, 2)).toEqual([4, 2])
  // 1024 + 1024 で初めて 2048
  const r2 = play(game([1024, 1024, ...Array(14).fill(0)]), 'left', seq(0, 0))
  expect(r2.isNewWin).toBe(true)
  expect(r2.game.hasWon).toBe(true)
  const r3 = play(game([1024, 1024, 0, 2048, ...Array(12).fill(0)], { hasWon: true }), 'left', seq(0, 0))
  expect(r3.isNewWin).toBe(false)
  // 最後の 1 マスが埋まって詰む
  // prettier-ignore
  const near = [
    0, 2, 4, 2,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2,
  ]
  // 右へは動けない。左へ詰めると右端が空いて 4 が出る → 詰み
  const r4 = play(game(near), 'left', seq(0, 0.95))
  expect(r4.game.board).toEqual([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])
  expect(r4.game.isOver).toBe(true)
  // 詰んだ盤は動かない
  expect(play(r4.game, 'down', seq(0)).game).toBe(r4.game)
})

// ---------------- マインスイーパーの規則 ----------------

test('マインスイーパー: まわりのマスと数字', () => {
  expect(around(0).sort((a, b) => a - b)).toEqual([1, 8, 9])
  expect(around(7)).toHaveLength(3)
  expect(around(63)).toHaveLength(3)
  expect(around(3)).toHaveLength(5)
  expect(around(24)).toHaveLength(5)
  expect(around(27).sort((a, b) => a - b)).toEqual([18, 19, 20, 26, 28, 34, 35, 36])
  // 左端と右端はつながらない
  expect(around(8)).not.toContain(7)
  expect(around(15)).not.toContain(16)
  const s = minesAt([0, 1, 9, 63])
  expect(countAt(s.mines!, 8)).toBe(3)
  expect(countAt(s.mines!, 10)).toBe(2)
  expect(countAt(s.mines!, 62)).toBe(1)
  expect(countAt(s.mines!, 30)).toBe(0)
})

test('マインスイーパー: 初手のマスとまわりには地雷を置かない (いつも 10 個)', () => {
  for (let k = 0; k < 200; k++) {
    const first = k % CELLS
    const m = place(first, seeded(k))
    expect(m.filter(Boolean)).toHaveLength(MINE_COUNT)
    expect(m[first]).toBe(false)
    for (const j of around(first)) expect(m[j]).toBe(false)
  }
  // 乱数が 1 に近くても範囲の外を選ばない
  expect(place(0, () => 0.9999999).filter(Boolean)).toHaveLength(MINE_COUNT)
  // 初手から開けると、地雷を置いて広く開く
  for (let k = 0; k < 50; k++) {
    const s = reveal(newMines(), 27, NOW, seeded(k))
    expect(s.status).not.toBe('lost')
    expect(s.startedAt).toBe(NOW)
    expect(s.mines!.filter(Boolean)).toHaveLength(MINE_COUNT)
    expect(countAt(s.mines!, 27)).toBe(0)
    expect(opened(s).length).toBeGreaterThan(8)
  }
})

test('マインスイーパー: 0 のマスは連鎖して開き、数字のマスで止まる', () => {
  // 7 列目 (c=6) が全部地雷。c=0〜5 が開き、c=7 は閉じたまま
  const col6 = Array.from({ length: 8 }, (_, r) => r * 8 + 6)
  const s = reveal(minesAt(col6), 0, NOW + 1000, seq(0))
  const want = Array.from({ length: CELLS }, (_, i) => i).filter(i => i % 8 <= 5)
  expect(opened(s)).toEqual(want)
  expect(s.status).toBe('play')
  // c=5 の数字: 角は 2、間は 3
  expect(look(s, 5).text).toBe('2')
  expect(look(s, 13).text).toBe('3')
  expect(look(s, 0).text).toBe('.')
  expect(look(s, 7).text).toBe('#')
  // 数字のマスを開けても広がらない
  const one = reveal(minesAt(col6), 7, NOW, seq(0))
  expect(opened(one)).toEqual([7])
  expect(look(one, 7).text).toBe('2')
  expect(look(one, 7).wide).toBe('２')
  // 旗のマスは連鎖でも開かない
  const flagged = toggleFlag(minesAt(col6), 18)
  const s2 = reveal(flagged, 0, NOW, seq(0))
  expect(s2.open[18]).toBe(false)
  expect(s2.open[17]).toBe(true)
  expect(look(s2, 18).text).toBe('F')
})

test('マインスイーパー: 旗・勝ち・負け', () => {
  const col6 = Array.from({ length: 8 }, (_, r) => r * 8 + 6)
  let s = minesAt(col6)
  // 旗を立てたマスは開けない。外せば開ける
  s = toggleFlag(s, 7)
  expect(reveal(s, 7, NOW, seq(0))).toBe(s)
  expect(minesLeft(s)).toBe(MINE_COUNT - 1)
  s = toggleFlag(s, 7)
  expect(s.flag[7]).toBe(false)
  // 開いたマスに旗は立たない、開いたマスをもう一度開けても変わらない
  s = reveal(s, 0, NOW + 1000, seq(0))
  expect(toggleFlag(s, 0)).toBe(s)
  expect(reveal(s, 0, NOW, seq(0))).toBe(s)
  // 右端を全部開けると勝ち。地雷には旗が立つ
  for (let r = 0; r < 8; r++) s = reveal(s, r * 8 + 7, NOW + 12_300, seq(0))
  expect(s.status).toBe('won')
  expect(isCleared(s.mines!, s.open)).toBe(true)
  expect(s.endedAt - s.startedAt).toBe(12_300)
  expect(col6.every(i => s.flag[i])).toBe(true)
  expect(minesLeft(s)).toBe(MINE_COUNT - 8)
  // 終わった盤は変わらない
  expect(toggleFlag(s, 6)).toBe(s)

  // 負け: 踏んだ所を覚え、地雷を全部見せる。違う所の旗は Ｘ
  let l = toggleFlag(minesAt(col6), 0)
  l = reveal(l, 14, NOW + 5000, seq(0))
  expect(l).toMatchObject({ status: 'lost', boom: 14, endedAt: NOW + 5000 })
  expect(col6.every(i => l.open[i])).toBe(true)
  expect(look(l, 14)).toMatchObject({ text: '*', wide: '●', isBoom: true })
  expect(look(l, 22).isBoom).toBe(false)
  expect(look(l, 0)).toMatchObject({ text: 'x', wide: 'Ｘ' })
  expect(reveal(l, 1, NOW, seq(0))).toBe(l)
  // 閉じたマス・旗の見え方
  expect(look(newMines(), 0)).toMatchObject({ text: '#', wide: '■', isOpen: false })
  expect(look(toggleFlag(newMines(), 0), 0)).toMatchObject({ text: 'F', wide: '▶' })
  // 範囲の外は何もしない
  const fresh = newMines()
  expect(reveal(fresh, 64, NOW, seq(0))).toBe(fresh)
  expect(toggleFlag(fresh, -1)).toBe(fresh)
})

test('マスの字は 1 文字で、terminal 用は半角だけ', () => {
  const col6 = Array.from({ length: 8 }, (_, r) => r * 8 + 6)
  const states = [newMines(), reveal(minesAt(col6), 0, NOW, seq(0)), reveal(minesAt(col6), 6, NOW, seq(0))]
  for (const s of states)
    for (let i = 0; i < CELLS; i++) {
      const l = look(s, i)
      expect(l.text).toMatch(/^[ -~]$/)
      expect([...l.wide]).toHaveLength(1)
    }
})

// ---------------- 記録・SVG ----------------

test('記録の合わせ方と、壊れた store の扱い', () => {
  const s = { best2048: 500, wins2048: 1, winsMines: 2, fastestMines: 30_000 }
  expect(addStats(s, { best2048: 300, winsMines: 1, fastestMines: 40_000 })).toEqual({ best2048: 500, wins2048: 1, winsMines: 3, fastestMines: 30_000 })
  expect(addStats(s, { best2048: 900, wins2048: 1, fastestMines: 20_000 })).toEqual({ best2048: 900, wins2048: 2, winsMines: 2, fastestMines: 20_000 })
  expect(addStats(EMPTY_STATS, { fastestMines: 9000 }).fastestMines).toBe(9000)
  expect(addStats(EMPTY_STATS, {}).fastestMines).toBe(0)
  expect(statsFromSaved(undefined)).toEqual(EMPTY_STATS)
  expect(statsFromSaved('broken')).toBeUndefined()
  expect(statsFromSaved([1, 2])).toBeUndefined()
  expect(statsFromSaved(null)).toBeUndefined()
  // 数でない項目・負の数は 0 (文字や制御文字が混ざっていても描画に流れない)
  expect(statsFromSaved({ best2048: 'x\x01', wins2048: -3, winsMines: 2.7, fastestMines: Infinity })).toEqual({ ...EMPTY_STATS, winsMines: 2 })
})

test('SVG: 制御文字を落とし、幅を付けず、動いたタイルが滑る', () => {
  expect(clean('a\x00b\x1bc\x7fd\te\nf')).toBe('abcd\te\nf')
  expect(esc('<b>\x01&"')).toBe('&lt;b&gt;&amp;&quot;')

  const g = play(game([2, 0, 0, 2, ...Array(12).fill(0)]), 'left', seq(0.99, 0))
  const svg = board2048Svg(g.game, EMPTY_STATS)
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
  expect(svg).toMatch(/type="translate" from="240 0"/)
  expect(svg).toMatch(/type="scale" values="1\.2;1"/)
  expect(svg).toMatch(/type="scale" values="0\.1;1"/)
  expect(svg).toMatch(/>スコア</)
  expect(svg).not.toMatch(/ゲームオーバー/)
  expect(svg.length).toBeLessThan(131_072)

  const over = board2048Svg(game([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2], { isOver: true, score: 1234 }), { ...EMPTY_STATS, best2048: 9999 })
  expect(over).toMatch(/ゲームオーバー/)
  expect(over).toMatch(/>9999</)
  const won = board2048Svg(game([2048, ...Array(15).fill(0)], { hasWon: true }), EMPTY_STATS)
  expect(won).toMatch(/2048 達成/)
  expect(won).toMatch(/stroke="#f2cc60"/)

  const col6 = Array.from({ length: 8 }, (_, r) => r * 8 + 6)
  expect(minesSvg(newMines(), EMPTY_STATS)).toMatch(/初手は安全です/)
  const lost = reveal(minesAt(col6), 6, NOW, seq(0))
  expect(minesSvg(lost, { ...EMPTY_STATS, winsMines: 4, fastestMines: 12_300 })).toMatch(/地雷を踏みました[\s\S]*勝ち 4 回 \/ 最速 12\.3秒/)
  expect(minesSvg(lost, EMPTY_STATS)).not.toMatch(/<svg[^>]*\swidth=/)
})

// ---------------- 画面 ----------------

/** エンジンの代わりに一番下で答える。store は手元の Map、トーストは集める */
const boot = async ($: Engine, on: On, init?: unknown, opts: { theme?: () => string } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const theme = opts.theme
  if (theme) {
    on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme(), provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
    on('config.set', (_$, e) => ({ value: e.value }))
  }
  const m = new Map<string, unknown>(init === undefined ? [] : [['stats', init]])
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // mod が書いた state を一番下で覗く。arm した値があれば、次のその key の書き込みを差し替える (盤を入れる)
  const last: Record<string, unknown> = {}
  const armed = new Map<string, unknown>()
  on('state.set', (_$, e, next) => {
    if (e.plugin !== 'wait-games') return next(e)
    const value = armed.has(e.key) ? armed.get(e.key) : e.value
    armed.delete(e.key)
    last[e.key] = value
    return next({ ...e, value } as typeof e)
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return {
    clock,
    toasts,
    store: m,
    g2048: () => last.g2048 as Game2048,
    mines: () => last.mines as Mines,
    last: <T,>(key: string) => last[key] as T,
    arm: (key: string, value: unknown) => armed.set(key, value),
  }
}

let n = 0
const startTurn = async ($: Engine, agentId?: string) => {
  const turnId = `t${++n}`
  await $.turn.start({ text: 'p', turnId, ...(agentId ? { agentId } : {}) })
  return turnId
}
const endTurn = async ($: Engine, turnId: string, reason: 'answer' | 'aborted' | 'error' = 'answer', agentId?: string) =>
  $.turn.complete({ answer: 'a', durationMs: 1000, isAborted: reason === 'aborted', turnId, reason, ...(agentId ? { agentId } : {}) } as never)

/** 描いた木の要素の数と深さ */
const measure = (el: unknown, depth = 1): { nodes: number; depth: number } => {
  if (typeof el !== 'object' || el === null) return { nodes: 0, depth: 0 }
  const kids = ((el as { props?: { children?: unknown } }).props?.children ?? (el as { children?: unknown }).children ?? []) as unknown
  const list = Array.isArray(kids) ? kids : [kids]
  return list.reduce<{ nodes: number; depth: number }>(
    (acc, k) => {
      const m = measure(k, depth + 1)
      return { nodes: acc.nodes + m.nodes, depth: Math.max(acc.depth, m.depth) }
    },
    { nodes: 1, depth },
  )
}

for (const surface of SURFACES) {
  test(`${surface}: 2048 を矢印で動かし、新しいゲームで戻す`, async ($, on) => {
    const { g2048: g2048Of } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toMatch(/>スコア</)
      expect(String(svg?.props.alt)).toMatch(/^2048 スコア 0、最高点 0$/)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'スコア 0 / 最高 0' })).toBeDefined()
      // 盤は 4 行、1 マス 5 桁
      const cells = (await ui.findAll({ type: 'Text' })).filter(t => /^ {0,3}(\.|\d{1,4}) $/.test(t.text))
      expect(cells).toHaveLength(16)
    }
    for (const k of ['up', 'left', 'down', 'right', 'new-2048']) expect(await ui.find({ key: k })).toBeDefined()
    expect((await ui.find({ key: 'up' }))?.props.label).toBe('↑')

    // 2 枚の盤はどこかの向きには必ず動く
    for (const k of ['left', 'right', 'up', 'down']) {
      await ui.press({ key: k })
      if ((g2048Of()?.moves ?? 0) > 0) break
    }
    const g = g2048Of()
    expect(g.moves).toBe(1)
    expect(g.board.filter(v => v !== 0).length).toBeGreaterThanOrEqual(2)
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/type="scale" values="0\.1;1"/)
    else expect(await ui.find({ type: 'Text', text: '1 手' })).toBeDefined()

    await ui.press({ key: 'new-2048' })
    expect(g2048Of()).toMatchObject({ moves: 0, score: 0 })
  })

  test(`${surface}: マインスイーパーは 64 マスの Button。29 桁に収まり、木が大きすぎない`, async ($, on) => {
    const { mines: minesOf } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'game', value: 'mines' })
    const cells = (await ui.findAll({ type: 'Button' })).filter(b => /^m\d+$/.test(b.key ?? ''))
    expect(cells).toHaveLength(64)
    expect(new Set(cells.map(b => b.key)).size).toBe(64)
    for (const b of cells) {
      expect(b.props.plain).toBe(true)
      expect([...String(b.props.label)]).toHaveLength(1)
    }
    // 1 行 = 8 マス + 間 7 桁。terminal は半角だけなので 15 桁
    const row = await ui.find({ key: 'row0' })
    expect(row?.props.columnGap).toBe(1)
    if (surface === 'terminal') expect(cells.every(b => /^[ -~]$/.test(String(b.props.label)))).toBe(true)
    // 木は検証を通り (drawn が拒まれない)、要素の数・深さ・大きさに余裕がある
    const tree = await ui.drawn()
    const size = measure(tree)
    expect(size.nodes).toBeGreaterThan(64)
    expect(size.nodes).toBeLessThan(200)
    expect(size.depth).toBeLessThan(12)
    expect(JSON.stringify(tree).length).toBeLessThan(40_000)

    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/初手は安全です/)
    else expect(await ui.find({ type: 'Text', text: /初手は安全です/ })).toBeDefined()

    // 初手は必ず安全で、広く開く
    await ui.press({ key: 'm27' })
    const s = minesOf()
    expect(s.status === 'play' || s.status === 'won').toBe(true)
    expect(s.open.filter(Boolean).length).toBeGreaterThan(8)
    const closed = surface === 'terminal' ? '#' : '■'
    const closedCount = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^m\d+$/.test(b.key ?? '') && b.props.label === closed).length
    expect(await closedCount()).toBe(64 - s.open.filter(Boolean).length)

    // 旗モード: 閉じたマスに旗。旗のマスは普通に押しても開かない
    const target = s.open.findIndex(o => !o)
    await ui.press({ key: 'flag' })
    expect((await ui.find({ key: 'flag' }))?.props.label).toBe('旗モード: オン')
    await ui.press({ key: `m${target}` })
    expect((await ui.find({ key: `m${target}` }))?.props.label).toBe(surface === 'terminal' ? 'F' : '▶')
    await ui.press({ key: 'flag' })
    await ui.press({ key: `m${target}` })
    expect(minesOf().open[target]).toBe(false)

    await ui.press({ key: 'new-mines' })
    expect(minesOf().status).toBe('ready')
    expect(await closedCount()).toBe(64)

    await ui.select({ key: 'game', value: '2048' })
    expect(await ui.find({ key: 'm0' })).toBeUndefined()
    expect(await ui.find({ key: 'up' })).toBeDefined()
  })

  test(`${surface}: 遊んでいる間にメインのターンが終わったら、帯とトーストを 1 回`, async ($, on) => {
    const { toasts } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    // 遊んでいないターンでは知らせない
    await endTurn($, await startTurn($))
    expect(toasts).toEqual([])

    // ターンの間に遊ぶ
    const t1 = await startTurn($)
    await ui.press({ key: 'left' })
    await ui.press({ key: 'right' })
    // サブエージェントのターンでは知らせない
    await endTurn($, await startTurn($, 'sub-1'), 'answer', 'sub-1')
    expect(toasts).toEqual([])
    await endTurn($, t1)
    expect(toasts).toEqual(['Claude のターンが終わりました'])
    expect(await ui.find({ type: 'Text', text: 'Claude のターンが終わりました' })).toBeDefined()

    // 閉じるで消える。次のターンでも始まりに消える
    await ui.press({ key: 'turn-ok' })
    expect(await ui.find({ key: 'turn-ok' })).toBeUndefined()

    // 遊ばずに終わったターンでは鳴らない
    await endTurn($, await startTurn($))
    expect(toasts).toHaveLength(1)

    // 中断は知らせない。エラーで止まったら「止まりました」
    const t2 = await startTurn($)
    await ui.press({ key: 'up' })
    await endTurn($, t2, 'aborted')
    expect(toasts).toHaveLength(1)
    const t3 = await startTurn($)
    await ui.select({ key: 'game', value: 'mines' })
    await ui.press({ key: 'm0' })
    await endTurn($, t3, 'error')
    expect(toasts).toEqual(['Claude のターンが終わりました', 'Claude のターンが止まりました'])
    // 次のターンが始まると帯は消える
    await startTurn($)
    expect(await ui.find({ type: 'Text', text: /^Claude のターン/ })).toBeUndefined()
  })
}

test('最高点と勝ちは、書く直前に読み直した store に足す (別のセッションの分を消さない)', async ($, on) => {
  const { store, arm, mines: minesOf } = await boot($, on, { best2048: 0, wins2048: 0, winsMines: 1, fastestMines: 0 })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 別のセッションが先に記録を進めた
  store.set('stats', { best2048: 50_000, wins2048: 3, winsMines: 7, fastestMines: 20_000 })
  // このセッションは古い写しのまま。合わせられる盤で点を取る
  arm('g2048', game([2, 2, ...Array(14).fill(0)]))
  await ui.press({ key: 'new-2048' })
  await ui.press({ key: 'left' })
  expect(store.get('stats')).toEqual({ best2048: 50_000, wins2048: 3, winsMines: 7, fastestMines: 20_000 })
  // 勝ち直前の盤で勝つと、読み直した 7 に 1 を足す。最速は小さい方
  const col6 = Array.from({ length: 8 }, (_, r) => r * 8 + 6)
  let s = reveal(minesAt(col6, { startedAt: NOW - 9000 }), 0, NOW, seq(0))
  for (let r = 0; r < 7; r++) s = reveal(s, r * 8 + 7, NOW, seq(0))
  await ui.select({ key: 'game', value: 'mines' })
  arm('mines', s)
  await ui.press({ key: 'new-mines' })
  await ui.press({ key: 'm63' })
  expect(minesOf().status).toBe('won')
  expect(store.get('stats')).toEqual({ best2048: 50_000, wins2048: 3, winsMines: 8, fastestMines: 9000 })
  expect(await ui.find({ type: 'Text', text: /勝ち 8 回 \/ 最速 9\.0秒/ })).toBeDefined()
  // 勝った盤をもう一度押しても数えない
  await ui.press({ key: 'm63' })
  expect((store.get('stats') as { winsMines: number }).winsMines).toBe(8)
})

test('2048 を作ると勝ちを 1 回数え、連打しても記録が消えない', async ($, on) => {
  const { store, arm, g2048: g2048Of } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  arm('g2048', game([1024, 1024, 0, 0, 2, 2, 0, 0, 4, 4, 0, 0, 8, 8, 0, 0]))
  await ui.press({ key: 'new-2048' })
  await Promise.all([ui.press({ key: 'left' }), ui.press({ key: 'right' }), ui.press({ key: 'left' })])
  const saved = store.get('stats') as { best2048: number; wins2048: number }
  expect(saved.wins2048).toBe(1)
  expect(saved.best2048).toBe(g2048Of().score)
  expect(saved.best2048).toBeGreaterThanOrEqual(2048 + 4 + 8 + 16)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/2048 達成/)
})

test('記録を書く時、知らない欄 (新しい版が足した物) を入れ子の中まで残す', async ($, on) => {
  const future = {
    best2048: 10, wins2048: 0, winsMines: 2, fastestMines: 0, futureField: 1,
    puzzles: { fifteen: { wins: 1, bestMoves: 50, fastest: 90_000, futureInner: 2 }, sudoku16: { wins: 3 } },
  }
  const { store, arm } = await boot($, on, future)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  arm('g2048', game([8, 8, ...Array(14).fill(0)]))
  await ui.press({ key: 'new-2048' })
  await ui.press({ key: 'left' })
  const saved = store.get('stats') as Record<string, unknown> & { puzzles: Record<string, Record<string, unknown>> }
  expect(saved.best2048).toBe(16)
  expect(saved.futureField).toBe(1)
  expect(saved.puzzles.sudoku16).toEqual({ wins: 3 })
  expect(saved.puzzles.fifteen).toEqual({ wins: 1, bestMoves: 50, fastest: 90_000, futureInner: 2 })
  expect(keepUnknown({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 5 }, e: 6 })).toEqual({ a: 1, b: { c: 5, d: 3 }, e: 6 })
  expect(keepUnknown('broken', { a: 1 })).toEqual({ a: 1 })
})

test('store が読めない形なら書かずに知らせる', async ($, on) => {
  const { store, arm } = await boot($, on, 'broken')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /記録を読めなかった/ })).toBeDefined()
  arm('g2048', game([2, 2, ...Array(14).fill(0)]))
  await ui.press({ key: 'new-2048' })
  await ui.press({ key: 'left' })
  expect(store.get('stats')).toBe('broken')
  expect(await ui.find({ type: 'Text', text: /記録を読めなかった/ })).toBeDefined()
})

test('/games を登録して開く。取れなければ /wait-games', async ($, on) => {
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'games' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  let opened = ''
  on('ui.open', (_$, e) => {
    opened = e.id
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['games'])
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect((await $.command.run({ command: 'games', ...run })).text).toBe('ミニゲームを開きました。')
  expect(opened).toBe('wait-games')
  isTaken = true
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['games', 'games', 'wait-games'])
  opened = ''
  expect((await $.command.run({ command: 'wait-games', ...run })).text).toBe('ミニゲームを開きました。')
  expect(opened).toBe('wait-games')
})

test('/games が取れなかった時は、元の /games を横取りしない', async ($, on) => {
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (e.name === 'games' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.run', { command: 'games' }, () => ({ text: '組み込みの games' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'games', ...run })).toMatchObject({ text: '組み込みの games' })
  expect(opened).toEqual([])
})

// ================ 0.2.0 で足したゲーム ================

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

// ---------------- 15 パズル ----------------

test('15 パズル: 解けるかの判定と、新しい盤はいつも解ける並び', () => {
  expect(solvable15(SOLVED)).toBe(true)
  // 14 と 15 を入れ替えた有名な解けない並び
  expect(solvable15([...range(13).map(i => i + 1), 15, 14, 0])).toBe(false)
  // 解けた形から合法な手を何回打っても解ける
  let t = [...SOLVED]
  const r = seeded(5)
  for (let k = 0; k < 300; k++) {
    const blank = t.indexOf(0)
    const ns = neighbors(blank)
    const j = ns[Math.floor(r() * ns.length)]!
    ;[t[blank], t[j]] = [t[j]!, 0]
    expect(solvable15(t)).toBe(true)
  }
  for (let k = 0; k < 200; k++) {
    const g = newFifteen(seeded(k))
    expect([...g.tiles].sort((a, b) => a - b)).toEqual(range(16))
    expect(solvable15(g.tiles)).toBe(true)
    expect(isSolved(g.tiles)).toBe(false)
    expect(g).toMatchObject({ moves: 0, status: 'play', startedAt: 0 })
  }
  // 乱数が偏っても (いつも 0) 解ける・そろっていない盤
  for (const v of [0, 0.9999999]) {
    const g = newFifteen(() => v)
    expect(solvable15(g.tiles)).toBe(true)
    expect(isSolved(g.tiles)).toBe(false)
  }
})

test('15 パズル: 空きの隣だけ動き、そろうと勝ち', () => {
  // 1..14, 空き, 15
  const g: Fifteen = { tiles: [...range(14).map(i => i + 1), 0, 15], moves: 0, startedAt: 0, endedAt: 0, status: 'play' }
  expect(applyFifteen(g, 0, NOW)).toBe(g) // 隣でない
  expect(applyFifteen(g, 14, NOW)).toBe(g) // 空き自身
  expect(applyFifteen(g, 99, NOW)).toBe(g)
  const up = applyFifteen(g, 10, NOW) // 11 が下へ
  expect(up.tiles[14]).toBe(11)
  expect(up.tiles[10]).toBe(0)
  expect(up).toMatchObject({ moves: 1, startedAt: NOW, status: 'play' })
  const won = applyFifteen(g, 15, NOW + 4200)
  expect(won).toMatchObject({ status: 'won', moves: 1, startedAt: NOW + 4200, endedAt: NOW + 4200 })
  expect(applyFifteen(won, 14, NOW)).toBe(won)
  // マスの字はどれも 2 桁
  for (const i of range(16)) expect(look15(g, i).text).toHaveLength(2)
  expect(look15(g, 14)).toMatchObject({ text: ' .', isBlank: true })
  expect(look15(g, 0)).toMatchObject({ text: ' 1', isHome: true })
  expect(look15(g, 15).isHome).toBe(false)
})

// ---------------- ライツアウト ----------------

test('ライツアウト: 何も変えない押し方 2 つと、解ける盤の判定', () => {
  const dark = Array(25).fill(false)
  // QUIET のマスを全部押しても盤は変わらない (だから重なりの偶奇が解けるかの印になる)
  for (const q of QUIET) expect(range(25).filter(i => q[i]).reduce((on, i) => press(on, i), dark)).toEqual(dark)
  expect(solvableLights(dark)).toBe(true)
  for (const i of range(25)) expect(solvableLights(press(dark, i))).toBe(true)
  // 隅の 1 つだけ点いた盤は解けない
  expect(solvableLights(dark.map((_, i) => i === 0))).toBe(false)
  for (let k = 0; k < 200; k++) {
    const g = newLights(seeded(k))
    expect(solvableLights(g.on)).toBe(true)
    expect(isDark(g.on)).toBe(false)
  }
  expect(isDark(newLights(() => 0.99).on)).toBe(false)
})

test('ライツアウト: 押すと十字が切り替わり、全部消えると勝ち', () => {
  const dark = Array(25).fill(false)
  // 中央は 5 マス、隅は 3 マス、右端と次の行の左端はつながらない
  expect(press(dark, 12).filter(Boolean)).toHaveLength(5)
  expect(range(25).filter(i => press(dark, 0)[i])).toEqual([0, 1, 5])
  expect(range(25).filter(i => press(dark, 4)[i])).toEqual([3, 4, 9])
  const g: Lights = { on: press(dark, 12), moves: 3, startedAt: NOW - 5000, endedAt: 0, status: 'play' }
  const once = applyLights(g, 0, NOW)
  expect(once.on.filter(Boolean)).toHaveLength(8)
  expect(once).toMatchObject({ moves: 4, status: 'play', startedAt: NOW - 5000 })
  const won = applyLights(g, 12, NOW)
  expect(won).toMatchObject({ status: 'won', moves: 4, endedAt: NOW })
  expect(applyLights(won, 3, NOW)).toBe(won)
  expect(applyLights(g, 25, NOW)).toBe(g)
  expect(lookLights(g, 12)).toMatchObject({ text: '#', wide: '■', isOn: true })
  expect(lookLights(g, 0)).toMatchObject({ text: '.', wide: '・', isOn: false })
})

// ---------------- 数独 ----------------

test('数独: 完成した盤は行・列・箱に重なりが無く、問題は答えが 1 つ', () => {
  expect(peers(9, 0)).toHaveLength(20)
  expect(peers(4, 0).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 8, 12])
  for (let k = 0; k < 30; k++) expect(isComplete({ size: 4, cells: solutionFor(4, seeded(k)) })).toBe(true)
  for (let k = 0; k < 10; k++) expect(isComplete({ size: 9, cells: solutionFor(9, seeded(k)) })).toBe(true)
  const check = (g: Sudoku) => {
    expect(countSolutions(g.size, g.cells)).toBe(1)
    g.cells.forEach((v, i) => {
      expect(g.givens[i]).toBe(v !== 0)
      if (v !== 0) expect(v).toBe(g.solution[i])
    })
    expect(g).toMatchObject({ selected: -1, moves: 0, status: 'play' })
  }
  for (let k = 0; k < 30; k++) {
    const g = newSudoku(4, seeded(k))
    check(g)
    expect(g.cells.filter(v => v === 0).length).toBeGreaterThan(4)
  }
  for (let k = 0; k < 3; k++) {
    const g = newSudoku(9, seeded(k))
    check(g)
    expect(g.cells.filter(v => v !== 0).length).toBeLessThanOrEqual(36)
  }
  // 空の盤は答えがたくさん (2 で打ち切り)
  expect(countSolutions(4, Array(16).fill(0))).toBe(2)
})

test('数独: マスを選んで数字を入れ、重なりは印、全部正しく埋まると勝ち', () => {
  const base = newSudoku(4, seeded(7))
  const empty = range(16).filter(i => !base.givens[i])
  const given = range(16).find(i => base.givens[i])!
  // 初めからある数字は選べない、選ばずに入れても変わらない
  expect(selectCell(base, given)).toBe(base)
  expect(applySudoku(base, 1, NOW)).toBe(base)
  const sel = selectCell(base, empty[0]!)
  expect(sel.selected).toBe(empty[0])
  expect(selectCell(sel, empty[0]!).selected).toBe(-1)
  // 同じ行にある数字を入れると重なりの印
  const rowMate = peers(4, empty[0]!).find(j => base.givens[j])!
  const clash = applySudoku(sel, base.cells[rowMate]!, NOW)
  expect(clash).toMatchObject({ moves: 1, startedAt: NOW })
  expect(clashes(clash, empty[0]!)).toBe(true)
  expect(lookSudoku(clash, empty[0]!)).toMatchObject({ isClash: true, isSelected: true, isGiven: false })
  expect(applySudoku(clash, base.cells[rowMate]!, NOW)).toBe(clash) // 同じ数字
  expect(applySudoku(clash, 5, NOW)).toBe(clash) // 4x4 に 5 は無い
  // 0 で消す
  expect(applySudoku(clash, 0, NOW).cells[empty[0]!]).toBe(0)
  // 答えのとおりに埋めると勝ち
  let g = base
  for (const i of empty) g = applySudoku(selectCell(g, i), base.solution[i]!, NOW + 30_000)
  expect(g).toMatchObject({ status: 'won', selected: -1, moves: empty.length, endedAt: NOW + 30_000 })
  expect(selectCell(g, empty[0]!)).toBe(g)
  expect(lookSudoku(base, given)).toMatchObject({ isGiven: true, text: String(base.cells[given]) })
  expect(lookSudoku(base, empty[0]!)).toMatchObject({ text: '.', wide: '・' })
})

// ---------------- 神経衰弱 ----------------

test('神経衰弱: 8 組の札、違う 2 枚は次に押すまで見せ、同じ 2 枚はそろう', () => {
  const g0 = newMemory(seeded(3))
  expect(range(8).map(f => g0.cards.filter(c => c === f).length)).toEqual(Array(8).fill(2))
  // 札の並びを決める: 0,0,1,1,...
  const g: Memory = { ...g0, cards: range(16).map(i => Math.floor(i / 2)) }
  const a = applyMemory(g, 0, NOW)
  expect(a).toMatchObject({ up: [0], moves: 0, startedAt: NOW })
  expect(applyMemory(a, 0, NOW)).toBe(a) // 表の札をもう一度
  const miss = applyMemory(a, 2, NOW)
  expect(miss).toMatchObject({ up: [0, 2], moves: 1 })
  expect(lookMemory(miss, 0)).toMatchObject({ text: '赤', isMiss: true, isUp: true })
  expect(lookMemory(miss, 2).text).toBe('青')
  // 次に押すと 2 枚とも伏せて、押した札だけ表
  const next = applyMemory(miss, 5, NOW)
  expect(next.up).toEqual([5])
  expect(lookMemory(next, 0)).toMatchObject({ text: '##', wide: '■', isUp: false })
  // 違う 2 枚を見せている時に、その 1 枚を押すと、それが 1 枚目になる
  expect(applyMemory(miss, 2, NOW).up).toEqual([2])
  const hit = applyMemory(applyMemory(g, 4, NOW), 5, NOW)
  expect(hit).toMatchObject({ up: [], moves: 1 })
  expect(hit.done.filter(Boolean)).toHaveLength(2)
  expect(lookMemory(hit, 4)).toMatchObject({ text: '緑', isDone: true, isMiss: false })
  expect(applyMemory(hit, 4, NOW)).toBe(hit) // そろった札
  // 全部そろうと勝ち
  let all = g
  for (const i of range(16)) all = applyMemory(all, i, NOW + 20_000)
  expect(all).toMatchObject({ status: 'won', moves: 8, endedAt: NOW + 20_000 })
  expect(applyMemory(all, 0, NOW)).toBe(all)
  expect(FACES.every(f => [...f].length === 1)).toBe(true)
})

// ---------------- 記録・見出し ----------------

test('記録: 各ゲームの勝ち・最短手数・最速、古い store は壊さない', () => {
  // 0.1.x の記録 (puzzles の欄が無い) はそのまま読める
  expect(statsFromSaved({ best2048: 10, wins2048: 0, winsMines: 1, fastestMines: 5 })).toEqual({ best2048: 10, wins2048: 0, winsMines: 1, fastestMines: 5 })
  const s1 = addStats(EMPTY_STATS, { puzzle: { kind: 'fifteen', moves: 80, ms: 60_000 } })
  expect(s1.puzzles).toEqual({ fifteen: { wins: 1, bestMoves: 80, fastest: 60_000 } })
  const s2 = addStats(s1, { puzzle: { kind: 'fifteen', moves: 95, ms: 40_000 } })
  expect(s2.puzzles?.fifteen).toEqual({ wins: 2, bestMoves: 80, fastest: 40_000 })
  const s3 = addStats(s2, { puzzle: { kind: 'sudoku9', moves: 51, ms: 300_000 } })
  expect(Object.keys(s3.puzzles ?? {}).sort()).toEqual(['fifteen', 'sudoku9'])
  // 2048 やマインの記録を足しても、ほかのゲームの記録は残る
  expect(addStats(s3, { winsMines: 1 }).puzzles).toEqual(s3.puzzles)
  // 壊れた欄は 0、知らないゲームと形の違う物は落とす
  expect(statsFromSaved({ puzzles: { lights: { wins: 'x', bestMoves: -1, fastest: 9000 }, memory: 3, chess: { wins: 9 } } })).toEqual({
    ...EMPTY_STATS,
    puzzles: { lights: { wins: 0, bestMoves: 0, fastest: 9000 } },
  })
  expect(statsFromSaved({ puzzles: [1] })).toEqual(EMPTY_STATS)
  // store に書いた物を読み直しても同じ
  expect(statsFromSaved(JSON.parse(JSON.stringify(s3)))).toEqual(s3)
})

test('見出し SVG: 遊び方の一言・手数・クリアと記録。幅を付けない', () => {
  const stats: GameStats = { ...EMPTY_STATS, puzzles: { fifteen: { wins: 3, bestMoves: 61, fastest: 45_200 } } }
  const g: Fifteen = { tiles: [...range(14).map(i => i + 1), 0, 15], moves: 0, startedAt: 0, endedAt: 0, status: 'play' }
  const fresh = fifteenSvg(g, stats)
  expect(fresh).toMatch(/15 パズル[\s\S]*正しい位置 14 \/ 15[\s\S]*空きの隣を押して[\s\S]*勝ち 3 回 \/ 最短 61 手 \/ 最速 45\.2秒/)
  expect(fresh).not.toMatch(/<svg[^>]*\swidth=/)
  const won = fifteenSvg(applyFifteen(g, 15, NOW), stats)
  expect(won).toMatch(/クリア 0\.0秒 \/ 1 手/)
  expect(won).toMatch(/values="0;0\.35;0"/)
  expect(fresh).not.toMatch(/values="0;0\.35;0"/)
  expect(lightsSvg(newLights(seeded(1)), EMPTY_STATS)).toMatch(/ライツアウト[\s\S]*点灯 \d+ 個[\s\S]*勝ち 0 回</)
  const sd = newSudoku(4, seeded(2))
  expect(sudokuSvg(sd, EMPTY_STATS)).toMatch(/数独 4x4[\s\S]*空き \d+ マス/)
  // 埋まったのに重なっている
  const full: Sudoku = { ...sd, cells: sd.cells.map(v => v || 1) }
  expect(sudokuSvg(full, EMPTY_STATS)).toMatch(/同じ数字が重なっています/)
  expect(memorySvg(newMemory(seeded(1)), EMPTY_STATS)).toMatch(/神経衰弱[\s\S]*そろった 0 \/ 8 組[\s\S]*同じ色の名前/)
})

// ---------------- 画面 ----------------

/** 盤の Button (key が prefix + 数字) */
const cellsOf = async (ui: { findAll: (q: { type: string }) => Promise<{ key?: string; props: Record<string, unknown> }[]> }, prefix: string) =>
  (await ui.findAll({ type: 'Button' })).filter(b => new RegExp(`^${prefix}\\d+$`).test(b.key ?? ''))
/** 画面の桁数 (全角は 2 桁) */
const cols = (s: string) => [...s].reduce((n, ch) => n + (/[ -~]/.test(ch) ? 1 : 2), 0)

for (const surface of SURFACES) {
  test(`${surface}: 15 パズルは 16 マスの Button、そろえると記録が残る`, async ($, on) => {
    const { store, arm, last } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'game', value: 'fifteen' })
    const cells = await cellsOf(ui, 'f')
    expect(cells).toHaveLength(16)
    for (const b of cells) {
      expect(b.props.plain).toBe(true)
      expect(String(b.props.label)).toHaveLength(2)
    }
    expect(await ui.find({ key: 'new-fifteen' })).toBeDefined()
    // そろう直前の盤で 15 を滑らせる
    arm('fifteen', { tiles: [...range(14).map(i => i + 1), 0, 15], moves: 40, startedAt: NOW - 61_000, endedAt: 0, status: 'play' } satisfies Fifteen)
    await ui.press({ key: 'new-fifteen' })
    await ui.press({ key: 'f0' }) // 隣でないので動かない
    expect(last<Fifteen>('fifteen').moves).toBe(40)
    await ui.press({ key: 'f15' })
    expect(last<Fifteen>('fifteen').status).toBe('won')
    expect((store.get('stats') as GameStats).puzzles?.fifteen).toEqual({ wins: 1, bestMoves: 41, fastest: 61_000 })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/クリア 61\.0秒 \/ 41 手/)
    else expect(await ui.find({ type: 'Text', text: 'クリア 61.0秒 / 41 手' })).toBeDefined()
    // 解いた盤をもう一度押しても数えない
    await ui.press({ key: 'f14' })
    expect((store.get('stats') as GameStats).puzzles?.fifteen?.wins).toBe(1)
  })

  test(`${surface}: ライツアウトは 25 マス、押すと十字が切り替わり、消すと勝ち`, async ($, on) => {
    const { store, arm, last } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'game', value: 'lights' })
    expect(await cellsOf(ui, 'l')).toHaveLength(25)
    arm('lights', { on: press(Array(25).fill(false), 12), moves: 0, startedAt: 0, endedAt: 0, status: 'play' } satisfies Lights)
    await ui.press({ key: 'new-lights' })
    const lit = surface === 'terminal' ? '#' : '■'
    const litCount = async () => (await cellsOf(ui, 'l')).filter(b => b.props.label === lit).length
    expect(await litCount()).toBe(5)
    await ui.press({ key: 'l0' })
    expect(await litCount()).toBe(8)
    await ui.press({ key: 'l0' })
    await ui.press({ key: 'l12' })
    expect(last<Lights>('lights')).toMatchObject({ status: 'won', moves: 3 })
    expect(await litCount()).toBe(0)
    expect((store.get('stats') as GameStats).puzzles?.lights).toMatchObject({ wins: 1, bestMoves: 3 })
  })

  test(`${surface}: 数独はマスを選んで下の数字で入れる。9x9 も 29 桁に収まる`, async ($, on) => {
    const { store, arm, last } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'game', value: 'sudoku' })
    expect(await cellsOf(ui, 's')).toHaveLength(16)
    for (const d of ['d1', 'd2', 'd3', 'd4', 'd0']) expect(await ui.find({ key: d })).toBeDefined()
    expect(await ui.find({ key: 'd5' })).toBeUndefined()
    // 1 マスだけ空いた盤
    const base = newSudoku(4, seeded(11))
    const hole = 6
    const one: Sudoku = { ...base, cells: base.solution.map((v, i) => (i === hole ? 0 : v)), givens: range(16).map(i => i !== hole), startedAt: NOW - 12_000 }
    arm('sudoku', one)
    await ui.press({ key: 'sudoku-4' })
    await ui.press({ key: 'd1' }) // 選ぶ前は入らない
    expect(last<Sudoku>('sudoku').cells[hole]).toBe(0)
    await ui.press({ key: `s${hole}` })
    expect(last<Sudoku>('sudoku').selected).toBe(hole)
    const wrong = (one.solution[hole]! % 4) + 1
    await ui.press({ key: `d${wrong}` })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/同じ数字が重なっています/)
    else expect(await ui.find({ type: 'Text', text: '同じ数字が重なっています' })).toBeDefined()
    await ui.press({ key: `d${one.solution[hole]}` })
    expect(last<Sudoku>('sudoku')).toMatchObject({ status: 'won', moves: 2 })
    expect((store.get('stats') as GameStats).puzzles?.sudoku4).toEqual({ wins: 1, bestMoves: 2, fastest: 12_000 })

    // 9x9
    await ui.press({ key: 'sudoku-9' })
    const cells = await cellsOf(ui, 's')
    expect(cells).toHaveLength(81)
    expect(last<Sudoku>('sudoku').size).toBe(9)
    // 1 行 = 箱 3 つ (中の間 1 桁) + 箱の間 2 桁
    const row = await ui.find({ key: 's-r0' })
    expect(row?.props.columnGap).toBe(2)
    expect((await ui.find({ key: 's-r0g0' }))?.props.columnGap).toBe(1)
    const width = Math.max(...cells.map(b => cols(String(b.props.label)))) * 9 + 3 * 2 + 2 * 2
    expect(width).toBeLessThanOrEqual(29)
    if (surface === 'terminal') expect(width).toBe(19)
    const tree = await ui.drawn()
    const size = measure(tree)
    expect(size.nodes).toBeLessThan(400)
    expect(size.depth).toBeLessThan(16)
    expect(JSON.stringify(tree).length).toBeLessThan(60_000)
    for (const d of range(9)) expect(await ui.find({ key: `d${d + 1}` })).toBeDefined()
  })

  test(`${surface}: 神経衰弱は 16 枚、違う 2 枚は次に押すまで見せ、全部そろえると勝ち`, async ($, on) => {
    const { store, arm, last } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'game', value: 'memory' })
    const closed = surface === 'terminal' ? '##' : '■'
    const shown = async () => (await cellsOf(ui, 'c')).filter(b => b.props.label !== closed).map(b => b.key)
    expect(await cellsOf(ui, 'c')).toHaveLength(16)
    expect(await shown()).toEqual([])
    const g: Memory = { ...newMemory(seeded(1)), cards: range(16).map(i => Math.floor(i / 2)) }
    arm('memory', g)
    await ui.press({ key: 'new-memory' })
    await ui.press({ key: 'c0' })
    await ui.press({ key: 'c2' })
    expect(await shown()).toEqual(['c0', 'c2'])
    expect((await cellsOf(ui, 'c')).find(b => b.key === 'c0')?.props.label).toBe('赤')
    await ui.press({ key: 'c1' })
    expect(await shown()).toEqual(['c1'])
    for (const i of range(16)) await ui.press({ key: `c${i}` })
    expect(last<Memory>('memory').status).toBe('won')
    expect(await shown()).toHaveLength(16)
    expect((store.get('stats') as GameStats).puzzles?.memory?.wins).toBe(1)
  })
}

test('選べるのは 6 つのゲームだけ (知らない値では変えない)', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const sel = await ui.find({ key: 'game' })
  expect((sel?.props.options as { value: string }[]).map(o => o.value)).toEqual(['2048', 'mines', 'fifteen', 'lights', 'sudoku', 'memory'])
  await ui.select({ key: 'game', value: 'memory' })
  expect(await ui.find({ key: 'c0' })).toBeDefined()
  await ui.select({ key: 'game', value: 'chess' }).catch(() => {})
  expect(await ui.find({ key: 'c0' })).toBeDefined()
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  await boot($, on, undefined, { theme: () => theme })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/<rect width="360" height="\d+" fill="#ffffff"/)
  await ui.select({ key: 'game', value: 'lights' })
  expect(await source()).toMatch(/fill="#ffffff"/)
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await source()).toMatch(/fill="#0d1117"/)
  expect(await source()).not.toMatch(/fill="#ffffff"/)
})
