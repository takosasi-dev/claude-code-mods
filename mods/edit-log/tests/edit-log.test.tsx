import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { countLines, diffBody, fileStats, linesOf, overviewSvg, parentDir, relPath } from '../hooks/editlog'
import type { EditLogEntry } from '../types'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'edit-log',
  component: 'Pane',
  requestId: 'edit-log',
  props: {
    title: '変更ログ',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,2 +1,2 @@',
  ' const a = 1\r',
  '-const b = 2',
  '+const b = 3',
  '',
].join('\n')

type World = {
  repo: 'none' | 'repo'
  diff: string
  calls: string[][]
  noHead?: boolean
  /** process.run に渡った cwd と env */
  inits?: { cwd?: string; env?: Record<string, string> }[]
}

/** git の argv から全体オプション (-c の対と -- で始まる物) を飛ばした、サブコマンドから後ろ */
const sub = (argv: readonly string[]) => {
  let i = 1
  while (i < argv.length && (argv[i] === '-c' || (argv[i] ?? '').startsWith('--'))) i += argv[i] === '-c' ? 2 : 1
  return argv.slice(i)
}
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

// エンジンの代わりに一番下で答える: cwd・ツール・git
const bottom = (on: On, world: World) => {
  mock.clock(on, { now: NOW })
  on('session.cwd', () => ({ value: CWD }))
  on('tool.call', (_$, e) => {
    const input = e as unknown as { content?: string }
    return input.content === 'boom' ? { isError: true as const, result: 'boom', text: 'boom' } : { result: 'ok' as never }
  })
  on('process.run', (_$, e) => {
    world.calls.push([...e.argv])
    world.inits?.push({ cwd: e.init?.cwd, env: e.init?.env })
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    // git はファイルの親フォルダで走らせる
    const cwd = e.init?.cwd ?? ''
    if (cwd !== CWD && !cwd.startsWith(`${CWD}/`) && !cwd.startsWith('/tmp/other/')) return out('', 1, 'wrong cwd')
    if (world.repo === 'none') return out('', 128, 'fatal: not a git repository')
    const args = sub(e.argv)
    if (args[0] === 'rev-parse') return out('true\n')
    // まだコミットの無いリポジトリでは HEAD と比べられない
    if (args[0]?.startsWith('diff') && world.noHead && args.includes('HEAD')) return out('', 128, "fatal: bad revision 'HEAD'")
    if (args[0]?.startsWith('diff')) return out(world.diff)
    return out('', 1, `unexpected: ${args.join(' ')}`)
  })
}

const edit = ($: Engine, file: string, oldS: string, newS: string, agentId?: string) =>
  $.tool.call({ tool: 'Edit', file_path: file, old_string: oldS, new_string: newS, ...(agentId ? { agentId } : {}) } as never)
const write = ($: Engine, file: string, content: string) => $.tool.call({ tool: 'Write', file_path: file, content } as never)

