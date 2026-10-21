export interface QuestReward {
  /** dev-rpg が受け取る経験値 */
  exp: number
  /** turn-gacha が受け取る、おまけで引ける回数 */
  pulls: number
}
export interface Quest {
  /** その日の中で一意。例 'turns-5' */
  id: string
  title: string
  goal: number
  progress: number
  done: boolean
  reward: QuestReward
}
export interface QuestDay {
  /** JST の YYYY-MM-DD */
  date: string
  quests: Quest[]
}

/** お題の種類 (数える物) */
export type QuestKind = 'turns' | 'edits' | 'tests' | 'commits' | 'clean' | 'newFiles' | 'reads' | 'shells'

/** 種類ごとの数。無い種類は 0 */
export type QuestCounts = Partial<Record<QuestKind, number>>

/** $.store に残す物 */
export interface QuestSave {
  /** JST の日付 → その日の数。直近 7 日だけ */
  days: Record<string, QuestCounts>
  /** 3 つ全部こなした日 (古い順) */
  fullDays: string[]
  /** 通算でこなしたお題の数 */
  totalDone: number
}

declare module 'claude-code' {
  interface PluginState {
    'daily-quest': {
      today: QuestDay
      /** 3 つ全部こなした日が続いている日数 */
      streak: number
      /** 通算でこなしたお題の数 */
      totalDone: number
      // ここから下は daily-quest の中だけで使う (読む側は上の 3 つだけを当てにする)
      /** 最後に store から読んだ・書いた物 */
      saved: QuestSave
      /** まだ store に流していない数 (ターンの終わりに流す) */
      pending: { date: string; counts: QuestCounts }
      /** 今のメインのターンで失敗したツールの数 */
      turnErrors: number
      /** 保存の失敗などの一言。空なら出さない */
      note: string
    }
  }
}
