export type GameKind = '2048' | 'mines'

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

/** $.store に残す記録 */
export type GameStats = {
  best2048: number
  /** 2048 を作った回数 */
  wins2048: number
  winsMines: number
  /** マインスイーパーの一番速い勝ち (ms)。0 はまだ */
  fastestMines: number
}

declare module 'claude-code' {
  interface PluginState {
    'wait-games': {
      game: GameKind
      g2048: Game2048
      mines: Mines
      /** 押したマスに旗を立てる */
      flagMode: boolean
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