test('数え方・相対パス・差分の取り出し', () => {
  expect([countLines(''), countLines('a'), countLines('a\nb\n'), countLines('a\r\nb'), countLines(3)]).toEqual([0, 1, 2, 2, 0])
  expect(linesOf('Edit', { old_string: 'a\nb\nc', new_string: 'x' })).toBe(3)
  expect(linesOf('Write', { content: '1\n2\n3\n4\n' })).toBe(4)
  expect(linesOf('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'd', new_string: 'e' }] })).toBe(3)
  expect(linesOf('NotebookEdit', { new_source: 'x\ny' })).toBe(2)
  expect(linesOf('Bash', { command: 'ls' })).toBe(0)

  expect(relPath('/tmp/demo', '/tmp/demo/src/a.ts')).toBe('src/a.ts')
  expect(relPath('X:\\tmp\\demo\\', 'x:\\tmp\\demo\\b.ts')).toBe('b.ts')
  expect(relPath('/tmp/demo', '/tmp/demo2/c.ts')).toBe('/tmp/demo2/c.ts')
  expect(relPath('', '/tmp/demo/d.ts')).toBe('/tmp/demo/d.ts')

  const body = diffBody(DIFF)
  expect(body?.diff.startsWith('@@ -1,2 +1,2 @@')).toBe(true)
  expect(body?.diff).not.toMatch(/\r|diff --git|\+\+\+/)
  expect(body?.isCut).toBe(false)
  expect(diffBody('')).toBeUndefined()
  expect(diffBody('Binary files a/x.png and b/x.png differ\n')).toBeUndefined()
  // 長いときはハンクの切れ目で切る
  const hunk = (i: number) => `@@ -${i},1 +${i},1 @@\n-${'a'.repeat(40)}\n+${'b'.repeat(40)}`
  const long = diffBody([1, 2, 3, 4].map(hunk).join('\n'), 200)
  expect(long?.isCut).toBe(true)
  expect(long?.diff).toBe([1, 2].map(hunk).join('\n'))

  const entry = (id: number, label: string, isError = false): EditLogEntry => ({
    id,
    at: NOW + id,
    file: `/tmp/demo/${label}`,
    label,
    tool: 'Edit',
    isError,
    lines: 2,
    isSub: false,
  })
  const stats = fileStats([entry(1, 'a.ts'), entry(2, 'b.ts'), entry(3, 'b.ts', true), entry(4, 'c.ts')])
  expect(stats.map(s => [s.label, s.count, s.fails, s.lines])).toEqual([
    ['b.ts', 2, 1, 2],
    ['c.ts', 1, 0, 2],
    ['a.ts', 1, 0, 2],
  ])
  const svg = overviewSvg([entry(1, '<x>&.ts')])
  expect(svg).toMatch(/&lt;x&gt;&amp;\.ts/)
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
  expect(overviewSvg([])).toMatch(/まだ変更はありません/)
})

for (const surface of SURFACES) {
  test(`${surface}: 記録してタイルと一覧が出る。サブエージェントと失敗に印`, async ($, on) => {
    bottom(on, { repo: 'repo', diff: DIFF, calls: [] })
    await edit($, '/tmp/demo/src/app.ts', 'a\nb', 'c')
    await edit($, '/tmp/demo/src/app.ts', 'x', 'y', 'agent-1')
    await write($, '/tmp/demo/README.md', 'boom')
    await $.tool.call({ tool: 'Read', file_path: '/tmp/demo/src/app.ts' } as never)
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/tmp/demo/nb.ipynb', new_source: 'print(1)' } as never)

    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      const src = String(svg?.props.source)
      expect(src).toMatch(/>3本</)
      expect(src).toMatch(/>4回</)
      expect(src).toMatch(/fill="#f85149">1回</)
      expect(src).toMatch(/うちサブ 1 回/)
      expect(src).toMatch(/>サブ</)
      expect(src).toMatch(/src\/app\.ts/)
      expect(src).toMatch(/>NotebookEdit</)
      expect(src).toMatch(/約2行/)
      expect(String(svg?.props.alt)).toMatch(/触ったファイル 3本 \/ 変更 4回 \/ 失敗 1回/)
      expect(await ui.find({ key: 'lines' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '触ったファイル 3本 / 変更 4回 / 失敗 1回' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /Write 失敗 README\.md$/ }))?.props.color).toBe('red')
      expect(await ui.find({ type: 'Text', text: /Edit\(サブ\) 約1行 src\/app\.ts$/ })).toBeDefined()
    }
    // ファイルのボタン (回数の多い順)
    const buttons = (await ui.findAll({ type: 'Button' })).map(b => b.key)
    expect(buttons).toEqual(['file:src/app.ts', 'file:nb.ipynb', 'file:README.md', 'reset'])
    expect((await ui.find({ key: 'file:README.md' }))?.text).toMatch(/1回 失敗1/)
  })

  test(`${surface}: ファイルを押すと履歴と git の差分。ボタンで入力欄へ。戻る`, async ($, on) => {
    const world: World = { repo: 'repo', diff: DIFF, calls: [] }
    bottom(on, world)
    const filled: string[] = []
    const modes: string[] = []
    on('prompt.fill', (_$, e) => {
      filled.push(e.text)
      modes.push(e.mode)
      return { isFilled: true }
    })
    await edit($, '/tmp/demo/src/app.ts', 'a', 'b')
    await edit($, '/tmp/demo/src/app.ts', 'c', 'd')
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'file:src/app.ts' })

    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(String(code?.props.source)).toMatch(/^@@ -1,2 \+1,2 @@\n const a = 1\n-const b = 2\n\+const b = 3$/)
    expect(world.calls.map(a => sub(a)[0])).toEqual(['rev-parse', 'diff-index'])
    expect(world.calls[1]?.slice(-3)).toEqual(['HEAD', '--', '/tmp/demo/src/app.ts'])
    if (surface === 'vscode') {
      const src = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(src).toMatch(/>app\.ts</)
      expect(src).toMatch(/このファイルの変更履歴/)
      expect(src).toMatch(/>2回</)
    } else {
      expect(await ui.find({ type: 'Text', text: '変更 2回 / 失敗 0回' })).toBeDefined()
    }

    await ui.press({ key: 'review' })
    await ui.press({ key: 'explain' })
    expect(filled[0]).toMatch(/^src\/app\.ts をレビュー/)
    expect(filled[1]).toMatch(/^src\/app\.ts に.*説明/)
    expect(modes).toEqual(['insert', 'insert'])
    expect(await ui.find({ type: 'Text', text: '入力欄に入れました(送信はしていません)' })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ key: 'file:src/app.ts' })).toBeDefined()
  })

  test(`${surface}: git でないフォルダ・差分なし・入力欄に入らない`, async ($, on) => {
    const world: World = { repo: 'none', diff: '', calls: [] }
    bottom(on, world)
    on('prompt.fill', () => ({ isFilled: false, refusal: 'dialog' as const }))
    await write($, '/tmp/demo/new.txt', 'hello')
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'file:new.txt' })
    expect(await ui.find({ type: 'Text', text: '差分は git のフォルダでだけ出ます' })).toBeDefined()
    expect(world.calls).toHaveLength(1)

    world.repo = 'repo'
    await ui.press({ key: 'back' })
    await ui.press({ key: 'file:new.txt' })
    expect(await ui.find({ type: 'Text', text: /^git の差分はありません/ })).toBeDefined()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    await ui.press({ key: 'review' })
    expect(await ui.find({ type: 'Text', text: /^入力欄に入れられませんでした: / })).toBeDefined()
  })
}

