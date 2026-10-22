import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HistoryWeekDay } from '../types'
import { EMPTY_DAY } from '../hooks/history'

// 直近 7 日 (state の week) と、控え (backupDir)・古い版のまま書かないこと
// 版を変える試験はモジュールの中の「古い版」の印を残すので、このファイルの最後に置く
const NOW = Date.parse('2026-10-22T03:00:00Z') // 日本時間 10/22(木) 12:00
const DAY = 86_400_000
const DIR = 'D:/backup'
const OPTIONS = { options: { backupDir: DIR } }
const PANE = {
  plugin: 'usage-history',
  component: 'Pane',
  requestId: 'usage-history',
  props: { title: '使い方の記録', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** 区切りをそろえる (Windows ではエンジンが \ に直して渡すことがある) */
const norm = (p: string) => p.replace(/\\/g, '/')
const heatOf = (n: number) => Array.from({ length: 168 }, (_, k) => (k === 0 ? n : 0))

const boot = async ($: Engine, on: On, store: Record<string, unknown>, files: Map<string, string> = new Map()) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(Object.entries(store))
  let sets = 0
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    sets++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  // 偽の fs: 控えのファイルと、版を読む plugin.json
  let version = '0.2.0'
  const writes: string[] = []
  on('fs.read', (_$, e) => {
    const p = norm(e.path)
    if (p.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ name: 'usage-history', version }) }
    const f = files.get(p)
    return f === undefined ? { deny: 'ENOENT' } : { value: f }
  })
  on('fs.write', (_$, e) => {
    writes.push(norm(e.path))
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  let week: HistoryWeekDay[] | undefined
  on('state.set', async (_$, e, next) => {
    const r = await next(e)
    if (e.plugin === 'usage-history' && e.key === 'week' && r.value?.isSet) week = e.value as HistoryWeekDay[]
    return r
  })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'vscode', isInteractive: true })
  return {
    clock,
    files,
    writes,
    toasts,
    raw: m,
    sets: () => sets,
    week: () => week,
    setVersion: (v: string) => (version = v),
  }
}

let turnNo = 0
const turn = async ($: Engine, clock: { settle: () => Promise<void> }) => {
  await $.turn.complete({ answer: 'ok', durationMs: 90_000, isAborted: false, turnId: `k${++turnNo}`, reason: 'answer' })
  await clock.settle()
}

