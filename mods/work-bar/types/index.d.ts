// 実行中のターン(メインループのみ)。待機中は null
export type WorkBarRun = {
  startedAt: number
  elapsed: number // 秒
  calls: number
  errors: number
  active: string[] // 今動いているツール(並列ぶん)
  lastError: boolean
}

// 前のターンの要約
export type WorkBarLast = { seconds: number; calls: number; errors: number }

declare module 'claude-code' {
  interface PluginState {
    'work-bar': {
      run: WorkBarRun | null
      last: WorkBarLast | null
      isHidden: boolean
      pick: string // Select 表示のときに選んでいる定型の番号
    }
  }
}
