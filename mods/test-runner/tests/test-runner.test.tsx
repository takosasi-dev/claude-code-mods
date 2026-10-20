import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { countResults, fixPrompt, paneSvg, splitCommand, statusOf, tailOf } from '../hooks/runner'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const SET = { options: { testCommand: 'npm test', timeoutSeconds: 300 } }
const PANE = {
  plugin: 'test-runner',
  component: 'Pane',
  requestId: 'test-runner',
  props: {
    title: 'テスト',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const JEST_FAIL = [
  '\u001b[1mPASS\u001b[22m src/a.test.ts',
  'FAIL src/b.test.ts',
  '  ● b > works',
  '    expect(received).toBe(expected)',
  '',
  'Test Suites: 1 failed, 1 passed, 2 total',
  'Tests:       1 failed, 3 passed, 4 total',
  'Snapshots:   0 total',
  'Time:        1.2 s',
  '',
].join('\n')
const JEST_PASS = 'Tests:       4 passed, 4 total\nTime: 0.5 s\n'

type Child = { chunks: string[]; code?: number; wait?: number; isMissing?: boolean }
type World = { child: Child; calls: { argv: readonly string[]; cwd?: string }[] }

/** process.spawn をエンジンの代わりに答える。wait があれば止められるまで mock の時計で眠る */
const mockSpawn = (on: On, clock: MockClock, world: World) => {
  on('session.cwd', () => ({ value: CWD }))
  on('process.spawn', async function* (_$, e) {
    world.calls.push({ argv: [...e.argv], cwd: e.cwd })
    const c = world.child
    // 起動できない時、エンジンは最初の読み取りで reject する。テストではこの hook が投げて同じ形にする
    if (c.isMissing) throw new Error(`failed to start: ENOENT: Command '${e.argv[0]}' not found`)
    for (const text of c.chunks) yield { stream: 'stdout' as const, text }
    if (c.wait) await clock.sleep(c.wait)
    return { value: { code: c.code ?? 0, signal: null } }
  })
}

const svgOf = async (ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) =>
  String((await ui.find({ type: 'Svg' }))?.props.source ?? '')

test('純関数: argv・数の拾い方 (jest / vitest / pytest / cargo / mocha / node --test / go)・末尾', () => {
  expect(splitCommand('  npx   vitest run ')).toEqual(['npx', 'vitest', 'run'])
  expect(splitCommand('')).toEqual([])

  expect(countResults(JEST_FAIL)).toEqual({ passed: 3, failed: 1 })
  expect(countResults(JEST_PASS)).toEqual({ passed: 4, failed: 0 })
  expect(countResults(' Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 9 passed (11)\n   Duration  1.1s\n')).toEqual({ passed: 9, failed: 2 })
  expect(countResults('collected 5 items\n\n==== 1 failed, 4 passed in 0.12s ====\n')).toEqual({ passed: 4, failed: 1 })
  expect(countResults('===== 6 passed in 0.03s =====')).toEqual({ passed: 6, failed: 0 })
  const cargo = 'running 3 tests\ntest result: FAILED. 2 passed; 1 failed; 0 ignored\n\n   Doc-tests x\ntest result: ok. 1 passed; 0 failed; 0 ignored\n'
  expect(countResults(cargo)).toEqual({ passed: 3, failed: 1 })
  expect(countResults('  3 passing (12ms)\n  1 failing\n\n  1) thing:\n     Error: boom\n')).toEqual({ passed: 3, failed: 1 })
  expect(countResults('# tests 5\n# pass 4\n# fail 1\n')).toEqual({ passed: 4, failed: 1 })
  expect(countResults('=== RUN   TestA\n--- PASS: TestA (0.00s)\n=== RUN   TestB\n    --- FAIL: TestB (0.00s)\nFAIL\n')).toEqual({ passed: 1, failed: 1 })
  expect(countResults('built ok\n')).toEqual({})

  const many = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\r\n') + '\r\n\r\n'
  const tail = tailOf(many)
  expect(tail.split('\n')).toHaveLength(60)
  expect(tail.startsWith('line 40')).toBe(true)
  expect(tail.endsWith('line 99')).toBe(true)
  expect(tailOf('\u001b[31mred\u001b[0m')).toBe('red')

  expect([statusOf(0, undefined), statusOf(1, undefined), statusOf(null, 'user'), statusOf(null, 'timeout')]).toEqual(['pass', 'fail', 'stopped', 'timeout'])
  const p = fixPrompt({ status: 'fail', command: 'npm test', exitCode: 1, ms: 1, finishedAt: NOW, tail: 'Tests: 1 failed' })
  expect(p).toContain('`npm test`')
  expect(p).toContain('終了コード 1')
  expect(p).toContain('```\nTests: 1 failed\n```')
})

test('実行中の SVG はスピナーと明滅、上限内', () => {
  const svg = paneSvg({ kind: 'running', command: 'npm test', startedAt: NOW }, [], 'npm test')
  expect(svg).toContain('実行中')
  expect(svg).toContain('animateTransform')
  expect(svg).toContain('repeatCount="indefinite"')
  expect(svg).toContain('#d29922')
  expect(svg).not.toMatch(/<svg[^>]* width=/)
  const full = Array.from({ length: 20 }, (_, i) => ({ status: i % 2 ? ('pass' as const) : ('fail' as const), ms: 1000 * i }))
  expect(paneSvg({ kind: 'idle' }, full, 'npm test').length).toBeLessThan(131_072)
})

for (const surface of SURFACES) {
  test(`${surface}: 未設定なら設定のしかたを出し、押しても走らせない`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world: World = { child: { chunks: [] }, calls: [] }
    mockSpawn(on, clock, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('未設定')
      expect(svg).toContain('testCommand に')
    } else expect(await ui.find({ type: 'Text', text: /^未設定。\/config で test-runner の testCommand/ })).toBeDefined()
    await ui.press({ key: 'run' })
    expect(world.calls).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /^未設定。/ })).toBeDefined()
  })

  test(`${surface}: 失敗 — 信号・数・末尾・「この失敗を直して」`, SET, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world: World = { child: { chunks: [JEST_FAIL.slice(0, 40), JEST_FAIL.slice(40)], code: 1 }, calls: [] }
    mockSpawn(on, clock, world)
    const filled: string[] = []
    on('prompt.fill', (_$, e) => {
      filled.push(e.text)
      return { isFilled: true }
    })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'fix' })).toBeUndefined()
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('未実行')
    else expect(await ui.find({ type: 'Text', text: '未実行' })).toBeDefined()

    await clock.advance(10)
    await ui.press({ key: 'run' })
    expect(world.calls).toEqual([{ argv: ['npm', 'test'], cwd: CWD }])
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('>失敗<')
      expect(svg).toMatch(/>3<\/text>/)
      expect(svg).toMatch(/>1<\/text>/)
      expect(svg).toContain('終了コード 1')
      expect(svg).toContain('fill="#f85149"/><circle')
      expect(await ui.find({ key: 'lines' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^失敗 \/ 所要 / }))?.props.color).toBe('red')
      expect(await ui.find({ type: 'Text', text: '通過 3 / 失敗 1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^直近 ■ / })).toBeDefined()
    }
    expect((await ui.find({ type: 'Code' }))?.text).toContain('Tests:       1 failed, 3 passed, 4 total')

    await ui.press({ key: 'fix' })
    expect(filled).toHaveLength(1)
    expect(filled[0]).toContain('`npm test` が失敗しました(終了コード 1)')
    expect(filled[0]).toContain('expect(received).toBe(expected)')
    expect(await ui.find({ type: 'Text', text: '入力欄に入れました(送信はしていません)' })).toBeDefined()
  })

  test(`${surface}: 通過 — 直近の列が伸び、20 回で止まる`, SET, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world: World = { child: { chunks: [JEST_PASS] }, calls: [] }
    mockSpawn(on, clock, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'run' })
    expect(await ui.find({ type: 'Button', key: 'fix' })).toBeUndefined()
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('>通過<')
      expect(svg).toContain('通過 1</tspan>')
      expect(svg).toContain('<animate attributeName="height"')
    } else expect((await ui.find({ type: 'Text', text: /^通過 \/ 所要 / }))?.props.color).toBe('green')
    for (let i = 0; i < 22; i++) await ui.press({ key: 'run' })
    expect(world.calls).toHaveLength(23)
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('/ 20 回')
    else expect(await ui.find({ type: 'Text', text: `直近 ${'●'.repeat(20)} (● 通過 / ■ 失敗 / ○ 中断)` })).toBeDefined()
  })

  test(`${surface}: 起動できないコマンドは赤い説明`, SET, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mockSpawn(on, clock, { child: { chunks: [], isMissing: true }, calls: [] })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'run' })
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('起動できません')
    else expect((await ui.find({ type: 'Text', text: /^起動できません: ./ }))?.props.color).toBe('red')
    expect(await ui.find({ type: 'Button', key: 'run' })).toBeDefined()
  })

  test(`${surface}: 実行中は止めるだけ出し、止めると中断として残る`, SET, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world: World = { child: { chunks: ['running...\n'], wait: 600_000 }, calls: [] }
    mockSpawn(on, clock, world)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'run' })
    expect(await ui.find({ type: 'Button', key: 'run' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'stop' })).toBeDefined()
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('実行中')
    else expect(await ui.find({ type: 'Text', text: /^実行中 \(開始 / })).toBeDefined()
    await clock.advance(3000)
    await ui.press({ key: 'stop' })
    expect(await ui.find({ type: 'Button', key: 'stop' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'fix' })).toBeUndefined()
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('止めました')
    else expect(await ui.find({ type: 'Text', text: /^止めました \/ 所要 3\.0 秒/ })).toBeDefined()
    expect(world.calls).toHaveLength(1)
  })
}

