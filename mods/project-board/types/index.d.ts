// project-board の $.state の契約
export type ProjectBoardProject = {
  /** ファイル名から .md を除いた物 = プロジェクト名 */
  name: string
  /** メモの絶対パス */
  path: string
  mtimeMs: number
  /** 本文の先頭の # 見出し */
  title: string
  /** 「状態」「現状」「次にやること」「待ち」などから抜いた行(最大 4) */
  lines: string[]
}

export type ProjectBoardSort = 'new' | 'name' | 'old'

export type ProjectBoardDetail = {
  name: string
  /** 表示する本文(先頭 4000 字、全文表示では上限 100000 字) */
  body: string
  /** まだ続きがある */
  more: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'project-board': {
      projects: ProjectBoardProject[]
      /** 最後に読み込んだ時刻。0 はまだ読んでいない */
      loadedAt: number
      /** 読み込みの失敗。空なら無し */
      error: string
      sort: ProjectBoardSort
      filter: string
      detail: ProjectBoardDetail | null
    }
  }
}
