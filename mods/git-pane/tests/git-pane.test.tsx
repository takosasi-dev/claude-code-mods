import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ago, headFit, paneSvg, tailFit, toRepo } from '../hooks/git'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'git-pane',
  component: 'Pane',
  requestId: 'git-pane',
  props: {
    title: 'git',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const LONG = 'src/very/long/path/to/deeply/nested/component/ファイル名.tsx'
const DIRTY = {
  status: ['## main...origin/main [ahead 2, behind 1]', 'M  src/app.ts', ' M README.md', `MM ${LONG}`, '?? notes/', ' D old.txt', 'A  img.png', ''].join('\n'),
  unstaged: ['3\t1\tREADME.md', `5\t2\t${LONG}`, '0\t10\told.txt', ''].join('\n'),
  staged: ['20\t4\tsrc/app.ts', `1\t0\t${LONG}`, '-\t-\timg.png', ''].join('\n'),
  log: [`abc1234\t${(NOW - 5 * 60_000) / 1000}\tFix the <thing> & more`, `def5678\t${(NOW - 3 * 86_400_000) / 1000}\t最初のコミット`, ''].join('\n'),
}
const CLEAN = { status: '## main\n', unstaged: '', staged: '', log: `abc1234\t${(NOW - 60 * 60_000) / 1000}\tInitial\n` }

// git が C の文字列の形で囲んだ、\b と \f を含む名前。題には BEL と ESC
const ODD = {
  status: '## main\n M "a\\bb\\f.txt"\n',
  unstaged: '1\t0\t"a\\bb\\f.txt"\n',
  staged: '',
  log: `abc1234\t${(NOW - 60_000) / 1000}\tFix \u0007bell \u001b[31mred\n`,
}
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

type World = {
  repo: 'none' | 'clean' | 'dirty' | 'odd' | 'unsafe'
  calls: string[][]
  /** process.run に渡った env */
  envs?: (Record<string, string> | undefined)[]
}

/** git の argv から全体オプション (-c の対と -- で始まる物) を飛ばした、サブコマンドから後ろ */
const sub = (argv: readonly string[]) => {
  let i = 1
  while (i < argv.length && (argv[i] === '-c' || (argv[i] ?? '').startsWith('--'))) i += argv[i] === '-c' ? 2 : 1
  return argv.slice(i)
}

// process を差し替える。git の読む操作だけ答え、それ以外が来たら記録に残る
const mockGit = (on: On, world: World) => {
  on('session.cwd', () => ({ value: CWD }))
  on('process.run', (_$, e) => {
    world.calls.push([...e.argv])
    world.envs?.push(e.init?.env)
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.init?.cwd !== CWD) return out('', 1, 'wrong cwd')
    const args = sub(e.argv).join(' ')
    if (world.repo === 'none') return out('', 128, 'fatal: not a git repository')
    if (world.repo === 'unsafe') return out('', 128, "fatal: detected dubious ownership in repository at '/tmp/demo'\n")
    const src = world.repo === 'dirty' ? DIRTY : world.repo === 'odd' ? ODD : CLEAN
    if (args === 'rev-parse --is-inside-work-tree') return out('true\n')
    if (args.startsWith('status ')) return out(src.status)
    if (args.startsWith('diff --cached ')) return out(src.staged)
    if (args.startsWith('diff ') || args.startsWith('diff-files ')) return out(src.unstaged)
    if (args.startsWith('log ')) return out(src.log)
    return out('', 1, `unexpected: ${args}`)
  })
}

const READ_ONLY = new Set(['rev-parse', 'status', 'diff', 'diff-files', 'log'])
const onlyReads = (world: World) => world.calls.every(a => a[0] === 'git' && READ_ONLY.has(sub(a)[0] ?? ''))

