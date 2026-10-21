/** 顔の状態: 待ち・考え中・ツール実行中・答え終わり・エラー/中断 */
export type FaceBandMood = 'idle' | 'think' | 'tool' | 'happy' | 'sad'

/** 帯が描く今の顔 */
export type FaceBandNow = {
  mood: FaceBandMood
  /** 顔の横の一言 */
  word: string
  /** 最後に使ったツールの名前 (制御文字は落としてある) */
  tool: string
  /** 今動いているメインのツールの数 */
  active: number
  /** にっこり/しょんぼりを 3 秒で戻すときに、後から来た変化を消さないための番号 */
  seq: number
}

/** 日本時間で決まる時間帯と季節 (小物が変わる)。1 分ごとに見て、変わった時だけ書く */
export type FaceBandLook = {
  part: '朝' | '昼' | '夕' | '夜'
  season: '春' | '夏' | '秋' | '冬'
}

declare module 'claude-code' {
  interface PluginState {
    'face-band': {
      now: FaceBandNow
      isHidden: boolean
      look: FaceBandLook
    }
  }
}
