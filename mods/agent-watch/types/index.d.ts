/** $.agent.list() の status と同じ言葉 */
export type AgentWatchStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** 1 体分の記録。$.agent.list() とイベント (tool.call / turn.start / turn.complete) を合わせた物 */
export type AgentWatchRecord = {
  id: string
  /** 種類 (general-purpose, Explore ...)。制御文字は落としてある。一覧が名前を言うまでは空 */
  type: string
  /** Agent 呼び出しの description。制御文字は落としてある */
  description: string
  status: AgentWatchStatus
  /** $.agent.list() に一度でも出たか。出ない物 (エンジンの内部の fork など) は描かない */
  isListed: boolean
  /** 最初に見た時刻 (ms) */
  startedAt: number
  /** 終わった時刻 (ms)。動いている間は無し */
  endedAt?: number
  /** turn.complete の durationMs の合計 */
  durationMs: number
  tools: number
  /** 最後に呼んだツール。まだ無ければ空 */
  lastTool: string
  /** ツールがエラーを返した回数 (deny と中断は数えない) */
  errors: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-watch': {
      /** id ごとの記録 */
      agents: Record<string, AgentWatchRecord>
      /** 経過時間を描き直すための時刻。ペインが開いていて動いている物がある間、2 秒ごとに書く */
      now: number
      /** 終わった物を隠すか */
      hideDone: boolean
      /** ボタンの結果の一言。空なら出さない */
      note: string
    }
  }
}
