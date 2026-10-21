import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { CUT_TEXT, LIMIT, WALK_LIMITS, delta, paneLines, paneSvg, parseGrep, tally, walk } from '../hooks/todo'
import type { WalkEntry } from '../hooks/todo'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'todo-board',
  component: 'Pane',
  requestId: 'todo-board',
  props: {
    title: 'TODO',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** git grep -n -z の 1 行 */
const row = (path: string, line: number, text: string) => `${path}\0${line}\0${text}\n`
const MANY = [
  row('src/app.ts', 3, '  // TODO: ログを足す'),
  row('src/app.ts', 10, '  // FIXME 0 で割ると落ちる <x> & y'),
  row('src/app.ts', 22, '  /* HACK: 仮の回避 */\r'),
  row('lib/日本語.py', 1, '# XXX あとで消す'),
  row('lib/日本語.py', 5, '# TODO 名前を変える'),
  row('README.md', 40, '- TODO と FIXME を拾う'),
].join('')
// 2 件片付けた後
const FEWER = [row('src/app.ts', 10, '  // FIXME 0 で割ると落ちる <x> & y'), row('lib/日本語.py', 1, '# XXX あとで消す'), row('lib/日本語.py', 5, '# TODO 名前を変える'), row('README.md', 40, '- TODO と FIXME を拾う')].join('')
const HUGE = Array.from({ length: 520 }, (_, i) => row(`gen/f${i % 13}.ts`, i + 1, `// TODO 項目 ${i}`)).join('')

type World = {
  repo: 'none' | 'no-git' | 'empty' | 'many' | 'fewer' | 'huge' | 'broken' | 'odd'
  calls: string[][]
  /** 作業フォルダ。無ければ CWD */
  cwd?: string
  /** grep の答えを返すまでの待ち (1 回目, 2 回目, ...)。clock と組で使う */
  delays?: number[]
  clock?: MockClock
}
// 制御文字の入ったファイル名と本文 (-z なので名前は囲まれずにそのまま来る)
const ODD = row('src/a\bb\x1b.ts', 7, '  // TODO \x0c改ページ \x07鳴る')
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

// process を差し替える。git の読む操作だけ答え、それ以外が来たら記録に残る
const mockGit = (on: On, world: World) => {
  on('session.cwd', () => ({ value: world.cwd ?? CWD }))
  let greps = 0
  on('process.run', async (_$, e) => {
    world.calls.push([...e.argv])
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.init?.cwd !== (world.cwd ?? CWD)) return out('', 1, 'wrong cwd')
    const args = e.argv.slice(4).join(' ')
    const repo = world.repo
    if (repo === 'no-git') throw new Error('spawn git ENOENT')
    if (repo === 'none') return out('', 128, 'fatal: not a git repository')
    if (args === 'rev-parse --is-inside-work-tree') return out('true\n')
    if (args.startsWith('grep ') && args.endsWith(' -E \\b(TODO|FIXME|HACK|XXX)\\b')) {
      const wait = world.delays?.[greps++] ?? 0
      if (wait > 0 && world.clock) await world.clock.sleep(wait)
      if (repo === 'broken') return out('', 2, 'fatal: bad pattern')
      if (repo === 'empty') return out('', 1)
      return out(repo === 'many' ? MANY : repo === 'fewer' ? FEWER : repo === 'odd' ? ODD : HUGE)
    }
    return out('', 1, `unexpected: ${args}`)
  })
}

// 読むだけの git で、index を書かない形 (先頭 4 つは決まった前置き)
const onlyReads = (world: World) =>
  world.calls.every(a => a.slice(0, 4).join(' ') === 'git --no-optional-locks -c core.fsmonitor=false' && ['rev-parse', 'grep'].includes(a[4] ?? ''))

