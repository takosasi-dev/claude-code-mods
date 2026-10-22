export type TestRunnerStatus = 'pass' | 'fail' | 'stopped' | 'timeout'

/** 1 回分の結果 */
export type TestRunnerResult = {
  status: TestRunnerStatus
  command: string
  /** 止めた・時間切れなら null */
  exitCode: number | null
  ms: number
  finishedAt: number
  /** 出力 (標準出力と標準エラーを来た順に) の末尾 60 行 */
  tail: string
  /** 出力から拾えた数。拾えなければ無し */
  passed?: number
  failed?: number
  /** claude なら Claude が Bash / PowerShell で走らせた物を拾った結果。無ければボタン */
  source?: 'claude'
}

export type TestRunnerRun =
  | { kind: 'idle' }
  | { kind: 'running'; command: string; startedAt: number }
  | { kind: 'done'; result: TestRunnerResult }
  /** コマンドを起動できなかった */
  | { kind: 'error'; command: string; message: string }

/** 履歴の 1 点。古い順、最大 20 */
export type TestRunnerMark = { status: TestRunnerStatus; ms: number }

declare module 'claude-code' {
  interface PluginState {
    'test-runner': {
      run: TestRunnerRun
      history: TestRunnerMark[]
      /** ボタンの結果などの一言。空なら出さない */
      note: string
    }
  }
}
