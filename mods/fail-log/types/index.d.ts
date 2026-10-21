/** 失敗 1 回分 */
export type FailEntry = {
  /** 時刻 (ms) */
  at: number
  /** ツールの名前 */
  tool: string
  /** 入力の短い要約。Bash ならコマンドの頭、Edit などならファイル名。無ければ空 */
  input: string
  /** エラーの 1 行目 */
  error: string
  /** 似た失敗をまとめる鍵 (ツール + 正規化したコマンドの頭、ファイルの道具ならファイル名) */
  group: string
  /** サブエージェントの呼び出し */
  isSub: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'fail-log': {
      /** 古い順。新しい 200 件 ($.store の写し) */
      entries: FailEntry[]
      /** 通算の数 (消すまで) */
      total: number
      /** 「消す」を 1 回押して、もう 1 回を待っている */
      confirming: boolean
    }
  }
}
