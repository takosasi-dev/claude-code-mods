import type { Register } from 'claude-code'

export const register: Register = (on, options) => {
  const thresholdMs = Number(options.thresholdSeconds ?? 120) * 1000

  on('turn.complete', ($, e, next) => {
    // 中断したターンとサブエージェントのターンは知らせない
    if (!e.isAborted && e.agentId === undefined && e.durationMs > thresholdMs) {
      const total = Math.round(e.durationMs / 1000)
      const min = Math.floor(total / 60)
      const sec = total % 60
      $.ui.toast(`応答が終わりました(${min > 0 ? `${min}分` : ''}${sec}秒)`)
    }

    return next(e)
  })
}
