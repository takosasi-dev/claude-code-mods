// 実画面の点検表。項目は手で書く(足す時は ITEMS に 1 行足すだけ。id は変えない: 付けた印の鍵になる)。どれも純関数
import type { CheckMark } from '../types'
import { clean } from './style'

export type ChecklistItem = {
  /** 印を残す鍵。変えない */
  id: string
  /** どの mod か(全体に効く物は「全体」) */
  mod: string
  /** 開くコマンド。無ければ空 */
  command: string
  /** 何を見るかを 1 文で */
  look: string
}

export const ITEMS: readonly ChecklistItem[] = [
  { id: 'trophies', mod: 'trophy-shelf', command: '/trophies', look: 'トロフィーの棚が崩れずに並び、取った物と取っていない物の見分けが付く' },
  { id: 'quest', mod: 'daily-quest', command: '/quest', look: '今日のお題と連続日数が読め、済んだ物に印が付く' },
  { id: 'errors', mod: 'fail-log', command: '/errors', look: '失敗の一覧が新しい順に並び、行の文字が切れすぎない' },
  { id: 'dash-sort', mod: 'cc-dash', command: '/dash', look: '並べ替えのボタンが狭いペイン(29 桁)でも崩れず、押すと順が変わる' },
  { id: 'inbox-open', mod: 'toast-inbox', command: '/inbox', look: '行を押すと、そのトーストを出した元の mod のペインが開く' },
  { id: 'face-night-winter', mod: 'face-band', command: '/face', look: '夜と冬の見た目(色・空)が昼や夏と違って見える' },
  { id: 'buttons', mod: '全体', command: '', look: 'ボタンの主と脇(0.9.1): 主は 1 つだけ普通の見た目で、ほかは枠だけの控えめなボタン' },
  { id: 'test-card', mod: 'test-runner', command: '/testrun', look: '色枠のカードに見出しと説明とボタンが収まり、結果で枠の色が変わる' },
  { id: 'cue-band', mod: 'compact-cue', command: '/cue', look: '入力欄の上に区切りの帯が出て、文が 1 行に収まる' },
  { id: 'ship-confirm', mod: 'ship-guard', command: '/guard', look: 'push や公開の前に確かめが出て、選んだ通りに進む・止まる' },
  { id: 'rule-band', mod: 'rule-watch', command: '/rulewatch', look: '約束から外れた時に入力欄の上の帯が出て、次のターンで下りる' },
  { id: 'run-guard', mod: 'run-guard', command: '/runguard', look: '窓を出す・音を鳴らす・隔離なしの headless を、実行の前に止める' },
  { id: 'week-card', mod: 'week-card', command: '/week', look: '1 週間のカードに増えた物が並び、週報に貼る文が出る' },
  { id: 'tank-deco', mod: 'aqua-pet', command: '/aquarium', look: '水槽のかざりを置く・外す・入れ替えるができ、底に描かれる' },
  { id: 'rpg-dungeon', mod: 'dev-rpg', command: '/rpg', look: '冒険の書のダンジョンで階を潜り、帰るとごほうびが入る' },
  { id: 'restore', mod: '控えあり', command: '/rpg など', look: '「控えから戻す」で日付が並び、確かめてから戻すと記録が控えの値になる' },
  { id: 'stale-band', mod: 'mod-check', command: '/mod-check', look: 'mod の版が変わると「開き直してください」の帯とトーストが出る' },
]

export const MARK_LABEL: Record<CheckMark, string> = { bad: 'だめ', todo: 'まだ', good: 'よい' }
/** 並べる順(だめ・まだを先に) */
export const MARK_ORDER: readonly CheckMark[] = ['bad', 'todo', 'good']

/** 印。付いていない物は「まだ」 */
export const markOf = (marks: Readonly<Record<string, CheckMark>>, id: string): CheckMark => {
  const m = marks[id]
  return m === 'good' || m === 'bad' ? m : 'todo'
}

/** store の生の値から、知っている形の印だけを取り出す */
export function marksFrom(raw: unknown): Record<string, CheckMark> {
  const marks = typeof raw === 'object' && raw !== null ? (raw as { marks?: unknown }).marks : undefined
  if (typeof marks !== 'object' || marks === null || Array.isArray(marks)) return {}
  return Object.fromEntries(Object.entries(marks).filter((e): e is [string, CheckMark] => e[1] === 'good' || e[1] === 'bad'))
}

/**
 * 書く直前に読み直した生の値に、1 項目の印だけを当てた物。知らない欄(上の欄も marks の中の知らない id も)は残す。
 * 「まだ」は印を消す
 */
export function withMark(raw: unknown, id: string, mark: CheckMark): Record<string, unknown> {
  const base = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const old = typeof base.marks === 'object' && base.marks !== null && !Array.isArray(base.marks) ? (base.marks as Record<string, unknown>) : {}
  const marks = { ...old }
  if (mark === 'todo') delete marks[id]
  else marks[id] = mark
  return { ...base, marks }
}

export type MarkCounts = Record<CheckMark, number>

export const countMarks = (marks: Readonly<Record<string, CheckMark>>, items = ITEMS): MarkCounts => {
  const c: MarkCounts = { good: 0, bad: 0, todo: 0 }
  for (const it of items) c[markOf(marks, it.id)] += 1
  return c
}

export const markCountLine = (c: MarkCounts, total: number) => `全 ${total} 項目  だめ ${c.bad}  まだ ${c.todo}  よい ${c.good}`

/** だめ・まだを先に、同じ印の中は表の順 */
export const sortItems = (marks: Readonly<Record<string, CheckMark>>, items = ITEMS) =>
  [...items].sort((a, b) => MARK_ORDER.indexOf(markOf(marks, a.id)) - MARK_ORDER.indexOf(markOf(marks, b.id)))

/** 1 行 1 項目(/mod-check の貼る文と同じ形) */
export const itemLine = (it: ChecklistItem, mark: CheckMark) =>
  [clean(it.mod).padEnd(16), MARK_LABEL[mark], it.command, clean(it.look)].filter(s => s !== '').join(' ')

/** 「点検の結果を貼る文」。stamp は jstStamp の値 */
export function checklistText(marks: Readonly<Record<string, CheckMark>>, stamp: string, items = ITEMS): string {
  return [
    `mod-check の点検表 ${stamp} (日本時間)`,
    markCountLine(countMarks(marks, items), items.length),
    ...sortItems(marks, items).map(it => itemLine(it, markOf(marks, it.id))),
  ].join('\n')
}
