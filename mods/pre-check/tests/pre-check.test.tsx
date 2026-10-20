import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock, TestBody } from 'claude-code/testing'

import { itemsOf, mask, parseNumstat, scanPatch, verdictOf } from '../hooks/check'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const SET = { options: { testCommand: 'npm test', timeoutSeconds: 300 } }
const PANE = {
  plugin: 'pre-check',
  component: 'Pane',
  requestId: 'pre-check',
  props: {
    title: 'コミット前',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
// どれも明らかな偽物
const FAKE_AWS = 'AKIAEXAMPLEEXAMPLE00'
const FAKE_PW = 'hunter2hunter2'

// 実物の git (diff-index --cached -p -U0 --no-textconv ...) で取った形。空白を含む名前の後ろのタブも実物のとおり
const STAGED_PATCH = [
  'diff --git a/keep.txt b/keep.txt',
  'index 422c2b7..1d26929 100644',
  '--- a/keep.txt',
  '+++ b/keep.txt',
  '@@ -1,0 +2,2 @@ a',
  `+key = "${FAKE_AWS}"`,
  '+<<<<<<< HEAD',
  '@@ -2,0 +5 @@ b',
  '+=======',
  'diff --git a/new [1].env.txt b/new [1].env.txt',
  'new file mode 100644',
  'index 0000000..e8c0f3b',
  '--- /dev/null',
  '+++ b/new [1].env.txt\t',
  '@@ -0,0 +1 @@',
  `+password: "${FAKE_PW}"`,
  '',
].join('\n')
const UNSTAGED_PATCH = ['diff --git a/keep.txt b/keep.txt', 'index 1d26929..a8e145f 100644', '--- a/keep.txt', '+++ b/keep.txt', '@@ -5,0 +6 @@ b', '+x', ''].join('\n')

type Repo = { sn: string; un: string; sp: string; up: string; ut: string; hasHead: boolean }
const DIRTY: Repo = { sn: '3\t0\tkeep.txt\n1\t0\tnew [1].env.txt\n', un: '1\t0\tkeep.txt\n', sp: STAGED_PATCH, up: UNSTAGED_PATCH, ut: 'u.txt\0big.bin\0', hasHead: true }
const STAGED_OK: Repo = {
  sn: '2\t1\tsrc/app.ts\n',
  un: '',
  sp: 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -3 +3,2 @@\n+const a = 1\n+const b = 2\n',
  up: '',
  ut: '',
  hasHead: true,
}

type World = {
  repo: Repo | 'none' | 'unsafe' | 'missing'
  calls: { argv: string[]; env?: Record<string, string>; stdin?: string }[]
  sizes?: Record<string, number>
}

/** git の argv から全体オプション (-c の対と -- で始まる物) を飛ばした、サブコマンドから後ろ */
const sub = (argv: readonly string[]) => {
  let i = 1
  while (i < argv.length && (argv[i] === '-c' || (argv[i] ?? '').startsWith('--'))) i += argv[i] === '-c' ? 2 : 1
  return argv.slice(i)
}

const mockHost = (on: On, world: World) => {
  on('session.cwd', () => ({ value: CWD }))
  on('process.run', (_$, e) => {
    world.calls.push({ argv: [...e.argv], env: e.init?.env, stdin: e.init?.stdin })
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    const r = world.repo
    if (r === 'missing') return { deny: 'spawn git ENOENT' }
    if (r === 'none') return out('', 128, 'fatal: not a git repository (or any of the parent directories): .git\n')
    if (r === 'unsafe') return out('', 128, "fatal: detected dubious ownership in repository at '/tmp/demo'\n")
    const a = sub(e.argv)
    const args = a.join(' ')
    if (args === 'rev-parse --is-inside-work-tree --show-toplevel') return out(`true\n${CWD}\n`)
    if (args === 'rev-parse -q --verify HEAD') return r.hasHead ? out('abc\n') : out('', 1)
    if (args === 'hash-object -t tree --stdin') return out('4b825dc642cb6eb9a060e54bf8d69288fbee4904\n')
    if (a[0] === 'diff-index' && a.includes('--numstat')) return out(r.sn)
    if (a[0] === 'diff-files' && a.includes('--numstat')) return out(r.un)
    if (a[0] === 'diff-index' && a.includes('-p')) return out(r.sp)
    if (a[0] === 'diff-files' && a.includes('-p')) return out(r.up)
    if (a[0] === 'ls-files') return out(r.ut)
    return out('', 1, `unexpected: ${args}`)
  })
  on('fs.stat', (_$, e) => {
    const name = e.path.split(/[\\/]/).pop() ?? ''
    const size = world.sizes?.[name]
    return size === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file' as const, size, mtimeMs: NOW, isLink: false } }
  })
}

type Child = { chunks: string[]; code?: number; wait?: number; isMissing?: boolean }
const mockSpawn = (on: On, clock: MockClock, child: Child, argvs: string[][]) => {
  on('process.spawn', async function* (_$, e) {
    argvs.push([...e.argv])
    if (child.isMissing) throw new Error(`failed to start: ENOENT: Command '${e.argv[0]}' not found`)
    for (const text of child.chunks) yield { stream: 'stdout' as const, text }
    if (child.wait) await clock.sleep(child.wait)
    return { value: { code: child.code ?? 0, signal: null } }
  })
}

const presentation = { isFullscreen: false, columns: 80 }

async function open($: Parameters<TestBody>[0], on: On, surface: (typeof SURFACES)[number], world: World, child: Child = { chunks: [] }, argvs: string[][] = []) {
  const clock = mock.clock(on, { now: NOW })
  mockHost(on, world)
  mockSpawn(on, clock, child, argvs)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const r = await $.command.run({ command: 'precheck', args: '', origin: { kind: 'composer' }, presentation })
  expect(r).toMatchObject({ text: 'コミット前のペインを開きました。' })
  const ui = await $.ui.mount({ ...PANE, surface })
  return { clock, ui }
}

/** 描かれた物ぜんぶの文字 (Svg の source と alt も) */
const allText = async (ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, texts: string[]) => {
  const svg = await ui.find({ type: 'Svg' })
  return [String(svg?.props.source ?? ''), String(svg?.props.alt ?? ''), ...texts].join('\n')
}

test('純関数: numstat・秘密の検出と伏せ方・衝突の印・行番号', () => {
  const files = parseNumstat(DIRTY.sn, DIRTY.un)
  expect(files).toEqual([
    { path: 'keep.txt', add: 4, del: 0, isStaged: true, isUnstaged: true, isBinary: false },
    { path: 'new [1].env.txt', add: 1, del: 0, isStaged: true, isUnstaged: false, isBinary: false },
  ])
  expect(parseNumstat('-\t-\timg.png\n', '')[0]).toMatchObject({ path: 'img.png', isBinary: true })

  const s = scanPatch(STAGED_PATCH, true)
  expect(s.secrets).toEqual([
    { path: 'keep.txt', line: 2, kind: 'AWS のアクセスキー', text: 'AKIA…00', isStaged: true },
    { path: 'new [1].env.txt', line: 1, kind: 'パスワードらしい値', text: 'password: "hunt…r2', isStaged: true },
  ])
  expect(s.conflicts.map(c => `${c.path}:${c.line} ${c.text}`)).toEqual(['keep.txt:3 <<<<<<< HEAD', 'keep.txt:5 ======='])

  // 伏せ方: 頭 4 字…尾 2 字。短い物は頭 1 字だけ
  expect(mask('ghp_EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLE')).toBe('ghp_…LE')
  expect(mask('abcdef')).toBe('a…')

  const many = [
    'diff --git a/x b/x',
    '+++ b/x',
    '@@ -0,0 +1,8 @@',
    '+token = "ghp_EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLE"',
    '+ANTHROPIC=sk-ant-EXAMPLE-EXAMPLE-EXAMPLE-00',
    '+OPENAI=sk-EXAMPLEEXAMPLEEXAMPLE00',
    '+slack: xoxb-EXAMPLE-EXAMPLE-00',
    '+-----BEGIN RSA PRIVATE KEY-----',
    '+gh = "github_pat_EXAMPLE_EXAMPLE_EXAMPLE_00"',
    // 中身が +++ で始まる足した行は、見出しと取り違えない
    '+++ looks like a header but is content',
    '+=========',
    '',
  ].join('\n')
  const m = scanPatch(many, false)
  expect(m.secrets.map(h => h.kind)).toEqual([
    'GitHub のトークン',
    'Anthropic の API キー',
    'API キー (sk-)',
    'Slack のトークン',
    '秘密鍵',
    'GitHub のトークン',
  ])
  expect(m.secrets.every(h => h.path === 'x')).toBe(true)
  expect(m.secrets.map(h => h.line)).toEqual([1, 2, 3, 4, 5, 6])
  // ======= が 7 つちょうどでなければ衝突の印にしない (Markdown の下線など)
  expect(m.conflicts).toEqual([])
  // 消した行 (-) は見ない
  expect(scanPatch(`diff --git a/y b/y\n+++ b/y\n@@ -1 +0,0 @@\n-key = "${FAKE_AWS}"\n`, true).secrets).toEqual([])
  // 名前の制御文字は落とす
  expect(scanPatch(`diff --git a/z b/z\n+++ "b/a\\bz.txt"\n@@ -0,0 +1 @@\n+<<<<<<< ours\n`, true).conflicts[0]?.path).toBe('az.txt')
})

test('純関数: 全体の判定 (テストは未設定か通過の時だけ緑)', () => {
  const repo = { kind: 'repo' as const, loadedAt: NOW, files: parseNumstat(STAGED_OK.sn, ''), untracked: [], untrackedCount: 0, secrets: [], conflicts: [], large: [], isCut: false }
  const unset = itemsOf(repo, { kind: 'idle' }, false)
  expect(verdictOf(unset, false)).toEqual({ light: 'green', text: 'コミットしてよさそう' })
  expect(verdictOf(itemsOf(repo, { kind: 'idle' }, true), true).light).toBe('yellow')
  const pass = { kind: 'done' as const, status: 'pass' as const, command: 'npm test', exitCode: 0, ms: 1, tail: '' }
  expect(verdictOf(itemsOf(repo, pass, true), true).light).toBe('green')
  expect(verdictOf(itemsOf(repo, { ...pass, status: 'fail', exitCode: 1 }, true), true).light).toBe('red')
  expect(verdictOf(itemsOf({ ...repo, large: [{ path: 'a.bin', size: 2e6 }] }, pass, true), true).light).toBe('yellow')
})

for (const surface of SURFACES) {
  test(`${surface}: 秘密・衝突・大きいファイルで赤。秘密は伏せて出す`, async ($, on) => {
    const world: World = { repo: DIRTY, calls: [], sizes: { 'big.bin': 3 * 1024 * 1024, 'keep.txt': 100, 'u.txt': 10 } }
    const { ui } = await open($, on, surface, world)
    const texts: string[] = []
    if (surface === 'vscode') {
      const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(svg).toContain('直してからコミット')
      expect(svg).toContain('2 件見つかりました')
      expect(svg).toContain('1MB 超が 1 件')
      expect(svg).toContain('未設定 (飛ばしました)')
    } else {
      expect((await ui.find({ type: 'Text', text: '直してからコミット' }))?.props.color).toBe('red')
      expect((await ui.find({ type: 'Text', text: '● 秘密情報: 2 件見つかりました' }))?.props.color).toBe('red')
      expect((await ui.find({ type: 'Text', text: '● 変更: 済 2 件・未 1 件 +5 −0' }))?.props.color).toBe('green')
      expect((await ui.find({ type: 'Text', text: '● 大きいファイル: 1MB 超が 1 件' }))?.props.color).toBe('yellow')
      expect(await ui.find({ type: 'Text', text: '○ テスト: 未設定 (飛ばしました)' })).toBeDefined()
    }
    // テストは未設定なので走らせるボタンは無い
    expect(await ui.find({ type: 'Button', key: 'run-test' })).toBeUndefined()

    await ui.press({ key: 'open-secrets' })
    const aws = await ui.find({ type: 'Text', text: 'keep.txt:2 AWS のアクセスキー AKIA…00 (ステージ済み)' })
    expect(aws).toBeDefined()
    texts.push(String(aws?.text))
    texts.push(String((await ui.find({ type: 'Text', text: /^new \[1\]\.env\.txt:1 / }))?.text))
    const shown = await allText(ui, texts)
    expect(shown).not.toContain(FAKE_AWS)
    expect(shown).not.toContain(FAKE_PW)

    await ui.press({ key: 'open-conflicts' })
    expect(await ui.find({ type: 'Text', text: 'keep.txt:3 <<<<<<< HEAD (ステージ済み)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^keep\.txt:2 AWS/ })).toBeUndefined()
    await ui.press({ key: 'open-large' })
    expect(await ui.find({ type: 'Text', text: 'big.bin 3.0 MB' })).toBeDefined()
    await ui.press({ key: 'open-changes' })
    expect(await ui.find({ type: 'Text', text: '[済+未] keep.txt +4 −0' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '追跡していない 2 件 (中身は見ていません)' })).toBeDefined()
    // もう一度押すと閉じる
    await ui.press({ key: 'open-changes' })
    expect(await ui.find({ type: 'Text', text: /^\[済\+未\]/ })).toBeUndefined()
  })

  test(`${surface}: テストを設定していれば、通るまでは黄、通ったら「コミットしてよさそう」`, SET, async ($, on) => {
    const world: World = { repo: STAGED_OK, calls: [] }
    const argvs: string[][] = []
    const { ui } = await open($, on, surface, world, { chunks: ['Tests: 3 passed\n'] }, argvs)
    // テストは自動では走らせない
    expect(argvs).toHaveLength(0)
    const verdict = async () =>
      surface === 'vscode' ? String((await ui.find({ type: 'Svg' }))?.props.source) : String((await ui.find({ type: 'Text', text: /コミット/ }))?.text)
    expect(await verdict()).toContain('確かめてからコミット')
    await ui.press({ key: 'run-test' })
    expect(argvs).toEqual([['npm', 'test']])
    expect(await verdict()).toContain('コミットしてよさそう')
  })

  test(`${surface}: git が無い・git のフォルダでない・所有者の確認 で別の文`, async ($, on) => {
    const world: World = { repo: 'missing', calls: [] }
    const { ui } = await open($, on, surface, world)
    const has = async (re: RegExp) =>
      surface === 'vscode' ? re.test(String((await ui.find({ type: 'Svg' }))?.props.alt)) : (await ui.find({ type: 'Text', text: re })) !== undefined
    expect(await has(/^git を実行できません/)).toBe(true)
    if (surface === 'terminal') expect((await ui.find({ type: 'Text', text: /^git を実行できません: / }))?.props.color).toBe('red')
    world.repo = 'none'
    await ui.press({ key: 'reload' })
    expect(await has(/^git のフォルダではありません/)).toBe(true)
    world.repo = 'unsafe'
    await ui.press({ key: 'reload' })
    expect(await has(/^git が所有者の確認で止めました/)).toBe(true)
    world.repo = STAGED_OK
    await ui.press({ key: 'reload' })
    expect(await has(/コミットしてよさそう/)).toBe(true)
  })
}

test('テストが失敗したら赤で、末尾を出す。起動できない時も赤', SET, async ($, on) => {
  const world: World = { repo: STAGED_OK, calls: [] }
  const child: Child = { chunks: ['FAIL src/a.test.ts\n\u001b[31mTests: 1 failed\u001b[0m\u0007\n'], code: 1 }
  const { ui } = await open($, on, 'terminal', world, child)
  await ui.press({ key: 'run-test' })
  expect((await ui.find({ type: 'Text', text: '● テスト: 失敗 (終了コード 1)' }))?.props.color).toBe('red')
  expect((await ui.find({ type: 'Text', text: '直してからコミット' }))?.props.color).toBe('red')
  await ui.press({ key: 'open-test' })
  const code = String((await ui.find({ type: 'Code' }))?.props.source)
  expect(code).toContain('Tests: 1 failed')
  expect(code).not.toMatch(CTRL)
  child.isMissing = true
  await ui.press({ key: 'run-test' })
  expect((await ui.find({ type: 'Text', text: /^起動できません: / }))?.props.color).toBe('red')
})

test('テストは時間の上限で止める', { options: { testCommand: 'npm test', timeoutSeconds: 5 } }, async ($, on) => {
  const world: World = { repo: STAGED_OK, calls: [] }
  const { clock, ui } = await open($, on, 'terminal', world, { chunks: ['slow\n'], wait: 600_000 })
  await ui.press({ key: 'run-test' })
  expect(await ui.find({ type: 'Text', text: '● テスト: 実行中' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'run-test' })).toBeUndefined()
  await clock.advance(5500)
  expect(await ui.find({ type: 'Text', text: '● テスト: 時間切れ' })).toBeDefined()
})

test('テストの途中でリロードされたら、実行中のまま残さない', SET, async ($, on) => {
  const world: World = { repo: STAGED_OK, calls: [] }
  const { ui } = await open($, on, 'terminal', world, { chunks: ['slow\n'], wait: 600_000 })
  await ui.press({ key: 'run-test' })
  expect(await ui.find({ type: 'Button', key: 'run-test' })).toBeUndefined()
  // リロードでも session.start が来る
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(await ui.find({ type: 'Text', text: '○ テスト: まだ走らせていません' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'run-test' })).toBeDefined()
})

test('git は読むだけ: 読みの全体オプション・env・--no-textconv。コミットが無ければ空の木と比べる', async ($, on) => {
  const world: World = { repo: { ...STAGED_OK, hasHead: false }, calls: [] }
  await open($, on, 'terminal', world)
  const READS = new Set(['rev-parse', 'hash-object', 'diff-index', 'diff-files', 'ls-files'])
  expect(world.calls.length).toBeGreaterThan(5)
  for (const c of world.calls) {
    expect(c.argv.slice(0, 6)).toEqual(['git', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '--literal-pathspecs'])
    expect(c.env).toEqual({ GIT_OPTIONAL_LOCKS: '0' })
    expect(READS.has(sub(c.argv)[0] ?? '')).toBe(true)
    if (c.argv.includes('-p')) expect(c.argv).toContain('--no-textconv')
    // hash-object は -w を付けない (書かない)
    expect(c.argv).not.toContain('-w')
  }
  expect(world.calls.find(c => sub(c.argv)[0] === 'hash-object')?.stdin).toBe('')
  const di = world.calls.filter(c => sub(c.argv)[0] === 'diff-index')
  expect(di.every(c => c.argv[c.argv.length - 1] === '4b825dc642cb6eb9a060e54bf8d69288fbee4904')).toBe(true)
})

test('ファイル名の制御文字は描く前に落とす', async ($, on) => {
  const world: World = {
    repo: { ...STAGED_OK, sn: '1\t0\t"a\\bb\\f.txt"\n', ut: 'u\u0007.txt\0' },
    calls: [],
  }
  const { ui } = await open($, on, 'vscode', world)
  await ui.press({ key: 'open-changes' })
  expect(await ui.find({ type: 'Text', text: '[済] ab.txt +1 −0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  u.txt' })).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toMatch(CTRL)
})

test('/precheck が拒まれたら /pre-check で開き、/precheck は横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  mockHost(on, { repo: STAGED_OK, calls: [] })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    if (e.name === 'precheck') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.run', { command: 'precheck' }, () => ({ text: '別の precheck' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['pre-check'])
  expect(await $.command.run({ command: 'pre-check', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: 'コミット前のペインを開きました。' })
  expect(await $.command.run({ command: 'precheck', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: '別の precheck' })
  expect(opened).toEqual(['pre-check'])
})
