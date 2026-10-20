/** ツール呼び出し 1 回の区間 */
export type TimelineTool = {
  /** tool_use_id。終わりを書き込む時に引く */
  id: string
  tool: string
  /** 始まった時刻 (ms) */
  start: number
  /** 終わった時刻 (ms)。無ければ実行中 */
  end?: number
  isError: boolean
  /** サブエージェントの呼び出し */
  isSub: boolean
}

/** メインループのターン 1 回 = 1 行 */
export type TimelineTurn = {
  turnId: string
  /** 始まった時刻 (ms) */
  start: number
  /** 終わった時刻 (ms)。無ければ実行中 */
  end?: number
  /** 依頼の先頭 (制御文字は落としてある) */
  label: string
  /** 古い順。上限を超えた分は捨てる */
  tools: TimelineTool[]
  /** turn.complete の reason。'answer' の物だけターン数に数える */
  reason?: 'answer' | 'aborted' | 'refusal' | 'error'
}

declare module 'claude-code' {
  interface PluginState {
    'session-timeline': {
      /** 古い順。直近 100 ターン */
      turns: TimelineTurn[]
    }
  }
}
