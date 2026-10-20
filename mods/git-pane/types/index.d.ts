/** 変更のあるファイル 1 つ。行数は未ステージとステージ済みの合計 */
export type GitPaneFile = {
  path: string
  add: number
  del: number
  isStaged: boolean
  isUnstaged: boolean
  isUntracked: boolean
  isBinary: boolean
}

export type GitPaneCommit = { hash: string; subject: string; /** コミット時刻 (ms) */ time: number }

export type GitPaneSnapshot =
  | { kind: 'idle' }
  | { kind: 'not-repo'; cwd: string }
  /** git が所有者の確認 (safe.directory) で止めた */
  | { kind: 'unsafe'; cwd: string }
  | { kind: 'error'; cwd: string; message: string }
  | {
      kind: 'repo'
      cwd: string
      branch: string
      upstream: string
      ahead: number
      behind: number
      /** 行数の多い順 */
      files: GitPaneFile[]
      commits: GitPaneCommit[]
      loadedAt: number
    }

declare module 'claude-code' {
  interface PluginState {
    'git-pane': {
      snap: GitPaneSnapshot
      /** ボタンの結果などの一言。空なら出さない */
      note: string
    }
  }
}