test('時間の上限を過ぎると止めて時間切れにする', { options: { testCommand: 'npm test', timeoutSeconds: 5 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mockSpawn(on, clock, { child: { chunks: ['slow\n'], wait: 600_000 }, calls: [] })
  const filled: string[] = []
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    // hook が書いた refusal はエンジンが落とすので、理由の分からない拒否として出る
    return { isFilled: false }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'run' })
  await clock.advance(4000)
  expect(await ui.find({ type: 'Button', key: 'stop' })).toBeDefined()
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /^時間切れ \/ 所要 5\.0 秒/ })).toBeDefined()
  await ui.press({ key: 'fix' })
  expect(filled[0]).toContain('時間の上限を過ぎて止まりました')
  expect(await ui.find({ type: 'Text', text: '入力欄に入れられませんでした(断られました)' })).toBeDefined()
})

const presentation = { isFullscreen: false, columns: 80 }

test('/testrun を登録できればそれでペインを開く', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(`${e.id}:${e.title}`)
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['testrun'])
  const r = await $.command.run({ command: 'testrun', args: '', origin: { kind: 'composer' }, presentation })
  expect(r).toMatchObject({ text: 'テストのペインを開きました。' })
  expect(opened).toEqual(['test-runner:テスト'])
})

test('/testrun が拒まれたら /test-runner で開き、/testrun は横取りしない', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    if (e.name === 'testrun') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.run', { command: 'testrun' }, () => ({ text: '組み込みの testrun' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['test-runner'])
  const own = await $.command.run({ command: 'test-runner', args: '', origin: { kind: 'composer' }, presentation })
  expect(own).toMatchObject({ text: 'テストのペインを開きました。' })
  const builtin = await $.command.run({ command: 'testrun', args: '', origin: { kind: 'composer' }, presentation })
  expect(builtin).toMatchObject({ text: '組み込みの testrun' })
  expect(opened).toEqual(['test-runner'])
})

