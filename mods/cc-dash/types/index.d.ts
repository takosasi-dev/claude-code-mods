export type CcDashTab = 'overview' | 'tools' | 'usage'

/** ツール呼び出し 1 回の記録。end が無いものは実行中 */
export type CcDashCall = { id: string; tool: string; start: number; end?: number; isError: boolean }

declare module 'claude-code' {
  interface PluginState {
    'cc-dash': {
      tab: CcDashTab
      /** 計測を始めた時刻 (ms)。0 は未設定 */
      startedAt: number
      turnCount: number
      /** 直近 20 ターンの所要時間 (ms)、古い順 */
      turnDurations: number[]
      /** メインループのターンが走っていれば開始時刻、無ければ null */
      runningSince: number | null
      /** 直近 200 回の呼び出し、古い順 */
      calls: CcDashCall[]
      /** ツール名ごとの通算回数 */
      toolCounts: Record<string, number>
      toolTotal: number
      errorCount: number
    }
  }
}