test('リセットと /clear で空になる', async ($, on) => {
  bottom(on, { repo: 'repo', diff: DIFF, calls: [] })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await edit($, '/tmp/demo/a.ts', 'a', 'b')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'file:a.ts' })).toBeDefined()
  await ui.press({ key: 'reset' })
  expect(await ui.find({ type: 'Text', text: 'まだ変更はありません' })).toBeDefined()
  expect(await ui.find({ key: 'reset' })).toBeUndefined()

  await edit($, '/tmp/demo/b.ts', 'a', 'b')
  expect(await ui.find({ key: 'file:b.ts' })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(await ui.find({ key: 'file:b.ts' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'まだ変更はありません' })).toBeDefined()
})

test('/edits を登録して開く。取れなければ /edit-log', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'edits' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  let opened = ''
  on('ui.open', (_$, e) => {
    opened = e.id
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['edits'])
  isTaken = true
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['edits', 'edits', 'edit-log'])

  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect((await $.command.run({ command: 'edit-log', ...run })).text).toBe('変更ログを開きました。')
  expect(opened).toBe('edit-log')
})

test('まだコミットが無いリポジトリでは HEAD を使わずに差分を読む', async ($, on) => {
  const world: World = { repo: 'repo', diff: DIFF, calls: [], noHead: true }
  bottom(on, world)
  await edit($, '/tmp/demo/src/app.ts', 'a', 'b')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'file:src/app.ts' })
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
  expect(world.calls.slice(1).map(a => a.includes('HEAD'))).toEqual([true, false])
})

// ── v0.1.1 で直した物