test('state の week は今日で終わる 7 日 (古い順)。ターンの終わりに置き換わり、分は所要時間から', async ($, on) => {
  const s = await boot($, on, { days: { '2026-10-16': { ...EMPTY_DAY, turns: 4, tools: 9, inputTokens: 10, outputTokens: 20, durationMs: 300_000 }, '2026-10-15': { ...EMPTY_DAY, turns: 99 } } })
  // セッションの始まりに置く
  expect(s.week()?.map(d => d.day)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'])
  expect(s.week()?.[0]).toEqual({ day: '2026-10-16', turns: 4, tools: 9, inputTokens: 10, outputTokens: 20, minutes: 5 })
  await turn($, s.clock)
  await turn($, s.clock)
  expect(s.week()?.at(-1)).toEqual({ day: '2026-10-22', turns: 2, tools: 0, inputTokens: 0, outputTokens: 0, minutes: 3 })
})

test('控えは JST の日に 1 回だけ、days と heat の生の値 (知らない欄ごと) を書く。日が変わればまた書く', OPTIONS, async ($, on) => {
  const days = { futureField: 1, '2026-10-21': { ...EMPTY_DAY, turns: 7 } }
  const s = await boot($, on, { days, heat: heatOf(3) })
  for (let i = 0; i < 3; i++) await turn($, s.clock)
  expect(s.writes).toHaveLength(2)
  expect(s.writes[0]).toMatch(/\/backup\/usage-history\/days-\d\.json$/)
  expect(s.writes[1]).toMatch(/\/backup\/usage-history\/heat-\d\.json$/)
  const body = JSON.parse(s.files.get(s.writes[0]!)!) as { day: string; value: unknown }
  // セッションの始まりに読んだ値 (今日のターンを足す前) を、知らない欄ごと
  expect(body).toEqual({ day: '2026-10-22', value: days })
  await s.clock.advance(DAY)
  await turn($, s.clock)
  expect(s.writes).toHaveLength(4)
  expect(s.writes[2]).not.toBe(s.writes[0])
  await turn($, s.clock)
  expect(s.writes).toHaveLength(4)
})

test('「控えから戻す」で日付を選び、確かめてから戻すと、記録が控えの値になる', OPTIONS, async ($, on) => {
  const old = { futureField: 1, '2026-10-18': { ...EMPTY_DAY, turns: 30 } }
  const files = new Map([
    [`${DIR}/usage-history/days-0.json`, JSON.stringify({ day: '2026-10-18', value: old })],
    [`${DIR}/usage-history/heat-0.json`, JSON.stringify({ day: '2026-10-18', value: heatOf(30) })],
  ])
  const s = await boot($, on, { days: { '2026-10-21': { ...EMPTY_DAY, turns: 2 } }, heat: heatOf(2) }, files)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'restore' })
  // 今日の分 (セッションの始まりに控えた物) と、前の日の分が新しい順に並ぶ
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => /^restore:\d/.test(k))
  expect(keys).toEqual(['restore:2026-10-22', 'restore:2026-10-18'])
  await ui.press({ key: 'restore:2026-10-18' })
  expect(await ui.find({ type: 'Text', text: '2026-10-18 の記録に戻しますか。今の記録は上書きされます' })).toBeDefined()
  // やめると戻らない
  await ui.press({ key: 'restore:no' })
  expect(s.raw.get('days')).not.toEqual(old)
  await ui.press({ key: 'restore:2026-10-18' })
  await ui.press({ key: 'restore:yes' })
  expect(s.raw.get('days')).toEqual(old)
  expect(s.raw.get('heat')).toEqual(heatOf(30))
  expect(s.week()?.find(d => d.day === '2026-10-18')?.turns).toBe(30)
  expect(await ui.find({ type: 'Text', text: '2026-10-18 の記録に戻しました' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'restore:yes' })).toBeUndefined()
  // その後のターンは戻した記録に足し、知らない欄も残る
  await turn($, s.clock)
  expect(s.raw.get('days')).toMatchObject({ futureField: 1, '2026-10-18': { turns: 30 }, '2026-10-22': { turns: 1 } })
  expect(s.raw.get('days')).not.toHaveProperty('2026-10-21')
})

test('backupDir が空なら控えを取らず、「控えから戻す」に設定のしかたを出す', async ($, on) => {
  const s = await boot($, on, { days: { '2026-10-21': { ...EMPTY_DAY, turns: 2 } } })
  await turn($, s.clock)
  expect(s.writes).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'restore' })
  expect((await ui.find({ type: 'Text', text: '設定の backupDir を入れると控えが取れます' }))?.props.dimColor).toBe(true)
  await ui.press({ key: 'restore:close' })
  expect(await ui.find({ type: 'Text', text: '設定の backupDir を入れると控えが取れます' })).toBeUndefined()
})

// ここから下は「古い版」の印が残る。新しい試験はこの上に足す
test('新しい版が入ったら (plugin.json の版が変わったら) 記録を書かず、トーストで 1 回だけ開き直しを頼む。戻すこともしない', OPTIONS, async ($, on) => {
  const s = await boot($, on, { days: { '2026-10-21': { ...EMPTY_DAY, turns: 2 } } })
  await turn($, s.clock)
  const before = s.sets()
  const saved = JSON.stringify(s.raw.get('days'))
  s.setVersion('0.3.0')
  await s.clock.advance(61_000)
  await turn($, s.clock)
  await turn($, s.clock)
  expect(s.sets()).toBe(before)
  expect(JSON.stringify(s.raw.get('days'))).toBe(saved)
  expect(s.toasts.filter(t => t.includes('新しい版が入りました'))).toHaveLength(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'restore' })
  await ui.press({ key: 'restore:2026-10-22' })
  await ui.press({ key: 'restore:yes' })
  expect(s.sets()).toBe(before)
  expect(await ui.find({ type: 'Text', text: '新しい版が入りました。VS Code を開き直すまで記録は書きません' })).toBeDefined()
})
