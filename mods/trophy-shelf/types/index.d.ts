// trophy-shelf の $.state の契約と、読むだけの他の mod の state の写し。
// 他の mod の型は dependencies を使わず、要る欄だけをここに写す(見本: mods/dev-rpg/types/index.d.ts の 'turn-gacha')。
// 読んだ値は hooks/shelf.ts の snapshotOf で形を確かめてから使う(その mod が入っていない時は undefined)

/** 棚に並べる mod */
export type ShelfMod = 'dev-rpg' | 'turn-gacha' | 'aqua-pet' | 'wait-games' | 'daily-quest'

/** 他の mod の state から作る、トロフィーの判定に使う数。入っていない mod は undefined */
export type ShelfSnapshot = {
  rpg?: { level: number; achievements: number; wins: number; bosses: number; deepest: number }
  gacha?: { owned: number; total: number; ssr: number; pulls: number }
  aqua?: { kinds: number; fish: number; days: number }
  games?: { kinds: number; best2048: number; wins2048: number; wins: number }
  quest?: { streak: number; totalDone: number }
}

/** トロフィーの id → 初めて取った時刻 (ms) */
export type ShelfFirstAt = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    'trophy-shelf': {
      /** $.store の 'firstAt' の写し。書く直前に store を読み直して足す */
      firstAt: ShelfFirstAt
    }
    /** ここから下は他の mod の state の、trophy-shelf が読む欄だけ(書くのは各 mod) */
    'dev-rpg': {
      hero: { xp: number; achievements: Record<string, number>; wins: number; defeated: Record<string, number>; deepest?: number }
    }
    'turn-gacha': {
      save: { book: Record<string, { count: number; firstAt: number }>; total: number }
      cards: { id: string; rarity: 'N' | 'R' | 'SR' | 'SSR' }[]
    }
    'aqua-pet': {
      tank: { fish: { kind: string }[]; view: { days: number } }
    }
    'wait-games': {
      stats: {
        best2048: number
        wins2048: number
        winsMines: number
        puzzles?: Partial<Record<string, { wins: number }>>
      }
    }
    'daily-quest': {
      /** 3 つ全部こなした日が続いている日数 */
      streak: number
      /** 通算でこなしたお題の数 */
      totalDone: number
    }
  }
}