test('変換: 種類・件数・ファイルの並び・上限', () => {
  const r = parseGrep(MANY)
  expect(r.total).toBe(6)
  expect(r.counts).toEqual({ FIXME: 1, TODO: 3, HACK: 1, XXX: 1 })
  expect(r.files.map(f => [f.path, f.count])).toEqual([
    ['src/app.ts', 3],
    ['lib/日本語.py', 2],
    ['README.md', 1],
  ])
  expect(r.files[0]?.byKind).toEqual({ FIXME: 1, TODO: 1, HACK: 1, XXX: 0 })
  expect(r.fileCount).toBe(3)
  // 行の最初に出た語の種類で数える。末尾の \r は落とす
  expect(r.items[5]).toEqual({ path: 'README.md', line: 40, kind: 'TODO', text: '- TODO と FIXME を拾う' })
  expect(r.items[2]?.text).toBe('/* HACK: 仮の回避 */')
  expect(parseGrep('').total).toBe(0)

  const big = parseGrep(HUGE)
  expect(big.total).toBe(520)
  expect(big.items).toHaveLength(LIMIT)
  expect(big.files).toHaveLength(10)
  expect(big.fileCount).toBe(13)

  expect(delta([])).toBeUndefined()
  expect(delta([{ at: 0, total: 5 }])).toBeUndefined()
  expect(delta([{ at: 0, total: 5 }, { at: 1, total: 3 }])).toBe(2)
  expect(delta([{ at: 0, total: 3 }, { at: 1, total: 4 }])).toBe(-1)

  const snap = { kind: 'repo' as const, cwd: CWD, loadedAt: NOW, isCut: false, ...r }
  const svg = paneSvg(snap, [{ at: 0, total: 8 }, { at: 1, total: 6 }])
  expect(svg).toMatch(/2 件減りました/)
  expect(svg).toMatch(/stroke-dashoffset/)
  // 点が 1 つなら線は引かない
  expect(paneSvg(snap, [{ at: 0, total: 6 }])).not.toMatch(/stroke-dashoffset/)
  expect(paneSvg({ ...snap, ...parseGrep('') }, [])).toMatch(/TODO はありません/)
  const odd = paneSvg({ ...snap, ...parseGrep(row('a<b>&.ts', 1, '// TODO')) }, [])
  expect(odd).toMatch(/a&lt;b&gt;&amp;\.ts/)
  expect(odd).not.toMatch(/a<b>/)
})

