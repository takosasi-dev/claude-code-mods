// live-commentary の $.state の契約

/** 実況 1 行の種類。ログの色分けに使う (error は赤) */
export type LiveCommentaryKind = 'play' | 'error' | 'cheer' | 'whistle'

export type LiveCommentaryLine = {
  /** 言った時刻 (ms) */
  at: number
  text: string
  kind: LiveCommentaryKind
}

/** スコアボード (セッションの間の数) */
export type LiveCommentaryScore = {
  ok: number
  err: number
  /** 今の連続成功 */
  streak: number
}

/** 今のターンの時計 */
export type LiveCommentaryClock = {
  /** 主ループのターンが始まった時刻。走っていなければ 0 */
  startedAt: number
  /** 今の時刻 (ターン中だけ 1 秒ごとに進める) */
  now: number
  /** 前のターンの長さ (ms)。まだなら 0 */
  lastMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'live-commentary': {
      /** 直近 100 行 (新しい順)。先頭が最新の実況 */
      log: LiveCommentaryLine[]
      score: LiveCommentaryScore
      clock: LiveCommentaryClock
      /** 実況オン ($.store にも残す) */
      isOn: boolean
    }
  }
}
