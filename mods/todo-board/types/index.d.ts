// todo-board の $.state の契約

export type TodoKind = 'FIXME' | 'TODO' | 'HACK' | 'XXX'

/** 拾った 1 件。text は行の前後の空白を落とした物 */
export type TodoItem = { path: string; line: number; kind: TodoKind; text: string }

/** ファイルごとの件数 (種類の内訳つき) */
export type TodoFile = { path: string; count: number; byKind: Record<TodoKind, number> }

/** 上限で止めた理由。'' は止めずに読み切った */
export type TodoCut = '' | 'files' | 'hits' | 'time' | 'output'

export type TodoSnapshot =
  | { kind: 'idle' }
  | { kind: 'error'; cwd: string; message: string }
  | {
      /** 読めた (git の外でフォルダを歩いた時も 'repo') */
      kind: 'repo'
      cwd: string
      /** git grep で読んだか、$.fs でフォルダを歩いたか。無ければ git */
      via?: 'git' | 'walk'
      /** フォルダを歩いた時に読んだファイルの数 */
      scanned?: number
      /** 上限で止めた理由 */
      cut?: TodoCut
      /** git grep の順。先頭から上限まで */
      items: TodoItem[]
      /** 上限で切る前の件数 */
      total: number
      counts: Record<TodoKind, number>
      /** 件数の多い順の上位 */
      files: TodoFile[]
      fileCount: number
      /** git の出力が 4 MiB を超えて読み切れなかった */
      isCut: boolean
      loadedAt: number
    }

/** 読んだときの件数 1 回分 */
export type TodoPoint = { at: number; total: number }

export type TodoFilter = 'ALL' | TodoKind

declare module 'claude-code' {
  interface PluginState {
    'todo-board': {
      snap: TodoSnapshot
      /** 読んだ件数の推移 (セッション内、直近 20 回) */
      history: TodoPoint[]
      /** 読んでいる最中 (前の結果は残して見せる) */
      running: boolean
      filter: TodoFilter
      /** 詳細を開いている件 (`ファイル:行`)。空なら閉じている */
      selected: string
      /** ボタンの結果などの一言。空なら出さない */
      note: string
    }
  }
}
