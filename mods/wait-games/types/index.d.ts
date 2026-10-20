export type GameKind = '2048' | 'mines' | 'fifteen' | 'lights' | 'sudoku' | 'memory'

export type Dir = 'up' | 'down' | 'left' | 'right'

/** 1 枚のタイルの動き (盤の位置 0〜15)。アニメにだけ使う */
export type Slide = { from: number; to: number; value: number }

/** 2048 の盤。board は左上から横に 16 マス、0 は空き */
export type Game2048 = {
  board: number[]
  score: number
  /** 動かした手の数 */
  moves: number
  /** この盤で 2048 を作った (勝ちは 1 回だけ数える) */
  hasWon: boolean
  /** もう動かせない */
  isOver: boolean
  /** 直前の手の動き。新しいゲームの直後は空 */
  slides: Slide[]
  /** 直前の手で合わさってできたタイルの位置 */
  merged: number[]
  /** 直前の手で出た新しいタイルの位置 (出ていなければ空) */
  spawned: number[]
}

export type MinesStatus = 'ready' | 'play' | 'won' | 'lost'

/** マインスイーパーの盤。8×8 を左上から横に 64 マス */
export type Mines = {
  /** 地雷の位置。初手までは null (初手のまわりを避けて置く) */
  mines: boolean[] | null
  open: boolean[]
  flag: boolean[]
  status: MinesStatus
  /** 踏んだ地雷の位置。踏んでいなければ -1 */
  boom: number
  /** 初手の時刻と終わった時刻 (ms)。0 はまだ */
  startedAt: number
  endedAt: number
}

/** 押して解くゲーム (15 パズル・ライツアウト・数独・神経衰弱) に共通の欄 */
export type Puzzle = {
  /** 手の数 */
  moves: number
  /** 初手の時刻と解いた時刻 (ms)。0 はまだ */
  startedAt: number
  endedAt: number
  status: 'play' | 'won'
}

/** 15 パズル。tiles は 4×4 を左上から横に 16 マス、0 は空き */
export type Fifteen = Puzzle & { tiles: number[] }

/** ライツアウト。5×5 の点いているマス */
export type Lights = Puzzle & { on: boolean[] }

export type SudokuSize = 4 | 9

/** 数独。cells は size×size、0 は空き */
export type Sudoku = Puzzle & {
  size: SudokuSize
  /** 初めからある数字 (書き換えられない) */
  givens: boolean[]
  cells: number[]
  solution: number[]
  /** 選んでいるマス。-1 は無し */
  selected: number
}

/** 神経衰弱。cards は 4×4 の絵柄の番号 (同じ番号が 2 枚ずつ) */
export type Memory = Puzzle & {
  cards: number[]
  /** そろった札 */
  done: boolean[]
  /** 表にしている、まだそろっていない札 (0〜2 枚) */
  up: number[]
}

/** 記録を分ける単位 (数独は大きさ別) */
export type RecordKind = 'fifteen' | 'lights' | 'sudoku4' | 'sudoku9' | 'memory'

/** 1 つのゲームの記録。最短・最速の 0 はまだ */
export type PuzzleRecord = { wins: number; bestMoves: number; fastest: number }

/** $.store に残す記録 */
export type GameStats = {
  best2048: number
  /** 2048 を作った回数 */
  wins2048: number
  winsMines: number
  /** マインスイーパーの一番速い勝ち (ms)。0 はまだ */
  fastestMines: number
  /** 押して解くゲームの記録。遊んだ物だけ (0.1.x の記録には無い) */
  puzzles?: Partial<Record<RecordKind, PuzzleRecord>>
}

declare module 'claude-code' {
  interface PluginState {
    'wait-games': {
      game: GameKind
      g2048: Game2048
      mines: Mines
      /** 押したマスに旗を立てる */
      flagMode: boolean
      fifteen: Fifteen
      lights: Lights
      sudoku: Sudoku
      memory: Memory
      stats: GameStats
      /** このターンの間にゲームを触った (ターンが終わった知らせを出すか) */
      isPlaying: boolean
      /** 「ターンが終わりました」の帯。空なら出さない */
      turnNote: string
      /** 記録の読み書きの知らせ。空なら出さない */
      note: string
    }
  }
}
