/** 見張りの結果。confirmed は直前の確認で通した、asked-yes / asked-no はその場で聞いた、no-ask は聞けなかった */
export type GuardOutcome = 'confirmed' | 'asked-yes' | 'asked-no' | 'no-ask'

/** 記録の 1 件。古い順、最大 20 */
export type GuardEntry = {
  at: number
  /** git push など */
  label: string
  /** コマンドの頭 200 字 */
  command: string
  outcome: GuardOutcome
}

/** 公開してよいという確認。turn のターンと、その次のターンまで効く */
export type GuardPermit = { turn: number; at: number; about: string }

declare module 'claude-code' {
  interface PluginState {
    'ship-guard': {
      isOff: boolean
      log: GuardEntry[]
      permit: GuardPermit | null
      /** メインのターンの数 */
      turn: number
    }
  }
}
