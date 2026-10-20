// SVG を文字列で組む関数と terminal 用の行。どれも純関数。描画面は <img> なので SMIL だけで動かす
import type { Fifteen, Game2048, GameStats, Lights, Memory, Mines, Puzzle, PuzzleRecord, Sudoku } from '../types'
import { SOLVED } from './fifteen'
import { litCount } from './lights'
import { pairCount } from './memory'
import { MINE_COUNT, minesLeft } from './mines'
import { recordOf } from './stats'
import { emptyCount } from './sudoku'
import { C, frame, header, HEADER_H, isLight, panel } from './style'

// 色は共通の C (/config の theme で明るい色に替わる)
export { C }

const FONT = 'font-family="sans-serif"'

/** 制御文字を落とす。エンジンは制御文字を含む Text の子や alt を拒み、SVG も壊れる */
export const clean = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')

export const esc = (s: string) =>
  clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const text = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${FONT} ${extra}>${esc(s)}</text>`

/** 秒 (小数 1 桁) */
export const secs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}秒`

// ---- 2048 ----

/** タイルの地と文字の色 */
export function tileColor(v: number): { fill: string; ink: string } {
  const table: Record<number, string> = {
    2: isLight() ? '#eaeef2' : '#21262d',
    4: C.line,
    8: C.orange,
    16: C.yellow,
    32: C.red,
    64: C.purple,
    128: C.blue,
    256: C.green,
    512: '#1f6feb',
    1024: '#8957e5',
  }
  if (v >= 2048) return { fill: '#e3b341', ink: C.bg }
  const fill = table[v] ?? C.face
  return { fill, ink: v <= 4 ? C.text : C.bg }
}

const CELL = 72
const GAP = 8
const BX = 16
const BY = 72
const pos = (i: number) => ({ x: BX + GAP + (i % 4) * (CELL + GAP), y: BY + GAP + Math.floor(i / 4) * (CELL + GAP) })
const MOVE = '0.12s'

/** タイル 1 枚 (左上を 0,0 に置いた形) */
function tile(v: number) {
  const { fill, ink } = tileColor(v)
  const digits = String(v).length
  const size = digits <= 2 ? 32 : digits === 3 ? 28 : digits === 4 ? 24 : 18
  const glow = v >= 2048 ? ` stroke="#f2cc60" stroke-width="3"` : ''
  return (
    `<rect width="${CELL}" height="${CELL}" rx="6" fill="${fill}"${glow}/>` +
    text(CELL / 2, CELL / 2 + size * 0.36, String(v), size, ink, 'text-anchor="middle" font-weight="bold"')
  )
}

/** 遅れて大きくなって出るタイル (合わさった物・新しい物) */
function pop(i: number, v: number, from: string) {
  const { x, y } = pos(i)
  const h = CELL / 2
  return (
    `<g transform="translate(${x + h} ${y + h})" opacity="0"><set attributeName="opacity" to="1" begin="${MOVE}" fill="freeze"/>` +
    `<g><animateTransform attributeName="transform" type="scale" values="${from};1" begin="${MOVE}" dur="0.15s" fill="freeze"/>` +
    `<g transform="translate(${-h} ${-h})">${tile(v)}</g></g></g>`
  )
}

