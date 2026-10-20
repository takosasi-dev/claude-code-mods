import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { baseName, canStop, mergeRows, parseLsof, parseNetstat, parseTasklist, stopArgv, tilesSvg } from '../hooks/ports'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const WIN_CWD = 'D:\\demo'
const NIX_CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'port-watch',
  component: 'Pane',
  requestId: 'port-watch',
  props: {
    title: 'ポート',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

// 日本語の Windows の netstat -ano に近い形 (見出しは化けている)
const netstat = (rows: string[]) =>
  [
    '',
    '\ufffdA\ufffdN\ufffde\ufffdB\ufffdu\ufffd\u0228\u06b1',
    '',
    '  \ufffdv\ufffd\ufffd\ufffdg\ufffdR\ufffd\ufffd  \ufffd\ufffd\ufffd[\ufffdJ\ufffd\ufffd \ufffdA\ufffdh\ufffd\ufffd\ufffdX      PID',
    ...rows,
    '  UDP    0.0.0.0:5353           *:*                                    3000',
    '',
  ].join('\r\n')
const NS_BASE = netstat([
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1792',
  '  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4',
  '  TCP    127.0.0.1:5354         127.0.0.1:0            LISTENING       4864',
  '  TCP    127.0.0.1:5354         127.0.0.1:49670        ESTABLISHED     4864',
  '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       5100',
  '  TCP    [::]:3000              [::]:0                 LISTENING       5100',
  '  TCP    [::]:445               [::]:0                 LISTENING       4',
])
const NS_MORE = netstat([
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1792',
  '  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4',
  '  TCP    127.0.0.1:5354         127.0.0.1:0            LISTENING       4864',
  '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       5100',
  '  TCP    [::1]:5173             [::]:0                 LISTENING       7200',
  '  TCP    127.0.0.1:80           0.0.0.0:0              LISTENING       7300',
])
const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"System","4","Services","0","25,524 K"',
  '"svchost.exe","1792","Services","0","12,000 K"',
  '"mDNSResponder.exe","4864","Services","0","3,100 K"',
  '"node.exe","5100","Console","1","45,000 K"',
  '"node.exe","7200","Console","1","61,000 K"',
  '"python.exe","7300","Console","1","20,000 K"',
  '',
].join('\r\n')
const LSOF = [
  'COMMAND     PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
  'node      41234 me     23u  IPv6 0x1a2b3c4d5e6f7a8b      0t0  TCP *:3000 (LISTEN)',
  'node      41234 me     24u  IPv4 0x1a2b3c4d5e6f7a8c      0t0  TCP 127.0.0.1:3000 (LISTEN)',
  'Python    41500 me      5u  IPv4 0x1a2b3c4d5e6f7a8d      0t0  TCP 127.0.0.1:8000 (LISTEN)',
  'rapportd    512 me      9u  IPv6 0x1a2b3c4d5e6f7a8e      0t0  TCP [::1]:49152 (LISTEN)',
  '',
].join('\n')

type World = {
  netstat: string
  tasklist?: string
  lsof?: string
  /** 一覧のコマンドが無い */
  isMissing?: boolean
  /** 一覧を読むたびに netstat を差し替える (止める前の読み直しで変える) */
  next?: string[]
  calls: string[][]
}

const mockHost = (on: On, world: World, cwd: string) => {
  on('session.cwd', () => ({ value: cwd }))
  on('process.run', (_$, e) => {
    world.calls.push([...e.argv])
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (world.isMissing) return { deny: `spawn ${e.argv[0]} ENOENT` }
    const cmd = e.argv[0]
    if (cmd === 'netstat') {
      const shift = world.next?.shift()
      if (shift !== undefined) world.netstat = shift
      return out(world.netstat)
    }
    if (cmd === 'tasklist') return out(world.tasklist ?? TASKLIST)
    if (cmd === 'lsof') return world.lsof === '' ? out('', 1) : out(world.lsof ?? LSOF)
    // 止めるコマンドは記録だけ。本物は走らせない
    if (cmd === 'taskkill' || cmd === 'kill') return out('SUCCESS\r\n')
    return out('', 1, `unexpected: ${e.argv.join(' ')}`)
  })
}
const kills = (w: World) => w.calls.filter(a => a[0] === 'taskkill' || a[0] === 'kill')

const presentation = { isFullscreen: false, columns: 80 }

