// mod-hub の $.state の契約

/** plugin.register で見えた mod 1 本 */
export type ModHubMod = {
  name: string
  /** plugin.json の version。書いていなければ空 */
  version: string
  /** ペインを開くか、何かを描く */
  isGui: boolean
}

/** $.command.list() のうち mod が足したコマンド */
export type ModHubCommand = {
  name: string
  description: string
  plugin: string
}

/** カテゴリー別か名前順か最近開いた順か */
export type ModHubSort = 'category' | 'name' | 'recent'

/** 起動ボタンを押した記録 (新しい順、最大 20) */
export type ModHubRecent = { name: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'mod-hub': {
      mods: ModHubMod[]
      commands: ModHubCommand[]
      /** 最後の操作の結果 (空なら出さない) */
      notice: string
      /** 並べ方。$.store の 'sort' にも残す */
      sort: ModHubSort
      /** 検索欄の文字 (セッションの間だけ) */
      filter: string
      /** 固定した mod の名前。$.store の 'pins' にも残す */
      pins: string[]
      /** 最近開いた mod。$.store の 'recent' にも残す */
      recent: ModHubRecent[]
    }
  }
}