export function board2048Svg(g: Game2048, stats: GameStats): string {
  const best = Math.max(stats.best2048, g.score)
  let out = ''
  // 見出し: 題・スコア・最高点
  out += text(16, 44, '2048', 30, C.text, 'font-weight="bold"')
  const box = (x: number, label: string, v: number) =>
    `<rect x="${x}" y="10" width="100" height="50" rx="6" fill="${C.face}" stroke="${C.line}"/>` +
    text(x + 50, 29, label, 12, C.dim, 'text-anchor="middle"') +
    text(x + 50, 52, String(v), 18, C.text, 'text-anchor="middle" font-weight="bold"')
  out += box(140, 'スコア', g.score) + box(248, '最高点', best)
  // 盤の地と空きマス
  out += `<rect x="${BX}" y="${BY}" width="${4 * CELL + 5 * GAP}" height="${4 * CELL + 5 * GAP}" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  for (let i = 0; i < 16; i++) {
    const { x, y } = pos(i)
    out += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="6" fill="${C.bg}"/>`
  }
  // 動いたタイル (動く前の値を、行き先へ滑らせる)。直前の手が無ければ盤のまま
  const fresh = new Set([...g.merged, ...g.spawned])
  if (g.slides.length > 0) {
    for (const s of g.slides) {
      const a = pos(s.from)
      const b = pos(s.to)
      const slide =
        s.from === s.to ? '' : `<animateTransform attributeName="transform" type="translate" from="${a.x - b.x} ${a.y - b.y}" to="0 0" dur="${MOVE}" fill="freeze"/>`
      out += `<g transform="translate(${b.x} ${b.y})"><g>${slide}${tile(s.value)}</g></g>`
    }
  } else {
    g.board.forEach((v, i) => {
      if (v === 0 || fresh.has(i)) return
      const { x, y } = pos(i)
      out += `<g transform="translate(${x} ${y})">${tile(v)}</g>`
    })
  }
  for (const i of g.merged) out += pop(i, g.board[i] ?? 0, '1.2')
  for (const i of g.spawned) out += pop(i, g.board[i] ?? 0, '0.1')

  // 下の一言・終わりの幕
  const by = BY + 4 * CELL + 5 * GAP
  if (g.isOver) {
    out +=
      `<rect x="${BX}" y="${BY}" width="${4 * CELL + 5 * GAP}" height="${4 * CELL + 5 * GAP}" rx="8" fill="${C.bg}" opacity="0">` +
      `<animate attributeName="opacity" from="0" to="0.8" begin="0.3s" dur="0.4s" fill="freeze"/></rect>` +
      text(180, BY + 150, 'ゲームオーバー', 28, C.red, 'text-anchor="middle" font-weight="bold"') +
      text(180, BY + 182, `スコア ${g.score}`, 16, C.text, 'text-anchor="middle"')
  }
  const foot = g.hasWon ? '2048 達成。このまま続けられます' : `${g.moves} 手 / 同じ数を合わせて 2048 へ`
  out += text(180, by + 22, foot, 13, g.hasWon ? '#e3b341' : C.dim, 'text-anchor="middle"')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 ${by + 32}"><rect width="360" height="${by + 32}" fill="${C.bg}"/>${out}</svg>`
}

/** terminal 用の盤の行。1 マス 5 桁で 20 桁 */
export function board2048Rows(g: Game2048): { cells: { text: string; color: string }[] }[] {
  return [0, 1, 2, 3].map(r => ({
    cells: [0, 1, 2, 3].map(c => {
      const v = g.board[r * 4 + c] ?? 0
      return { text: (v === 0 ? '.' : String(v)).padStart(4) + ' ', color: v === 0 ? C.dim : v <= 4 ? C.text : tileColor(v).fill }
    }),
  }))
}

export function lines2048(g: Game2048, stats: GameStats): string[] {
  const head = `スコア ${g.score} / 最高 ${Math.max(stats.best2048, g.score)}`
  const foot = g.isOver ? 'ゲームオーバー' : g.hasWon ? '2048 達成。このまま続けられます' : `${g.moves} 手`
  return [head, foot]
}

// ---- マインスイーパー ----

/** 盤の上の 1 行 (残りの地雷・状態・記録) */
export function minesHead(s: Mines, stats: GameStats): { left: string; state: string; record: string; color: string } {
  const left = `地雷 ${minesLeft(s)} / ${MINE_COUNT}`
  const record = `勝ち ${stats.winsMines} 回` + (stats.fastestMines > 0 ? ` / 最速 ${secs(stats.fastestMines)}` : '')
  if (s.status === 'won') return { left, state: `クリア ${secs(s.endedAt - s.startedAt)}`, record, color: C.green }
  if (s.status === 'lost') return { left, state: '地雷を踏みました', record, color: C.red }
  if (s.status === 'play') return { left, state: 'プレイ中', record, color: C.blue }
  return { left, state: '初手は安全です', record, color: C.dim }
}

