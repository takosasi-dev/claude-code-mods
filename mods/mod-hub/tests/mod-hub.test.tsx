import type { On, Register } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { byCategory, categoryOf, clean, headerSvg, isGui, launchers, noteMod } from '../hooks/hub'

const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'mod-hub',
  component: 'Pane',
  requestId: 'mod-hub',
  props: {
    title: 'mod',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// テストから打つコマンドの決まった部分
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

// セッションを始めて /mod を持たせる(/mod を開けるのは持てた時だけ)
const start = async ($: Engine, on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
}

// mod-hub より後に読み込まれる試しの mod: ペインを開く物・帯を描く物・画面を持たない物
const pane: Register = on => {
  on('ui.render', { component: 'Pane', requestId: 'demo' }, async ($, e, next) => {
    await $.ui.open({ id: 'demo', title: 'demo' })
    return next(e)
  })
}
const band: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => next(e))
}
const quiet: Register = on => {
  on('tool.call', async ($, e, next) => next(e))
}
const PLUGINS = {
  plugins: [
    { name: 'pane-mod', register: pane },
    { name: 'band-mod', register: band },
    { name: 'quiet-mod', register: quiet },
  ],
}

// コマンドの一覧: 画面のある 2 本・画面の無い 1 本・自分・plugin でない物
const COMMANDS = [
  { name: 'pane-open', description: '試しのペインを開く', source: 'plugin', plugin: 'pane-mod' },
  { name: 'band', description: '帯の表示を切り替える', source: 'plugin', plugin: 'band-mod@example-market' },
  { name: 'quiet-cmd', description: '画面の無いコマンド', source: 'plugin', plugin: 'quiet-mod' },
  { name: 'mod', description: 'mod の一覧', source: 'plugin', plugin: 'mod-hub' },
  { name: 'help', description: 'ヘルプ', source: 'builtin' },
] as const

const cardKeys = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Box' })).map(b => b.key ?? '').filter(k => k.startsWith('card:'))

test('画面を持つかの判定と、並べる物', () => {
  expect(isGui(['ui.render'], [])).toBe(true)
  expect(isGui([], ['ui.open'])).toBe(true)
  expect(isGui(['tool.call'], ['command.register'])).toBe(false)

  const mods = [
    { name: 'b', version: '1.0.0', isGui: true },
    { name: 'a', version: '', isGui: true },
    { name: 'frame', version: '', isGui: true },
    { name: 'quiet', version: '', isGui: false },
    { name: 'mod-hub', version: '', isGui: true },
  ]
  const cmds = [
    { name: 'b-open', description: '', plugin: 'b@m' },
    { name: 'a-open', description: '', plugin: 'a' },
    { name: 'q', description: '', plugin: 'quiet' },
    { name: 'mod', description: '', plugin: 'mod-hub' },
  ]
  // コマンドの無い枠だけの mod・画面の無い mod・自分は並べない
  expect(launchers(mods, cmds).map(l => l.name)).toEqual(['a', 'b'])

  const svg = headerSvg(2)
  expect(svg).toMatch(/画面のある mod 2 本/)
  expect(svg).toMatch(/<animate/)
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
})

for (const surface of SURFACES) {
  test(`${surface}: /mod で画面のある mod のボタンだけが並び、押すと開く`, PLUGINS, async ($, on) => {
    on('command.list', () => ({ value: COMMANDS.map(c => ({ ...c })) }))
    let opened = ''
    on('ui.open', (_$, e) => {
      opened = e.id
      return { value: { isPlaced: true as const } }
    })
    const ran: string[] = []
    on('command.run', { command: 'pane-open' }, async (_$, e) => {
      ran.push(e.command)
      return { text: 'opened' }
    })
    await start($, on)
    const r = await $.command.run({ command: 'mod', ...RUN })
    expect(r.text).toBe('mod の一覧を開きました。')
    expect(opened).toBe('mod-hub')

    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await cardKeys(ui)).toEqual(['card:band-mod', 'card:pane-mod'])
    expect(await ui.find({ key: 'run:band-mod:band' })).toBeDefined()
    expect(await ui.find({ key: 'run:quiet-mod:quiet-cmd' })).toBeUndefined()
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/画面のある mod 2 本/)
    else expect(await ui.find({ type: 'Svg' })).toBeUndefined()

    await ui.press({ key: 'run:pane-mod:pane-open' })
    expect(ran).toEqual(['pane-open'])
    expect(await ui.find({ type: 'Text', text: /pane-open を送りました/ })).toBeDefined()
  })
}

