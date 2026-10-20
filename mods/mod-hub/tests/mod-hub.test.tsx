import type { On, Register } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { ModHubMod } from '../types'
import { buildRows, disableCommand, headerSvg, kindOf, sourceLabel, stats, usesSummary } from '../hooks/hub'

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

// mod-hub より後に読み込まれる試しの mod (ペイン + ツール監視)
const demo: Register = on => {
  on('command.run', { command: 'demo-own' }, async () => ({ text: 'demo ran' }))
  on('tool.call', async ($, e, next) => next(e))
  on('ui.render', { component: 'Pane', requestId: 'demo' }, async ($, e, next) => {
    await $.ui.open({ id: 'demo', title: 'demo' })
    return next(e)
  })
}
const builtin: Register = on => {
  on('turn.complete', async ($, e, next) => next(e))
}
const PLUGINS = { plugins: [{ name: 'demo-mod', register: demo }, { name: 'cc-plugin-hidden', register: builtin }] }

// コマンドの一覧: 試しの mod・先に読み込まれた mod・自分・組み込み・plugin でない物
const COMMANDS = [
  { name: 'demo-open', description: '試しのペインを開く', source: 'plugin', plugin: 'demo-mod' },
  { name: 'early-cmd', description: '先に読み込まれた mod のコマンド', source: 'plugin', plugin: 'early-mod@example-market' },
  { name: 'mod', description: 'mod の一覧', source: 'plugin', plugin: 'mod-hub' },
  { name: 'hidden-cmd', description: '組み込み', source: 'plugin', plugin: 'cc-plugin-hidden' },
  { name: 'help', description: 'ヘルプ', source: 'builtin' },
] as const

// store を Map で答えて、中身を直接見られるようにする
const mockStore = (on: On, init: Record<string, unknown> = {}) => {
  const map = new Map(Object.entries(init))
  on('store.get', (_$, e) => ({ value: map.get(e.key) }))
  on('store.set', (_$, e) => {
    map.set(e.key, e.value)
    return { value: undefined }
  })
  return map
}

const cardKeys = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Box' })).map(b => b.key ?? '').filter(k => k.startsWith('card:'))

