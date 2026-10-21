export type AquaPeriod = '朝' | '昼' | '夕' | '夜'
export type AquaSeason = '春' | '夏' | '秋' | '冬'

// 時刻から決まる「段」。60 秒ごとに計算し、変わった時だけ書く(描き直しを減らす。時刻は 15 分刻み)
export type AquaView = {
  period: AquaPeriod
  season: AquaSeason
  /** 日本時間の 15 分刻みの番号 0-95。水の色の段階に使う (15 分ごとに描き直す) */
  slot: number
  /** 満腹度 0-100、5 刻み */
  fullness: number
  /** 待機が 10 分を超えた */
  isIdle: boolean
  isUpset: boolean
  isFeeding: boolean
  /** 育てた日数 (1 日目から) */
  days: number
}

/** この版の知っている魚の種類。並びは珍しさの順 (後ろほど珍しい) */
export type KnownFishKind = 'maru' | 'shima' | 'mizutama' | 'hirenaga' | 'ougi' | 'akari' | 'hoshi' | 'tsuno' | 'niji' | 'ryugu'
/** 魚の種類。新しい版が足した種類 (この版の知らない文字列) も消さずに持ち回る */
export type FishKind = KnownFishKind | (string & {})
/** 育ちの段階 */
export type FishStage = '稚魚' | '若魚' | '成魚' | '大物'

/** 水槽の魚 1 匹 ($.store に残す) */
export type AquaFish = {
  /** 来た順の番号 (0 から) */
  id: number
  kind: FishKind
  /** 来た時刻 (ms) */
  bornAt: number
  /** 来てから数えたターン */
  turnsSeen: number
  name?: string
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
  /** 魚。空なら turns から決まる数を描く (古い記録・見本の絵) */
  fish: AquaFish[]
  // セッションの間だけの値
  isRunning: boolean
  lastActiveAt: number
  upsetUntil: number
  feedUntil: number
  isNaming: boolean
  /** 魚の一覧を出している */
  isListing: boolean
  view: AquaView
}

declare module 'claude-code' {
  interface PluginState {
    'aqua-pet': { tank: AquaTank }
  }
}
