/** 装備の枠: 武器・防具・お守り */
export type RpgSlot = 'weapon' | 'armor' | 'charm'

/**
 * turn-gacha のカード 1 種類。turn-gacha の契約 (types/index.d.ts の GachaCard) の写し。
 * plugin.json の dependencies は使わない (dev-rpg は turn-gacha が無くても動く)。読んだ値は rpg.ts の gachaCards で確かめる
 */
export type RpgGachaCard = {
  id: string
  rarity: 'N' | 'R' | 'SR' | 'SSR'
  slot: RpgSlot
  name: string
}

/** 装備しているカード (枠ごと)。名前とレア度は装備した時の写し */
export type RpgEquip = Partial<Record<RpgSlot, RpgGachaCard>>

/** セッションをまたいで $.store に残す値 */
export type RpgSaved = {
  /** 累計の経験値 (レベルはここから計算する) */
  xp: number
  turns: number
  tools: number
  edits: number
  reads: number
  shells: number
  recoveries: number
  errors: number
  /** 冒険 (セッション) の回数 */
  sessions: number
  /** 実績の id → 取った時刻 (ms) */
  achievements: Record<string, number>
  /** 今日の日付 (YYYY-MM-DD) とその日のターン数 */
  day: string
  dayTurns: number
  /** 装備 (0.2.0 から。古い store には無い) */
  equip: RpgEquip
}

/** このセッションの間だけの値 */
export type RpgSession = {
  startedAt: number
  /** 最後に休んだ時刻 (HP はここから減る) */
  restedAt: number
  lastActiveAt: number
  toolOk: number
  toolErr: number
  edits: number
  reads: number
  shells: number
  recoveries: number
  /** 今のターンのツールの数とエラーの数 */
  turnTools: number
  turnErrors: number
  /** 今のターンでエラーが出て、まだ成功していない */
  isErrorPending: boolean
}

export type RpgHero = RpgSaved & {
  s: RpgSession
  /** HP の割合 0-100 (1 分ごとに計算し、変わった時だけ書く) */
  hpPct: number
  /** 経験値バーのアニメの始まり (今のレベルの中の割合 0-1) */
  xpFrom: number
  /** 最後に store と合わせた時の値。保存はここからの差分だけを store に足す (別のセッションの分を消さない) */
  synced: RpgSaved
  /**
   * 画面に出す時だけ置く: equip のうち、今もガチャの図鑑にあるカード。
   * 無ければ (undefined) equip をそのまま使う。store には書かない
   */
  worn?: RpgEquip
}

declare module 'claude-code' {
  interface PluginState {
    'dev-rpg': {
      hero: RpgHero
      tab: 'status' | 'gear' | 'achievements'
      /** 「冒険をやり直す」を 1 回押して確認待ち */
      isConfirmingReset: boolean
      /** 最後の出来事の一言 (実績・レベルアップ)。空なら出さない */
      news: string
    }
    /** turn-gacha が他の mod に見せている物のうち、dev-rpg が読む分だけ (書くのは turn-gacha) */
    'turn-gacha': {
      save: { book: Record<string, { count: number; firstAt: number }> }
      cards: RpgGachaCard[]
    }
  }
}