/** セッションを始めて /ports で開くまで。返すのは開いたペインの描画 */
async function start($: Parameters<TestBody>[0], on: On, surface: (typeof SURFACES)[number], world: World, cwd = WIN_CWD) {
  const clock = mock.clock(on, { now: NOW })
  mockHost(on, world, cwd)
  let isUp = false
  on('ui.open', () => {
    isUp = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: isUp ? [{ id: 'port-watch', title: 'ポート', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd, surface: 'vscode', isInteractive: true })
  await clock.advance(1000)
  await $.command.run({ command: 'ports', args: '', origin: { kind: 'composer' }, presentation })
  const ui = await $.ui.mount({ ...PANE, surface })
  return { clock, ui }
}

test('純関数: netstat・tasklist・lsof の読み方', () => {
  expect(parseNetstat(NS_BASE)).toEqual([
    { port: 135, pid: 1792 },
    { port: 445, pid: 4 },
    { port: 5354, pid: 4864 },
    { port: 3000, pid: 5100 },
    { port: 3000, pid: 5100 },
    { port: 445, pid: 4 },
  ])
  const names = parseTasklist(TASKLIST)
  expect(names.get(5100)).toBe('node.exe')
  expect(names.get(4)).toBe('System')
  expect(names.size).toBe(6)
  const lsof = mergeRows(parseLsof(LSOF))
  expect(lsof).toEqual([
    { port: 3000, pid: 41234, name: 'node' },
    { port: 8000, pid: 41500, name: 'Python' },
    { port: 49152, pid: 512, name: 'rapportd' },
  ])
  expect(parseLsof('')).toEqual([])
  // PID・ポートが数字でない行は読まない
  expect(parseNetstat('  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   12a\n  TCP    0.0.0.0:99999   0.0.0.0:0   LISTENING   5\n')).toEqual([])
  // 名前の制御文字は落とす
  expect(mergeRows([{ port: 1, pid: 2, name: 'no\u0007de\u001b.exe' }])[0]?.name).toBe('node.exe')
})

test('純関数: 止められる/止められない の判定と止めるコマンド', () => {
  expect(baseName('Python3.11')).toBe('python')
  expect(baseName('node.exe')).toBe('node')
  expect(canStop({ port: 3000, pid: 1, name: 'node.exe' })).toBe(true)
  expect(canStop({ port: 8000, pid: 1, name: 'python3' })).toBe(true)
  expect(canStop({ port: 5000, pid: 1, name: 'uvicorn' })).toBe(true)
  // 低いポート・開発用でない名前・名前の分からない物には付けない
  expect(canStop({ port: 80, pid: 1, name: 'node.exe' })).toBe(false)
  expect(canStop({ port: 3000, pid: 1, name: 'svchost.exe' })).toBe(false)
  expect(canStop({ port: 3000, pid: 1, name: 'nodemonster.exe' })).toBe(false)
  expect(canStop({ port: 3000, pid: 1, name: '?' })).toBe(false)
  expect(stopArgv(true, 5100)).toEqual(['taskkill', '/PID', '5100', '/T', '/F'])
  expect(stopArgv(false, 41234)).toEqual(['kill', '41234'])
  expect(stopArgv(true, 0)).toBeUndefined()
  expect(stopArgv(true, -3)).toBeUndefined()
  expect(stopArgv(true, 1.5)).toBeUndefined()
  expect(stopArgv(true, NaN)).toBeUndefined()
  const svg = tilesSvg({ all: 3, added: 1, dev: 2 }, false)
  expect(svg).toContain('>今回増えた<')
  expect(svg).toContain('repeatCount="indefinite"')
  expect(svg).not.toMatch(/<svg[^>]* width=/)
})

for (const surface of SURFACES) {
  test(`${surface}: Windows の一覧・増えた印・開発用だけ/全部`, async ($, on) => {
    const world: World = { netstat: NS_BASE, calls: [] }
    const { clock, ui } = await start($, on, surface, world)
    expect(world.calls.some(a => a.join(' ') === 'netstat -ano')).toBe(true)
    expect(world.calls.some(a => a.join(' ') === 'tasklist /FO CSV /NH')).toBe(true)
    // 始めは増えた物が無い。開発用だけを出す
    expect(await ui.find({ type: 'Text', text: /^○ 3000  node\.exe$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^○ 135 / })).toBeUndefined()
    if (surface === 'vscode') {
      const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(svg).toContain('>待ち受け<')
    } else expect(await ui.find({ type: 'Text', text: '待ち受け 4 / 増えた 0 / 開発用 1' })).toBeDefined()

    // 5 秒後に 5173 と 80 が増える
    world.netstat = NS_MORE
    await clock.advance(5000)
    const added = await ui.find({ type: 'Text', text: /^● 5173  node\.exe$/ })
    expect(added?.props.color).toBe('yellow')
    expect(await ui.find({ type: 'Text', text: '  PID 7200  このセッションで増えた' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'stop-5173-7200' })).toBeDefined()
    // 80 は増えたので出るが、1024 未満なので止めるボタンは無い
    expect(await ui.find({ type: 'Text', text: /^● 80  python\.exe$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'stop-80-7300' })).toBeUndefined()
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: '待ち受け 6 / 増えた 2 / 開発用 2' })).toBeDefined()

    await ui.press({ key: 'narrow' })
    expect(await ui.find({ type: 'Text', text: /^○ 135  svchost\.exe$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'stop-135-1792' })).toBeUndefined()
  })

  test(`${surface}: 一覧のコマンドが無くても画面は壊れない`, async ($, on) => {
    const world: World = { netstat: NS_BASE, isMissing: true, calls: [] }
    const { ui } = await start($, on, surface, world)
    expect((await ui.find({ type: 'Text', text: /^一覧のコマンドを実行できません: / }))?.props.color).toBe('red')
    expect(await ui.find({ type: 'Button', key: 'reload' })).toBeDefined()
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('一覧を読めません')
    // 直れば読める
    world.isMissing = false
    await ui.press({ key: 'reload' })
    expect(await ui.find({ type: 'Text', text: /^○ 3000  node\.exe$/ })).toBeDefined()
  })
}

