/** コンテキストの使用量 ($.session.usage() の context から) */
export type CueContext = {
  /** 使っている割合 (0 から 100)。返事がまだ無ければ無し */
  percent?: number
  tokens?: number
  /** 100% にする所 (自動 compact の位置か、モデルの窓) */
  window: number
  /** window が自動 compact の位置なら true */
  isAutoLimit?: boolean
}

/** 作業の様子。clean は区切り (最後の編集の後に区切りの印があった、または編集していない) */
export type CuePhase = 'clean' | 'mid'

/** 区切りの印 */
export type CueBreak = { kind: 'commit' | 'test' | 'memo'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'compact-cue': {
      context: CueContext | null
      phase: CuePhase
      lastBreak: CueBreak | null
      /** もうトーストを出した段階 (同じ段階では 2 回出さない)。空なら出していない */
      told: string
    }
  }
}