for (const surface of SURFACES) {
  test(`${surface}: 件数のタイル・多いファイル・一覧`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { repo: 'many', calls: [] }
    mockGit(on, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })

    if (surface === 'vscode') {
      const src = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(src).toMatch(/TODO ボード/)
      expect(src).toMatch(/>6(<animate[^>]*\/>)?<\/text>/) // 数字は増えて止まる(最後のコマ)
      expect(src).toMatch(/fill="#f85149">FIXME</)
      expect(src).toMatch(/fill="#58a6ff">TODO</)
      expect(src).toMatch(/fill="#f78166">HACK</)
      expect(src).toMatch(/fill="#bc8cff">XXX</)
      expect(src).toMatch(/src\/app\.ts/)
      expect(src).toMatch(/3 \/ 3 ファイル/)
      expect(src).toMatch(/clip-path/)
      expect(await ui.find({ key: 'lines' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '合計 6 件' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'FIXME 1 / TODO 3 / HACK 1 / XXX 1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '   3  src/app.ts' })).toBeDefined()
    }

    // 一覧: 1 件 1 ボタン
    expect(await ui.find({ key: 'item:src/app.ts:3' })).toBeDefined()
    expect(await ui.find({ key: 'item:README.md:40' })).toBeDefined()
    expect(await ui.find({ key: 'detail' })).toBeUndefined()

    // 種類で絞る
    expect((await ui.find({ key: 'filter-ALL' }))?.props.label).toBe('全部 6')
    expect((await ui.find({ key: 'filter-TODO' }))?.props.label).toBe('TODO 3')
    await ui.press({ key: 'filter-FIXME' })
    expect((await ui.find({ key: 'filter-FIXME' }))?.props.variant).toBe('primary')
    expect(await ui.find({ key: 'item:src/app.ts:10' })).toBeDefined()
    expect(await ui.find({ key: 'item:src/app.ts:3' })).toBeUndefined()
    await ui.press({ key: 'filter-HACK' })
    expect(await ui.find({ key: 'item:src/app.ts:22' })).toBeDefined()
    expect(await ui.find({ key: 'item:src/app.ts:10' })).toBeUndefined()
    await ui.press({ key: 'filter-ALL' })
    expect(await ui.find({ key: 'item:src/app.ts:3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ほか/ })).toBeUndefined()
    expect(onlyReads(world)).toBe(true)
    expect(world.calls).toHaveLength(2)
  })

  test(`${surface}: 押すと詳細、文を入力欄に入れる (送信しない)`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockGit(on, { repo: 'many', calls: [] })
    const filled: { text: string; mode: string }[] = []
    let isRefusing = false
    let submitted = 0
    on('prompt.fill', (_$, e) => {
      if (isRefusing) return { isFilled: false, refusal: 'dialog' as const }
      filled.push({ text: e.text, mode: e.mode })
      return { isFilled: true }
    })
    on('prompt.submit', (_$, e, next) => {
      submitted++
      return next(e)
    })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    await ui.press({ key: 'item:src/app.ts:10' })
    expect(await ui.find({ key: 'detail' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'FIXME  src/app.ts:10' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '// FIXME 0 で割ると落ちる <x> & y' })).toBeDefined()
    expect((await ui.find({ key: 'fix' }))?.props.label).toBe('この FIXME を片付けて')

    await ui.press({ key: 'fix' })
    expect(filled[0]?.mode).toBe('insert')
    expect(filled[0]?.text).toMatch(/^src\/app\.ts の 10 行目にある FIXME を片付けてください/)
    expect(filled[0]?.text).toMatch(/0 で割ると落ちる/)
    await ui.press({ key: 'cause' })
    expect(filled[1]?.text).toMatch(/^src\/app\.ts の 10 行目にある FIXME について、原因を調べてください/)
    expect(await ui.find({ type: 'Text', text: '入力欄に入れました(送信はしていません)' })).toBeDefined()
    expect(submitted).toBe(0)

    // hook が書いた理由は落とされるので、理由なしの文になる
    isRefusing = true
    await ui.press({ key: 'fix' })
    expect(await ui.find({ type: 'Text', text: '入力欄に入れられませんでした' })).toBeDefined()

    await ui.press({ key: 'item:lib/日本語.py:5' })
    expect((await ui.find({ key: 'cause' }))?.props.label).toBe('この TODO の原因を調べて')
    await ui.press({ key: 'close' })
    expect(await ui.find({ key: 'detail' })).toBeUndefined()
  })

  test(`${surface}: 読み直して減ったら緑の ▼`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { repo: 'many', calls: [] }
    mockGit(on, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    world.repo = 'fewer'
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') {
      const src = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(src).toMatch(/fill="#3fb950">2 件減りました/)
      expect(src).toMatch(/直近 2 回/)
    } else expect((await ui.find({ type: 'Text', text: '推移 6 → 4 (▼ 2 件減りました)' }))?.props.color).toBe('green')
    world.repo = 'many'
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/2 件増えました/)
    else expect(await ui.find({ type: 'Text', text: '推移 6 → 4 → 6 (▲ 2 件増えました)' })).toBeDefined()
  })

  test(`${surface}: 多いときは上限で切って「ほか N 件」`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockGit(on, { repo: 'huge', calls: [] })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    expect(await ui.find({ key: 'item:gen/f0.ts:1' })).toBeDefined()
    expect(await ui.find({ key: 'item:gen/f8.ts:100' })).toBeDefined()
    expect(await ui.find({ key: 'item:gen/f9.ts:101' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'ほか 420 件' })).toBeDefined()
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/10 \/ 13 ファイル/)
    else expect(await ui.find({ type: 'Text', text: '合計 520 件' })).toBeDefined()
  })

  test(`${surface}: 見つからない・失敗`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { repo: 'empty', calls: [] }
    mockGit(on, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/TODO はありません/)
    else expect(await ui.find({ type: 'Text', text: 'TODO はありません' })).toBeDefined()

    world.repo = 'broken'
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toMatch(/fatal: bad pattern/)
    else expect((await ui.find({ type: 'Text', text: /^git grep を実行できません/ }))?.props.color).toBe('red')
  })
}

