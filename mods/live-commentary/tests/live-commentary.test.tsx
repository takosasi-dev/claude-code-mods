import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CLEAR_MS, LONG_MS } from '../hooks/register'
import { PHRASES, SCENES, STYLES, duration, fileOf, fill, pickIndex, sceneOf, toStyle } from '../hooks/phrases'
import { boardSvg, stadiumSvg, tickerSvg } from '../hooks/svg'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'live-commentary',
  component: 'Pane',
  requestId: 'live-commentary',
  props: {
    title: '実況席',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** 言い回しの型 ({tool} などの差し込み) が文に合うか */
const matcher = (template: string) =>
  new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, '.+')}$`)
const isFrom = (style: (typeof STYLES)[number], scene: (typeof SCENES)[number], text: string | undefined) =>
  text !== undefined && PHRASES[style][scene].some(p => matcher(p).test(text))

type World = { fail: boolean; isPaneUp: boolean }

/** 下の hook は全部ここで足す (test が $ を呼んだ後は足せない) */
const boot = async ($: Engine, on: On, init: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>(Object.entries(init))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const status: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', (_$, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const world: World = { fail: false, isPaneUp: true }
  on('ui.panes', () => ({ value: world.isPaneUp ? [{ id: 'live-commentary', title: '実況席', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => (world.fail ? { isError: true as const, result: 'boom', text: 'boom' } : { result: 'ok' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const last = () => status.at(-1)
  return { clock, store, status, toasts, world, last }
}

const start = ($: Engine, agentId?: string) => $.turn.start({ text: 'hi', turnId: 't1', ...(agentId ? { agentId } : {}) })
const complete = ($: Engine, durationMs: number, isAborted = false) =>
  $.turn.complete({ answer: '', durationMs, isAborted, turnId: 't1', reason: isAborted ? 'aborted' : 'answer' })
const bash = ($: Engine) => $.tool.call({ tool: 'Bash', command: 'ls' })

type Ui = { find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }
const svgs = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))

test('言い回しは口調 × 場面ごとに 5 個以上・重なり無し・絵文字無し', () => {
  for (const style of STYLES)
    for (const scene of SCENES) {
      const list = PHRASES[style][scene]
      expect(list.length).toBeGreaterThanOrEqual(5)
      expect(new Set(list).size).toBe(list.length)
      for (const p of list) {
        expect(p).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u)
        expect(p.replace(/\{(tool|file|n|time)\}/g, '')).not.toMatch(/[{}]/)
      }
    }
  // 口調ごとに言い回しが違う
  expect(PHRASES.熱血.start[0]).not.toBe(PHRASES.関西.start[0])
  expect(toStyle('関西')).toBe('関西')
  expect(toStyle('なにか')).toBe('熱血')
})

test('同じ言い回しは続けて出さない', () => {
  let seed = 1
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  let last = -1
  for (let i = 0; i < 500; i++) {
    const next = pickIndex(5, last, rng)
    expect(next).not.toBe(last)
    expect(next >= 0 && next < 5).toBe(true)
    last = next
  }
  // 最後の値と同じ目が出ても別の物にずらす
  expect(pickIndex(5, 2, () => 0.5)).not.toBe(2)
  expect(pickIndex(5, 4, () => 0.99999)).not.toBe(4)
  expect(pickIndex(1, 0, () => 0)).toBe(0)
})

test('場面・ファイル名・時間の書き方', () => {
  expect(['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'Read', 'Grep', 'Glob', 'WebFetch', 'Agent', 'mcp__x__y'].map(sceneOf)).toEqual([
    'shell',
    'shell',
    'edit',
    'edit',
    'write',
    'read',
    'search',
    'search',
    'web',
    'agent',
    'other',
  ])
  expect(fileOf({ file_path: '/tmp/demo/src/main.ts' })).toBe('main.ts')
  expect(fileOf({ notebook_path: 'C:\\tmp\\demo\\a.ipynb' })).toBe('a.ipynb')
  expect(fileOf({ command: 'ls' })).toBe('ファイル')
  expect([42_000, 59_400, 60_000, 192_000].map(duration)).toEqual(['42 秒', '59 秒', '1 分', '3 分 12 秒'])
  expect(fill('{tool} と {x}', { tool: 'Bash' })).toBe('Bash と {x}')
})

test('絵: 照明はオンで動き、オフで止まる・テロップは流れる・数の板は試合中だけ動かない', () => {
  const on = stadiumSvg(true, '熱血')
  const off = stadiumSvg(false, '熱血')
  for (const s of [on, off]) {
    expect(s.startsWith('<svg')).toBe(true)
    expect(s).toContain('font-family="sans-serif"')
    expect(s).not.toMatch(/<svg[^>]*\swidth=/)
  }
  expect(on).toContain('<animate')
  expect(on).toContain('熱血 実況中')
  expect(off).not.toContain('<animate')
  expect(off).toContain('実況オフ')
  const board = boardSvg({ ok: 12, err: 3, streak: 4 }, { startedAt: NOW, now: NOW + 83_000, lastMs: 0 })
  expect(board).toMatch(/>12<.*>3<.*>4</)
  expect(board).toContain('試合時間 1:23')
  expect(board).not.toContain('<animate')
  // 試合の外は描き直さないので、数字が 0 から増える
  expect(boardSvg({ ok: 12, err: 3, streak: 4 }, { startedAt: 0, now: 0, lastMs: 42_000 })).toMatch(/<text [^>]*opacity="0">12<animate/)
  expect(boardSvg({ ok: 0, err: 0, streak: 0 }, { startedAt: 0, now: 0, lastMs: 42_000 })).toContain('前の試合 42 秒')
  const ticker = tickerSvg({ at: NOW, text: 'a<b & "c"', kind: 'error' }, true)
  expect(ticker).toContain('a&lt;b &amp; &quot;c&quot;')
  expect(ticker).toContain('animateTransform')
  expect(ticker).toContain('#f85149')
  expect(tickerSvg(null, false)).toContain('実況はお休み中です')
})

for (const surface of SURFACES) {
  test(`${surface}: 主な要素を描き、実況が出る`, async ($, on) => {
    const { last } = await boot($, on)
    await start($)
    await bash($)
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const key of ['toggle', 'clear', 'log']) expect(await ui.find({ key })).toBeDefined()
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('実況オフ')
    expect(isFrom('熱血', 'shell', last())).toBe(true)
    expect(await ui.find({ type: 'Text', text: last() })).toBeDefined()
    if (surface === 'vscode') {
      const [stadium, board, ticker] = await svgs(ui)
      expect(stadium).toContain('実況席')
      expect(board).toMatch(/>1<.*>0<.*>1</)
      expect(board).toContain('試合時間 0:00')
      expect(ticker).toContain('Bash')
      expect(await ui.find({ key: 'head' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '成功 1 / エラー 0 / 連続 1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '実況席 (熱血) 実況中' })).toBeDefined()
    }
  })

  test(`${surface}: 実況オフで黙り、次回もオフ。オンで戻る`, async ($, on) => {
    const { store, status, toasts, world } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await start($)
    await ui.press({ key: 'toggle' })
    expect(store.get('isOn')).toBe(false)
    expect(status.at(-1)).toBeUndefined()
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('実況オン')
    const before = status.length
    world.fail = true
    await bash($)
    world.fail = false
    for (let i = 0; i < 10; i++) await bash($)
    await complete($, LONG_MS + 1000)
    expect(status.length).toBe(before + 0)
    expect(toasts).toEqual([])
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: '成功 10 / エラー 1 / 連続 10' })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect(store.get('isOn')).toBe(true)
    await bash($)
    expect(status.length).toBe(before + 1)
  })

  test(`${surface}: ログを消す`, async ($, on) => {
    await boot($, on)
    await start($)
    await bash($)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '実況ログ 2 行 (新しい順)' })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: '実況ログ 0 行 (新しい順)' })).toBeDefined()
    if (surface === 'vscode') expect((await svgs(ui))[2]).toContain('まもなく試合開始です')
  })
}

test('ツールの種類ごとの実況・エラー・立て直し・連続成功・試合終了・消える', async ($, on) => {
  const { last, status, toasts, world, clock } = await boot($, on)
  await start($)
  expect(isFrom('熱血', 'start', last())).toBe(true)
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/demo/src/main.ts', old_string: 'a', new_string: 'b' })
  expect(isFrom('熱血', 'edit', last())).toBe(true)
  expect(last()).toContain('main.ts')
  await $.tool.call({ tool: 'Read', file_path: '/tmp/demo/README.md' })
  expect(isFrom('熱血', 'read', last())).toBe(true)

  world.fail = true
  await bash($)
  expect(isFrom('熱血', 'error', last())).toBe(true)
  world.fail = false
  await bash($)
  expect(isFrom('熱血', 'comeback', last())).toBe(true)
  expect(toasts).toHaveLength(1)

  for (let i = 0; i < 3; i++) await bash($)
  // 4 連続 → 5 連続はステータス行だけ
  await bash($)
  expect(isFrom('熱血', 'streak', last())).toBe(true)
  expect(last()).toContain('5')
  expect(toasts).toHaveLength(1)
  for (let i = 0; i < 5; i++) await bash($)
  expect(isFrom('熱血', 'ten', last())).toBe(true)
  expect(last()).toContain('10')
  expect(toasts).toHaveLength(2)

  await complete($, 42_000)
  expect(isFrom('熱血', 'end', last())).toBe(true)
  expect(last()).toContain('42 秒')
  expect(toasts).toHaveLength(2)
  const shown = status.length
  await clock.advance(CLEAR_MS - 1000)
  expect(status.length).toBe(shown)
  await clock.advance(2000)
  expect(status.at(-1)).toBeUndefined()
})

test('エラーの行はログで赤い', async ($, on) => {
  const { world } = await boot($, on)
  world.fail = true
  await bash($)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const texts = (await (ui as unknown as { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }).findAll({ type: 'Text' })).filter(
    t => isFrom('熱血', 'error', t.text),
  )
  expect(texts).toHaveLength(1)
  expect(texts[0]?.props.color).toBe('error')
})

test('5 分を超えたターンの決着はトーストで、中断は静かに', async ($, on) => {
  const { last, toasts } = await boot($, on)
  await start($)
  await complete($, LONG_MS + 12_000)
  expect(isFrom('熱血', 'long', last())).toBe(true)
  expect(last()).toContain('5 分 12 秒')
  expect(toasts).toEqual([last()])
  await start($)
  await complete($, 3_000, true)
  expect(isFrom('熱血', 'abort', last())).toBe(true)
  expect(toasts).toHaveLength(1)
})

test('サブエージェントのターンとツールは実況しない', async ($, on) => {
  const { status } = await boot($, on)
  await start($, 'sub1')
  // $.tool.call の型は agentId を持たないが、テストでは loop の印として届く (リテラルでないので型は通る)
  const sub = { tool: 'Bash' as const, command: 'ls', agentId: 'sub1' }
  await $.tool.call(sub)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1', agentId: 'sub1', reason: 'answer' })
  expect(status).toEqual([])
})

test('ターン中は時計が 1 秒ごとに進む (ペインが閉じていれば書かない)', async ($, on) => {
  const { clock, world } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await start($)
  await clock.advance(3000)
  expect((await svgs(ui))[1]).toContain('試合時間 0:03')
  world.isPaneUp = false
  await clock.advance(5000)
  expect((await svgs(ui))[1]).toContain('試合時間 0:03')
  await complete($, 8000)
  expect((await svgs(ui))[1]).toContain('前の試合 8 秒')
})

test('口調は userConfig の style で変わる (関西)', { options: { style: '関西' } }, async ($, on) => {
  const { last } = await boot($, on)
  await start($)
  expect(isFrom('関西', 'start', last())).toBe(true)
  await bash($)
  expect(isFrom('関西', 'shell', last())).toBe(true)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '実況席 (関西) 実況中' })).toBeDefined()
})

test('口調 冷静', { options: { style: '冷静' } }, async ($, on) => {
  const { last } = await boot($, on)
  await start($)
  expect(isFrom('冷静', 'start', last())).toBe(true)
})

test('前回オフにしていれば、オフで始まる', async ($, on) => {
  const { status } = await boot($, on, { isOn: false })
  await start($)
  await bash($)
  expect(status).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('実況オン')
})

test('/jikkyo で開き、拒まれたら /live-commentary にする', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'jikkyo' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  let opened = ''
  on('ui.open', (_$, e) => {
    opened = e.id
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['jikkyo'])
  isTaken = true
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['jikkyo', 'jikkyo', 'live-commentary'])
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  const r = await $.command.run({ command: 'live-commentary', ...run })
  expect(r.text).toBe('実況席を開きました。')
  expect(opened).toBe('live-commentary')
})

test('/jikkyo が取れなかった時は、元の /jikkyo を横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('store.get', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (e.name === 'jikkyo' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.run', { command: 'jikkyo' }, () => ({ text: '組み込みの jikkyo' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'jikkyo', ...run })).toMatchObject({ text: '組み込みの jikkyo' })
  expect(opened).toEqual([])
})

test('前のターンのエラーは持ち越さない (次のターンの最初の成功は「反撃」にしない)', async ($, on) => {
  const { last, world } = await boot($, on)
  await start($)
  world.fail = true
  await bash($)
  world.fail = false
  await complete($, 1000)
  await start($)
  await bash($)
  expect(isFrom('熱血', 'comeback', last())).toBe(false)
  expect(isFrom('熱血', 'shell', last())).toBe(true)
})

test('エラーや拒否で終わったターンは「試合終了」と言わない', async ($, on) => {
  const { last } = await boot($, on)
  for (const reason of ['error', 'refusal'] as const) {
    await start($)
    await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason, ...(reason === 'refusal' ? { refusal: {} } : {}) } as never)
    expect(isFrom('熱血', 'end', last())).toBe(false)
    expect(isFrom('熱血', 'fail', last())).toBe(true)
  }
})

test('ファイル名の制御文字は実況に入れない', async ($, on) => {
  const { last } = await boot($, on)
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/demo/a\u0007b\u001b[31m.ts', old_string: 'a', new_string: 'b' })
  expect(last()).toContain('ab[31m.ts')
  expect(last()).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await svgs(ui))[2]).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/)
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const [stadium, board, ticker] = await svgs(ui)
  expect(board).toMatch(/fill="#ffffff"/)
  expect(ticker).toMatch(/fill="#ffffff"/)
  // 夜のスタジアムは情景なので、明るいテーマでも題は明るい字のまま
  expect(stadium).toMatch(/fill="#c9d1d9" text-anchor="middle">実況席</)

  theme = 'dark'
  await $.config.set({
    key: 'theme',
    value: 'dark',
    previous: 'light',
    provider: { plugin: 'core', tier: 'core' } as never,
    origin: { kind: 'composer' },
  })
  expect((await svgs(ui))[1]).toMatch(/fill="#0d1117"/)
})
