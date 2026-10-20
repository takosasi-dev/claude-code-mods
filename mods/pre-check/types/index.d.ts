/** 変わったファイル 1 つ。行数はステージ済みとまだの合計 */
export type PreCheckFile = { path: string; add: number; del: number; isStaged: boolean; isUnstaged: boolean; isBinary: boolean }

/** 足した行で見つけた物 (秘密情報らしい文字列・衝突の印)。text は表示してよい形 (秘密は伏せてある) */
export type PreCheckHit = { path: string; line: number; kind: string; text: string; isStaged: boolean }

export type PreCheckLarge = { path: string; size: number }

export type PreCheckReport =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-repo' }
  /** git が所有者の確認 (dubious ownership) で止めた */
  | { kind: 'unsafe' }
  | { kind: 'error'; message: string }
  | {
      kind: 'repo'
      loadedAt: number
      files: PreCheckFile[]
      /** 追跡していないファイル (先頭 200 まで) と数 */
      untracked: string[]
      untrackedCount: number
      secrets: PreCheckHit[]
      conflicts: PreCheckHit[]
      large: PreCheckLarge[]
      /** 差分が長すぎて一部しか見ていない */
      isCut: boolean
    }

export type PreCheckTest =
  | { kind: 'idle' }
  | { kind: 'running'; command: string; startedAt: number }
  | { kind: 'done'; status: 'pass' | 'fail' | 'timeout'; command: string; exitCode: number | null; ms: number; tail: string }
  /** 起動できなかった */
  | { kind: 'error'; command: string; message: string }

declare module 'claude-code' {
  interface PluginState {
    'pre-check': {
      report: PreCheckReport
      test: PreCheckTest
      /** 中身を開いている項目の id。空なら閉じている */
      open: string
    }
  }
}
