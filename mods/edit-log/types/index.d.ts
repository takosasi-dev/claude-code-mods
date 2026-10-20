/** ファイルを変えるツールの 1 回分 */
export type EditLogEntry = {
  /** セッションの中での通し番号 (1 から) */
  id: number
  /** 終わった時刻 (ms) */
  at: number
  /** ツールが受け取ったパス (git に渡す) */
  file: string
  /** 画面に出す名前。作業フォルダの中なら相対パス */
  label: string
  /** Edit / Write / MultiEdit / NotebookEdit */
  tool: string
  isError: boolean
  /** 置き換えた (書いた) 行数のおおよそ */
  lines: number
  /** サブエージェントの呼び出し */
  isSub: boolean
}

/** 詳細を開いたファイルの git の差分 */
export type EditLogDetail =
  | { kind: 'loading' }
  | { kind: 'diff'; diff: string; isCut: boolean }
  | { kind: 'clean' }
  | { kind: 'not-repo' }
  | { kind: 'error'; message: string }

declare module 'claude-code' {
  interface PluginState {
    'edit-log': {
      /** 古い順。上限を超えたら古い物から捨てる */
      entries: EditLogEntry[]
      /** 詳細を開いているファイル (EditLogEntry.label)。空なら一覧 */
      selected: string
      detail: EditLogDetail
      /** ボタンの結果などの一言。空なら出さない */
      note: string
    }
  }
}
