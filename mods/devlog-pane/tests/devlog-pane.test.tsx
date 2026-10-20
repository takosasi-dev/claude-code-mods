import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { HEAD, fit, jstDate } from '../hooks/text'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const LOG_DIR = '/tmp/demo/devlog'
const E_LOG = `${LOG_DIR}/2026-10-03.md`
const OPTIONS = { options: { logDir: LOG_DIR } }
// JST 2026-10-03 00:30
const NOW = Date.UTC(2026, 9, 2, 15, 30)

const PANE = {
  component: 'Pane',
  requestId: 'devlog',
  props: {
    title: '開発ログ',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// エンジンは Windows で /tmp/... を <ドライブ>:\tmp\... に直して渡すので、区切りとドライブをそろえて比べる
const key = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

// files にあるファイルだけが読める世界
const world = (on: On, files: Map<string, { text: string; mtimeMs: number }>) => {
  const reads: string[] = []
  on('fs.stat', (_$, e) => {
    const file = files.get(key(e.path))
    if (!file) throw new Error('ENOENT')
    return { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    const file = files.get(key(e.path))
    if (!file) throw new Error('ENOENT')
    return { value: file.text }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return reads
}

const runDevlog = ($: Engine) =>
  $.command.run({
    command: 'devlog',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

test('日付は JST の境界で切り替わる', () => {
  expect(jstDate(Date.UTC(2026, 9, 2, 14, 59, 59))).toBe('2026-10-02')
  expect(jstDate(Date.UTC(2026, 9, 2, 15, 0, 0))).toBe('2026-10-03')
  expect(jstDate(Date.UTC(2026, 11, 31, 15, 0, 0))).toBe('2027-01-01')
})

test('長文は後ろ側を行頭から残し、前略を付ける', () => {
  const lines = Array.from({ length: 20000 }, (_, i) => `line-${String(i).padStart(5, '0')}`)
  const text = lines.join('\n')
  const out = fit(text)
  // Markdown は 1 回の描画で 10 万字まで描ける
  expect(out.length).toBeLessThanOrEqual(100000)
  expect(out.length).toBeGreaterThan(90000)
  expect(out.startsWith(HEAD)).toBe(true)
  expect(out.slice(HEAD.length)).toMatch(/^line-\d{5}\n/)
  expect(out.endsWith('line-19999')).toBe(true)
  // 1 万字を超えても 10 万字までは削らない
  const mid = 'a'.repeat(50000)
  expect(fit(mid)).toBe(mid)
  expect(fit('a\r\nb')).toBe('a\nb')
  expect(fit('短い')).toBe('短い')
})

test('ファイルが無い日は dim で知らせる(全画面種)', OPTIONS, async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, new Map())
  await runDevlog($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'devlog-pane', surface, ...PANE })
    const found = await ui.find({ type: 'Text' })
    expect(found?.text).toBe(`今日の開発ログはまだありません(${E_LOG})`)
    expect(found?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('ログを Markdown で出し、30 秒ごとに mtime が変わったときだけ読み直す', OPTIONS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files = new Map([[E_LOG, { text: '# 2026-10-03 開発ログ\n\n- 一つ目', mtimeMs: 1 }]])
  const reads = world(on, files)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({
    value: [{ id: 'devlog', title: '開発ログ', isShown: true, isFocused: false, isPlaced: true }],
  }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'terminal', isInteractive: true })
  await runDevlog($)

  const ui = await $.ui.mount({ plugin: 'devlog-pane', surface: 'terminal', ...PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# 2026-10-03 開発ログ\n\n- 一つ目')

  await clock.advance(30_000)
  expect(reads).toHaveLength(1)

  files.set(E_LOG, { text: '# 2026-10-03 開発ログ\n\n- 二つ目', mtimeMs: 2 })
  await clock.advance(30_000)
  expect(reads).toHaveLength(2)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# 2026-10-03 開発ログ\n\n- 二つ目')
  await ui.unmount()
})

test('フォルダが未設定なら読まずに設定のしかたを出す', async ($, on) => {
  mock.clock(on, { now: NOW })
  const reads = world(on, new Map())
  await runDevlog($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'devlog-pane', surface, ...PANE })
    expect((await ui.find({ type: 'Text' }))?.text).toMatch(/未設定/)
    await ui.unmount()
  }
  expect(reads).toHaveLength(0)
})
