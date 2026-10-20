// usage-history の $.state の契約

/** 1 日分(日本時間の日付ごと)の足し上げ */
export type DayRec = {
  /** メインのターン数(reason が answer で agentId が無い物) */
  turns: number
  /** tool.call の数(サブエージェントの分も含む) */
  tools: number
  /** 以下 4 つはメインとサブエージェントの合計 */
  inputTokens: number
  outputTokens: number
  cacheRead: number
  /** メインのターンの所要時間の合計 */
  durationMs: number
  /** サブエージェントのターン数 */
  subTurns: number
}

/** 'YYYY-MM-DD'(日本時間) → その日の記録 */
export type Days = Record<string, DayRec>

export type HistoryRange = 7 | 30
export type HistoryMetric = 'turns' | 'output'

declare module 'claude-code' {
  interface PluginState {
    'usage-history': {
      /** 最大 400 日。$.store の 'days' にも残す */
      days: Days
      /** 曜日(月=0)×時刻(0-23 時)のメインのターン数、長さ 168。$.store の 'heat' にも残す */
      heat: number[]
      range: HistoryRange
      metric: HistoryMetric
    }
  }
}
