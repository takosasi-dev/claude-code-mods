/**
 * 見ている約束ごと。english は日本語で答える、question は確認を選択肢で聞く、memo は区切りで引き継ぎメモを書く、
 * log はコミットの後に今日の開発ログを書く、logLine は開発ログを書いたら返事に「📝 … 開発ログ …」の 1 行を入れる、
 * closing は締めの言葉の時に開発ログを書く
 */
export type RuleKind = 'english' | 'question' | 'memo' | 'log' | 'logLine' | 'closing'

/** 前の返事で外れた約束 1 つ */
export type RuleMiss = {
  rule: RuleKind
  /** 問いの行など。無ければ空 */
  detail: string
}

/** 記録の 1 件。古い順、最大 20 */
export type RuleEvent = RuleMiss & { at: number }

/** コミットの後でメモを待っている間の印。turns はそこから終わったメインのターンの数 */
export type MemoPending = { since: number; turns: number }

/** 開発ログの見張り */
export type LogWatch = {
  /** コミットの後で今日の開発ログを待っている間の印 */
  pending: MemoPending | null
  /** このメインのターンに今日の開発ログを書いたか (ターンの頭で false に戻す) */
  isWritten: boolean
  /** このメインのターンの依頼者の入力に締めの言葉があったか */
  isClosing: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'rule-watch': {
      /** 前のメインの返事で外れた約束 (帯に出す) */
      misses: RuleMiss[]
      /** このセッションで外れた数 */
      counts: Record<RuleKind, number>
      history: RuleEvent[]
      /** このターンに AskUserQuestion を呼んだ数 (メインのターンの頭で 0 に戻す) */
      asks: number
      memoPending: MemoPending | null
      log: LogWatch
    }
  }
}
