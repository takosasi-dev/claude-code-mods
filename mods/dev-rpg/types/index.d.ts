/** 装備の枠: 武器・防具・お守り */
export type RpgSlot = 'weapon' | 'armor' | 'charm'

/** SP を振る能力: 力・体力・知恵・素早さ */
export type RpgStat = 'str' | 'vit' | 'int' | 'agi'

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
  /** ここから 0.3.0。戦った回数と勝った回数 */
  battles: number
  wins: number
  /** たまっている遭遇 (ターンを終えるたびに 1 つ、5 つまで)。戦うと 1 つ減る */
  encounters: number
  /** SP を振った数 (能力ごと) */
  alloc: Record<RpgStat, number>
  /** 覚えたスキルの id → 覚えた時刻 (ms) */
  learned: Record<string, number>
  /** 倒したボスの id → 初めて倒した時刻 (ms) */
  defeated: Record<string, number>
  /** ここから 0.4.0。湧いたボスの気配 (0 か 1)。あれば気配を使わずにボスに挑めて、経験値が 1.5 倍 */
  bossSign: number
  /** ここから 0.6.0。ダンジョンで勝ち抜いた一番深い階 (0 はまだ)。2 つのセッションでは大きい方 */
  deepest: number
  /** 今潜っているダンジョン。入口にいれば null */
  delve: RpgDelve | null
  /**
   * ここから 0.6.1。帰った・力尽きた潜り (新しい物が後ろ、20 件まで)。
   * 別のセッションが同じ潜りを書き戻したり、袋をもう一度持ち帰ったりしないように
   */
  doneDelves: RpgDoneDelve[]
  /**
   * 記録の世代。やり直し・控えから戻すで 1 つ上がる。
   * 合わせた時の世代と store の世代が違えば、別のセッションは差分を足さずに store を取る
   */
  epoch: number
}

/** 終わった潜り 1 つ: 潜りの id (始めた時刻) と、持ち帰った経験値 */
export type RpgDoneDelve = { id: number; xp: number }

/** 最後の階の戦いの写し (絵と一言に使う) */
export type RpgDelveFight = {
  floor: number
  name: string
  level: number
  isBoss: boolean
  shape: string
  color: string
  result: 'won' | 'lost'
  /** 勇者が受けた量と、袋に入れた経験値 */
  hitMe: number
  loot: number
}

/** ダンジョンの 1 回の潜り。ターンを終えるたびに 1 歩進み、決まった歩数で次の階の敵と戦う */
export type RpgDelve = {
  /** 潜り始めた時刻 (同じ潜りかを見分ける) */
  startedAt: number
  /** 今いる階 (この階の敵とまだ戦っていない) */
  floor: number
  /** 次の階の敵までの歩み (0 から DELVE.steps まで) */
  step: number
  /** 潜っている間の HP と MP (%)。入口では 100 */
  hp: number
  mp: number
  /** 袋の経験値。帰ると持ち帰り、力尽きると半分になる */
  loot: number
  /** 勝ち抜いた階の数 (この潜りの間) */
  cleared: number
  /** 乱数の種 (階ごとの敵と戦いが決まる) */
  seed: number
  last: RpgDelveFight | null
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
  /** 戦いで減った HP (%)。休むと 0 に戻る (0.3.1 から。無ければ 0) */
  wound?: number
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

/** 敵の癖: なし・MP を吸う・2 回動く・物理をかわす・力をためて大技 */
export type RpgTrait = 'none' | 'drain' | 'double' | 'evade' | 'heavy'

/** 戦っている敵 */
export type RpgEnemy = {
  id: string
  name: string
  level: number
  isBoss: boolean
  maxHp: number
  hp: number
  atk: number
  def: number
  spd: number
  /** 倒した時の経験値 */
  xp: number
  trait: RpgTrait
  /** ドット絵の形と色 */
  shape: string
  color: string
}

/** 戦いの始めに写した勇者の強さ (戦いの間の HP と MP はここで減る) */
export type RpgFighter = {
  maxHp: number
  hp: number
  maxMp: number
  mp: number
  atk: number
  def: number
  mag: number
  spd: number
  /** 会心の確率 (%) */
  crit: number
  /** 毎ラウンドの終わりに戻す HP (最大 HP に対する %) */
  regen: number
}

/** 戦い 1 回。セッションの間だけ ($.state)。store には書かない */
export type RpgBattle = {
  enemy: RpgEnemy
  me: RpgFighter
  round: number
  /** テストの盾の残りラウンド */
  guard: number
  /** ログ解読で敵の守りを下げた */
  isExposed: boolean
  /** 敵が力をためている (次の攻撃が 2 倍) */
  isCharging: boolean
  usedRollback: boolean
  /** 乱数の種。1 手ごとに進める (同じ種なら同じ結果) */
  seed: number
  /** 新しい物が後ろ。6 行まで */
  log: string[]
  result: 'fight' | 'won' | 'lost' | 'fled'
  /** 勝った時の経験値 */
  gainedXp: number
  /** 最後の一手で敵と勇者が受けた量 (絵の揺れと数字に使う) */
  hitEnemy: number
  hitMe: number
}

export type RpgTab = 'status' | 'gear' | 'achievements' | 'battle' | 'growth' | 'dungeon'

/** 記録の控え 1 日分 (hooks/style.ts の Backup と同じ形) */
export type RpgBackup = { day: string; value: unknown }

/** 「控えから戻す」の画面。list が null なら閉じている。pick は確かめ中の日 */
export type RpgRestore = { list: RpgBackup[] | null; pick: string | null }

declare module 'claude-code' {
  interface PluginState {
    'dev-rpg': {
      hero: RpgHero
      tab: RpgTab
      /** 「冒険をやり直す」を 1 回押して確認待ち */
      isConfirmingReset: boolean
      /** 最後の出来事の一言 (実績・レベルアップ)。空なら出さない */
      news: string
      /** 今の戦い。戦っていなければ null */
      battle: RpgBattle | null
      /** 「控えから戻す」の画面 */
      restore: RpgRestore
    }
    /** turn-gacha が他の mod に見せている物のうち、dev-rpg が読む分だけ (書くのは turn-gacha) */
    'turn-gacha': {
      save: { book: Record<string, { count: number; firstAt: number }> }
      cards: RpgGachaCard[]
    }
    /**
     * daily-quest が他の mod に見せている物のうち、dev-rpg が読む分だけ (書くのは daily-quest)。
     * daily-quest の types/index.d.ts の写し。入っていない時は undefined なので、読んだ値は rpg.ts の questRewards で確かめる
     */
    'daily-quest': {
      today: { date: string; quests: { id: string; title: string; done: boolean; reward: { exp: number; pulls: number } }[] }
    }
  }
}
