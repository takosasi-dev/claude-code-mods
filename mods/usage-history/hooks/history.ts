// 日ごとの使い方の純関数(日付・足し方・刈り込み・集計・SVG)
import type { DayRec, Days, HistoryMetric, HistoryRange } from '../types'
import { C, HEADER_H, W, countUp, esc, fadeIn, frame, growColumn, header, panel } from './style'

/** 残す日数 */
export const KEEP_DAYS = 400
export const SLOTS = 7 * 24
export const EMPTY_DAY: DayRec = { turns: 0, tools: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, durationMs: 0, subTurns: 0 }
const FIELDS = Object.keys(EMPTY_DAY) as (keyof DayRec)[]
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
/** ヒートマップの行(月曜始まり) */
const ROWS = ['月', '火', '水', '木', '金', '土', '日']

const jst = (ms: number) => new Date(ms + 9 * 3600_000)

/** 日本時間の 'YYYY-MM-DD' */
export const dayKey = (ms: number) => jst(ms).toISOString().slice(0, 10)

/** 曜日(月=0)×時刻のます目の番号 */
export function slot(ms: number) {
  const d = jst(ms)
  return ((d.getUTCDay() + 6) % 7) * 24 + d.getUTCHours()
}

/** 'YYYY-MM-DD' → '10/18(土)' */
export function dayLabel(key: string, withWeek = true) {
  const d = new Date(`${key}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}${withWeek ? `(${WEEK[d.getUTCDay()]})` : ''}`
}

export const addDay = (a: DayRec, b: Partial<DayRec>): DayRec =>
  Object.fromEntries(FIELDS.map(k => [k, a[k] + (b[k] ?? 0)])) as DayRec

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** store から読んだ値を確かめる。形の合わない日は捨てる。オブジェクトでなければ undefined */
export function asDays(v: unknown): Days | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const out: Days = {}
  for (const [k, rec] of Object.entries(v)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof rec !== 'object' || rec === null) continue
    out[k] = Object.fromEntries(FIELDS.map(f => [f, num((rec as Record<string, unknown>)[f])])) as DayRec
  }
  return out
}

export const asHeat = (v: unknown): number[] | undefined =>
  Array.isArray(v) && v.length === SLOTS ? v.map(num) : undefined

/** 保存済みの日々に、このセッションで溜めた差分を足し、新しい KEEP_DAYS 日だけ残す */
export function mergeDays(saved: Days, delta: Days): Days {
  const out: Days = { ...saved }
  for (const [k, d] of Object.entries(delta)) out[k] = addDay(out[k] ?? EMPTY_DAY, d)
  return Object.fromEntries(
    Object.keys(out)
      .sort()
      .slice(-KEEP_DAYS)
      .map(k => [k, out[k] as DayRec]),
  )
}

export const mergeHeat = (saved: readonly number[], delta: readonly number[]) => Array.from({ length: SLOTS }, (_, k) => (saved[k] ?? 0) + (delta[k] ?? 0))

/** 今日で終わる n 日(古い順)。記録の無い日は 0 */
export function lastDays(days: Days, now: number, n: number) {
  return Array.from({ length: n }, (_, k) => {
    const key = dayKey(now - (n - 1 - k) * 86_400_000)
    return { key, rec: days[key] ?? EMPTY_DAY }
  })
}

export const metricOf = (rec: DayRec, metric: HistoryMetric) => (metric === 'turns' ? rec.turns : rec.outputTokens)

export function summarize(list: readonly { key: string; rec: DayRec }[], metric: HistoryMetric) {
  const total = list.reduce((a, d) => addDay(a, d.rec), EMPTY_DAY)
  let top: { key: string; value: number } | undefined
  for (const d of list) {
    const value = metricOf(d.rec, metric)
    if (value > 0 && (top === undefined || value >= top.value)) top = { key: d.key, value }
  }
  return { total, top, value: metricOf(total, metric), average: metricOf(total, metric) / Math.max(1, list.length) }
}