test('git はファイルの親フォルダで、textconv・pathspec の解釈・任意のロック・fsmonitor を止めて走らせる', async ($, on) => {
  const world: World = { repo: 'repo', diff: DIFF, calls: [], inits: [] }
  bottom(on, world)
  await edit($, '/tmp/demo/src/a[1].ts', 'a', 'b')
  // 作業フォルダの外 (別の worktree) のファイル
  await edit($, '/tmp/other/wt/x.ts', 'a', 'b')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'file:src/a[1].ts' })
  const diff = world.calls.find(a => sub(a)[0]?.startsWith('diff'))
  expect(diff).toBeDefined()
  expect(sub(diff ?? [])[0]).toBe('diff-index')
  expect(diff).toContain('--no-textconv')
  expect(diff).toContain('--no-ext-diff')
  // --literal-pathspecs は全体オプションなのでサブコマンドより前
  expect((diff ?? []).indexOf('--literal-pathspecs')).toBeGreaterThan(0)
  expect((diff ?? []).indexOf('--literal-pathspecs')).toBeLessThan((diff ?? []).indexOf('diff-index'))
  expect(diff).toContain('core.fsmonitor=false')
  expect(diff?.slice(-1)).toEqual(['/tmp/demo/src/a[1].ts'])
  expect(world.inits?.every(i => i.cwd === '/tmp/demo/src' && i.env?.GIT_OPTIONAL_LOCKS === '0')).toBe(true)

  await ui.press({ key: 'back' })
  world.inits = []
  await ui.press({ key: 'file:/tmp/other/wt/x.ts' })
  expect(world.inits.map(i => i.cwd)).toEqual(['/tmp/other/wt', '/tmp/other/wt'])
  expect(await ui.find({ type: 'Code' })).toBeDefined()
})

test('バイナリか権限だけの変更は、差分なしと分けて出す', async ($, on) => {
  const world: World = { repo: 'repo', diff: 'diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n', calls: [] }
  bottom(on, world)
  await write($, '/tmp/demo/x.png', 'png')
  await write($, '/tmp/demo/run.sh', 'echo')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'file:x.png' })
  expect(await ui.find({ type: 'Text', text: 'バイナリか権限だけの変更です' })).toBeDefined()
  world.diff = 'diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n'
  await ui.press({ key: 'back' })
  await ui.press({ key: 'file:run.sh' })
  expect(await ui.find({ type: 'Text', text: 'バイナリか権限だけの変更です' })).toBeDefined()
  world.diff = ''
  await ui.press({ key: 'back' })
  await ui.press({ key: 'file:run.sh' })
  expect(await ui.find({ type: 'Text', text: /^git の差分はありません/ })).toBeDefined()
})

for (const surface of SURFACES) {
  test(`${surface}: ファイル名の制御文字を落として描く`, async ($, on) => {
    bottom(on, { repo: 'repo', diff: DIFF, calls: [] })
    await edit($, '/tmp/demo/a\bb\x1b.ts', 'a', 'b')
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).not.toMatch(CTRL)
      expect(String(svg?.props.alt)).not.toMatch(CTRL)
    }
    const button = await ui.find({ key: 'file:ab.ts' })
    expect(button?.text).not.toMatch(CTRL)
    await ui.press({ key: 'file:ab.ts' })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toMatch(CTRL)
    else expect(await ui.find({ type: 'Text', text: 'ab.ts' })).toBeDefined()
  })
}

test('/edits が拒まれて /edit-log にした時は、/edits を横取りしない', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('command.register', (_$, e) => (e.name === 'edits' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  on('command.run', { command: 'edits' }, () => ({ text: '組み込みの edits' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'edits', ...run })).toMatchObject({ text: '組み込みの edits' })
  expect(await $.command.run({ command: 'edit-log', ...run })).toMatchObject({ text: '変更ログを開きました。' })
})

test('親フォルダ: 根は区切りを残し、相対パスは空', () => {
  expect(parentDir('/tmp/demo/src/a.ts')).toBe('/tmp/demo/src')
  expect(parentDir('/a.ts')).toBe('/')
  expect(parentDir('X:/a.ts')).toBe('X:/')
  expect(parentDir('X:/tmp/b.ts')).toBe('X:/tmp')
  expect(parentDir('src/a.ts')).toBe('')
  expect(parentDir('a.ts')).toBe('')
})
