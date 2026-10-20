/** メインループのターン 1 回の記録 */
export type RecapTurn = {
  turnId: string
  /** 始まった時刻 (ms) */
  start: number
  /** 終わった時刻 (ms)。無ければ実行中 */
  end?: number
  /** 一覧に出す名前: 依頼の先頭 60 字、スラッシュコマンドは「/名前」 */
  label: string
  /** 依頼の先頭 300 字 (コマンドは「/名前 引数」) */
  prompt: string
  /** ツール名ごとの回数 */
  tools: Record<string, number>
  /** 失敗したツール呼び出しの回数 */
  errors: number
  /** turn.complete の reason */
  reason?: 'answer' | 'aborted' | 'refusal' | 'error'
}

export type RecapSummary = {
  status: 'idle' | 'running' | 'done' | 'failed'
  /** done: 要約の Markdown / failed: 理由 */
  text: string
  /** 何についての要約か (「ここまで」「10:42 のターンまで」) */
  scope: string
  /** 押した時刻 (ms) */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-recap': {
      /** 直近 100 ターン、古い順 */
      turns: RecapTurn[]
      /** 計測を始めた時刻 (ms)。0 は未設定 */
      startedAt: number
      /** prompt.submit で見たスラッシュコマンド。次の turn.start で使って消す */
      pending: { name: string; args: string; at: number } | null
      /** 詳細を開いているターンの turnId */
      selected: string | null
      summary: RecapSummary
      /** 「入力欄に入れる」の結果の一言 */
      notice: string
      /** 登録できたコマンド名 ('recap' か 'session-recap')。'' は未登録 */
      command: string
    }
  }
}
