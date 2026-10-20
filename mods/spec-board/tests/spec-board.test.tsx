import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { READ_ONLY, cut, headOf, isAbsolute, isPythonOk, noticeOf, paneSvg, parseList, parseNext, sortWaiting } from '../hooks/board'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const SET = { options: { pythonPath: '/usr/bin/python3', specstatusScript: '/tmp/demo/spec-status/specstatus.py' } }
const PANE = {
  plugin: 'spec-board',
  component: 'Pane',
  requestId: 'spec-board',
  props: {
    title: '仕様書',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

const item = (name: string, state: string, waiting: string | null, note: string, done: number | null = null, last: number | null = null) => ({
  name,
  spec_dir: `demo/${name}`,
  docs: [{ path: `specs/${name}.md`, kind: '仕様書', created: null }],
  state,
  note,
  done_phase: done,
  last_phase: last,
  waiting,
  github: null,
})
const WAITING = JSON.stringify([
  item('アプリA', '実装完了', '実物待ち', '実機は未確認'),
  item('ツールB', '着手済', '確認待ち', 'Phase 2 まで済み。Q-3 の答え待ち', 2, 4),
  item('拡張C', '一部未実装', '確認待ち', ''),
])
const PROGRESS = JSON.stringify([item('ツールB', '着手済', '確認待ち', 'Phase 2 まで済み', 2, 4), item('ゲームD', '一部未実装', 'なし', '', null, 3)])
const NEXT = ' 170  ツールB  (着手済)  確認待ち(10日)・あなたの回答待ち 9\n  95  ゲーム D 改  (一部未実装)  止まって 12 日\n'
const SHOW = 'ツールB  (demo/ツールB)\n状態: 着手済\nPhase: 2/4  待ち: 確認待ち\n'

type Reply = { exitCode?: number; stdout?: string; stderr?: string; isMissing?: boolean }
type World = {
  calls: { argv: string[]; env?: Record<string, string> }[]
  replies: Partial<Record<'wait' | 'prog' | 'next' | 'show', Reply>>
  isOpen?: boolean
}

const kindOf = (argv: readonly string[]) =>
  argv[2] === 'list' ? (argv.includes('--waiting') ? 'wait' : 'prog') : argv[2] === 'next' ? 'next' : argv[2] === 'show' ? 'show' : undefined

/** process.run を SpecStatus の代わりに答える */
const mockSs = (on: On, world: World) => {
  on('process.run', (_$, e) => {
    world.calls.push({ argv: [...e.argv], env: e.init?.env })
    const kind = kindOf(e.argv)
    const base: Required<World['replies']> = {
      wait: { stdout: WAITING, stderr: 'GitHub の回数の上限です\n' },
      prog: { stdout: PROGRESS },
      next: { stdout: NEXT },
      show: { stdout: SHOW },
    }
    const r = kind ? (world.replies[kind] ?? base[kind]) : { exitCode: 2, stderr: 'unknown' }
    if (r.isMissing) return { deny: `spawn ${e.argv[0]} ENOENT` }
    return { value: { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.panes', () => ({
    value: world.isOpen ? [{ id: 'spec-board', title: '仕様書', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', () => {
    world.isOpen = true
    return { value: { isPlaced: true as const } }
  })
}

type Ui = {
  find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ props: Record<string, unknown>; text: string } | undefined>
  findAll: (q: { type?: string }) => Promise<{ props: Record<string, unknown>; text: string }[]>
  press: (q: { key: string }) => Promise<unknown>
}
const svgOf = async (ui: Ui) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
/** 木の中の文字 (Text・Button・Code・Svg の alt と source) に制御文字が無いか */
const hasCtrl = async (ui: Ui) => {
  for (const type of ['Text', 'Button', 'Code', 'Svg']) {
    for (const el of await ui.findAll({ type })) {
      if (CTRL.test(el.text) || CTRL.test(String(el.props.alt ?? '')) || CTRL.test(String(el.props.source ?? ''))) return true
    }
  }
  return false
}

test('純関数: 一覧・おすすめの読み方、パスの判定、頭の取り方', () => {
  const list = parseList(WAITING)
  expect(list.map(i => i.name)).toEqual(['アプリA', 'ツールB', '拡張C'])
  expect(list[1]).toEqual({ name: 'ツールB', state: '着手済', waiting: '確認待ち', note: 'Phase 2 まで済み。Q-3 の答え待ち', phase: 'Phase 2/4' })
  expect(parseList(PROGRESS)[1]).toMatchObject({ waiting: '', phase: 'Phase 0/3' })
  expect(sortWaiting(list).map(i => i.name)).toEqual(['ツールB', '拡張C', 'アプリA'])
  expect(() => parseList('{"a":1}')).toThrow()
  expect(parseList('[1, null, {"name": ""}, {"name": "x", "state": 3}]')).toEqual([{ name: 'x', state: '', waiting: '', note: '', phase: '' }])

  expect(parseNext(NEXT)).toEqual([
    { score: 170, name: 'ツールB', state: '着手済', reasons: '確認待ち(10日)・あなたの回答待ち 9' },
    { score: 95, name: 'ゲーム D 改', state: '一部未実装', reasons: '止まって 12 日' },
  ])
  expect(parseNext('おすすめはありません\n')).toEqual([])

  expect([isAbsolute('C:\\py\\python.exe'), isAbsolute('/usr/bin/python3'), isAbsolute('\\\\srv\\x'), isAbsolute('C:'), isAbsolute('tools/ss.py'), isAbsolute('')]).toEqual([
    true,
    true,
    true,
    false,
    false,
    false,
  ])
  expect([isPythonOk('python3'), isPythonOk('py'), isPythonOk('bin/python'), isPythonOk('')]).toEqual([true, true, false, false])
  expect(headOf('\n\nTraceback\n  File "x"\u0007\nValueError: boom\n', 2)).toBe('Traceback\n  File "x"')
  expect(noticeOf('\nGitHub の回数の上限です\n2 行目')).toBe('GitHub の回数の上限です')
  expect(cut('とても長い仕様書の名前です', 10)).toBe('とても長…')
  expect(READ_ONLY.has('mark')).toBe(false)
})

test('SVG は viewBox だけで上限内。おすすめの棒が伸びる', () => {
  const svg = paneSvg({ kind: 'ok', waiting: sortWaiting(parseList(WAITING)), progress: parseList(PROGRESS), next: parseNext(NEXT), loadedAt: NOW, notice: '' })
  expect(svg).not.toMatch(/<svg[^>]* width=/)
  expect(svg).toContain('確認 2・実物 1')
  expect(svg).toContain('<animate attributeName="width"')
  const many = Array.from({ length: 500 }, (_, i) => ({ name: `仕様書${i}`, state: '着手済', waiting: '確認待ち', note: 'x'.repeat(200), phase: '' }))
  expect(paneSvg({ kind: 'ok', waiting: many, progress: many, next: [], loadedAt: NOW, notice: '' }).length).toBeLessThan(131_072)
})

for (const surface of SURFACES) {
  test(`${surface}: 未設定なら設定のしかたを出し、押しても呼ばない`, async ($, on) => {
    const world: World = { calls: [], replies: {} }
    mockSs(on, world)
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('未設定')
      expect(svg).toContain('specstatusScript')
    } else expect(await ui.find({ type: 'Text', text: /^未設定。\/config で spec-board の pythonPath/ })).toBeDefined()
    expect(world.calls).toHaveLength(0)
  })

  test(`${surface}: 読み直すと件数・一覧・おすすめを出し、押すと詳細を読む`, SET, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world: World = { calls: [], replies: {} }
    mockSs(on, world)
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    await ui.press({ key: 'reload' })
    // 読むコマンドだけを、UTF-8 の指定つきで呼ぶ
    expect(world.calls.map(c => c.argv.slice(2).join(' ')).sort()).toEqual(['list --state 着手済 --state 一部未実装 --json', 'list --waiting --json', 'next'])
    expect(world.calls.every(c => c.argv[0] === '/usr/bin/python3' && c.argv[1] === '/tmp/demo/spec-status/specstatus.py')).toBe(true)
    expect(world.calls.every(c => c.env?.PYTHONIOENCODING === 'utf-8')).toBe(true)
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      // 待ちの数(数字は増えて止まる。止まった最後のコマが 3)
      expect(svg).toMatch(/>3<animate[^>]*fill="freeze"\/><\/text>/)
      expect(svg).toContain('確認 2・実物 1')
      expect(svg).toContain('着手 1・一部 1')
      expect(svg).toContain('ゲーム D 改')
    } else expect(await ui.find({ type: 'Text', text: '待ち 3 (確認待ち 2) / 途中 2 / おすすめ 2' })).toBeDefined()
    // 確認待ちが先
    expect((await ui.find({ type: 'Button', key: 'wait-b-0' }))?.text).toContain('ツールB')
    expect((await ui.find({ type: 'Button', key: 'wait-b-2' }))?.text).toContain('アプリA')
    expect(await ui.find({ type: 'Text', text: '  Phase 2 まで済み。Q-3 の答え待ち' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /GitHub の回数の上限です/ })).toBeDefined()

    await ui.press({ key: 'next-b-1' })
    expect(world.calls.at(-1)?.argv.slice(2)).toEqual(['show', '--', 'ゲーム D 改'])
    expect((await ui.find({ type: 'Code' }))?.text).toContain('状態: 着手済')
    expect(await ui.find({ type: 'Text', text: '詳細: ゲーム D 改' })).toBeDefined()
    await ui.press({ key: 'close-detail' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(world.calls.every(c => READ_ONLY.has(c.argv[2] ?? ''))).toBe(true)
  })

  test(`${surface}: 終了コードが 0 でなければ出力の頭をそのまま出す`, SET, async ($, on) => {
    const world: World = { calls: [], replies: { wait: { exitCode: 4, stdout: '', stderr: 'Traceback (most recent call last):\nKeyError: vault\n' } } }
    mockSs(on, world)
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('list --waiting が失敗しました')
    else expect((await ui.find({ type: 'Text', text: /^list --waiting が失敗しました: 終了コード 4/ }))?.props.color).toBe('red')
    expect((await ui.find({ type: 'Code' }))?.text).toBe('Traceback (most recent call last):\nKeyError: vault')
    expect(await ui.find({ type: 'Button', key: 'reload' })).toBeDefined()
  })

  test(`${surface}: python が無くても画面は壊れない`, SET, async ($, on) => {
    const world: World = { calls: [], replies: { wait: { isMissing: true }, prog: { isMissing: true }, next: { isMissing: true } } }
    mockSs(on, world)
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    await ui.press({ key: 'reload' })
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('起動できません')
    else expect(await ui.find({ type: 'Text', text: /^list --waiting が失敗しました: 起動できません/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'reload' })).toBeDefined()
  })
}

test('JSON が読めなければそう出す', SET, async ($, on) => {
  mockSs(on, { calls: [], replies: { prog: { stdout: 'Traceback: not json' } } })
  const ui = (await $.ui.mount({ ...PANE, surface: 'terminal' })) as unknown as Ui
  await ui.press({ key: 'reload' })
  expect(await ui.find({ type: 'Text', text: /^list が失敗しました: JSON として読めませんでした/ })).toBeDefined()
})

test('詳細の show が失敗したら赤で出し、一覧は残す', SET, async ($, on) => {
  mock.clock(on, { now: NOW })
  mockSs(on, { calls: [], replies: { show: { exitCode: 4, stdout: '宛先に当たる仕様書がありません。' } } })
  const ui = (await $.ui.mount({ ...PANE, surface: 'terminal' })) as unknown as Ui
  await ui.press({ key: 'reload' })
  await ui.press({ key: 'wait-b-0' })
  expect((await ui.find({ type: 'Text', text: /^show が失敗しました: 終了コード 4/ }))?.props.color).toBe('red')
  expect((await ui.find({ type: 'Code' }))?.text).toBe('宛先に当たる仕様書がありません。')
  expect(await ui.find({ type: 'Button', key: 'wait-b-0' })).toBeDefined()
})

test('相対パスの設定は未設定と同じ', { options: { pythonPath: 'python3', specstatusScript: 'spec-status/specstatus.py' } }, async ($, on) => {
  const world: World = { calls: [], replies: {} }
  mockSs(on, world)
  const ui = (await $.ui.mount({ ...PANE, surface: 'terminal' })) as unknown as Ui
  await ui.press({ key: 'reload' })
  expect(world.calls).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /^未設定。/ })).toBeDefined()
})

for (const surface of SURFACES) {
  test(`${surface}: 名前・メモ・出力の制御文字を落とす`, SET, async ($, on) => {
    mock.clock(on, { now: NOW })
    const bad = JSON.stringify([item('悪い\u0007名前\u001b[31m', '着手済', '確認待ち', 'メモ\u0000\u000b\u007f\tです')])
    mockSs(on, {
      calls: [],
      replies: { wait: { stdout: bad, stderr: '\u0007ベル\n' }, prog: { stdout: bad }, next: { stdout: ' 10  悪い\u0007名前  (着手済)  理由\u0008\n' }, show: { stdout: 'a\u0007b\u000cc\n' } },
    })
    const ui = (await $.ui.mount({ ...PANE, surface })) as unknown as Ui
    await ui.press({ key: 'reload' })
    expect((await ui.find({ type: 'Button', key: 'wait-b-0' }))?.text).toContain('悪い名前')
    await ui.press({ key: 'wait-b-0' })
    expect((await ui.find({ type: 'Code' }))?.text).toBe('abc')
    expect(await hasCtrl(ui)).toBe(false)
  })
}

const presentation = { isFullscreen: false, columns: 80 }

test('開いている間だけ 5 分ごとに読み直す', SET, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const world: World = { calls: [], replies: {} }
  mockSs(on, world)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  await clock.advance(5 * 60_000)
  expect(world.calls).toHaveLength(0)
  await $.command.run({ command: 'specs', args: '', origin: { kind: 'composer' }, presentation })
  expect(world.calls).toHaveLength(3)
  await clock.advance(5 * 60_000)
  expect(world.calls).toHaveLength(6)
  world.isOpen = false
  await clock.advance(5 * 60_000)
  expect(world.calls).toHaveLength(6)
})

test('/specs を登録できればそれでペインを開く', SET, async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  mockSs(on, { calls: [], replies: {} })
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['specs'])
  const r = await $.command.run({ command: 'specs', args: '', origin: { kind: 'composer' }, presentation })
  expect(r).toMatchObject({ text: '仕様書のペインを開きました。' })
})

test('/specs が拒まれたら /spec-board で開き、/specs は横取りしない', SET, async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    if (e.name === 'specs') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const world: World = { calls: [], replies: {} }
  mockSs(on, world)
  on('command.run', { command: 'specs' }, () => ({ text: '別の specs' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['spec-board'])
  expect(await $.command.run({ command: 'spec-board', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: '仕様書のペインを開きました。' })
  expect(await $.command.run({ command: 'specs', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: '別の specs' })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', SET, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  mockSs(on, { calls: [], replies: {} })
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'reload' })
  expect(await svgOf(ui)).toMatch(/<rect width="380" height="\d+" rx="10" fill="#ffffff"\/>/)
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await svgOf(ui)).toMatch(/<rect width="380" height="\d+" rx="10" fill="#0d1117"\/>/)
})
