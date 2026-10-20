import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { LIMIT, delta, paneSvg, parseGrep } from '../hooks/todo'

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

type World = { repo: 'none' | 'empty' | 'many' | 'fewer' | 'huge' | 'broken'; calls: string[][] }

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
    if (args === 'rev-parse --is-inside-work-tree') return out('true\n')
    if (args === 'grep -n -I -z --no-color -E \\b(TODO|FIXME|HACK|XXX)\\b') {
      if (world.repo === 'broken') return out('', 2, 'fatal: bad pattern')
      if (world.repo === 'empty') return out('', 1)
      return out(world.repo === 'many' ? MANY : world.repo === 'fewer' ? FEWER : HUGE)
    }
    return out('', 1, `unexpected: ${args}`)
  })
}

const onlyReads = (world: World) => world.calls.every(a => a[0] === 'git' && ['rev-parse', 'grep'].includes(a[3] ?? ''))

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
      expect(src).toMatch(/>6<\/text>/)
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
    await ui.select({ key: 'filter', value: 'FIXME' })
    expect(await ui.find({ key: 'item:src/app.ts:10' })).toBeDefined()
    expect(await ui.find({ key: 'item:src/app.ts:3' })).toBeUndefined()
    await ui.select({ key: 'filter', value: 'HACK' })
    expect(await ui.find({ key: 'item:src/app.ts:22' })).toBeDefined()
    expect(await ui.find({ key: 'item:src/app.ts:10' })).toBeUndefined()
    await ui.select({ key: 'filter', value: 'ALL' })
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
    expect(filled[0]?.mode).toBe('replace')
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

  test(`${surface}: git のフォルダでない・見つからない・失敗`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { repo: 'none', calls: [] }
    mockGit(on, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toMatch(/git のフォルダでだけ使えます/)
    else expect((await ui.find({ type: 'Text', text: 'git のフォルダでだけ使えます' }))?.props.color).toBe('yellow')
    expect(world.calls).toHaveLength(1)
    expect(await ui.find({ key: 'filter' })).toBeUndefined()

    world.repo = 'empty'
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

  const reads = () => world.calls.filter(a => a[3] === 'grep').length
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
