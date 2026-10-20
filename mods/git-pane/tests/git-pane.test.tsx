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

type World = { repo: 'none' | 'clean' | 'dirty'; calls: string[][] }

// process を差し替える。git の読む操作だけ答え、それ以外が来たら記録に残る
const mockGit = (on: On, world: World) => {
  on('session.cwd', () => ({ value: CWD }))
  on('process.run', (_$, e) => {
    world.calls.push([...e.argv])
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.init?.cwd !== CWD) return out('', 1, 'wrong cwd')
    const args = e.argv.slice(3).join(' ')
    if (world.repo === 'none') return out('', 128, 'fatal: not a git repository')
    const src = world.repo === 'dirty' ? DIRTY : CLEAN
    if (args === 'rev-parse --is-inside-work-tree') return out('true\n')
    if (args.startsWith('status ')) return out(src.status)
    if (args.startsWith('diff --cached ')) return out(src.staged)
    if (args.startsWith('diff ')) return out(src.unstaged)
    if (args.startsWith('log ')) return out(src.log)
    return out('', 1, `unexpected: ${args}`)
  })
}

const READ_ONLY = new Set(['rev-parse', 'status', 'diff', 'log'])
const onlyReads = (world: World) => world.calls.every(a => a[0] === 'git' && READ_ONLY.has(a[3] ?? ''))

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
      expect(src).not.toMatch(/<animate/)
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
    expect(filled[0]?.mode).toBe('replace')
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
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })

  const reads = () => world.calls.filter(a => a[3] === 'rev-parse').length
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
