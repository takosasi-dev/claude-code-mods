export type AquaPeriod = '朝' | '昼' | '夕' | '夜'

// 時刻から決まる「段」。60 秒ごとに計算し、変わった時だけ書く(描き直しを減らす)
export type AquaView = {
  period: AquaPeriod
  /** 満腹度 0-100、5 刻み */
  fullness: number
  /** 待機が 10 分を超えた */
  isIdle: boolean
  isUpset: boolean
  isFeeding: boolean
  /** 育てた日数 (1 日目から) */
  days: number
}

export type AquaTank = {
  // $.store に残す値
  turns: number
  bornAt: number
  /** fedAt 時点の満腹度 */
  fullness: number
  fedAt: number
  /** 水の濁り 0-10 (エラーで増え、掃除で 0) */
  murk: number
  name: string
  // セッションの間だけの値
  isRunning: boolean
  lastActiveAt: number
  upsetUntil: number
  feedUntil: number
  isNaming: boolean
  view: AquaView
}

declare module 'claude-code' {
  interface PluginState {
    'aqua-pet': { tank: AquaTank }
  }
}
