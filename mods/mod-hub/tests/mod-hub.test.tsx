import type { On, Register } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { applyFilter, asPins, asRecent, byCategory, categoryOf, clean, headerSvg, isGui, KNOWN_MODS, launchers, noteMod, pushRecent, sortRecent, splitPins } from '../hooks/hub'
import { bandSvg, categoryColor, hasIcon, iconStrip, modIcon } from '../hooks/icons'
import { DARK, LIGHT, setTheme } from '../hooks/style'

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

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', PLUGINS, async ($, on) => {
  on('command.list', () => ({ value: COMMANDS.map(c => ({ ...c })) }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  let theme = 'light-daltonized'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await start($, on)
  await $.command.run({ command: 'mod', ...RUN })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/fill="#ffffff"/)

  theme = 'dark'
  await $.config.set({
    key: 'theme',
    value: 'dark',
    previous: 'light-daltonized',
    provider: { plugin: 'core', tier: 'core' } as never,
    origin: { kind: 'composer' },
  })
  expect(await source()).toMatch(/fill="#0d1117"/)
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

// 起動ボタンの試しの一覧 (pane-mod / band-mod の 2 本)
const sample = () =>
  launchers(
    [
      { name: 'pane-mod', version: '', isGui: true },
      { name: 'band-mod', version: '', isGui: true },
    ],
    COMMANDS.map(c => ({ name: c.name, description: c.description, plugin: 'plugin' in c ? c.plugin : '' })),
  )

test('検索は名前・コマンド名・説明の部分一致で、大文字小文字を見ない', () => {
  const list = sample()
  expect(applyFilter(list, '').map(l => l.name)).toEqual(['band-mod', 'pane-mod'])
  expect(applyFilter(list, '  BAND ').map(l => l.name)).toEqual(['band-mod'])
  expect(applyFilter(list, 'PANE-OPEN').map(l => l.name)).toEqual(['pane-mod'])
  expect(applyFilter(list, '帯の表示').map(l => l.name)).toEqual(['band-mod'])
  expect(applyFilter(list, 'zzz')).toEqual([])
})

test('最近開いた順・固定の分け方・記録の上限と形の確かめ', () => {
  const list = launchers(
    ['a', 'b', 'c', 'd'].map(name => ({ name, version: '', isGui: true })),
    ['a', 'b', 'c', 'd'].map(name => ({ name, description: '', plugin: name })),
  )
  // 開いた物は新しい順、開いたことの無い物は後ろに名前順
  expect(sortRecent(list, [{ name: 'c', at: 5 }, { name: 'a', at: 9 }]).map(l => l.name)).toEqual(['a', 'c', 'b', 'd'])
  const { pinned, rest } = splitPins(list, ['c', 'zz'])
  expect(pinned.map(l => l.name)).toEqual(['c'])
  expect(rest.map(l => l.name)).toEqual(['a', 'b', 'd'])

  let recent = Array.from({ length: 25 }, (_, i) => ({ name: `m${i}`, at: i }))
  recent = pushRecent(recent, 'm3', 100)
  expect(recent).toHaveLength(20)
  expect(recent[0]).toEqual({ name: 'm3', at: 100 })
  expect(recent.filter(r => r.name === 'm3')).toHaveLength(1)

  expect(asPins(['a', 'b'])).toEqual(['a', 'b'])
  expect(asPins(['a', 1])).toBeUndefined()
  expect(asPins('a')).toBeUndefined()
  expect(asRecent([{ name: 'a', at: 1 }])).toEqual([{ name: 'a', at: 1 }])
  expect(asRecent([{ name: 'a' }])).toBeUndefined()
  expect(asRecent([null])).toBeUndefined()
})

test('表に載っている mod 全部に専用のアイコンがあり、文字を使わない', () => {
  for (const name of ['session-timeline', 'file-map', 'usage-history']) expect(categoryOf(name)).toBe('状況')
  expect(categoryOf('toast-inbox')).toBe('道具')
  const generic = modIcon('zz-unknown')
  for (const name of KNOWN_MODS) {
    expect(hasIcon(name)).toBe(true)
    const svg = modIcon(name)
    expect(svg).not.toBe(generic)
    expect(svg).not.toMatch(/<text/)
    expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
  }
  // 知らない mod はカテゴリーの色の汎用アイコン
  expect(generic).toMatch(new RegExp(`fill="${DARK.dim}"`))
  expect(bandSvg('開発', 3)).toMatch(/開発/)
  expect(bandSvg('開発', 3)).toMatch(/3 本/)
  const strip = iconStrip(['git-pane', 'aqua-pet', 'file-map'])
  expect(strip.match(/<svg /g)).toHaveLength(4)
  expect(strip).toMatch(/^<svg xmlns=[^>]*viewBox="0 0 380 60"/)
})

test('明るいテーマではアイコンと帯も明るい色で描く', () => {
  setTheme(true)
  try {
    const svg = modIcon('git-pane')
    expect(svg).toMatch(new RegExp(`fill="${LIGHT.face}"`))
    expect(svg).toMatch(new RegExp(LIGHT.blue))
    expect(svg).not.toMatch(new RegExp(DARK.blue))
    expect(bandSvg('固定', 1)).toMatch(new RegExp(LIGHT.orange))
    expect(categoryColor('遊び')).toBe(LIGHT.purple)
  } finally {
    setTheme(false)
  }
  expect(modIcon('git-pane')).toMatch(new RegExp(DARK.blue))
})

// store を持たせて /mod を開く
const openWithStore = async ($: Engine, on: On) => {
  on('command.list', () => ({ value: COMMANDS.map(c => ({ ...c })) }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('command.run', { command: 'pane-open' }, () => ({ text: 'opened' }))
  on('command.run', { command: 'band' }, () => ({ text: 'opened' }))
  const saved: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: saved[e.key] }))
  on('store.set', (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  await start($, on)
  await $.command.run({ command: 'mod', ...RUN })
  return saved
}

for (const surface of SURFACES) {
  test(`${surface}: 検索欄で絞り込み、空に戻すと全部出る`, PLUGINS, async ($, on) => {
    await openWithStore($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'filter' }))?.props.placeholder).toBe('名前や説明で絞る')
    await ui.input({ key: 'filter', text: 'BAND', kind: 'change' })
    expect(await cardKeys(ui)).toEqual(['card:band-mod'])
    await ui.input({ key: 'filter', text: '試しのペイン', kind: 'change' })
    expect(await cardKeys(ui)).toEqual(['card:pane-mod'])
    await ui.input({ key: 'filter', text: 'zzz', kind: 'change' })
    expect(await cardKeys(ui)).toEqual([])
    expect(await ui.find({ type: 'Text', text: '一致する mod がありません' })).toBeDefined()
    await ui.input({ key: 'filter', text: '', kind: 'change' })
    expect(await cardKeys(ui)).toEqual(['card:band-mod', 'card:pane-mod'])
  })
}

