/** 自分で足したルール */
export type RuleSwitchCustom = { id: string; text: string }

/** $.store に残す物 (state にも同じ物を写す) */
export type RuleSwitchSave = {
  /** オンのルールの id (決まったルールも自分のルールも)。オフは鍵ごと無い */
  on: Record<string, true>
  /** 自分で足したルール。足した順 */
  custom: RuleSwitchCustom[]
}

declare module 'claude-code' {
  interface PluginState {
    'rule-switch': {
      /** null はまだ store から読んでいない (/clear の後など) */
      save: RuleSwitchSave | null
      /** 「消す」を 1 回押した自分のルールの id。空なら無し */
      armed: string
      /** ボタンの結果などの一言。空なら出さない */
      note: string
    }
  }
}
