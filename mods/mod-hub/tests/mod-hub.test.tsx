import type { Register } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { headerSvg, isGui, launchers } from '../hooks/hub'

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