test('vscode ではカードにアイコン、段に色の帯を描く(terminal は描かない)', PLUGINS, async ($, on) => {
  await openWithStore($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svgs = await ui.findAll({ type: 'Svg' })
  const icon = svgs.find(s => s.props.alt === 'pane-mod のアイコン')
  expect(icon?.props.width).toBe(28)
  expect(String(icon?.props.source)).toBe(modIcon('pane-mod'))
  expect(svgs.some(s => s.props.alt === 'その他 2 本')).toBe(true)
  await ui.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: 'その他 (2)' })).toBeDefined()
})

test('固定した mod は一番上の「固定」の段に移り、store は読み直して足す・抜く', PLUGINS, async ($, on) => {
  const saved = await openWithStore($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'group:固定' })).toBeUndefined()

  await ui.press({ key: 'pin:pane-mod' })
  expect(saved.pins).toEqual(['pane-mod'])
  expect(await ui.find({ key: 'group:固定' })).toBeDefined()
  // 固定の段が先、他の段からは外れる (同じカードは 1 枚)
  expect(await cardKeys(ui)).toEqual(['card:pane-mod', 'card:band-mod'])
  expect(await ui.find({ type: 'Text', text: '外す' })).toBeDefined()

  // 別のセッションが足した分を消さない
  saved.pins = ['pane-mod', 'other-mod']
  await ui.press({ key: 'pin:band-mod' })
  expect(saved.pins).toEqual(['pane-mod', 'other-mod', 'band-mod'])
  await ui.press({ key: 'pin:pane-mod' })
  expect(saved.pins).toEqual(['other-mod', 'band-mod'])
  expect(await cardKeys(ui)).toEqual(['card:band-mod', 'card:pane-mod'])
  await ui.unmount()

  // 次のセッションも固定は残る
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: '固定 (1)' })).toBeDefined()
})

