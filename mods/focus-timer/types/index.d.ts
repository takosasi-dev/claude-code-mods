export type FocusTimerMode = 'focus' | 'break'

/**
 * 走っている (または一時停止中の) 1 区切り。
 * endsAt があれば走っている、null なら一時停止中で残りは leftMs
 */
export type FocusTimerRun = { mode: FocusTimerMode; totalMs: number; endsAt: number | null; leftMs: number }

declare module 'claude-code' {
  interface PluginState {
    'focus-timer': {
      /** null は待機 */
      run: FocusTimerRun | null
      /** ローカル日付 (YYYY-MM-DD) ごとの完了本数。$.store の 'done' にも写す */
      done: Record<string, number>
    }
  }
}
