import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ago, checkOf, classify, missingOrError, parsePr, parseRuns, prSvg, runsSvg } from '../hooks/ci'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'ci-pane',
  component: 'Pane',
  requestId: 'ci-pane',
  props: {
    title: 'CI',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const PR = {
  number: 42,
  title: 'ペインの読み直しを速くする',
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.com/demo/app/pull/42',
  reviewDecision: 'REVIEW_REQUIRED',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'test (ubuntu)', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/demo/app/actions/runs/1/job/1' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'CheckRun', name: 'label', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS', targetUrl: 'https://example.com' },
  ],
}
const RUNS = [
  { databaseId: 3, name: 'CI', status: 'in_progress', conclusion: '', url: 'https://github.com/demo/app/actions/runs/3', createdAt: iso(2 * 60_000), event: 'push', headSha: 'abc' },
  { databaseId: 2, name: 'CI', status: 'completed', conclusion: 'failure', url: 'https://github.com/demo/app/actions/runs/2', createdAt: iso(3 * 3600_000), event: 'pull_request', headSha: 'abd' },
  { databaseId: 1, name: 'Release', status: 'completed', conclusion: 'success', url: 'javascript:alert(1)', createdAt: iso(2 * 86400_000), event: 'push', headSha: 'abe' },
]

type Reply = { exitCode?: number; stdout?: string; stderr?: string; isMissing?: boolean }
type World = {
  calls: { argv: string[]; cwd?: string; env?: Record<string, string> }[]
  git?: Reply
  pr?: Reply
  runs?: Reply
  isOpen?: boolean
}