test('uses の分類と要約・どこから・オフの手順', async () => {
  expect(kindOf(['ui.render'], ['ui.open'])).toBe('pane')
  expect(kindOf(['ui.render'], [])).toBe('display')
  expect(kindOf(['tool.call'], [])).toBe('tool')
  expect(kindOf(['prompt.submit'], [])).toBe('prompt')
  expect(kindOf(['turn.complete'], [])).toBe('turn')
  expect(kindOf(['plugin.register', 'ui.render'], [])).toBe('manage')
  expect(kindOf(['session.start'], ['command.register'])).toBe('command')
  expect(kindOf(['session.start'], [])).toBe('other')
  expect(usesSummary(['session.start', 'ui.render', 'tool.call', 'command.run', 'x.y'], ['fs.read', 'fs.list', 'state.get'])).toEqual(['描画', 'ツール呼び出し', 'x.y', 'ファイル読み'])
  expect(sourceLabel('a@inline')).toBe('フォルダ')
  expect(sourceLabel('a@builtin')).toBe('組み込み')
  expect(sourceLabel('a@some-market')).toBe('some-market から')
  expect(sourceLabel('')).toBe('不明')

  const mods: ModHubMod[] = [
    { name: 'a', version: '1.0.0', provenance: 'a@inline', tier: 'user', events: ['ui.render'], calls: ['ui.open'], isRefused: false },
    { name: 'b', version: '', provenance: 'b@inline', tier: 'user', events: ['tool.call'], calls: [], isRefused: true },
    { name: 'c', version: '', provenance: 'c@inline', tier: 'user', events: ['tool.call'], calls: [], isRefused: true },
  ]
  const rows = buildRows(mods, [{ name: 'x', description: '', plugin: 'early@m' }], ['a', 'b', 'mod-hub'])
  const st = Object.fromEntries(rows.map(r => [r.name, r.status]))
  expect(st).toEqual({ 'mod-hub': 'self', a: 'off-next', b: 'off', c: 'on-next', early: 'early' })
  const early = rows.find(r => r.name === 'early')
  expect(early && disableCommand(early)).toBe('claude plugin disable early@m')
  const s = stats(rows)
  // 読み込み中 = 自分・a(次からオフ)・early。b(オフ)と c(次からオン)は今は読み込まれていない
  expect([s.loaded, s.off, s.commands]).toEqual([3, 2, 1])
  const svg = headerSvg(s)
  expect(svg).toMatch(/<animate attributeName="width"/)
  expect(svg).toMatch(/viewBox="0 0 380 /)
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
})

for (const surface of SURFACES) {
  test(`${surface}: /mod で一覧・組み込みの切替・絞り込み・並び替え`, PLUGINS, async ($, on) => {
    mockStore(on)
    on('command.list', () => ({ value: COMMANDS.map(c => ({ ...c })) }))
    let opened = ''
    on('ui.open', (_$, e) => {
      opened = e.id
      return { value: { isPlaced: true as const } }
    })
    const r = await $.command.run({ command: 'mod', ...RUN })
    expect(r.text).toBe('mod の一覧を開きました。')
    expect(opened).toBe('mod-hub')

    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await cardKeys(ui)).toEqual(['card:demo-mod', 'card:early-mod', 'card:mod-hub'])
    expect(await ui.find({ key: 'card:demo-mod', text: /ペイン/ })).toBeDefined()
    expect(await ui.find({ key: 'card:demo-mod', text: /フォルダ|claude-plugin-test から/ })).toBeDefined()
    expect(await ui.find({ key: 'card:demo-mod', text: /ツール呼び出し/ })).toBeDefined()
    expect(await ui.find({ key: 'card:early-mod', text: /読み込み順が先のため詳細不明/ })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.text).toBe('claude plugin disable early-mod@example-market')
    expect(await ui.find({ key: 'toggle:early-mod' })).toBeUndefined()
    expect(await ui.find({ key: 'toggle:mod-hub' })).toBeUndefined()
    expect(await ui.find({ key: 'card:mod-hub', text: /mod-hub 自身はオフにできません/ })).toBeDefined()

    if (surface === 'vscode') {
      const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(svg).toMatch(/読み込み中/)
      expect(svg).toMatch(/<animate/)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '読み込み中 3 本 / オフ 0 本 / コマンド 3 個' })).toBeDefined()
    }

    await ui.press({ key: 'builtin' })
    expect(await cardKeys(ui)).toContain('card:cc-plugin-hidden')
    await ui.press({ key: 'builtin' })
    expect(await cardKeys(ui)).not.toContain('card:cc-plugin-hidden')

    await ui.input({ key: 'filter', text: 'DEMO', kind: 'change' })
    expect(await cardKeys(ui)).toEqual(['card:demo-mod'])
    await ui.input({ key: 'filter', text: 'zzz' })
    expect(await cardKeys(ui)).toEqual([])
    expect(await ui.find({ type: 'Text', text: '該当する mod がありません' })).toBeDefined()
    await ui.input({ key: 'filter', text: '' })

    await ui.select({ key: 'sort', value: 'kind' })
    expect(await cardKeys(ui)).toEqual(['card:demo-mod', 'card:mod-hub', 'card:early-mod'])
  })

  test(`${surface}: コマンドのボタンで command.run が呼ばれる`, PLUGINS, async ($, on) => {
    mockStore(on)
    on('command.list', () => ({ value: COMMANDS.map(c => ({ ...c })) }))
    const ran: string[] = []
    on('command.run', { command: 'demo-open' }, async (_$, e) => {
      ran.push(e.command)
      return { text: 'opened' }
    })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'run:demo-mod:demo-open' })
    expect(ran).toEqual(['demo-open'])
    expect(await ui.find({ type: 'Text', text: /demo-open を送りました/ })).toBeDefined()
  })

  test(`${surface}: オフにすると store に入り、もう一度押すと外れる`, PLUGINS, async ($, on) => {
    const store = mockStore(on)
    on('command.list', () => ({ value: [] }))
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'card:demo-mod', text: /動作中/ })).toBeDefined()

    await ui.press({ key: 'toggle:demo-mod' })
    expect(store.get('off')).toEqual(['demo-mod'])
    expect(await ui.find({ key: 'card:demo-mod', text: /次の起動からオフ/ })).toBeDefined()
    expect((await ui.find({ key: 'toggle:demo-mod' }))?.text).toBe('オンにする')

    await ui.press({ key: 'toggle:demo-mod' })
    expect(store.get('off')).toEqual([])
    expect(await ui.find({ key: 'card:demo-mod', text: /動作中/ })).toBeDefined()
  })
}

test('次のセッション: store でオフの mod は plugin.register で拒まれる', PLUGINS, async ($, on) => {
  mockStore(on, { off: ['demo-mod'] })
  on('command.list', () => ({ value: [] }))
  // 試しの kit は拒まれた mod があると読み込みそのものを失敗にする。その理由で refuse を確かめる
  await expect($.command.run({ command: 'mod', ...RUN })).rejects.toThrow(/demo-mod: refused by mod-hub: mod-hub でオフにされています/)
})

test('オフの一覧に無い mod と自分の名前は拒まない', PLUGINS, async ($, on) => {
  mockStore(on, { off: ['mod-hub', 'other-mod'] })
  on('command.list', () => ({ value: [] }))
  const r = await $.command.run({ command: 'demo-own', ...RUN })
  expect(r.text).toBe('demo ran')
})

test('起動時に /mod を登録し、拒まれたら /mod-hub にする', async ($, on) => {
  mockStore(on)
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
