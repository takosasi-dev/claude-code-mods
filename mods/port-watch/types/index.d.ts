/** 待ち受けている 1 本。同じポートと PID の v4・v6 は 1 本にまとめる */
export type PortWatchRow = { port: number; pid: number; name: string }

export type PortWatchList =
  | { kind: 'idle' }
  | { kind: 'ok'; rows: PortWatchRow[] }
  /** 一覧のコマンドが無い・失敗した */
  | { kind: 'error'; message: string }

declare module 'claude-code' {
  interface PluginState {
    'port-watch': {
      list: PortWatchList
      /** セッションの始めに待ち受けていた物の "ポート/PID"。まだ読めていなければ null */
      baseline: string[] | null
      /** 「止める」を 1 回押した行。もう一度押すと止める */
      armed: { port: number; pid: number; at: number } | null
      /** 開発用と増えた物だけを出す */
      isNarrow: boolean
      /** ボタンの結果などの一言。空なら出さない */
      note: string
    }
  }
}
