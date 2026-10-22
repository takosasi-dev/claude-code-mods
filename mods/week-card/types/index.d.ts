// week-card の $.state の契約と、読むだけの他の mod の state の写し。
// 他の mod の型は dependencies を使わず、要る欄だけをここに写す(見本: mods/trophy-shelf/types/index.d.ts)。
// 読んだ値は hooks/card.ts の snapOf・usageOf で形を確かめてから使う(その mod が入っていない時は undefined)

/** その日の終わりの累計の数。入っていない mod の欄は無い */
export type WeekSnap = {
  /** dev-rpg のレベル */
  level?: number
  /** dev-rpg のダンジョンの一番深い階 (dev-rpg 0.6.0 から) */
  deepest?: number
  /** turn-gacha の図鑑の種類の数 */
  cards?: number
  /** aqua-pet の魚の数 */
  fish?: number
  /** daily-quest の通算でこなしたお題の数 */
  quests?: number
  /** daily-quest の 3 つ全部こなした日の連続 */
  streak?: number
}

/** 'YYYY-MM-DD'(日本時間) → その日の写し。$.store の 'snaps' にも残す (直近 30 日) */
export type WeekSnaps = Record<string, WeekSnap>

/** usage-history の week の 1 日分 (usage-history の HistoryWeekDay の写し) */
export type WeekUsageDay = {
  day: string
  turns: number
  tools: number
  inputTokens: number
  outputTokens: number
  minutes: number
}

declare module 'claude-code' {
  interface PluginState {
    'week-card': {
      /** $.store の 'snaps' の写し。書く直前に store を読み直し、今日の分だけを置き換える */
      snaps: WeekSnaps
    }
    /** ここから下は他の mod の state の、week-card が読む欄だけ(書くのは各 mod) */
    'usage-history': {
      /** 今日で終わる直近 7 日 (usage-history 0.2.0 から) */
      week: WeekUsageDay[]
    }
    'daily-quest': {
      streak: number
      totalDone: number
    }
    'turn-gacha': {
      save: { book: Record<string, { count: number; firstAt: number }> }
      cards: { id: string }[]
    }
    'dev-rpg': {
      hero: { xp: number; deepest?: number }
    }
    'aqua-pet': {
      tank: { fish: { kind: string }[] }
    }
  }
}
