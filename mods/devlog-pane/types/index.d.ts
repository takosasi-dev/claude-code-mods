// text が null ならファイル無し
export type DevlogPaneLog = { path: string; mtimeMs: number; text: string | null }

declare module 'claude-code' {
  interface PluginState {
    'devlog-pane': { log: DevlogPaneLog }
  }
}