test('/todos で読んで開く。ファイルを変えうるツールの後に 2 秒に 1 回まで読み直す', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = { repo: 'many', calls: [] }
  mockGit(on, world)
  let isUp = false
  on('ui.open', (_$, e) => {
    isUp = e.id === 'todo-board'
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: isUp ? [{ id: 'todo-board', title: 'TODO', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('tool.call', () => ({ result: {} as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })

  const reads = () => world.calls.filter(a => a[4] === 'grep').length
  const call = (tool: string) => $.tool.call({ tool, input: {} } as never)

  // 開く前はツールが終わっても読まない
  await call('Edit')
  await clock.advance(3000)
  expect(reads()).toBe(0)

  const ran = await $.command.run({
    command: 'todos',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: 'TODO のペインを開きました。' })
  expect(isUp).toBe(true)
  // 読むのは裏なので、終わるのを待つ
  await clock.settle()
  expect(reads()).toBe(1)

  // 読むだけのツールでは読み直さない
  await call('Read')
  await clock.advance(3000)
  expect(reads()).toBe(1)

  // 続けて変えても、2 秒の間は 1 回にまとまる
  await call('Edit')
  await clock.advance(10)
  expect(reads()).toBe(2)
  world.repo = 'fewer'
  await call('Write')
  await call('PowerShell')
  await clock.advance(500)
  expect(reads()).toBe(2)
  await clock.advance(1600)
  expect(reads()).toBe(3)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '合計 4 件' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^推移 6 → 6 → 4/ })).toBeDefined()
  expect(onlyReads(world)).toBe(true)
})

test('/todos が取れなければ /todo-board を登録する', async ($, on) => {
  const tried: string[] = []
  let isTaken = false
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'todos' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['todos'])
  isTaken = true
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['todos', 'todos', 'todo-board'])
})

// ── v0.1.1 で直した物

test('追跡していない新しいファイルも拾う (git grep --untracked)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world: World = { repo: 'many', calls: [] }
  mockGit(on, world)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reload' })
  const grep = world.calls.find(a => a[4] === 'grep')
  expect(grep).toContain('--untracked')
  expect(await ui.find({ type: 'Text', text: '合計 6 件' })).toBeDefined()
})

test('読み込みが 2 本並んでも、遅い方の古い件数で上書きしない', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // 1 本目は遅く (読み始めた時の 6 件)、2 本目はすぐ (片付けた後の 4 件) 返る
  const world: World = { repo: 'many', calls: [], delays: [1000, 0], clock }
  mockGit(on, world)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reload' })
  world.repo = 'fewer'
  await ui.press({ key: 'reload' })
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: '合計 4 件' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '推移 4' })).toBeDefined()
})

test('作業フォルダが変わったら推移を消す', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world: World = { repo: 'many', calls: [] }
  mockGit(on, world)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reload' })
  expect(await ui.find({ type: 'Text', text: '推移 6' })).toBeDefined()
  world.cwd = '/tmp/other'
  world.repo = 'fewer'
  await ui.press({ key: 'reload' })
  expect(await ui.find({ type: 'Text', text: '推移 4' })).toBeDefined()
  world.repo = 'many'
  await ui.press({ key: 'reload' })
  expect(await ui.find({ type: 'Text', text: /^推移 4 → 6/ })).toBeDefined()
})

