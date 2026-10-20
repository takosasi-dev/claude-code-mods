/** トークン数 4 種 (turn.complete の usage を読みやすい名前にした物) */
export type TokenMeterUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** 1 ターン分。n はセッションの中での通し番号 (1 から) */
export type TokenMeterTurn = TokenMeterUsage & { n: number }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': {
      /** メインループの直近 50 ターン、古い順 */
      turns: TokenMeterTurn[]
      /** メインループのセッション合計 */
      total: TokenMeterUsage
      /** サブエージェント (agentId 付きのターン) の合計と回数。メインとは別に数える */
      sub: TokenMeterUsage & { runs: number }
      /** メインループのターン数 (通し番号の元) */
      count: number
      /** 4 種の和が一番大きかったメインループのターン */
      heaviest: TokenMeterTurn | null
    }
  }
}
