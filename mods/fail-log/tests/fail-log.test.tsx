import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { KEEP, commandHead, failSvg, firstLine, jstDay, summarize, todayCount, topGroups } from '../hooks/faillog'
import type { FailEntry } from '../types'

const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'fail-log',
  component: 'Pane',
  requestId: 'fail-log',
  props: {
    title: '失敗の記録',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const CWD = 'D:\\proj'
// JST の 2026-10-21 12:00
const NOW = Date.parse('2026-10-21T03:00:00Z')
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

type Saved = Record<string, unknown>

/** エンジンの代わりに一番下で答える。コマンドに fail が入るか、ファイルが bad.ts なら失敗。deny.ts は断る */
const bottom = (on: On, saved: Saved = {}) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('store.get', (_$, e) => ({ value: saved[e.key] }))
  on('store.set', (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  on('tool.call', (_$, e) => {
    const x = e as unknown as Record<string, unknown>
    const cmd = String(x.command ?? '')
    const file = String(x.file_path ?? '')
    if (file.endsWith('deny.ts')) return { deny: 'だめ' }
    if (cmd.includes('fail')) return { isError: true as const, result: `Exit code 1\n${cmd} が失敗しました\nその後の行` }
    if (file.endsWith('bad.ts'))
      return { isError: true as const, result: undefined, text: '<tool_use_error>File has not been read yet. Read it first.</tool_use_error>' }
    return { result: 'ok' }
  })
  return clock
}

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool, ...input, ...(agentId ? { agentId } : {}) } as never)

/** 成功・失敗・断られたを混ぜて流す */
const flow = async ($: Engine) => {
  await call($, 'Bash', { command: 'cd app && npm test -- --fail' })
  await call($, 'Bash', { command: 'npm test fail-again' })
  await call($, 'Bash', { command: 'NODE_ENV=ci npm.cmd test --fail' })
  await call($, 'Bash', { command: 'git status' }) // 成功は数えない
  await call($, 'Edit', { file_path: 'D:\\proj\\src\\bad.ts', old_string: 'a', new_string: 'b' })
  await call($, 'Edit', { file_path: 'D:\\proj\\src\\deny.ts', old_string: 'a', new_string: 'b' }) // 断られた物も数えない
  await call($, 'Bash', { command: 'python -m fail.py' }, 'agent-1') // サブエージェント
}

type Found = { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }
const svgOf = async (ui: Found) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(x => String(x.text))

test('失敗だけを記録し、似た物をまとめて棒にし、最近の一覧と今日・通算を出す', async ($, on) => {
  const saved: Saved = {}
  bottom(on, saved)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  await flow($)
  expect((saved.entries as FailEntry[]).length).toBe(5)
  expect(saved.total).toBe(5)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(all).toContain('最近の失敗 5 件')
    // 新しい順。サブには印
    expect(all).toContain('12:00 Bash python -m fail.py (サブ)')
    expect(all).toContain('12:00 Edit bad.ts')
    expect(all).toContain('File has not been read yet. Read it first.')
    expect(all).toContain('Exit code 1: npm test fail-again が失敗しました')
    expect(all.some(s => s.includes('deny.ts') || s.includes('git status'))).toBe(false)
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toBe('今日 5 件 通算 5 件 種類 3')
      expect(svg).toContain('失敗の記録')
      expect(svg).toContain('>Bash npm test<')
      expect(svg).toContain('>3回<')
      expect(svg).toContain('>Bash python<')
      expect(svg).toContain('#bc8cff') // サブの棒
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(all[0]).toBe('今日 5 件 通算 5 件 種類 3')
      expect(all).toContain('  3回 Bash npm test')
      expect(all).toContain('  1回 Bash python (サブ 1)')
    }
    await ui.unmount()
  }
})

test('$.store は書く直前に読み直し、別のセッションで増えた分を消さない', async ($, on) => {
  const other: FailEntry = { at: NOW - 86_400_000, tool: 'Read', input: 'x.ts', error: 'ENOENT', group: 'Read x.ts', isSub: false }
  const saved: Saved = { entries: [other], total: 40 }
  bottom(on, saved)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  // セッションが始まった後に、別のセッションが 1 件足した
  const late: FailEntry = { ...other, at: NOW - 1000, error: 'late' }
  saved.entries = [other, late]
  saved.total = 41
  await call($, 'Bash', { command: 'make fail' })
  const list = saved.entries as FailEntry[]
  expect(list.map(x => x.error)).toEqual(['ENOENT', 'late', 'Exit code 1: make fail が失敗しました'])
  expect(saved.total).toBe(42)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 昨日の物は今日に数えず、時刻に月日が付く
  expect((await texts(ui))[0]).toBe('今日 2 件 通算 42 件 種類 2')
  expect(await ui.find({ type: 'Text', text: '10-20 12:00 Read x.ts' })).toBeDefined()
})

test('並んで落ちた失敗も取りこぼさず、200 件を超えたら古い物から捨てる', async ($, on) => {
  const saved: Saved = {}
  bottom(on, saved)
  await Promise.all(Array.from({ length: 5 }, (_, i) => call($, 'Bash', { command: `npm run fail${i}` })))
  expect((saved.entries as FailEntry[]).length).toBe(5)
  expect(saved.total).toBe(5)
  for (let i = 0; i < KEEP; i++) await call($, 'Bash', { command: `npm run fail-${i}` })
  const list = saved.entries as FailEntry[]
  expect(list.length).toBe(KEEP)
  expect(list.at(-1)?.input).toBe(`npm run fail-${KEEP - 1}`)
  expect(saved.total).toBe(KEEP + 5)
})

