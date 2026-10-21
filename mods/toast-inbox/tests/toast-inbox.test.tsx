import type { On, Register } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { InboxItem } from '../types'
import { asItems, commandsByMod, countByMod, inboxSvg, KEEP, merge, modLabel, toItem, unreadCount, when } from '../hooks/inbox'
import { setTheme } from '../hooks/style'

// 2026-10-21 12:00 (日本時間 21:00)
const NOW = Date.parse('2026-10-21T12:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'toast-inbox',
  component: 'Pane',
  requestId: 'toast-inbox',
  props: {
    title: '通知の受け箱',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

// トーストを出す試しの mod。テストの道具は inline の mod を文字にして読み込むので、外の変数は使えない
// 自分(toast-inbox)より後ろ(同じ user 階層)。turnId が burst なら同じ文を 500 回
const after: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.turnId === 'burst') for (let k = 0; k < 500; k++) void $.ui.toast('同じ文')
    else if (e.turnId.startsWith('t')) void $.ui.toast(`後ろの mod ${e.answer}`)
    return next(e)
  })
}
// 自分より上(prepend 階層)
const before: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.turnId.startsWith('t')) void $.ui.toast(`前の mod ${e.answer}`, { timeoutMs: 3000 })
    return next(e)
  })
}
// ステータス行を出す。answer が空なら消す
const status: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.turnId.startsWith('s')) void $.ui.status(e.answer === '' ? undefined : e.answer)
    return next(e)
  })
}
const PLUGINS = {
  plugins: [
    { name: 'demo-after', register: after },
    { name: 'demo-before', tier: 'prepend' as const, register: before },
    { name: 'demo-status', register: status },
  ],
}

type Cmd = { name: string; description: string; source: 'builtin' | 'plugin' | 'user' | 'mcp'; plugin?: string }
/** commands: $.command.list() の答え。ran: 押して走ったコマンドを積む */
type Boot = { taken?: boolean; theme?: () => string; store?: Record<string, unknown>; commands?: () => Cmd[]; ran?: string[] }