const mockGh = (on: On, world: World) => {
  on('session.cwd', () => ({ value: CWD }))
  on('process.run', (_$, e) => {
    world.calls.push({ argv: [...e.argv], cwd: e.init?.cwd, env: e.init?.env })
    const r: Reply =
      e.argv[0] === 'git'
        ? (world.git ?? { stdout: 'feature/fast\n' })
        : e.argv[1] === 'pr'
          ? (world.pr ?? { stdout: JSON.stringify(PR) })
          : e.argv[1] === 'run'
            ? (world.runs ?? { stdout: JSON.stringify(RUNS) })
            : { exitCode: 2, stderr: 'unexpected' }
    if (r.isMissing) return { deny: `failed to start: ENOENT: Command '${e.argv[0]}' not found` }
    return { value: { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.panes', () => ({ value: world.isOpen ? [{ id: 'ci-pane', title: 'CI', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.open', () => {
    world.isOpen = true
    return { value: { isPlaced: true as const } }
  })
}

type El = { props: Record<string, unknown>; text: string }
type Ui = {
  find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<El | undefined>
  findAll: (q: { type?: string }) => Promise<El[]>
  press: (q: { key: string }) => Promise<unknown>
}
const svgOf = async (ui: Ui, key: 'pr' | 'runs') => String((await ui.findAll({ type: 'Svg' }))[key === 'pr' ? 0 : 1]?.props.source ?? '')
const allText = async (ui: Ui) => {
  let s = ''
  for (const type of ['Text', 'Button', 'Link', 'Svg']) for (const el of await ui.findAll({ type })) s += `${el.text}\n${String(el.props.alt ?? '')}\n${String(el.props.source ?? '')}\n`
  return s
}

test('純関数: 失敗の分け方・チェックと実行の読み方・何分前', () => {
  expect(classify("fatal: detected dubious ownership in repository at '/tmp/demo'")).toBe('unsafe')
  expect(classify('failed to run git: fatal: not a git repository (or any of the parent directories): .git')).toBe('not-git')
  expect(classify('no git remotes found')).toBe('not-github')
  // GitHub でない時の文にも gh auth login が出るので、ログインより先に見る
  expect(classify('none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`')).toBe('not-github')
  expect(classify('no pull requests found for branch "feature/x"')).toBe('no-pr')
  expect(classify('To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable')).toBe('no-login')
  expect(classify('HTTP 502: Bad Gateway')).toBe('other')
  expect(missingOrError("failed to start: ENOENT: Command 'gh' not found")).toBe('no-gh')
  expect(missingOrError('timed out after 30000 ms')).toBe('error')

  expect(PR.statusCheckRollup.map(c => checkOf(c)?.kind)).toEqual(['pass', 'fail', 'run', 'skip', 'pass'])
  expect(checkOf({ context: 'ci/old', state: 'PENDING' })).toEqual({ name: 'ci/old', kind: 'run' })
  const pr = parsePr(JSON.stringify({ ...PR, url: 'http://insecure.example/pr' }))
  expect(pr).toMatchObject({ number: 42, state: 'OPEN', review: 'REVIEW_REQUIRED', url: '' })
  expect(() => parsePr('[]')).toThrow()
  const runs = parseRuns(JSON.stringify(RUNS))
  expect(runs.map(r => [r.kind, r.label])).toEqual([
    ['run', '実行中'],
    ['fail', '失敗'],
    ['pass', '成功'],
  ])
  expect(runs[2]?.url).toBe('')
  expect(() => parseRuns('{}')).toThrow()
  expect([ago(NOW - 30_000, NOW), ago(NOW - 5 * 60_000, NOW), ago(NOW - 3 * 3600_000, NOW), ago(NOW - 2 * 86400_000, NOW), ago(0, NOW)]).toEqual([
    '今',
    '5 分前',
    '3 時間前',
    '2 日前',
    '─',
  ])
})

test('SVG: viewBox だけ。走っているチェックの丸は回り、時刻は下の SVG にだけ出る', () => {
  const snap = { kind: 'ok' as const, branch: 'feature/fast', pr: parsePr(JSON.stringify(PR)), prNote: '', runs: parseRuns(JSON.stringify(RUNS)), runsNote: '', loadedAt: NOW }
  const top = prSvg(snap)
  expect(top).not.toMatch(/<svg[^>]* width=/)
  expect(top).toContain('animateTransform')
  expect(top).toContain('#42')
  expect(top).toContain('>開<')
  expect(top).toContain('レビュー待ち')
  expect(top).not.toContain('分前')
  expect(prSvg({ ...snap, loadedAt: NOW + 60_000 })).toBe(top)
  expect(runsSvg(snap)).toContain('2 分前')
  const many = { ...snap, pr: { ...snap.pr, checks: Array.from({ length: 300 }, (_, i) => ({ name: `job ${i}`, kind: 'pass' as const })) } }
  expect(prSvg(many)).toContain('ほか 290 件')
  expect(prSvg({ ...snap, pr: { ...snap.pr, state: 'MERGED' } })).toContain('>マージ<')
  expect(prSvg({ ...snap, pr: { ...snap.pr, isDraft: true } })).toContain('>下書き<')
  expect(prSvg({ ...snap, pr: { ...snap.pr, state: 'CLOSED' } })).toContain('>閉<')
})

for (const surface of SURFACES) {
  test(`${surface}: PR の札・チェック・Actions・リンクを出す`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { calls: [] }
    mockGh(on, world)
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    await ui.press({ key: 'reload' })
    expect(world.calls.map(c => c.argv.join(' '))).toEqual([
      'git -c core.fsmonitor=false rev-parse --abbrev-ref HEAD',
      'gh pr view --json number,title,state,isDraft,url,reviewDecision,statusCheckRollup',
      'gh run list --branch feature/fast --limit 8 --json databaseId,name,status,conclusion,url,createdAt,event,headSha',
    ])
    expect(world.calls.every(c => c.cwd === CWD && c.env?.GIT_OPTIONAL_LOCKS === '0')).toBe(true)
    if (surface === 'vscode') {
      expect(await svgOf(ui, 'pr')).toContain('ペインの読み直しを速くする')
      expect(await svgOf(ui, 'runs')).toContain('3 時間前')
    } else {
      expect(await ui.find({ type: 'Text', text: '#42 [開] ペインの読み直しを速くする' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^レビュー待ち \/ 通過 2 失敗 1 実行中 1 他 1/ }))?.props.color).toBe('red')
      expect((await ui.find({ type: 'Text', text: '  ■ lint' }))?.props.color).toBe('red')
      expect((await ui.find({ type: 'Text', text: '○ CI 実行中 2 分前' }))?.props.color).toBe('blue')
    }
    expect((await ui.find({ type: 'Link', text: /^PR #42 / }))?.props.href).toBe('https://github.com/demo/app/pull/42')
    // https でない URL はリンクにしない
    const links = (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))
    expect(links).toEqual(['https://github.com/demo/app/pull/42', 'https://github.com/demo/app/actions/runs/3', 'https://github.com/demo/app/actions/runs/2'])
    // 何かを起こす gh のコマンドは呼ばない
    expect(world.calls.some(c => /rerun|merge|cancel|close|edit/.test(c.argv.join(' ')))).toBe(false)
  })

  test(`${surface}: PR が無くても Actions は出す`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockGh(on, { calls: [], pr: { exitCode: 1, stderr: 'no pull requests found for branch "feature/fast"\n' } })
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') {
      expect(await svgOf(ui, 'pr')).toContain('このブランチの PR はありません')
      expect(await svgOf(ui, 'runs')).toContain('Release')
    } else {
      expect(await ui.find({ type: 'Text', text: 'このブランチの PR はありません' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '● Release 成功 2 日前' })).toBeDefined()
    }
    expect(await ui.find({ type: 'Link', text: /^PR #42 / })).toBeUndefined()
  })

  test(`${surface}: gh が無い・ログインしていない・GitHub でない・git でない を別の文で出す`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { calls: [], pr: { isMissing: true }, runs: { isMissing: true } }
    mockGh(on, world)
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    const shown = async () => (surface === 'vscode' ? svgOf(ui, 'pr') : (await allText(ui)))
    await ui.press({ key: 'reload' })
    expect(await shown()).toContain('gh (GitHub CLI) が見つかりません')

    world.pr = world.runs = { exitCode: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }
    await ui.press({ key: 'reload' })
    expect(await shown()).toContain('gh にログインしていません')

    world.pr = world.runs = { exitCode: 1, stderr: 'none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`\n' }
    await ui.press({ key: 'reload' })
    expect(await shown()).toContain('GitHub のリポジトリではありません')

    world.git = { exitCode: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' }
    await ui.press({ key: 'reload' })
    expect(await shown()).toContain('git のリポジトリではありません')

    world.git = { exitCode: 128, stderr: "fatal: detected dubious ownership in repository at '/tmp/demo'\n" }
    await ui.press({ key: 'reload' })
    expect(await shown()).toContain('所有者の確認で止めました')

    world.git = { isMissing: true }
    await ui.press({ key: 'reload' })
    expect(await shown()).toContain('git・gh を実行できませんでした')
    expect(await ui.find({ type: 'Button', key: 'reload' })).toBeDefined()
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(surface === 'vscode' ? 1 : 0)
  })

  test(`${surface}: 題・チェック名・実行名の制御文字を落とす`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const bad = { ...PR, title: '悪い\u0007題\u001b[31m', statusCheckRollup: [{ name: 'job\u0000\u000b', status: 'COMPLETED', conclusion: 'FAILURE' }] }
    const badRuns = [{ ...RUNS[0], name: 'run\u0008\u007f名', event: 'push\u000c' }]
    mockGh(on, { calls: [], pr: { stdout: JSON.stringify(bad) }, runs: { stdout: JSON.stringify(badRuns) } })
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    await ui.press({ key: 'reload' })
    const s = await allText(ui)
    expect(s).toContain('悪い題')
    expect(s).toContain('run名')
    expect(CTRL.test(s)).toBe(false)
  })
}

test('HEAD が外れている時は PR を読まず、全ブランチの Actions を出す', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world: World = { calls: [], git: { stdout: 'HEAD\n' } }
  mockGh(on, world)
  const ui = (await $.ui.mount({ ...PANE, surface: 'terminal' })) as unknown as Ui
  await ui.press({ key: 'reload' })
  expect(world.calls.map(c => c.argv[1])).toEqual(['-c', 'run'])
  expect(world.calls[1]?.argv).not.toContain('--branch')
  expect(await ui.find({ type: 'Text', text: 'ブランチにいません (HEAD が外れています)' })).toBeDefined()
})

test('Actions が読めない時は PR を出したまま一言', async ($, on) => {
  mock.clock(on, { now: NOW })
  mockGh(on, { calls: [], runs: { exitCode: 1, stderr: 'HTTP 502: Bad Gateway\n' } })
  const ui = (await $.ui.mount({ ...PANE, surface: 'terminal' })) as unknown as Ui
  await ui.press({ key: 'reload' })
  expect(await ui.find({ type: 'Text', text: 'Actions を読めませんでした: HTTP 502: Bad Gateway' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#42 / })).toBeDefined()
})

const presentation = { isFullscreen: false, columns: 80 }

test('開いている間だけ読む。走っている物があれば 20 秒、無ければ 60 秒ごと', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const world: World = { calls: [] }
  mockGh(on, world)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  await clock.advance(120_000)
  expect(world.calls).toHaveLength(0)
  await $.command.run({ command: 'ci', args: '', origin: { kind: 'composer' }, presentation })
  await clock.advance(1000)
  expect(world.calls).toHaveLength(3)
  // 走っている物があるので 20 秒で読み直す
  await clock.advance(20_000)
  expect(world.calls).toHaveLength(6)
  // 全部終わったら 60 秒ごと
  world.pr = { stdout: JSON.stringify({ ...PR, statusCheckRollup: [] }) }
  world.runs = { stdout: JSON.stringify(RUNS.slice(1)) }
  await clock.advance(20_000)
  expect(world.calls).toHaveLength(9)
  await clock.advance(40_000)
  expect(world.calls).toHaveLength(9)
  await clock.advance(20_000)
  expect(world.calls).toHaveLength(12)
  world.isOpen = false
  await clock.advance(180_000)
  expect(world.calls).toHaveLength(12)
})

test('/ci を登録できればそれでペインを開く', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  mockGh(on, { calls: [] })
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['ci'])
  expect(await $.command.run({ command: 'ci', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: 'CI のペインを開きました。' })
})

test('/ci が拒まれたら /ci-pane で開き、/ci は横取りしない', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    if (e.name === 'ci') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  mockGh(on, { calls: [] })
  on('command.run', { command: 'ci' }, () => ({ text: '別の ci' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['ci-pane'])
  expect(await $.command.run({ command: 'ci-pane', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: 'CI のペインを開きました。' })
  expect(await $.command.run({ command: 'ci', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: '別の ci' })
})
