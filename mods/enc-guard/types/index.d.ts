/**
 * 見ている罠。ps-encoding は -Encoding の無い Set-Content / Add-Content、ps1-bom は日本語入りで BOM の無い .ps1、
 * bat-ascii は ASCII 以外の字が入った .bat / .cmd、py-open は encoding= / newline= の無い Python の書き込み
 */
export type EncRule = 'ps-encoding' | 'ps1-bom' | 'bat-ascii' | 'py-open'

/** 記録の 1 件。古い順、最大 30 */
export type EncEntry = {
  at: number
  rule: EncRule
  /** ファイルのパスか、コマンドの頭 */
  where: string
  /** told は Claude に伝えた、blocked は止めた */
  action: 'told' | 'blocked'
}

declare module 'claude-code' {
  interface PluginState {
    'enc-guard': {
      log: EncEntry[]
      /** このセッションで見つけた数 */
      counts: Record<EncRule, number>
    }
  }
}