test('変換: 状態・行数・並び・ahead/behind・コミット', async () => {
  const r = toRepo(DIRTY.status, DIRTY.unstaged, DIRTY.staged, DIRTY.log)
  expect(r.branch).toBe('main')
  expect(r.upstream).toBe('origin/main')
  expect([r.ahead, r.behind]).toEqual([2, 1])
  expect(r.files.map(f => f.path)).toEqual(['src/app.ts', 'old.txt', LONG, 'README.md', 'img.png', 'notes/'])
  const by = (p: string) => r.files.find(f => f.path === p)
  expect(by(LONG)).toMatchObject({ add: 6, del: 2, isStaged: true, isUnstaged: true, isUntracked: false })
  expect(by('src/app.ts')).toMatchObject({ isStaged: true, isUnstaged: false })
  expect(by('notes/')).toMatchObject({ isUntracked: true, add: 0 })
  expect(by('img.png')).toMatchObject({ isBinary: true, isStaged: true })
  expect(r.commits).toEqual([
    { hash: 'abc1234', time: NOW - 5 * 60_000, subject: 'Fix the <thing> & more' },
    { hash: 'def5678', time: NOW - 3 * 86_400_000, subject: '最初のコミット' },
  ])

  const fresh = toRepo('## No commits yet on main\n?? a.txt\n', '', '', '')
  expect(fresh).toMatchObject({ branch: 'main', upstream: '', commits: [] })
  expect(toRepo('## HEAD (no branch)\n', '', '', '').branch).toBe('(切り離し HEAD)')
  expect(toRepo('## dev...origin/dev [gone]\n', '', '', '')).toMatchObject({ branch: 'dev', ahead: 0, behind: 0 })
  expect(toRepo('## x\nM  "a\\"b.txt"\n', '', '', '').files[0]?.path).toBe('a"b.txt')

  expect(ago(NOW - 5 * 60_000, NOW)).toBe('5分前')
  expect(ago(NOW - 10_000, NOW)).toBe('たった今')
  expect(ago(NOW - 2 * 86_400_000, NOW)).toBe('2日前')
  expect(tailFit(LONG, 20)).toBe('…nent/ファイル名.tsx')
  expect(headFit('あいうえおかきくけこ', 9)).toBe('あいうえ…')
  expect(tailFit('short.ts', 38)).toBe('short.ts')

  const svg = paneSvg({ kind: 'repo', cwd: CWD, loadedAt: NOW, ...r }, NOW)
  expect(svg).toMatch(/Fix the &lt;thing&gt; &amp; more/)
  expect(svg).toMatch(/<animate attributeName="width"/)
  expect(svg).not.toMatch(/<thing>/)

  // 13 ファイル以上は上位 12 だけ描き、残りの数を出す。名前に空白があると " で囲まれる
  const many = Array.from({ length: 15 }, (_, i) => ` M f${i}.ts`).concat('?? "日本 語.txt"').join('\n')
  const nums = Array.from({ length: 15 }, (_, i) => `${i + 1}\t0\tf${i}.ts`).join('\n')
  const m = toRepo(`## main\n${many}\n`, nums, '', '')
  expect(m.files).toHaveLength(16)
  expect(m.files[0]?.path).toBe('f14.ts')
  expect(m.files.some(f => f.path === '日本 語.txt' && f.isUntracked)).toBe(true)
  const big = paneSvg({ kind: 'repo', cwd: CWD, loadedAt: NOW, ...m }, NOW)
  expect(big).toMatch(/ほか 4 ファイル/)
  expect(big).toMatch(/12 \/ 16/)
  expect(big).toMatch(/まだコミットがありません/)
})

