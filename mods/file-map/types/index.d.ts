/** 触ったファイル 1 つ分の回数 */
export type FileTouch = {
  /** 作業フォルダからの相対パス (区切りは /)。外ならそのままのパス */
  label: string
  /** まとめる先: 上の 2 段のフォルダ。作業フォルダ直下は「直下」、外は「外」 */
  group: string
  /** 読んだ回数 (Read・Grep・Glob) */
  reads: number
  /** 書いた回数 (Edit・Write・MultiEdit・NotebookEdit) */
  writes: number
  /** うちサブエージェントの回数 */
  subs: number
  /** 最後に触った時刻 (ms) */
  last: number
}

export type FileMapFilter = 'all' | 'written'

declare module 'claude-code' {
  interface PluginState {
    'file-map': {
      /** 順は問わない。上限を超えたら古く触った物から捨てる */
      files: FileTouch[]
      filter: FileMapFilter
    }
  }
}