/** 1 万を超えたら「万」、1 億を超えたら「億」で 1 桁 */
export function fmtNum(n: number) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}億`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return Number.isInteger(n) || n >= 100 ? String(Math.round(n)) : n.toFixed(1)
}

export const UNIT: Record<HistoryMetric, string> = { turns: 'ターン', output: '出力トークン' }

/** いちばん多い時間帯(ターン数)。記録が無ければ undefined */
export function busiest(heat: readonly number[]) {
  let best = -1
  let max = 0
  heat.forEach((v, k) => {
    if (v > max) {
      max = v
      best = k
    }
  })
  return best < 0 ? undefined : { week: ROWS[Math.floor(best / 24)] ?? '', hour: best % 24, turns: max }
}

/** 見出し・合計と 1 日平均・日ごとの縦棒・いちばん多かった日 */
export function chartSvg(days: Days, now: number, range: HistoryRange, metric: HistoryMetric) {
  const list = lastDays(days, now, range)
  const { total, top, value, average } = summarize(list, metric)
  const unit = UNIT[metric]
  const parts: string[] = [header('日ごとの使い方', `直近 ${range} 日の${unit}`, C.green)]

  // 合計と 1 日平均の 2 枚
  const tileY = HEADER_H + 10
  const tileW = (W - 14 * 2 - 10) / 2
  for (const [k, [label, n]] of ([
    ['合計', value],
    ['1 日平均', average],
  ] as const).entries()) {
    const x = 14 + k * (tileW + 10)
    parts.push(panel(x, tileY, tileW, 58))
    parts.push(`<text x="${x + 12}" y="${tileY + 20}" font-size="12" fill="${C.dim}">${esc(`${label}(${unit})`)}</text>`)
    parts.push(countUp(n, `x="${x + 12}" y="${tileY + 46}" font-size="22" font-weight="bold" fill="${C.text}"`, fmtNum, k * 0.1))
  }
  const subY = tileY + 58 + 18
  parts.push(`<text x="14" y="${subY}" font-size="12" fill="${C.dim}">${esc(`ツール ${fmtNum(total.tools)} 回 / サブエージェント ${fmtNum(total.subTurns)} ターン`)}</text>`)
  parts.push(`<text x="14" y="${subY + 16}" font-size="12" fill="${C.dim}">${esc(`入力 ${fmtNum(total.inputTokens)} / 出力 ${fmtNum(total.outputTokens)} / キャッシュ読み ${fmtNum(total.cacheRead)}`)}</text>`)

  // 日ごとの縦棒。いちばん多かった日は黄色、今日は青、ほかは緑
  const chartTop = subY + 34
  const chartH = 110
  const bottom = chartTop + chartH
  const left = 14
  const gap = range === 7 ? 10 : 3
  const colW = (W - left * 2 - gap * (range - 1)) / range
  const max = Math.max(1, ...list.map(d => metricOf(d.rec, metric)))
  parts.push(`<line x1="${left}" y1="${bottom}" x2="${W - left}" y2="${bottom}" stroke="${C.line}"/>`)
  list.forEach((d, k) => {
    const v = metricOf(d.rec, metric)
    const x = left + k * (colW + gap)
    const h = v === 0 ? 0 : Math.max(2, ((chartH - 16) * v) / max)
    const fill = top?.key === d.key ? C.yellow : k === list.length - 1 ? C.blue : C.green
    parts.push(growColumn(x, bottom, colW, h, fill, k * (range === 7 ? 0.05 : 0.015)))
    if (range === 7 && v > 0) parts.push(fadeIn(`<text x="${x + colW / 2}" y="${bottom - h - 4}" font-size="12" fill="${C.text}" text-anchor="middle">${esc(fmtNum(v))}</text>`, 0.5))
    const isLabeled = range === 7 || (list.length - 1 - k) % 7 === 0
    if (isLabeled) parts.push(`<text x="${x + colW / 2}" y="${bottom + 16}" font-size="12" fill="${C.dim}" text-anchor="middle">${esc(dayLabel(d.key, false))}</text>`)
  })

  const topY = bottom + 40
  parts.push(
    `<text x="14" y="${topY}" font-size="13" fill="${C.text}">${esc(
      top ? `いちばん多かった日 ${dayLabel(top.key)} ${fmtNum(top.value)} ${unit}` : `直近 ${range} 日はまだ記録がありません`,
    )}</text>`,
  )
  return frame(topY + 14, parts.join(''))
}

/** 曜日×時間帯のヒートマップ(濃さ = これまでのメインのターン数) */
export function heatSvg(heat: readonly number[]) {
  const left = 40
  const top = 34
  const cw = (W - left - 14) / 24
  const ch = 18
  const max = Math.max(1, ...heat)
  const parts: string[] = [`<text x="14" y="22" font-size="13" font-weight="bold" fill="${C.text}">曜日と時間帯ごとのターン数(これまで)</text>`]
  ROWS.forEach((label, r) => {
    const y = top + r * ch
    parts.push(`<text x="14" y="${y + 13}" font-size="12" fill="${C.dim}">${label}</text>`)
    for (let h = 0; h < 24; h++) {
      const v = heat[r * 24 + h] ?? 0
      const x = left + h * cw
      parts.push(
        v === 0
          ? `<rect x="${x.toFixed(1)}" y="${y}" width="${(cw - 2).toFixed(1)}" height="${ch - 2}" rx="2" fill="${C.face}"/>`
          : `<rect x="${x.toFixed(1)}" y="${y}" width="${(cw - 2).toFixed(1)}" height="${ch - 2}" rx="2" fill="${C.green}" opacity="${(0.2 + (0.8 * v) / max).toFixed(2)}"/>`,
      )
    }
  })
  const labelY = top + 7 * ch + 14
  for (const h of [0, 6, 12, 18, 23]) parts.push(`<text x="${(left + h * cw + cw / 2).toFixed(1)}" y="${labelY}" font-size="12" fill="${C.dim}" text-anchor="middle">${h}</text>`)
  const b = busiest(heat)
  parts.push(
    `<text x="14" y="${labelY + 22}" font-size="12" fill="${C.dim}">${esc(b ? `いちばん多いのは ${b.week}曜 ${b.hour} 時台(${b.turns} ターン)` : 'まだ記録がありません')}</text>`,
  )
  return frame(labelY + 32, fadeIn(parts.join('')))
}