test('起動時に /mod を登録し、拒まれたら /mod-hub にする', async ($, on) => {
  on('command.list', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'mod' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['mod'])
  isTaken = true
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['mod', 'mod', 'mod-hub'])
})

// テストの道具は、読み込みを拒まれた mod があるとテストを落とすので、記録の判断は純関数で確かめる
test('後ろの mod に拒まれた mod は並べない(next(e) が allow の時だけ記録)', () => {
  const e = { name: 'band-mod', version: '1.0.0\x07', uses: { events: ['ui.render'], calls: [] } }
  expect(noteMod(e, { refuse: '試しに拒む' })).toBeUndefined()
  expect(noteMod(e, { allow: true })).toEqual({ name: 'band-mod', version: '1.0.0', isGui: true })
})

test('説明と版の制御文字を落として描く(木が拒まれない)', PLUGINS, async ($, on) => {
  const BAD = '\x07試しの\x1b[31mペイン\x00'
  on('command.list', () => ({
    value: [{ name: 'pane-open', description: BAD, source: 'plugin', plugin: 'pane-mod' }],
  }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await start($, on)
  await $.command.run({ command: 'mod', ...RUN })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '試しの[31mペイン' })).toBeDefined()
    await ui.unmount()
  }
  expect(clean('1.0.0\b\t\n')).toBe('1.0.0')
})

test('/mod を持てなかった時は /mod を横取りしない', async ($, on) => {
  on('command.list', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (e.name === 'mod' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  on('command.run', { command: 'mod' }, () => ({ text: '組み込みの /mod' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect((await $.command.run({ command: 'mod', ...RUN })).text).toBe('組み込みの /mod')
  expect((await $.command.run({ command: 'mod-hub', ...RUN })).text).toBe('mod の一覧を開きました。')
})

test('カテゴリーの順に分け、表に無い mod は「その他」', () => {
  const mods = ['wait-games', 'zz-other', 'git-pane', 'cc-dash', 'aqua-pet'].map(name => ({ name, version: '', isGui: true }))
  const cmds = mods.map(m => ({ name: m.name, description: '', plugin: m.name }))
  const groups = byCategory(launchers(mods, cmds))
  expect(groups.map(g => g.category)).toEqual(['開発', '状況', '遊び', 'その他'])
  expect(groups.find(g => g.category === '遊び')?.items.map(l => l.name)).toEqual(['aqua-pet', 'wait-games'])
  expect(categoryOf('zz-other')).toBe('その他')
})

test('並びのボタンで名前順とカテゴリー別を切り替え、次のセッションにも残す', PLUGINS, async ($, on) => {
  on('command.list', () => ({ value: COMMANDS.map(c => ({ ...c })) }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  const saved: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: saved[e.key] }))
  on('store.set', (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  await start($, on)
  await $.command.run({ command: 'mod', ...RUN })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'group:その他' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /並び: カテゴリー別/ })).toBeDefined()

  await ui.press({ key: 'sort' })
  expect(await ui.find({ key: 'group:その他' })).toBeUndefined()
  expect(await cardKeys(ui)).toEqual(['card:band-mod', 'card:pane-mod'])
  expect(saved.sort).toBe('name')
  await ui.unmount()

  // 次のセッションは残した並びで始まる
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const again = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await again.find({ type: 'Text', text: /並び: 名前順/ })).toBeDefined()
})
