/** 見張る物の組。window は窓のあるアプリの起動、sound は音、headless は隔離なしの claude -p */
export type RunGroup = 'window' | 'sound' | 'headless'

/** blocked は止めた (聞けなかった時も)、asked-yes / asked-no は聞いて通した / 止めた、told は実行の後で Claude に伝えた */
export type RunAction = 'blocked' | 'asked-yes' | 'asked-no' | 'told'

/** 記録の 1 件。古い順、最大 50 */
export type RunEntry = {
  at: number
  /** 見つけた組 (1 つ以上) */
  groups: RunGroup[]
  /** コマンドの頭 80 字 */
  command: string
  action: RunAction
}

/** $.store の 'save' の形 (知らない欄は残して書く) */
export type RunSaved = {
  /** true の組は見張らない */
  off: Record<RunGroup, boolean>
  /** 組ごとの見つけた数 (ずっと足していく) */
  counts: Record<RunGroup, number>
  log: RunEntry[]
}

declare module 'claude-code' {
  interface PluginState {
    'run-guard': {
      /** store の 'save' を読んだ物 */
      saved: RunSaved
    }
  }
}