for (const surface of SURFACES) {
  test(`${surface}: 変更あり — ブランチ・数・ファイル・コミット`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { repo: 'dirty', calls: [] }
    mockGit(on, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })

    if (surface === 'vscode') {
      const src = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(src).toMatch(/>main</)
      expect(src).toMatch(/↑2<\/tspan>.*↓1</)
      expect(src).toMatch(/>6</)
      expect(src).toMatch(/>\+29</)
      expect(src).toMatch(/>−17</)
      expect(src).toMatch(/>…eeply\/nested\/component\/ファイル名\.tsx</)
      expect(src).toMatch(/abc1234/)
      expect(src).toMatch(/5分前/)
      expect(src).toMatch(/最初のコミット/)
      expect(src).toMatch(/#3fb950/)
      expect(src).toMatch(/#f85149/)
      expect(await ui.find({ key: 'lines' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ key: 'lines' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'ブランチ main ↑2 ↓1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '変更 6 ファイル +29 -17' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'S  +20 -4  src/app.ts' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: `SM +6 -2  ${LONG}` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '?  新規  notes/' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'abc1234 Fix the <thing> & more (5分前)' })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^読込 / })).toBeDefined()
    expect(onlyReads(world)).toBe(true)
    expect(world.calls).toHaveLength(5)
  })

  test(`${surface}: 変更なし`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { repo: 'clean', calls: [] }
    mockGit(on, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') {
      const src = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(src).toMatch(/変更はありません/)
      expect(src).toMatch(/上流なし/)
      expect(src).toMatch(/1時間前/)
      // 差分の棒(高さ 8 の伸びる棒)は無い。見出しの線とコミットの出方の動きはある
      expect(src).not.toMatch(/height="8" rx="2"[^>]*><animate/)
    } else {
      expect(await ui.find({ type: 'Text', text: 'ブランチ main (上流なし)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '変更はありません' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '変更 0 ファイル +0 -0' })).toBeDefined()
    }
    expect(onlyReads(world)).toBe(true)
  })

  test(`${surface}: git のフォルダではない`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { repo: 'none', calls: [] }
    mockGit(on, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/読み込み中/)
    else expect(await ui.find({ type: 'Text', text: '読み込み中' })).toBeDefined()

    await ui.press({ key: 'reload' })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toMatch(/git のフォルダではありません/)
      expect(String(svg?.props.alt)).toMatch(/git のフォルダではありません/)
    } else {
      expect((await ui.find({ type: 'Text', text: 'git のフォルダではありません' }))?.props.color).toBe('yellow')
      expect(await ui.find({ type: 'Text', text: CWD })).toBeDefined()
    }
    expect(world.calls).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /^読込 / })).toBeUndefined()
  })

  test(`${surface}: ボタンで入力欄に文を入れる (送信しない)`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockGit(on, { repo: 'dirty', calls: [] })
    const filled: { text: string; mode: string }[] = []
    let submitted = 0
    on('prompt.fill', (_$, e) => {
      filled.push({ text: e.text, mode: e.mode })
      return { isFilled: true }
    })
    on('prompt.submit', (_$, e, next) => {
      submitted++
      return next(e)
    })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'review' })
    expect(filled).toHaveLength(1)
    expect(filled[0]?.text).toMatch(/レビュー/)
    expect(filled[0]?.mode).toBe('insert')
    expect(await ui.find({ type: 'Text', text: '入力欄に入れました(送信はしていません)' })).toBeDefined()
    await ui.press({ key: 'commit-msg' })
    expect(filled[1]?.text).toMatch(/コミットメッセージ/)
    expect(submitted).toBe(0)
    await ui.press({ key: 'reload' })
    expect(await ui.find({ type: 'Text', text: /^入力欄に/ })).toBeUndefined()
  })
}

