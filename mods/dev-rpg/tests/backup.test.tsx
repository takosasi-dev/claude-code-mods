import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { RpgHero, RpgSaved } from '../types'
import { INITIAL_SAVED, xpToReach } from '../hooks/rpg'

// 控え (backupDir) と、古い版のまま書かないこと
const NOW = Date.parse('2026-10-22T03:00:00Z')
const DAY = 86_400_000
const DIR = 'D:/backup'
const OPTIONS = { options: { backupDir: DIR } }
const PANE = {
  plugin: 'dev-rpg',
  component: 'Pane',
  requestId: 'dev-rpg',
  props: { title: '冒険の書', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** 区切りをそろえる (Windows ではエンジンが \ に直して渡すことがある) */
const norm = (p: string) => p.replace(/\\/g, '/')

const boot = async ($: Engine, on: On, saved: Record<string, unknown>, files: Map<string, string> = new Map()) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>([['hero', saved]])
  let sets = 0
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    sets++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  // 偽の fs: 控えのファイルと、版を読む plugin.json
  let version = '0.6.0'
  const writes: string[] = []
  on('fs.read', (_$, e) => {
    const p = norm(e.path)
    if (p.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ name: 'dev-rpg', version }) }
    const f = files.get(p)
    return f === undefined ? { deny: 'ENOENT' } : { value: f }
  })
  on('fs.write', (_$, e) => {
    writes.push(norm(e.path))
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  let hero: RpgHero | undefined
  on('state.set', async (_$, e, next) => {
    const r = await next(e)
    if (e.plugin === 'dev-rpg' && e.key === 'hero' && r.value?.isSet) hero = e.value as RpgHero
    return r
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return {
    clock,
    files,
    writes,
    toasts,
    sets: () => sets,
    stored: () => m.get('hero') as RpgSaved & Record<string, unknown>,
    hero: () => hero!,
    setVersion: (v: string) => (version = v),
  }
}

let turnNo = 0
const turn = async ($: Engine) => {
  const turnId = `k${++turnNo}`
  await $.turn.start({ text: 'hi', turnId })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
}

const SAVED = { ...INITIAL_SAVED, xp: xpToReach(12), turns: 40, futureField: 1 }

test('控えは JST の日に 1 回だけ、store の生の値 (知らない欄ごと) を書く。日が変わればまた書く', OPTIONS, async ($, on) => {
  const s = await boot($, on, SAVED)
  for (let i = 0; i < 3; i++) await turn($)
  expect(s.writes).toHaveLength(1)
  const path = s.writes[0]!
  expect(path).toMatch(/\/backup\/dev-rpg\/hero-\d\.json$/)
  const body = JSON.parse(s.files.get(path)!) as { day: string; value: Record<string, unknown> }
  expect(body.day).toBe('2026-10-22')
  // セッションの始まりに読んだ値 (冒険の回数を足す前) を、知らない欄ごと
  expect(body.value).toMatchObject({ xp: xpToReach(12), turns: 40, futureField: 1 })
  await s.clock.advance(DAY)
  await turn($)
  expect(s.writes).toHaveLength(2)
  expect(s.writes[1]).not.toBe(path)
  await turn($)
  expect(s.writes).toHaveLength(2)
})

test('「控えから戻す」で日付を選び、確かめてから戻すと、記録が控えの値になる', OPTIONS, async ($, on) => {
  const old = { ...INITIAL_SAVED, xp: xpToReach(20), turns: 300, deepest: 12, futureField: 1 }
  const files = new Map([[`${DIR}/dev-rpg/hero-1.json`, JSON.stringify({ day: '2026-10-19', value: old })]])
  const s = await boot($, on, { ...INITIAL_SAVED, xp: 10 }, files)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'restore' })
  // 今日の分 (セッションの始まりに控えた物) と、前の日の分が新しい順に並ぶ
  const days = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => /^restore:\d/.test(k))
  expect(days).toEqual(['restore:2026-10-22', 'restore:2026-10-19'])
  expect((await ui.find({ type: 'Button', key: 'restore:2026-10-19' }))?.text).toBe('2026-10-19 の記録 (Lv 20)')
  await ui.press({ key: 'restore:2026-10-19' })
  expect(await ui.find({ type: 'Text', text: '2026-10-19 の記録に戻しますか。今の記録は上書きされます' })).toBeDefined()
  // やめると戻らない
  await ui.press({ key: 'restore:no' })
  expect(s.stored().xp).not.toBe(old.xp)
  await ui.press({ key: 'restore:2026-10-19' })
  await ui.press({ key: 'restore:yes' })
  expect(s.stored()).toEqual(old)
  expect(s.hero()).toMatchObject({ xp: old.xp, turns: 300, deepest: 12 })
  expect(await ui.find({ type: 'Text', text: '2026-10-19 の記録に戻しました' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'restore:yes' })).toBeUndefined()
  // その後のターンは戻した記録に足す
  await turn($)
  expect(s.stored()).toMatchObject({ xp: old.xp + 10, turns: 301, futureField: 1 })
})

test('新しい版が入ったら (plugin.json の版が変わったら) 記録を書かず、トーストで 1 回だけ開き直しを頼む', OPTIONS, async ($, on) => {
  const s = await boot($, on, SAVED)
  await turn($)
  const before = s.sets()
  const xp = s.stored().xp
  s.setVersion('0.7.0')
  await s.clock.advance(61_000)
  await turn($)
  await turn($)
  expect(s.sets()).toBe(before)
  expect(s.stored().xp).toBe(xp)
  expect(s.toasts.filter(t => t.includes('新しい版が入りました'))).toHaveLength(1)
  // 戻すことも、やり直すこともしない
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'restore' })
  await ui.press({ key: 'restore:2026-10-22' })
  await ui.press({ key: 'restore:yes' })
  expect(s.sets()).toBe(before)
  expect(await ui.find({ type: 'Text', text: '新しい版が入りました。VS Code を開き直すまで記録は書きません' })).toBeDefined()
})

test('backupDir が空なら控えを取らず、「控えから戻す」に設定のしかたを出す', async ($, on) => {
  const s = await boot($, on, SAVED)
  await turn($)
  expect(s.writes).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'restore' })
  expect((await ui.find({ type: 'Text', text: '設定の backupDir を入れると控えが取れます' }))?.props.dimColor).toBe(true)
  await ui.press({ key: 'restore:close' })
  expect(await ui.find({ type: 'Text', text: '設定の backupDir を入れると控えが取れます' })).toBeUndefined()
})