/** 下の hook を全部置いてセッションを始める (test が $ を呼んだ後は足せない) */
const boot = async ($: Engine, on: On, opts: Boot = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  let writes = 0
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    if (e.key === 'items') writes++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => (opts.taken && e.name === 'inbox' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  on('command.run', { command: 'inbox' }, () => ({ text: '別の /inbox' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const commands = opts.commands
  if (commands) {
    on('command.list', () => ({ value: commands() }))
    for (const c of commands()) {
      if (c.name === 'inbox') continue
      on('command.run', { command: c.name }, (_$, e) => {
        opts.ran?.push(e.command)
        return { text: `${e.command} を開いた` }
      })
    }
  }
  const theme = opts.theme
  if (theme) {
    on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme(), provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
    on('config.set', (_$, e) => ({ value: e.value }))
  }
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return { clock, items: () => asItems(m.get('items')) ?? [], raw: m, writes: () => writes }
}

const turn = ($: Engine, turnId: string, answer = '') => $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId, reason: 'answer' })

const item = (plugin: string, text: string, at: number, kind: InboxItem['kind'] = 'toast'): InboxItem => ({ plugin, text, at, kind })

test('記録の形・まとめ方・時刻 (純関数)', () => {
  expect(toItem('demo@market', '\x07終わり\x1b[31mました\n', 5, 'toast')).toEqual(item('demo', '終わり[31mました', 5))
  expect(toItem('toast-inbox', '自分の通知', 5, 'toast')).toBeUndefined()
  expect(toItem('toast-inbox@example-market', '自分の通知', 5, 'toast')).toBeUndefined()
  expect(toItem('demo', '  ', 5, 'status')).toBeUndefined()
  expect(toItem('demo', undefined, 5, 'status')).toBeUndefined()
  expect(modLabel('engine')).toBe('本体')

  expect(asItems('壊れた値')).toBeUndefined()
  expect(asItems([item('a', 'x', 1), { plugin: 1 }, null, item('b', 'y', 2, 'status')])).toEqual([item('a', 'x', 1), item('b', 'y', 2, 'status')])

  const many = Array.from({ length: 150 }, (_, k) => item('a', `${k}`, k))
  const merged = merge(many.slice(0, 80), many.slice(80))
  expect(merged.length).toBe(KEEP)
  expect(merged[0]?.text).toBe('50')
  expect(merged.at(-1)?.text).toBe('149')

  expect(unreadCount([item('a', 'x', 1), item('a', 'y', 5)], 3)).toBe(1)
  expect(countByMod([item('b', 'x', 1), item('a', 'x', 1), item('b', 'y', 2)])).toEqual([
    { name: 'b', count: 2 },
    { name: 'a', count: 1 },
  ])

  // 日本時間: UTC 12:00 は 21:00、UTC 前日 16:30 は 01:30 で今日
  expect(when(NOW, NOW)).toBe('21:00')
  expect(when(Date.parse('2026-10-20T16:30:00Z'), NOW)).toBe('01:30')
  expect(when(Date.parse('2026-10-20T14:59:00Z'), NOW)).toBe('10/20 23:59')

  setTheme(false)
  const svg = inboxSvg([item('demo', 'x', 10), item('demo', 'y', 20), item('engine', 'z', 30)], 15)
  expect(svg).toContain('未読 2 件 / 全 3 件')
  expect(svg).toContain('本体')
  expect(svg).toContain('<animate')
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
  expect(inboxSvg([], 0)).toContain('まだ通知はありません')
})

test('自分より後ろの mod と上の mod のトーストを両方拾い、1 秒後にまとめて書く', PLUGINS, async ($, on) => {
  const s = await boot($, on)
  await turn($, 't1', 'A')
  await s.clock.settle()
  expect(s.writes()).toBe(0) // まだ溜めているだけ
  await s.clock.advance(1000)
  const got = s.items().map(i => `${i.plugin}:${i.text}`)
  expect(got.sort()).toEqual(['demo-after:後ろの mod A', 'demo-before:前の mod A'])
  expect(s.writes()).toBe(1)
  expect(s.items().every(i => i.at === NOW && i.kind === 'toast')).toBe(true)
})

test('1 ターンで同じ文が 500 件来ても、書き込みは 1 回で最新 100 件だけ残す', PLUGINS, async ($, on) => {
  const s = await boot($, on)
  await turn($, 'burst')
  await s.clock.advance(1000)
  expect(s.writes()).toBe(1)
  expect(s.items().length).toBe(KEEP)
  expect(s.items().every(i => i.text === '同じ文')).toBe(true)
})

test('ステータス行は同じ文の連続を 1 件にし、消した時は記録しない', PLUGINS, async ($, on) => {
  const s = await boot($, on)
  for (const [id, answer] of [
    ['s1', '読んでいます'],
    ['s2', '読んでいます'],
    ['s3', ''],
    ['s4', '読んでいます'],
    ['s5', '書いています'],
  ] as const) {
    await turn($, id, answer)
    await s.clock.settle()
  }
  await s.clock.advance(1000)
  expect(s.items().map(i => `${i.kind}:${i.text}`)).toEqual(['status:読んでいます', 'status:読んでいます', 'status:書いています'])
})

test('書く直前に読み直し、別のセッションが足した分を消さない', PLUGINS, async ($, on) => {
  const other = item('demo-x', '別のセッションの通知', NOW - 60_000)
  const s = await boot($, on, { store: { items: [item('old', '前からある通知', NOW - 120_000)] } })
  await turn($, 't1', 'B')
  await s.clock.settle()
  // 溜めている間に、別のセッションが 1 件足した
  s.raw.set('items', [...s.items(), other])
  await s.clock.advance(1000)
  expect(s.items().map(i => i.text).slice(0, 2)).toEqual(['前からある通知', '別のセッションの通知'])
  expect(s.items().length).toBe(4)
})

test('セッションを閉じる時に溜めた分を書く', PLUGINS, async ($, on) => {
  const s = await boot($, on)
  await turn($, 't1', 'C')
  await s.clock.settle()
  await $.session.end({ sessionId: 'x', reason: 'other' } as never)
  expect(s.items().length).toBe(2)
})

for (const surface of SURFACES) {
  test(`${surface}: 未読の数・新しい順の一覧・絞り込み・既読・2 回押しで空にする`, PLUGINS, async ($, on) => {
    const s = await boot($, on, { store: { items: [item('old', '\x07前の通知', NOW - 86_400_000)], readAt: NOW - 1 } })
    await turn($, 't1', 'D')
    await s.clock.advance(1000)
    expect((await $.command.run({ command: 'inbox', ...RUN })).text).toBe('通知の受け箱を開きました。')

    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.alt)).toBe('通知の受け箱 未読 2 件 / 全 3 件')
      expect(String(svg?.props.source)).toContain('demo-after')
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '通知の受け箱 未読 2 件 / 全 3 件' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'old 1 件' })).toBeDefined()
    }
    // 新しい順。前の日の物は日付付き
    const heads = (await ui.findAll({ type: 'Text' })).map(x => x.text).filter(x => /\d{2}:\d{2} /.test(x))
    expect(heads.length).toBe(3)
    expect(heads.at(-1)).toBe('10/20 21:00 old')
    expect(heads.slice(0, 2).every(h => h.startsWith('未読 21:00 '))).toBe(true)
    expect(await ui.find({ type: 'Text', text: '前の通知' })).toBeDefined()

    await ui.select({ key: 'filter', value: 'demo-before' })
    expect((await ui.findAll({ type: 'Text' })).filter(x => /\d{2}:\d{2} /.test(x.text)).map(x => x.text)).toEqual(['未読 21:00 demo-before'])
    await ui.select({ key: 'filter', value: '*' })

    await ui.press({ key: 'mark-read' })
    expect(s.raw.get('readAt')).toBe(NOW + 1000)
    expect((await ui.findAll({ type: 'Text' })).some(x => x.text.startsWith('未読 '))).toBe(false)

    await ui.press({ key: 'clear' })
    expect(s.items().length).toBe(3) // 1 回目は確かめるだけ
    expect((await ui.find({ key: 'clear' }))?.props.label).toBe('もう一度押すと空にします')
    await ui.press({ key: 'clear' })
    expect(s.items().length).toBe(0)
    expect(await ui.find({ type: 'Text', text: /まだ通知はありません/ })).toBeDefined()
    await ui.unmount()
  })
}

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', PLUGINS, async ($, on) => {
  let theme = 'light'
  await boot($, on, { theme: () => theme })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/fill="#ffffff"/)
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await source()).toMatch(/fill="#0d1117"/)
})