for (const surface of SURFACES) {
  test(`${surface}: 名前や本文の制御文字を落として描く`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockGit(on, { repo: 'odd', calls: [] })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).not.toMatch(CTRL)
      expect(String(svg?.props.alt)).not.toMatch(CTRL)
      expect(String(svg?.props.source)).toMatch(/src\/ab\.ts/)
    } else expect(await ui.find({ type: 'Text', text: '   1  src/ab.ts' })).toBeDefined()
    const item = await ui.find({ key: 'item:src/ab.ts:7' })
    expect(item?.text).not.toMatch(CTRL)
    await ui.press({ key: 'item:src/ab.ts:7' })
    expect(await ui.find({ type: 'Text', text: '// TODO 改ページ 鳴る' })).toBeDefined()
  })
}

test('/todos が拒まれて /todo-board にした時は、/todos を横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  mockGit(on, { repo: 'many', calls: [] })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('command.register', (_$, e) => (e.name === 'todos' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  on('command.run', { command: 'todos' }, () => ({ text: '組み込みの todos' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'todos', ...run })).toMatchObject({ text: '組み込みの todos' })
  expect(await $.command.run({ command: 'todo-board', ...run })).toMatchObject({ text: 'TODO のペインを開きました。' })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  mock.clock(on, { now: NOW })
  mockGit(on, { repo: 'many', calls: [] })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'reload' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/<rect width="380" height="\d+" rx="10" fill="#ffffff"\/>/)
  expect(await source()).toContain('fill="#cf222e">FIXME<') // 明るい赤
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await source()).toMatch(/<rect width="380" height="\d+" rx="10" fill="#0d1117"\/>/)
})

// ── v0.3.0: todo-scan から移した物 (git の外はフォルダを歩く)

// エンジンは Windows で区切りとドライブを直して渡すことがあるので、そろえて比べる
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

