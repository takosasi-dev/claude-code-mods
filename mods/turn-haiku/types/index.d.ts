/** 1 句。id はターンの id (詠み直すと同じ id で置き換わる) */
export type HaikuPoem = { id: string; at: number; text: string }

/** 詠む材料: 1 ターンでしたこと */
export type HaikuTurn = {
  turnId: string
  /** ツールの名前と回数 (多い順) */
  tools: [string, number][]
  /** 触ったファイルの名前 (パスの最後の部分だけ) */
  files: string[]
  /** 最後の答えの頭 300 字 */
  answerHead: string
  durationMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'turn-haiku': {
      /** 古い順、最大 50 */
      poems: HaikuPoem[]
      /** 「自動で詠む」。既定オン */
      isAuto: boolean
      /** 詠んでいる最中 */
      isComposing: boolean
      /** 最後に答えて終わったメインのターンの材料 (詠み直す用) */
      lastTurn: HaikuTurn | null
      /** ペインの下に弱い文字で出す一言。空なら出さない */
      note: string
    }
  }
}
