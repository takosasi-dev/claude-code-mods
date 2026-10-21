// toast-inbox の $.state の契約

/** 拾った通知 1 件 */
export type InboxItem = {
  /** 出した mod の名前(@ より前)。本体なら 'engine' */
  plugin: string
  /** 制御文字を落とした本文 */
  text: string
  /** 拾った時刻($.clock.now() のミリ秒) */
  at: number
  kind: 'toast' | 'status'
}

declare module 'claude-code' {
  interface PluginState {
    'toast-inbox': {
      /** 古い順、最大 100 件。$.store の 'items' にも残す */
      items: InboxItem[]
      /** この時刻より後の通知が未読。$.store の 'readAt' にも残す */
      readAt: number
      /** 絞り込む mod の名前(空ならすべて) */
      filter: string
      /** 「空にする」を 1 回押した後 */
      confirmClear: boolean
      /** mod の名前 → 行を押した時に開くコマンド(スラッシュ無し)。ペインを開く時に $.command.list() から引き直す */
      commands: Record<string, string>
      /** 行を押した結果の一言。空なら出さない */
      notice: string
    }
  }
}