/** git でないフォルダ。パス → 中身 (フォルダは null) */
const TREE: Record<string, string | null> = {
  '/proj/a.ts': '// TODO 一つ目\nconst x = 1 // FIXME 二つ目\n',
  '/proj/src': null,
  '/proj/src/b.py': '# HACK ここ\n# XXX そこ\n# TODO あれ\n',
  '/proj/src/deep': null,
  '/proj/src/deep/c.md': 'TODO 深い所\n',
  '/proj/node_modules': null,
  '/proj/node_modules/x.js': '// TODO 読まない\n',
  '/proj/.git': null,
  '/proj/.git/HEAD': 'TODO 読まない\n',
  '/proj/logo.png': 'TODO 読まない',
  '/proj/blob.dat': 'TODO\0 文字でない',
}
const mockFs = (on: On, reads: string[]) => {
  on('fs.list', (_$, e) => {
    const dir = key(e.path ?? '')
    if (TREE[dir] !== null && dir !== '/proj') return { deny: 'ENOENT' }
    const value: WalkEntry[] = Object.keys(TREE)
      .filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .map(p => ({ name: p.slice(dir.length + 1), kind: TREE[p] === null ? ('dir' as const) : ('file' as const), size: TREE[p]?.length ?? 0 }))
    return { value: value.map(v => ({ ...v, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_$, e) => {
    reads.push(key(e.path))
    const text = TREE[key(e.path)]
    return typeof text === 'string' ? { value: text } : { deny: 'ENOENT' }
  })
}

for (const surface of SURFACES) {
  test(`${surface}: git でないフォルダは $.fs で歩く。node_modules・. で始まるフォルダ・文字でないファイルは飛ばす`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { repo: 'none', calls: [], cwd: 'D:\\proj' }
    const reads: string[] = []
    mockGit(on, world)
    mockFs(on, reads)
    const ui = await $.ui.mount({ ...PANE, surface })
    // git の外と、git が入っていない時
    for (const repo of ['none', 'no-git'] as const) {
      world.repo = repo
      world.calls = []
      reads.length = 0
      await ui.press({ key: 'reload' })
      expect(world.calls.map(a => a[4])).toEqual(['rev-parse'])
      expect(reads.sort()).toEqual(['/proj/a.ts', '/proj/blob.dat', '/proj/src/b.py', '/proj/src/deep/c.md'])
      if (surface === 'vscode') {
        const src = String((await ui.find({ type: 'Svg' }))?.props.source)
        expect(src).toContain('4 個読んだ')
        expect(src).toContain('>src/b.py<')
        expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toMatch(/^合計 6 件 \(フォルダを歩いた 4 個\)/)
      } else {
        expect(await ui.find({ type: 'Text', text: '合計 6 件 (フォルダを歩いた 4 個)' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'FIXME 1 / TODO 3 / HACK 1 / XXX 1' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: '   3  src/b.py' })).toBeDefined()
      }
      const items = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('item:'))
      expect(items).toEqual(['item:a.ts:1', 'item:a.ts:2', 'item:src/b.py:1', 'item:src/b.py:2', 'item:src/b.py:3', 'item:src/deep/c.md:1'])
    }
    await ui.press({ key: 'filter-XXX' })
    expect(await ui.find({ key: 'item:src/b.py:2' })).toBeDefined()
    expect(await ui.find({ key: 'item:a.ts:1' })).toBeUndefined()
  })
}

test('歩く上限: ファイルの数・見つけた数・時間で止め、止めたことを出す', async () => {
  const files = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.ts`, kind: 'file' as const, size: 10 }))
  let t = 0
  const io = (step = 0) => ({
    list: async (p: string) => (p === 'D:\\w' ? files : []),
    read: async () => '// TODO a\n// TODO b\n',
    now: async () => (t += step),
  })
  expect(await walk(io(), 'D:\\w', { ...WALK_LIMITS, files: 3 })).toMatchObject({ scanned: 3, cut: 'files' })
  expect((await walk(io(), 'D:\\w', { ...WALK_LIMITS, hits: 5 })).rows.length).toBe(5)
  expect(await walk(io(), 'D:\\w', { ...WALK_LIMITS, hits: 5 })).toMatchObject({ cut: 'hits' })
  t = 0
  expect(await walk(io(1000), 'D:\\w', { ...WALK_LIMITS, ms: 2500 })).toMatchObject({ scanned: 2, cut: 'time' })
  expect(await walk(io(), 'D:\\w')).toMatchObject({ scanned: 10, cut: '' })
  // 大きすぎるファイルは読まない
  expect(await walk({ ...io(), list: async p => (p === 'D:\\w' ? [{ name: 'big.ts', kind: 'file', size: WALK_LIMITS.size + 1 }] : []) }, 'D:\\w')).toMatchObject({ scanned: 0 })
  const snap = { kind: 'repo' as const, cwd: 'D:\\w', via: 'walk' as const, scanned: 2000, cut: 'files' as const, loadedAt: NOW, isCut: true, ...tally([]) }
  expect(paneSvg(snap, [])).toContain(CUT_TEXT.files)
  expect(paneLines(snap, []).map(l => l.text)).toContain('ファイルが多いので 2000 個で止めました')
})

test('/todos は読み終わるのを待たずに返り、読み終わったら件数が出る', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = { repo: 'many', calls: [], delays: [3000], clock }
  mockGit(on, world)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  // 待っていたら、時計を進めない限り grep が終わらず、ここに来ない
  const ran = await $.command.run({ command: 'todos', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(ran).toMatchObject({ text: 'TODO のペインを開きました。' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '読み込み中' })).toBeDefined()
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: '合計 6 件' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '読んでいます…' })).toBeUndefined()
})
