// prompt-book の $.state の契約

/** 保存した依頼文 1 件 ($.store にも同じ形で残す) */
export type PromptBookItem = {
  id: string
  title: string
  body: string
  /** 0〜3 個 */
  tags: string[]
  /** 入力欄へ入れた回数 */
  uses: number
  /** 最後に入力欄へ入れた時刻 (ms)。まだなら 0 */
  lastUsedAt: number
  /** 保存した時刻 (ms) */
  createdAt: number
}

/** 並び: よく使う順 / 新しい順 / 題の順 */
export type PromptBookSort = 'uses' | 'new' | 'title'

/** 追加欄に打ちかけの値 */
export type PromptBookDraft = {
  title: string
  body: string
  /** カンマ区切り */
  tags: string
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-book': {
      items: PromptBookItem[]
      draft: PromptBookDraft
      /** 絞り込むタグ。空ならすべて */
      tag: string
      sort: PromptBookSort
      /** 「消す」を 1 回押した件の id。空なら無し */
      armed: string
      /** 最後の操作の結果 (空なら出さない) */
      notice: string
      /** 「保存しました」を光らせている間 true */
      isFlashing: boolean
    }
  }
}
