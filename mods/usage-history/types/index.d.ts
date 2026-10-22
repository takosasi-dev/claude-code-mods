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

/** 直近 7 日の 1 日分(他の mod が読む形。week-card など) */
export type HistoryWeekDay = {
  /** 日本時間の 'YYYY-MM-DD' */
  day: string
  /** メインのターン数 */
  turns: number
  /** ツールの回数(サブエージェントの分も含む) */
  tools: number
  /** 入力・出力トークン(メインとサブエージェントの合計) */
  inputTokens: number
  outputTokens: number
  /** メインのターンの所要時間の合計(分、四捨五入) */
  minutes: number
}

/** 「控えから戻す」の欄。days が null なら閉じている。days は控えのある日 (新しい順)、pick は確かめ中の日 */
export type HistoryRestore = { days: string[] | null; pick: string | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-history': {
      /** 最大 400 日。$.store の 'days' にも残す */
      days: Days
      /** 曜日(月=0)×時刻(0-23 時)のメインのターン数、長さ 168。$.store の 'heat' にも残す */
      heat: number[]
      /**
       * 今日で終わる直近 7 日(古い順、7 要素。記録の無い日は 0)。他の mod が読んでよい(書くのは usage-history)。
       * セッションの始まりとメインのターンの終わりに置き換わる。usage-history が入っていない・読み込む前は undefined
       */
      week: HistoryWeekDay[]
      range: HistoryRange
      metric: HistoryMetric
      restore: HistoryRestore
      /** ボタンの結果などの一言。空なら出さない */
      note: string
    }
  }
}
