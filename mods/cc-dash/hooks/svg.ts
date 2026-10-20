// SVG を文字列で組む関数。描画面は <img> なので SMIL だけで動かす
import type { CcDashCall } from '../types'

export const C = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  dim: '#8b949e',
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
  orange: '#f78166',
}
// ツールの色。赤はエラー専用なので外す
export const TOOL_COLORS = [C.blue, C.green, C.purple, C.orange, C.yellow]

const W = 360
const FONT = 'font-family="sans-serif"'

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 2)}..` : s)

/** mcp__server__tool は最後の部分だけにする */
export const shortTool = (tool: string) => (tool.startsWith('mcp__') ? tool.split('__').pop() || tool : tool)

/** 経過時間 h:mm */
export const clock = (ms: number) => {
  const min = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}

/** 所要時間 12秒 / 3分5秒 / 0.4秒 */
export const dur = (ms: number) => {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}秒`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}秒` : `${Math.floor(s / 60)}分${s % 60}秒`
}

/** リセットまでの残り (usage-pane の left() を写した物) */
export const left = (iso: unknown, now: number) => {
  // 小数秒が 6 桁でも読めるよう 3 桁に切る
  const at = typeof iso === 'string' ? Date.parse(iso.replace(/(\.\d{3})\d+/, '$1')) : NaN
  if (Number.isNaN(at)) return ''
  if (at <= now) return 'リセット済み'
  const min = Math.floor((at - now) / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return d > 0 ? `あと${d}日${h}時間` : h > 0 ? `あと${h}時間${m}分` : `あと${m}分`
}

const svg = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" ${FONT}>` +
  `<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="12" fill="${C.face}" stroke="${C.line}"/>` +
  body +
  `</svg>`