test('URL を写す', async ($, on) => {
  const world: World = { netstat: NS_BASE, calls: [] }
  const copied: string[] = []
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const { ui } = await start($, on, 'vscode', world)
  await ui.press({ key: 'copy-3000-5100' })
  expect(copied).toEqual(['http://localhost:3000'])
  expect(await ui.find({ type: 'Text', text: 'http://localhost:3000 を写しました' })).toBeDefined()
})

test('止めるのは 2 回押し。1 回目は止めない', async ($, on) => {
  const world: World = { netstat: NS_BASE, calls: [] }
  const { ui } = await start($, on, 'terminal', world)
  await ui.press({ key: 'stop-3000-5100' })
  expect(kills(world)).toHaveLength(0)
  expect((await ui.find({ type: 'Button', key: 'stop-3000-5100' }))?.props.label).toBe('もう一度押すと止めます')
  await ui.press({ key: 'stop-3000-5100' })
  expect(kills(world)).toEqual([['taskkill', '/PID', '5100', '/T', '/F']])
  expect(await ui.find({ type: 'Text', text: 'node.exe (PID 5100) を止めました' })).toBeDefined()
})

test('1 回目から時間が経っていたら、もう一度構え直す', async ($, on) => {
  const world: World = { netstat: NS_BASE, calls: [] }
  const { clock, ui } = await start($, on, 'terminal', world)
  await ui.press({ key: 'stop-3000-5100' })
  await clock.advance(11_000)
  await ui.press({ key: 'stop-3000-5100' })
  expect(kills(world)).toHaveLength(0)
  expect((await ui.find({ type: 'Button', key: 'stop-3000-5100' }))?.props.label).toBe('もう一度押すと止めます')
})

test('止める直前の読み直しで PID が変わっていたら止めない', async ($, on) => {
  const world: World = { netstat: NS_BASE, calls: [] }
  const { ui } = await start($, on, 'terminal', world)
  await ui.press({ key: 'stop-3000-5100' })
  // 2 回目の直前の読み直しでは、3000 は別の PID が持っている
  world.next = [NS_BASE.replace(/5100/g, '5999')]
  await ui.press({ key: 'stop-3000-5100' })
  expect(kills(world)).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: 'ポート 3000 の持ち主が変わったので止めませんでした' })).toBeDefined()
  // 一覧は読み直した物に変わる (新しい PID は名前が分からないので止めるボタンも無い)
  expect(await ui.find({ type: 'Text', text: '  PID 5999  このセッションで増えた' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'stop-3000-5999' })).toBeUndefined()
})

test('Windows でない時は lsof で読み、kill で止める', async ($, on) => {
  const world: World = { netstat: '', calls: [] }
  const { ui } = await start($, on, 'terminal', world, NIX_CWD)
  expect(world.calls.some(a => a.join(' ') === 'lsof -nP -iTCP -sTCP:LISTEN')).toBe(true)
  expect(world.calls.some(a => a[0] === 'netstat')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /^○ 8000  Python$/ })).toBeDefined()
  await ui.press({ key: 'stop-8000-41500' })
  await ui.press({ key: 'stop-8000-41500' })
  expect(kills(world)).toEqual([['kill', '41500']])
})

test('lsof が何も書かずに 1 で終わったら「ありません」', async ($, on) => {
  const world: World = { netstat: '', lsof: '', calls: [] }
  const { ui } = await start($, on, 'terminal', world, NIX_CWD)
  await ui.press({ key: 'narrow' })
  expect(await ui.find({ type: 'Text', text: '待ち受けているポートはありません' })).toBeDefined()
})

test('名前の制御文字は描く前に落とす', async ($, on) => {
  const world: World = { netstat: NS_BASE, tasklist: TASKLIST.replace('"node.exe","5100"', '"no\u0007de\u001b.exe","5100"'), calls: [] }
  const { ui } = await start($, on, 'terminal', world)
  const row = await ui.find({ type: 'Text', text: /^○ 3000 / })
  expect(String(row?.text)).toBe('○ 3000  node.exe')
  expect(String(row?.text)).not.toMatch(CTRL)
})

test('/ports が拒まれたら /port-watch で開き、/ports は横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  mockHost(on, { netstat: NS_BASE, calls: [] }, WIN_CWD)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    if (e.name === 'ports') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('command.run', { command: 'ports' }, () => ({ text: '別の ports' }))
  await $.session.start({ cwd: WIN_CWD, surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['port-watch'])
  expect(await $.command.run({ command: 'port-watch', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: 'ポートのペインを開きました。' })
  expect(await $.command.run({ command: 'ports', args: '', origin: { kind: 'composer' }, presentation })).toMatchObject({ text: '別の ports' })
  expect(opened).toEqual(['port-watch'])
})