test('/inbox を持てなかった時は /toast-inbox にして、/inbox を横取りしない', async ($, on) => {
  await boot($, on, { taken: true })
  expect((await $.command.run({ command: 'inbox', ...RUN })).text).toBe('別の /inbox')
  expect((await $.command.run({ command: 'toast-inbox', ...RUN })).text).toBe('通知の受け箱を開きました。')
})

/** label で Button を探す (ElementQuery に label は無い) */
const button = async (ui: { findAll: (q: { type: string }) => Promise<{ key?: string; props: Record<string, unknown> }[]> }, label: string) =>
  (await ui.findAll({ type: 'Button' })).find(b => b.props.label === label)

const cmd = (name: string, plugin?: string, source: Cmd['source'] = 'plugin'): Cmd => ({ name, description: '', source, plugin })

test('mod ごとに開くコマンドを決める (純関数)', () => {
  expect(
    commandsByMod([
      cmd('help', undefined, 'builtin'),
      cmd('rpg', 'dev-rpg@market'),
      cmd('dev-rpg', 'dev-rpg@market'),
      cmd('aquarium', 'aqua-pet'),
      cmd('inbox', 'toast-inbox'),
      cmd('mine', undefined, 'user'),
      cmd('later', 'aqua-pet'),
    ]),
  ).toEqual({ 'dev-rpg': 'dev-rpg', 'aqua-pet': 'aquarium' })
  // mod と同じ名前の物は、一覧で後ろにあっても選ぶ。本体は入れない
  expect(commandsByMod([cmd('dev-rpg', 'dev-rpg'), cmd('rpg', 'dev-rpg'), cmd('x', 'engine')])).toEqual({ 'dev-rpg': 'dev-rpg' })
  expect(commandsByMod([])).toEqual({})
})

for (const surface of SURFACES) {
  test(`${surface}: 通知の行を押すと出した mod のコマンドを開き、コマンドの分からない mod の行は押せない`, PLUGINS, async ($, on) => {
    const ran: string[] = []
    let list = [cmd('after-main', 'demo-after@example-market'), cmd('demo-after', 'demo-after@example-market'), cmd('before', 'demo-before')]
    const s = await boot($, on, { commands: () => list, ran, store: { items: [item('engine', '本体の通知', NOW - 60_000)] } })
    await turn($, 't1', 'E')
    await turn($, 's1', '動いています')
    await s.clock.advance(1000)
    await $.command.run({ command: 'inbox', ...RUN })

    const ui = await $.ui.mount({ ...PANE, surface })
    // demo-after は mod と同じ名前の物、demo-before は 1 つだけの物
    const after = await button(ui, '未読 21:00 demo-after を開く')
    expect(after).toBeDefined()
    expect(await button(ui, '未読 21:00 demo-before を開く')).toBeDefined()
    // 本体と、コマンドの無い mod (demo-status) の行は文字のまま
    expect(await ui.find({ type: 'Text', text: '未読 20:59 本体' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '未読 21:00 demo-status (ステータス)' })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).some(b => /本体|demo-status/.test(String(b.props.label)))).toBe(false)

    await ui.press({ key: String(after?.key) })
    expect(ran).toEqual(['demo-after'])
    expect(await ui.find({ type: 'Text', text: '/demo-after を送りました(セッションが空いたら開きます)' })).toBeDefined()

    // コマンドの名前が mod と違っても、その mod の物を開く
    const before = await button(ui, '未読 21:00 demo-before を開く')
    await ui.press({ key: String(before?.key) })
    expect(ran).toEqual(['demo-after', 'before'])
    expect(await ui.find({ type: 'Text', text: '/before を送りました(セッションが空いたら開きます)' })).toBeDefined()
    await ui.unmount()

    // mod を外した後にペインを開き直すと、その行は押せなくなる
    list = [cmd('before', 'demo-before')]
    await $.command.run({ command: 'inbox', ...RUN })
    const again = await $.ui.mount({ ...PANE, surface })
    expect(await button(again, '未読 21:00 demo-after を開く')).toBeUndefined()
    expect(await again.find({ type: 'Text', text: '未読 21:00 demo-after' })).toBeDefined()
    await again.unmount()
  })
}