test('「記録を消す」は 2 度押しで消え、「やめる」で戻る', async ($, on) => {
  const saved: Saved = {}
  bottom(on, saved)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  await flow($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'clear' })
    expect((await ui.find({ key: 'clear' }))?.props.label).toBe('もう一度押すと消します')
    await ui.press({ key: 'cancel' })
    expect((await ui.find({ key: 'clear' }))?.props.label).toBe('記録を消す')
    expect((saved.entries as FailEntry[]).length).toBe(5)
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'clear' })
  await ui.press({ key: 'clear' })
  expect(saved.entries).toEqual([])
  expect(saved.total).toBe(0)
  expect(await svgOf(ui)).toContain('まだ失敗はありません')
  expect(await ui.find({ key: 'clear' })).toBeUndefined()
})

test('/errors を登録して開く。取れなければ /fail-log にして、/errors は横取りしない', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('store.get', () => ({ value: undefined }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'errors' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  on('command.run', { command: 'errors' }, () => ({ text: 'ほかの errors' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(await $.command.run({ command: 'errors', ...RUN })).toMatchObject({ text: '失敗の記録を開きました。' })
  isTaken = true
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['errors', 'errors', 'fail-log'])
  expect(await $.command.run({ command: 'errors', ...RUN })).toMatchObject({ text: 'ほかの errors' })
  expect(await $.command.run({ command: 'fail-log', ...RUN })).toMatchObject({ text: '失敗の記録を開きました。' })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  bottom(on)
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  await flow($)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgOf(ui)).toMatch(/fill="#ffffff"/)
  expect(await svgOf(ui)).toContain('fill="#cf222e"') // 明るい赤
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await svgOf(ui)).toMatch(/fill="#0d1117"/)
})

test('コマンドの頭の正規化: 移動・環境変数・パス・拡張子・フラグを外す', () => {
  expect(commandHead('cd app && npm test -- --watch')).toBe('npm test')
  expect(commandHead('NODE_ENV=ci FOO=1 npx vitest run a.ts')).toBe('npx vitest')
  expect(commandHead('C:\\tools\\Git.EXE --no-pager log')).toBe('git')
  expect(commandHead('"/usr/bin/python3" -m pytest')).toBe('python3')
  expect(commandHead('Set-Location D:\\x; node tools/a.mts')).toBe('node')
  expect(commandHead('cat a.txt | grep x')).toBe('cat')
  expect(commandHead('cargo build 2>&1')).toBe('cargo build')
  expect(commandHead('')).toBe('')
  expect(summarize('Bash', { command: 'ls\nrm -rf x' })).toEqual({ input: 'ls', group: 'Bash ls' })
  expect(summarize('NotebookEdit', { notebook_path: 'D:\\p\\a.ipynb' })).toEqual({ input: 'a.ipynb', group: 'NotebookEdit a.ipynb' })
  expect(summarize('WebFetch', { url: 'https://example.com/a?b' })).toEqual({ input: 'example.com', group: 'WebFetch example.com' })
  expect(summarize('mcp__srv__do_it', { x: 1 })).toEqual({ input: '', group: 'do_it' })
  expect(summarize('Read', { file_path: 'D:\\p\\a\u0007b.ts' }).input).toBe('ab.ts')
})

test('エラーの 1 行目: 札を外し、Exit code の行には次の行を付け、制御文字を落とす', () => {
  expect(firstLine('<tool_use_error>String not found</tool_use_error>')).toBe('String not found')
  expect(firstLine('\n\nExit code 2\n  boom \x1b[31mred\n')).toBe('Exit code 2: boom [31mred')
  expect(firstLine('Exit code 1')).toBe('Exit code 1')
  expect(firstLine('')).toBe('(エラーの文がありません)')
  expect(firstLine('x'.repeat(500)).length).toBe(160)
})

test('JST の日付で今日を数え、多くても SVG は上限に収まる', () => {
  expect(jstDay(Date.UTC(2026, 9, 20, 14, 59, 59))).toBe('2026-10-20')
  expect(jstDay(Date.UTC(2026, 9, 20, 15, 0, 0))).toBe('2026-10-21')
  const e = (at: number, group: string, isSub = false): FailEntry => ({ at, tool: 'Bash', input: '', error: 'x', group, isSub })
  expect(todayCount([e(Date.UTC(2026, 9, 20, 14, 59), 'a'), e(Date.UTC(2026, 9, 20, 15, 1), 'a')], NOW)).toBe(1)
  const groups = topGroups([e(1, 'a'), e(2, 'b', true), e(3, 'b'), e(4, 'c')])
  expect(groups.map(g => [g.group, g.count, g.subs])).toEqual([
    ['b', 2, 1],
    ['c', 1, 0],
    ['a', 1, 0],
  ])
  const many = Array.from({ length: KEEP }, (_, i) => e(NOW - i * 1000, `Bash cmd${i % 50}\u0007<&>${'長'.repeat(40)}`, i % 4 === 0))
  const svg = failSvg(many, 99_999, NOW)
  expect(svg.length).toBeLessThan(131_072)
  expect(svg).not.toMatch(CTRL)
  expect(svg).toContain('&lt;&amp;&gt;')
})