const text = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`

const title = (s: string, right = '', rightFill: string = C.dim) =>
  text(16, 28, s, 14, C.text, 'font-weight="bold"') +
  (right ? text(W - 16, 28, right, 12, rightFill, 'text-anchor="end"') : '')

// ---- 概要 ----

export type Overview = { elapsedMs: number; turns: number; tools: number; errors: number; isRunning: boolean }

export const overviewSvg = (o: Overview) => {
  const pulse = o.isRunning
    ? `<circle cx="${W - 74}" cy="23" r="5" fill="${C.green}">` +
      `<animate attributeName="r" values="4;9;4" dur="1.4s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite"/></circle>` +
      `<circle cx="${W - 74}" cy="23" r="3.5" fill="${C.green}"/>` +
      text(W - 16, 28, '実行中', 13, C.green, 'text-anchor="end" font-weight="bold"')
    : text(W - 16, 28, '待機中', 13, C.dim, 'text-anchor="end"')
  const tw = (W - 32 - 12) / 2
  const th = 74
  const tile = (i: number, label: string, value: string, edge: string, valueFill: string = C.text) => {
    const x = 16 + (i % 2) * (tw + 12)
    const y = 44 + Math.floor(i / 2) * (th + 12)
    return (
      `<rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="8" fill="${C.bg}" stroke="${edge}" stroke-width="1.5"/>` +
      `<rect x="${x + 10}" y="${y}" width="${tw - 20}" height="3" fill="${edge}"/>` +
      text(x + 12, y + 24, label, 12, C.dim) +
      text(x + 12, y + 60, value, 28, valueFill, 'font-weight="bold"')
    )
  }
  return svg(
    44 + th * 2 + 12 + 16,
    title('セッション') +
      pulse +
      tile(0, '経過 (時:分)', clock(o.elapsedMs), C.blue) +
      tile(1, 'ターン', String(o.turns), C.green) +
      tile(2, 'ツール呼び出し', String(o.tools), C.yellow) +
      tile(3, 'エラー', String(o.errors), C.red, o.errors > 0 ? C.red : C.text),
  )
}

export const turnColor = (ms: number) => (ms > 300_000 ? C.red : ms > 120_000 ? C.yellow : C.blue)

export const turnsSvg = (durations: number[]) => {
  const h = 210
  const recent = durations.slice(-20)
  const last = recent[recent.length - 1]
  if (last === undefined) {
    return svg(h, title('直近20ターンの所要時間') + text(W / 2, 120, 'まだ完了したターンがありません', 13, C.dim, 'text-anchor="middle"'))
  }
  const x0 = 48
  const top = 48
  const base = 168
  const plotH = base - top
  const max = Math.max(...recent, 1000)
  const slot = (W - 16 - x0) / 20
  const bw = Math.max(4, slot - 5)
  // 120 秒・300 秒の目安線 (縦軸に入る時だけ)
  const guide = (ms: number, color: string) => {
    if (ms > max) return ''
    const y = base - (ms / max) * plotH
    return `<line x1="${x0}" y1="${y}" x2="${W - 16}" y2="${y}" stroke="${color}" stroke-dasharray="4 4" opacity="0.6"/>`
  }
  const bars = recent
    .map((ms, i) => {
      const bh = Math.max(2, (ms / max) * plotH)
      const x = x0 + i * slot + (slot - bw) / 2
      const isLast = i === recent.length - 1
      const color = turnColor(ms)
      const op = isLast || color !== C.blue ? 1 : 0.45
      return (
        `<rect x="${x}" y="${base - bh}" width="${bw}" height="${bh}" rx="2" fill="${color}" opacity="${op}">` +
        `<animate attributeName="height" from="0" to="${bh}" dur="0.7s" fill="freeze"/>` +
        `<animate attributeName="y" from="${base}" to="${base - bh}" dur="0.7s" fill="freeze"/></rect>` +
        (isLast ? `<rect x="${x - 2}" y="${base + 4}" width="${bw + 4}" height="3" rx="1.5" fill="${color}"/>` : '')
      )
    })
    .join('')
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length
  return svg(
    h,
    title('直近20ターンの所要時間', `最新 ${dur(last)}`, turnColor(last)) +
      text(x0 - 6, top + 4, dur(max), 12, C.dim, 'text-anchor="end"') +
      text(x0 - 6, base, '0', 12, C.dim, 'text-anchor="end"') +
      `<line x1="${x0}" y1="${top}" x2="${W - 16}" y2="${top}" stroke="${C.line}"/>` +
      `<line x1="${x0}" y1="${base}" x2="${W - 16}" y2="${base}" stroke="${C.line}"/>` +
      guide(120_000, C.yellow) +
      guide(300_000, C.red) +
      bars +
      text(16, 196, `平均 ${dur(avg)}  /  2分超は黄、5分超は赤`, 12, C.dim),
  )
}

// ---- ツール ----

export const toolBarsSvg = (top: [string, number][], total: number, colorOf: (tool: string) => string) => {
  const row = 28
  const h = 48 + Math.max(1, top.length) * row + 12
  if (top.length === 0) {
    return svg(h + 20, title('ツール別の呼び出し回数') + text(W / 2, 80, 'まだ呼び出しがありません', 13, C.dim, 'text-anchor="middle"'))
  }
  const max = Math.max(...top.map(([, n]) => n))
  const bx = 124
  const bmax = W - bx - 56
  const rows = top
    .map(([tool, n], i) => {
      const y = 48 + i * row
      const w = Math.max(3, (n / max) * bmax)
      const color = colorOf(tool)
      return (
        text(16, y + 15, cut(shortTool(tool), 12), 12, C.text) +
        `<rect x="${bx}" y="${y + 2}" width="${w}" height="16" rx="3" fill="${color}">` +
        `<animate attributeName="width" from="0" to="${w}" dur="0.6s" fill="freeze"/></rect>` +
        text(bx + w + 6, y + 15, String(n), 12, C.dim)
      )
    })
    .join('')
  return svg(h, title('ツール別の呼び出し回数', `計 ${total}回`) + rows)
}

export const timelineSvg = (calls: CcDashCall[], now: number, colorOf: (tool: string) => string) => {
  const row = 20
  const list = calls.slice(-30)
  const h = 48 + Math.max(1, list.length) * row + 16
  if (list.length === 0) {
    return svg(h + 20, title('直近30回の呼び出し') + text(W / 2, 80, 'まだ呼び出しがありません', 13, C.dim, 'text-anchor="middle"'))
  }
  const len = (c: CcDashCall) => Math.max(0, (c.end ?? now) - c.start)
  const max = Math.max(...list.map(len), 1)
  const bmax = 190
  const running = list.filter(c => c.end === undefined).length
  const errors = list.filter(c => c.isError).length
  const bands = list
    .map((c, i) => {
      const y = 44 + i * row
      const w = Math.max(3, (len(c) / max) * bmax)
      const isRunning = c.end === undefined
      const color = c.isError ? C.red : isRunning ? C.blue : colorOf(c.tool)
      // 実行中は太い破線の dashoffset を流して縞にする (pattern より描ける所が多い)
      const band = isRunning
        ? `<rect x="16" y="${y}" width="${w}" height="14" rx="3" fill="${C.blue}" opacity="0.3"/>` +
          `<line x1="16" y1="${y + 7}" x2="${16 + w}" y2="${y + 7}" stroke="${C.blue}" stroke-width="14" stroke-dasharray="6 6">` +
          `<animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.6s" repeatCount="indefinite"/></line>`
        : `<rect x="16" y="${y}" width="${w}" height="14" rx="3" fill="${color}" opacity="${c.isError ? 1 : 0.85}"/>`
      const label = `${cut(shortTool(c.tool), 12)} ${isRunning ? '実行中' : dur(len(c))}`
      return band + text(16 + w + 6, y + 12, label, 12, c.isError ? C.red : C.text)
    })
    .join('')
  const right = [running ? `実行中 ${running}` : '', errors ? `失敗 ${errors}` : ''].filter(Boolean).join(' / ')
  return svg(h, title('直近30回の呼び出し', right, errors ? C.red : C.blue) + bands + text(16, h - 10, '上が古く下が新しい。幅は所要時間', 12, C.dim))
}

// ---- 使用量 ----

export type Gauge = { label: string; pct: number; left: string }

export const gaugeColor = (pct: number) => (pct > 80 ? C.red : pct > 50 ? C.yellow : C.green)

export const gaugesSvg = (gauges: Gauge[], footer: string) => {
  const h = 196
  const col = W / gauges.length
  const r = 38
  const circ = 2 * Math.PI * r
  const rings = gauges
    .map((g, i) => {
      const cx = col * i + col / 2
      const cy = 88
      const p = Math.min(100, Math.max(0, g.pct))
      const d = (circ * p) / 100
      const color = gaugeColor(p)
      return (
        text(cx, 30, cut(g.label, 9), 12, C.text, 'text-anchor="middle" font-weight="bold"') +
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.line}" stroke-width="10"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="${p > 0 ? 'round' : 'butt'}" ` +
        `stroke-dasharray="${d.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})">` +
        `<animate attributeName="stroke-dasharray" from="0 ${circ.toFixed(1)}" to="${d.toFixed(1)} ${circ.toFixed(1)}" dur="0.9s" fill="freeze"/></circle>` +
        text(cx, cy + 7, `${Math.round(p)}%`, 20, color, 'text-anchor="middle" font-weight="bold"') +
        text(cx, 150, g.left, 12, C.dim, 'text-anchor="middle"')
      )
    })
    .join('')
  return svg(h, rings + (footer ? text(W / 2, 180, footer, 12, C.dim, 'text-anchor="middle"') : ''))
}
