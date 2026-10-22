/** コミット 1 件 */
export type DraftCommit = { hash: string; subject: string }

/** 版が上がったファイル (plugin.json・package.json)。from が無ければタグの時には無かった */
export type DraftBump = { path: string; name: string; from?: string; to: string }

/** 読んだ結果 */
export type DraftReport =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-repo'; dir: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      /** 読んだリポジトリの一番上 */
      dir: string
      loadedAt: number
      /** 前のタグ。無ければ null (最近のコミットを読む) */
      tag: string | null
      /** 新しい順、最大 200 */
      commits: DraftCommit[]
      /** タグからのコミットの本当の数 */
      commitCount: number
      isCut: boolean
      bumps: DraftBump[]
      /** タグから変わったファイルの数 (まだコミットしていない物も含む) */
      fileCount: number
    }

declare module 'claude-code' {
  interface PluginState {
    'release-draft': {
      report: DraftReport
      /** 最後に git commit した場所。空ならセッションの場所を読む */
      repo: string
    }
  }
}
