/** 音の種類: 和音・ベル・ポン */
export type DoneChimeSound = 'chord' | 'bell' | 'pon'
export type DoneChimeVolume = 'low' | 'mid' | 'high'

export type DoneChimeSettings = {
  isOn: boolean
  sound: DoneChimeSound
  /** これ以上かかったターンで鳴らす (秒) */
  threshold: number
  volume: DoneChimeVolume
}

declare module 'claude-code' {
  interface PluginState {
    'done-chime': {
      settings: DoneChimeSettings
      /** 最後に鳴らした結果など、ペインの下に出す一言 */
      note: string
    }
  }
}
