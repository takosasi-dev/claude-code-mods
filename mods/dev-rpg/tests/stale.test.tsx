import { expect, mock, test } from 'claude-code/testing'

import type { RpgSaved } from '../types'
import { INITIAL_SAVED, xpToReach } from '../hooks/rpg'

// 共通の手 (hooks/style.ts の rememberVersion / isStale / mayWrite) の試験。
// isStale は一度古いと分かると戻らず、モジュールの値はこのファイルの試験で共有するので、このファイルには 1 つだけ置く

const NOW = Date.parse('2026-10-22T03:00:00Z')
const norm = (p: string) => p.replace(/\\/g, '/')

test('版の数字はそのままで hooks の中身だけが変わったら、記録を書かずにトーストで 1 回だけ開き直しを頼む', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>([['hero', { ...INITIAL_SAVED, xp: xpToReach(5), futureField: 1 }]])
  let sets = 0
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    sets++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  // 偽の fs: plugin.json の版は変えず、hooks の 1 本の中身だけを変える
  let source = 'export const a = 1'
  on('fs.read', (_$, e) => {
    const p = norm(e.path)
    if (p.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ name: 'dev-rpg', version: '0.6.1' }) }
    if (p.endsWith('/hooks/rpg.ts')) return { value: source }
    return { deny: 'ENOENT' }
  })
  on('fs.list', (_$, e) =>
    norm(e.path).endsWith('/hooks')
      ? { value: [{ name: 'rpg.ts', kind: 'file' as const, size: source.length, mtimeMs: 0, isLink: false }] }
      : { deny: 'ENOENT' },
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  let turnNo = 0
  const turn = async () => {
    const turnId = `s${++turnNo}`
    await $.turn.start({ text: 'hi', turnId })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  }
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  // 中身が同じ間は書く
  await clock.advance(61_000)
  await turn()
  const before = sets
  const xp = (m.get('hero') as RpgSaved).xp
  expect(before).toBeGreaterThan(0)
  expect(xp).toBe(xpToReach(5) + 10)
  // 中身だけが変わった
  source = 'export const a = 2'
  await clock.advance(61_000)
  await turn()
  await turn()
  expect(sets).toBe(before)
  expect((m.get('hero') as RpgSaved).xp).toBe(xp)
  expect(toasts.filter(t => t.includes('新しい版が入りました'))).toHaveLength(1)
})
