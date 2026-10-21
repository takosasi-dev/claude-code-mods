// 「自分の並び」の枠の順と隠す枠。store の 'layout' に { order, hidden } で残す。
// 知らない枠の名前(新しい版で足された枠)と知らない欄は消さずに書き戻す
import type { CcDashLayout, CcDashPanel } from '../types'

export const PANELS: readonly CcDashPanel[] = ['overview', 'turns', 'toolBars', 'timeline', 'usage']

export const PANEL_LABEL: Record<CcDashPanel, string> = {
  overview: 'セッションのタイル',
  turns: 'ターンの所要時間',
  toolBars: 'ツール別の回数',
  timeline: '直近の呼び出し',
  usage: '使用量',
}

export const isPanel = (v: unknown): v is CcDashPanel => PANELS.includes(v as CcDashPanel)

/** 物なら中身、そうでなければ空 (知らない欄を残すための元) */
export const objOf = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [])

/** store の生の値を並びにする。足りない枠は後ろに足す。知らない名前はその場に残す */
export function layoutOf(raw: unknown): CcDashLayout {
  const o = objOf(raw)
  const order = strings(o.order)
  return { order: [...order, ...PANELS.filter(p => !order.includes(p))], hidden: strings(o.hidden) }
}

/** 画面に出す順 (知っている枠だけ) */
export const knownOrder = (l: CcDashLayout) => l.order.filter(isPanel)
export const shownOf = (l: CcDashLayout) => knownOrder(l).filter(p => !l.hidden.includes(p))

/** 隣の知っている枠と入れ替える。知らない名前は飛ばして、その位置に残す */
export function move(l: CcDashLayout, id: CcDashPanel, dir: -1 | 1): CcDashLayout {
  const order = [...l.order]
  const i = order.indexOf(id)
  let j = i + dir
  while (j >= 0 && j < order.length && !isPanel(order[j])) j += dir
  if (i < 0 || j < 0 || j >= order.length) return l
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  return { ...l, order }
}

export const setShown = (l: CcDashLayout, id: CcDashPanel, isShown: boolean): CcDashLayout => ({
  ...l,
  hidden: isShown ? l.hidden.filter(h => h !== id) : [...l.hidden.filter(h => h !== id), id],
})

/** 初めの並びに戻す (知らない名前はそのまま後ろに残す) */
export const reset = (l: CcDashLayout): CcDashLayout => ({
  order: [...PANELS, ...l.order.filter(p => !isPanel(p))],
  hidden: l.hidden.filter(p => !isPanel(p)),
})
