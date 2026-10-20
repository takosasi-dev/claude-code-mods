export type CanvasKind = 'bar' | 'line' | 'pie' | 'table' | 'markdown' | 'svg'

/** terminal で描く 1 行 */
export type CanvasLine = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** 1 枚。描く物は呼ばれた時に組み終えておく (描画フックは読むだけ) */
export type CanvasItem = {
  id: number
  /** 描いた時刻 (ms) */
  at: number
  title: string
  kind: CanvasKind
  /** bar / line / pie / table はこの mod が組んだ SVG、svg は Claude が渡した SVG */
  svg?: string
  /** markdown の本文 */
  markdown?: string
  /** Svg の alt (制御文字なし) */
  alt: string
  /** terminal で描く行 */
  lines: CanvasLine[]
}

export type CanvasBoard = {
  /** 古い順、最大 20 */
  items: CanvasItem[]
  /** 見ている 1 枚の位置 (items の添字) */
  pos: number
  /** 次の id */
  seq: number
}

declare module 'claude-code' {
  interface PluginState {
    'canvas-pane': {
      board: CanvasBoard
    }
  }
}
