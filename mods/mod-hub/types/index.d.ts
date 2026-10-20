// mod-hub の $.state の契約

/** plugin.register で見えた mod 1 本 */
export type ModHubMod = {
  name: string
  /** plugin.json の version。書いていなければ空 */
  version: string
  /** `<name>@inline` / `<name>@<marketplace>` / `<name>@builtin` */
  provenance: string
  tier: string
  /** uses.events (on(...) で名指ししたイベント) */
  events: string[]
  /** uses.calls ($ の上で呼ぶ noun.method) */
  calls: string[]
  /** このセッションの読み込みで mod-hub が拒んだ */
  isRefused: boolean
}

/** $.command.list() のうち mod が足したコマンド */
export type ModHubCommand = {
  name: string
  description: string
  plugin: string
}

export type ModHubSort = 'name' | 'kind'

declare module 'claude-code' {
  interface PluginState {
    'mod-hub': {
      mods: ModHubMod[]
      commands: ModHubCommand[]
      /** オフにした mod の名前 ($.store の 'off' の写し) */
      off: string[]
      filter: string
      sort: ModHubSort
      showBuiltin: boolean
      /** 最後の操作の結果 (空なら出さない) */
      notice: string
    }
  }
}
