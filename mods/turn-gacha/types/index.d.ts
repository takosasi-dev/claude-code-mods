export type GachaRarity = 'N' | 'R' | 'SR' | 'SSR'

/** 1 回引いた結果 */
export type GachaDraw = {
  cardId: string
  /** 引いた時刻 (ms) */
  at: number
  /** 初めて引いたカード */
  isNew: boolean
  /** そのターンのエラーが 0 で、SR 以上が出やすくなっていた */
  isClean: boolean
  /** ボタンで引いた */
  isManual: boolean
}

/** 図鑑の 1 種類分 */
export type GachaOwned = { count: number; firstAt: number }

/** $.store に残す物 (state にも同じ物を写す) */
export type GachaSave = {
  /** カードの id ごとの所持数と初めて引いた日時 */
  book: Record<string, GachaOwned>
  /** 累計で引いた回数 */
  total: number
  /** 手動で引いた日 (YYYY-MM-DD) と、その日に引いた回数 */
  manualDay: string
  manualUsed: number
  /** 新しい順、最大 10 */
  history: GachaDraw[]
}

declare module 'claude-code' {
  interface PluginState {
    'turn-gacha': {
      save: GachaSave
      /** カードを大きく出すか、図鑑の一覧か */
      view: 'card' | 'book'
      /** ボタンの結果などの一言。空なら出さない */
      note: string
      /** 今のメインのターンで失敗したツールの数 */
      turnErrors: number
    }
  }
}