export function minesSvg(s: Mines, stats: GameStats): string {
  const h = minesHead(s, stats)
  let out = `<rect x="4" y="4" width="352" height="64" rx="8" fill="${C.face}" stroke="${h.color}" stroke-width="2"/>`
  // 勝ち負けの時だけ枠を光らせる
  if (s.status === 'won' || s.status === 'lost')
    out += `<rect x="4" y="4" width="352" height="64" rx="8" fill="${h.color}" opacity="0"><animate attributeName="opacity" values="0;0.35;0" dur="0.9s" repeatCount="2"/></rect>`
  out += text(18, 30, h.left, 14, C.text)
  out += text(342, 30, h.state, 14, h.color, 'text-anchor="end" font-weight="bold"')
  out += text(18, 54, h.record, 12, C.dim)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 72"><rect width="360" height="72" fill="${C.bg}"/>${out}</svg>`
}

// ---- 押して解くゲーム (15 パズル・ライツアウト・数独・神経衰弱) ----

/** 盤の上の見出しの中身 (terminal でも同じ言葉を使う) */
export type Head = { left: string; state: string; record: string; color: string }

export function recordLine(r: PuzzleRecord): string {
  return `勝ち ${r.wins} 回` + (r.bestMoves > 0 ? ` / 最短 ${r.bestMoves} 手` : '') + (r.fastest > 0 ? ` / 最速 ${secs(r.fastest)}` : '')
}

/** 解いた・まだ動かしていない (遊び方の一言)・遊んでいる の 3 つ */
export function puzzleHead(g: Puzzle, r: PuzzleRecord, left: string, hint: string): Head {
  const record = recordLine(r)
  if (g.status === 'won') return { left, state: `クリア ${secs(g.endedAt - g.startedAt)} / ${g.moves} 手`, record, color: C.green }
  if (g.moves === 0) return { left, state: hint, record, color: C.dim }
  return { left, state: `${g.moves} 手`, record, color: C.blue }
}

export const fifteenHead = (g: Fifteen, s: GameStats) =>
  puzzleHead(g, recordOf(s, 'fifteen'), `正しい位置 ${g.tiles.filter((v, i) => v !== 0 && v === SOLVED[i]).length} / 15`, '空きの隣を押して 1 から順に並べる')

export const lightsHead = (g: Lights, s: GameStats) => puzzleHead(g, recordOf(s, 'lights'), `点灯 ${litCount(g)} 個`, '押すと十字が切り替わる。全部消す')

export function sudokuHead(g: Sudoku, s: GameStats): Head {
  const h = puzzleHead(g, recordOf(s, g.size === 4 ? 'sudoku4' : 'sudoku9'), `空き ${emptyCount(g)} マス`, 'マスを選び、下の数字で入れる')
  // 埋まったのに解けていない = どこかで重なっている
  return g.status === 'play' && emptyCount(g) === 0 ? { ...h, state: '同じ数字が重なっています', color: C.red } : h
}

export const memoryHead = (g: Memory, s: GameStats) => puzzleHead(g, recordOf(s, 'memory'), `そろった ${pairCount(g)} / 8 組`, '同じ色の名前を 2 枚そろえる')

/** 見出し帯 + 状態と記録の 2 行。解いた時は枠が光る */
export function headSvg(title: string, h: Head, isWon: boolean): string {
  const y = HEADER_H + 6
  let body = header(title, h.left, h.color === C.dim ? C.blue : h.color)
  body += panel(8, y, 364, 50)
  if (isWon) body += `<rect x="8" y="${y}" width="364" height="50" rx="8" fill="${h.color}" opacity="0"><animate attributeName="opacity" values="0;0.35;0" dur="0.9s" repeatCount="2"/></rect>`
  body += text(20, y + 21, h.state, 14, h.color, h.color === C.dim ? '' : 'font-weight="bold"')
  body += text(20, y + 40, h.record, 12, C.dim)
  return frame(y + 58, body)
}

export const fifteenSvg = (g: Fifteen, s: GameStats) => headSvg('15 パズル', fifteenHead(g, s), g.status === 'won')
export const lightsSvg = (g: Lights, s: GameStats) => headSvg('ライツアウト', lightsHead(g, s), g.status === 'won')
export const sudokuSvg = (g: Sudoku, s: GameStats) => headSvg(`数独 ${g.size}x${g.size}`, sudokuHead(g, s), g.status === 'won')
export const memorySvg = (g: Memory, s: GameStats) => headSvg('神経衰弱', memoryHead(g, s), g.status === 'won')
