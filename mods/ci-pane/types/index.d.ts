/** 丸の色の種類: 通った / 落ちた / 走っている / 飛ばした・取り消し・その他 */
export type CiKind = 'pass' | 'fail' | 'run' | 'skip'

/** PR のチェック 1 つ (statusCheckRollup の 1 件) */
export type CiCheck = { name: string; kind: CiKind }

export type CiPr = {
  number: number
  title: string
  /** OPEN / CLOSED / MERGED */
  state: string
  isDraft: boolean
  /** https で始まる時だけ。違えば空 */
  url: string
  /** APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED / 空 */
  review: string
  checks: CiCheck[]
}

/** Actions の実行 1 回 */
export type CiRun = {
  name: string
  kind: CiKind
  /** 成功・失敗・実行中 など */
  label: string
  url: string
  /** 始まった時刻 (ms)。読めなければ 0 */
  createdAt: number
  event: string
}

/** 読めなかった理由。それぞれ別の文を出す */
export type CiProblem = 'no-gh' | 'no-login' | 'not-git' | 'not-github' | 'unsafe' | 'error'

export type CiSnap =
  | { kind: 'idle' }
  | { kind: 'problem'; problem: CiProblem; detail: string }
  | {
      kind: 'ok'
      /** 今のブランチ。HEAD が外れていれば空 */
      branch: string
      pr?: CiPr
      /** PR が無い・読めない時の一言 */
      prNote: string
      runs: CiRun[]
      runsNote: string
      loadedAt: number
    }

declare module 'claude-code' {
  interface PluginState {
    'ci-pane': {
      snap: CiSnap
      isLoading: boolean
    }
  }
}