test('process が起動できないときは赤い説明', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.cwd', () => ({ value: CWD }))
  on('process.run', () => ({ deny: 'spawn git ENOENT' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reload' })
  expect((await ui.find({ type: 'Text', text: /^git を実行できません/ }))?.props.color).toBe('red')
})

test('/git で読んで開く。ファイルを変えうるツールの後に 2 秒に 1 回まで読み直す', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = { repo: 'clean', calls: [] }
  mockGit(on, world)
  let isUp = false
  on('ui.open', (_$, e) => {
    isUp = e.id === 'git-pane'
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: isUp ? [{ id: 'git-pane', title: 'git', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('tool.call', () => ({ result: {} as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })

  const reads = () => world.calls.filter(a => sub(a)[0] === 'rev-parse').length
  const call = (tool: string) => $.tool.call({ tool, input: {} } as never)

  // 開く前はツールが終わっても読まない
  await call('Edit')
  await clock.advance(3000)
  expect(reads()).toBe(0)

  const ran = await $.command.run({
    command: 'git',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: 'git のペインを開きました。' })
  expect(isUp).toBe(true)
  expect(reads()).toBe(1)

  // 読むだけのツールでは読み直さない
  await call('Read')
  await clock.advance(3000)
  expect(reads()).toBe(1)

  // 続けて 3 回変えても、2 秒の間は 1 回にまとまる
  await call('Edit')
  await clock.advance(10)
  expect(reads()).toBe(2)
  world.repo = 'dirty'
  await call('Write')
  await call('Bash')
  await clock.advance(500)
  expect(reads()).toBe(2)
  await clock.advance(1600)
  expect(reads()).toBe(3)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '変更 6 ファイル +29 -17' })).toBeDefined()
  expect(onlyReads(world)).toBe(true)
})

// ── v0.1.1 で直した物

test('index を書き直さない: 任意のロックを止め、未ステージは diff-files で読み、fsmonitor を走らせない', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world: World = { repo: 'dirty', calls: [], envs: [] }
  mockGit(on, world)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reload' })
  expect(world.calls).toHaveLength(5)
  expect(world.envs?.every(env => env?.GIT_OPTIONAL_LOCKS === '0')).toBe(true)
  expect(world.calls.every(a => a.includes('core.fsmonitor=false'))).toBe(true)
  // 署名の欄を持つコミットを log が読んでも gpg.program を走らせない
  expect(world.calls.every(a => a.includes('log.showSignature=false'))).toBe(true)
  // 作業ツリーと index の比べは diff-files (git diff は GIT_OPTIONAL_LOCKS を見ずに index を書く)
  const diffs = world.calls.map(a => sub(a)).filter(a => a[0]?.startsWith('diff'))
  expect(diffs.map(a => a.slice(0, 2).join(' ')).sort()).toEqual(['diff --cached', 'diff-files --numstat'])
  expect(await ui.find({ type: 'Text', text: '変更 6 ファイル +29 -17' })).toBeDefined()
})

for (const surface of SURFACES) {
  test(`${surface}: 所有者の確認 (dubious ownership) で止まったら、そう出す`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockGit(on, { repo: 'unsafe', calls: [] })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toMatch(/git が所有者の確認で止めました/)
      expect(String(svg?.props.source)).not.toMatch(/git のフォルダではありません/)
    } else expect(await ui.find({ type: 'Text', text: 'git が所有者の確認で止めました' })).toBeDefined()
  })

  test(`${surface}: 名前と題の制御文字を落として描く`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockGit(on, { repo: 'odd', calls: [] })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).not.toMatch(CTRL)
      expect(String(svg?.props.alt)).not.toMatch(CTRL)
      expect(String(svg?.props.source)).toMatch(/>ab\.txt</)
    } else {
      expect(await ui.find({ type: 'Text', text: ' M +1 -0  ab.txt' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^abc1234 Fix bell \[31mred / })).toBeDefined()
    }
  })
}

test('変換: 囲まれた名前の \\b \\f は本物の制御文字に戻さない', () => {
  const r = toRepo(ODD.status, ODD.unstaged, '', ODD.log)
  expect(r.files.map(f => f.path)).toEqual(['ab.txt'])
  expect(r.files[0]).toMatchObject({ add: 1, del: 0 })
  expect(r.commits[0]?.subject).not.toMatch(CTRL)
})

test('/git が拒まれて /gitpane にした時は、/git を横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  mockGit(on, { repo: 'clean', calls: [] })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  const tried: string[] = []
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'git' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  on('command.run', { command: 'git' }, () => ({ text: '組み込みの git' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['git', 'gitpane'])
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'git', ...run })).toMatchObject({ text: '組み込みの git' })
  expect(await $.command.run({ command: 'gitpane', ...run })).toMatchObject({ text: 'git のペインを開きました。' })
})

test('/git を持てた時は /gitpane を横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  mockGit(on, { repo: 'clean', calls: [] })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'gitpane' }, () => ({ text: '他の gitpane' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'gitpane', ...run })).toMatchObject({ text: '他の gitpane' })
  expect(await $.command.run({ command: 'git', ...run })).toMatchObject({ text: 'git のペインを開きました。' })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  mock.clock(on, { now: NOW })
  mockGit(on, { repo: 'dirty', calls: [] })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'reload' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/<rect width="380" height="\d+" rx="10" fill="#ffffff"\/>/)
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await source()).toMatch(/<rect width="380" height="\d+" rx="10" fill="#0d1117"\/>/)
})