// ── v0.1.1 で直した物
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

test('数の拾い方は長い数字の並びでも遅くならない', () => {
  const t0 = Date.now()
  expect(countResults(`${'1'.repeat(60_000)} x\n`)).toEqual({})
  expect(countResults(`${'9'.repeat(60_000)}\n`)).toEqual({})
  expect(Date.now() - t0).toBeLessThan(1000)
  // 数字の途中から拾わない
  expect(countResults('Tests: 12 passed, 12 total\n')).toEqual({ passed: 12, failed: 0 })
})

test('「この失敗を直して」の文: 末尾を文字数でも切り、``` があれば囲いを長くする', () => {
  const r = { status: 'fail' as const, command: 'npm test', exitCode: 1, ms: 1, finishedAt: NOW }
  const long = fixPrompt({ ...r, tail: `HEAD${'x'.repeat(10_000)}END` })
  expect(long).not.toContain('HEAD')
  expect(long).toContain('END')
  expect(long.length).toBeLessThan(4300)
  const fenced = fixPrompt({ ...r, tail: 'expected:\n```\ncode\n```\n' })
  expect(fenced).toContain('````\nexpected:\n```\ncode\n```\n\n````')
})

test('出力の末尾から制御文字を落とす (Code に渡すので)', () => {
  expect(tailOf('a\u0007b\bc\u000cd\te')).toBe('abcd\te')
})

test('表示するコマンドは argv を空白 1 つでつないだ物', { options: { testCommand: `npm${' '.repeat(80)}test\t--runInBand`, timeoutSeconds: 300 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = { child: { chunks: [JEST_PASS] }, calls: [] }
  mockSpawn(on, clock, world)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgOf(vs)).toContain('npm test --runInBand')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: 'npm test --runInBand' })).toBeDefined()
  await term.press({ key: 'run' })
  expect(world.calls[0]?.argv).toEqual(['npm', 'test', '--runInBand'])
  expect(await term.find({ type: 'Text', text: 'npm test --runInBand' })).toBeDefined()
})

test('時間の上限は 3600 秒まで', { options: { testCommand: 'npm test', timeoutSeconds: 999_999 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mockSpawn(on, clock, { child: { chunks: ['slow\n'], wait: 10_000_000 }, calls: [] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'run' })
  await clock.advance(3_599_000)
  expect(await ui.find({ type: 'Button', key: 'stop' })).toBeDefined()
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /^時間切れ \/ 所要 60 分 0 秒/ })).toBeDefined()
})

test('「この失敗を直して」は入力欄の下書きを消さずに入れる (insert)', SET, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mockSpawn(on, clock, { child: { chunks: ['bell\u0007 Tests: 1 failed\n'], code: 1 }, calls: [] })
  const modes: string[] = []
  on('prompt.fill', (_$, e) => {
    modes.push(e.mode)
    return { isFilled: true }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'run' })
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).not.toMatch(CTRL)
  await ui.press({ key: 'fix' })
  expect(modes).toEqual(['insert'])
})