test('並びは 3 つを順に回し、最近開いた順は起動ボタンの記録で並ぶ', PLUGINS, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const saved = await openWithStore($, on)
  saved.recent = [{ name: 'gone-mod', at: 1 }]
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'sort' })
  await ui.press({ key: 'sort' })
  expect(await ui.find({ type: 'Text', text: /並び: 最近開いた順/ })).toBeDefined()
  expect(saved.sort).toBe('recent')
  // 開いたことが無ければ名前順
  expect(await cardKeys(ui)).toEqual(['card:band-mod', 'card:pane-mod'])

  await ui.press({ key: 'run:pane-mod:pane-open' })
  expect(await cardKeys(ui)).toEqual(['card:pane-mod', 'card:band-mod'])
  await clock.advance(60_000)
  await ui.press({ key: 'run:band-mod:band' })
  expect(await cardKeys(ui)).toEqual(['card:band-mod', 'card:pane-mod'])
  await clock.advance(60_000)
  await ui.press({ key: 'run:pane-mod:pane-open' })
  expect(await cardKeys(ui)).toEqual(['card:pane-mod', 'card:band-mod'])
  // 記録は読み直した物の先頭に足す
  expect((saved.recent as { name: string }[]).map(r => r.name)).toEqual(['pane-mod', 'band-mod', 'gone-mod'])

  await ui.press({ key: 'sort' })
  expect(await ui.find({ type: 'Text', text: /並び: カテゴリー別/ })).toBeDefined()
  await ui.unmount()

  // 次のセッションは残した並びと記録で始まる
  saved.sort = 'recent'
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const again = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await again.find({ type: 'Text', text: /並び: 最近開いた順/ })).toBeDefined()
  expect(await cardKeys(again)).toEqual(['card:pane-mod', 'card:band-mod'])
})

test('Input の無い画面 (mobile) では検索欄を出さず、全部並べる', PLUGINS, async ($, on) => {
  await openWithStore($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ key: 'filter' })).toBeUndefined()
  expect(await cardKeys(ui)).toEqual(['card:band-mod', 'card:pane-mod'])
})

// ---- 0.5.0 見出しに季節の飾り ----

test('見出しの季節の飾りは 4 季で違い、渡さなければ飾り無し', () => {
  const ids = ['deco-spring', 'deco-summer', 'deco-autumn', 'deco-winter']
  ;(['春', '夏', '秋', '冬'] as const).forEach((s, i) => ids.forEach((id, k) => expect(headerSvg(3, s).includes(`id="${id}"`)).toBe(i === k)))
  expect(headerSvg(3)).not.toContain('id="deco-')
  expect(headerSvg(0, '冬')).toContain('まだ見つかっていません')
  expect(headerSvg(12, '春')).not.toMatch(/<svg[^>]*\swidth=/)
})

test('vscode の見出しは今の季節 (JST の月) の飾りを描く', PLUGINS, async ($, on) => {
  // 2026-11-30 23:30 UTC は JST で 12/1 (冬)
  mock.clock(on, { now: Date.parse('2026-11-30T23:30:00Z') })
  await openWithStore($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const head = (await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith('画面のある mod'))
  expect(String(head?.props.source)).toContain('id="deco-winter"')
})
