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

/** カテゴリー別か名前順か */
export type ModHubSort = 'category' | 'name'

declare module 'claude-code' {
  interface PluginState {
    'mod-hub': {
      mods: ModHubMod[]
      commands: ModHubCommand[]
      /** 最後の操作の結果 (空なら出さない) */
      notice: string
      /** 並べ方。$.store の 'sort' にも残す */
      sort: ModHubSort
    }
  }
}
