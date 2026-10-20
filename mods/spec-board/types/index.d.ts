/** 仕様書 1 本 (list --json の 1 件から必要な所だけ) */
export type SpecBoardItem = {
  name: string
  /** 実装完了 / 一部未実装 / 着手済 など */
  state: string
  /** 確認待ち / 実物待ち / なし など。無ければ空 */
  waiting: string
  /** メモ (制御文字を落とした物) */
  note: string
  /** 「Phase 2/3」の形。分からなければ空 */
  phase: string
}

/** next の 1 行 */
export type SpecBoardNext = { score: number; name: string; state: string; reasons: string }

export type SpecBoardSnap =
  | { kind: 'idle' }
  /** pythonPath か specstatusScript が空・相対パス */
  | { kind: 'unset' }
  /** コマンドが起動できない・終了コードが 0 でない・JSON が読めない。head は出力の頭 */
  | { kind: 'error'; step: string; message: string; head: string }
  | {
      kind: 'ok'
      waiting: SpecBoardItem[]
      progress: SpecBoardItem[]
      next: SpecBoardNext[]
      loadedAt: number
      /** 標準エラーの 1 行目 (GitHub の回数の上限など)。無ければ空 */
      notice: string
    }

export type SpecBoardDetail =
  | { kind: 'none' }
  | { kind: 'loading'; name: string }
  | { kind: 'ok'; name: string; text: string }
  | { kind: 'error'; name: string; message: string; head: string }

declare module 'claude-code' {
  interface PluginState {
    'spec-board': {
      snap: SpecBoardSnap
      isLoading: boolean
      detail: SpecBoardDetail
    }
  }
}
