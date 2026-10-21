export type GachaRarity = 'N' | 'R' | 'SR' | 'SSR'

/** dev-rpg で装備する枠: 武器・防具・お守り */
export type GachaSlot = 'weapon' | 'armor' | 'charm'

/** カード 1 種類 (他の mod に見せる形。一言は含まない) */
export type GachaCard = {
  /** 保存に使う id。変わらない */
  id: string
  rarity: GachaRarity
  slot: GachaSlot
  name: string
}

/** 1 回引いた結果 */
export type GachaDraw = {
  cardId: string
  /** 引いた時刻 (ms) */
  at: number
  /** 初めて引いたカード */
  isNew: boolean
  /** そのターンのエラーが 0 で、SR 以上が出やすくなっていた */
  isClean: boolean
  /** ボタンで引いた */
  isManual: boolean
}

/** 図鑑の 1 種類分 */
export type GachaOwned = { count: number; firstAt: number }

/** $.store に残す物 (state にも同じ物を写す) */
export type GachaSave = {
  /** カードの id ごとの所持数と初めて引いた日時。持っていないカードはキーが無い */
  book: Record<string, GachaOwned>
  /** 累計で引いた回数 */
  total: number
  /** 手動で引いた日 (YYYY-MM-DD) と、その日に引いた回数 */
  manualDay: string
  manualUsed: number
  /** 新しい順、最大 10 */
  history: GachaDraw[]
}

/**
 * 他の mod が読んでよい物 (書けるのは turn-gacha だけ):
 * - save.book: 持っているカードの id と枚数。セッションの始まりに store から写し、引くたびに置き換わる
 * - cards: カード 60 種の表 (id・レア度・枠・名前)。セッションの始まりに 1 回置く
 * どちらも turn-gacha が入っていない、またはまだ読み込む前は undefined
 */
declare module 'claude-code' {
  interface PluginState {
    /**
     * daily-quest が他の mod に見せている物のうち、turn-gacha が読む分だけ (書くのは daily-quest)。
     * daily-quest の types/index.d.ts の写し。入っていない時は undefined なので、読んだ値は gacha.ts の questRewards で確かめる
     */
    'daily-quest': {
      today: { date: string; quests: { id: string; title: string; done: boolean; reward: { exp: number; pulls: number } }[] }
    }
    'turn-gacha': {
      save: GachaSave
      cards: GachaCard[]
      /** カードを大きく出すか、図鑑の一覧か */
      view: 'card' | 'book'
      /** ボタンの結果などの一言。空なら出さない */
      note: string
      /** 今のメインのターンで失敗したツールの数 */
      turnErrors: number
    }
  }
}
