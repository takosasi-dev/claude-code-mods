// code-omikuji の $.state の契約

export type OmikujiRank = '大吉' | '中吉' | '小吉' | '吉' | '末吉' | '凶' | '大凶'

/** 1 回分の運勢。date は JST の `YYYY-MM-DD` */
export type OmikujiResult = {
  date: string
  /** 第 N 番 (1〜100) */
  number: number
  rank: OmikujiRank
  /** 総合の一言 */
  words: string
  language: string
  command: string
  bug: string
  review: string
  lost: string
  warning: string
  commit: string
}

/** 直近の日の運勢 (store に残す) */
export type OmikujiDay = { date: string; rank: OmikujiRank }

declare module 'claude-code' {
  interface PluginState {
    'code-omikuji': {
      /** 今日の本番の結果 (store の写し)。開くまでは null */
      today: OmikujiResult | null
      /** 遊びの一回の結果。null なら本番を見せる */
      play: OmikujiResult | null
      /** 遊びで振った回数 (乱数の種に混ぜる) */
      plays: number
      /** 直近の日の運勢 (store の写し、古い順) */
      history: OmikujiDay[]
      /** shake は筒を振るアニメから、paper は開いた紙だけ */
      mode: 'shake' | 'paper'
      /** このセッションで一度開いたか */
      isOpened: boolean
      /** ボタンの結果などの一言。空なら出さない */
      note: string
    }
  }
}
