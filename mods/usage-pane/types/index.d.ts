// 使用量ファイルの中身(読めた分)
export type UsagePaneData = {
  sessionPct: number
  weeklyPct: number
  sessionResetAt?: unknown
  weeklyResetAt?: unknown
  modelName?: unknown
  modelPct?: unknown
  modelResetAt?: unknown
  fetchedAt?: unknown
}

declare module 'claude-code' {
  interface PluginState {
    'usage-pane': {
      // 最後に読んだ結果。null は読めなかった
      usage: { data: UsagePaneData | null }
    }
  }
}
