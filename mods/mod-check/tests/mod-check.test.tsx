import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { buildRows, classify, countRows, MODS, reportText, rowsSvg, summarySvg } from '../hooks/check'
import type { CommandLike } from '../hooks/check'
import { PROBED } from '../hooks/probe'
import { setTheme } from '../hooks/style'

// 2026-10-21 12:00 (日本時間 21:00)
const NOW = Date.parse('2026-10-21T12:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'mod-check',
  component: 'Pane',
  requestId: 'mod-check',
  props: {
    title: 'mod の点検',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

const byName = (name: string) => MODS.find(m => m.name === name)!

/** 全部の mod が本来の名前で入っている時のコマンドの一覧 */
const ALL_COMMANDS: CommandLike[] = MODS.filter(m => m.main !== undefined).map(m => ({ name: m.main!, source: 'plugin', plugin: m.name }))
const SELF_ONLY: CommandLike[] = [{ name: 'mod-check', source: 'plugin', plugin: 'mod-check' }]

type Boot = {
  commands?: () => readonly CommandLike[]
  /** state が書かれている mod */
  alive?: () => ReadonlySet<string>
  taken?: boolean
  /** 登録を試みたコマンドの名前をためる */
  tried?: string[]
  theme?: () => string
}

/** フックを置いてセッションを始める。alive に無い mod の state.get には答えない(入っていない) */
const boot = async ($: Engine, on: On, opts: Boot = {}) => {
  mock.clock(on, { now: NOW })
  on('command.list', () => ({ value: (opts.commands?.() ?? ALL_COMMANDS).map(c => ({ description: '', ...c })) as never }))
  const alive = opts.alive
  // 他の mod の state は { value: { value, version } } の二重の形で答える。自分の state はそのまま流す
  on('state.get', (_$, e, next) => (e.plugin !== 'mod-check' && alive?.().has(e.plugin) ? { value: { value: 1 as never, version: 2 } } : next(e)))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    opts.tried?.push(e.name)
    return opts.taken && e.name === 'mod-check' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  on('command.run', { command: 'mod-check' }, () => ({ text: '別の /mod-check' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [{ id: 'mod-check', title: 'mod の点検', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.version', () => ({ value: { version: '2.1.304', base: '2.1.304' } as never }))
  const theme = opts.theme
  if (theme) {
    on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme(), provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
    on('config.set', (_$, e) => ({ value: e.value }))
  }
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
}

const ALL_ALIVE = new Set(PROBED)

test('表は 41 本で todo-scan を含まず、state を読む表と食い違わない', () => {
  expect(MODS.length).toBe(41)
  expect(new Set(MODS.map(m => m.name)).size).toBe(41)
  expect(MODS.some(m => m.name === 'todo-scan')).toBe(false)
  for (const n of ['fail-log', 'daily-quest', 'trophy-shelf', 'mod-check']) expect(MODS.some(m => m.name === n)).toBe(true)
  // state を見せる mod (自分を除く) と、probe.ts で読む mod が同じ
  expect(
    MODS.filter(m => m.hasState && m.name !== 'mod-check')
      .map(m => m.name)
      .sort(),
  ).toEqual([...PROBED].sort())
  // コマンドも state も無いのは常時動く 3 本だけ
  expect(MODS.filter(m => m.main === undefined).map(m => m.name)).toEqual(['danger-frame', 'long-turn-toast', 'reply-frame'])
  // 本来の名前と予備の名前は、どの 2 本でも被らない
  const names = MODS.flatMap(m => [m.main, m.spare]).filter(n => n !== undefined)
  expect(new Set(names).size).toBe(names.length)
})

test('判定: 本来の名前・予備名・取られた・コマンドなし・拒まれた・確かめられない', () => {
  const agent = byName('agent-watch')
  expect(classify(agent, [{ name: 'agents', source: 'plugin', plugin: 'agent-watch@market' }], false).kind).toBe('ok')
  // 予備名に回り、本来の名前は組み込み
  const spare = classify(agent, [{ name: 'agents', source: 'builtin' }, { name: 'agent-watch', source: 'plugin', plugin: 'agent-watch' }], true)
  expect(spare.kind).toBe('spare')
  expect(spare.command).toBe('agent-watch')
  expect(spare.note).toBe('/agents は組み込みのコマンド')
  // 本来の名前を別の plugin が持っていて、自分のコマンドは無い
  const missing = classify(agent, [{ name: 'agents', source: 'plugin', plugin: 'other-mod@x' }], false)
  expect(missing.kind).toBe('missing')
  expect(missing.note).toBe('/agents は other-mod が使っている')
  // state は書かれているのにコマンドが無い
  expect(classify(agent, [], true).kind).toBe('nocmd')
  // 持ち主の分からない plugin のコマンドは自分の物とみなして書き添える
  const unsure = classify(agent, [{ name: 'agents', source: 'plugin' }], false)
  expect(unsure.kind).toBe('ok')
  expect(unsure.note).toBe('持ち主が分からない')
  // 読み込みで見えた版と、拒まれた理由
  expect(classify(agent, [], false, { name: 'agent-watch', version: '0.2.0', refused: 'だめ\n' }).note).toBe('読み込みを拒まれた: だめ')
  expect(classify(agent, ALL_COMMANDS, true, { name: 'agent-watch', version: '0.2.0', refused: '' }).version).toBe('0.2.0')
  // コマンドも state も無い mod は、読み込みで見えなければ確かめられない
  expect(classify(byName('reply-frame'), [], false).kind).toBe('unknown')
  expect(classify(byName('reply-frame'), [], false, { name: 'reply-frame', version: '0.2.1', refused: '' }).kind).toBe('ok')
})

test('並びは問題のある物が先で、返事の文は記号の表を使わない', () => {
  const rows = buildRows(
    [...ALL_COMMANDS.filter(c => c.name !== 'quest' && c.name !== 'agents'), { name: 'agents', source: 'builtin' }, { name: 'agent-watch', source: 'plugin', plugin: 'agent-watch' }],
    {},
    [],
  )
  expect(rows[0]?.name).toBe('daily-quest')
  expect(rows[0]?.kind).toBe('missing')
  expect(rows[1]?.kind).toBe('spare')
  const text = reportText({ at: NOW, env: { surface: 'vscode', theme: 'dark', engine: '2.1.304', panes: ['mod-check'] }, rows })
  const lines = text.split('\n')
  expect(lines.length).toBe(3 + 41)
  expect(lines[0]).toBe('mod-check の結果 2026-10-21 21:00 (日本時間)')
  expect(lines[1]).toBe('画面 vscode  テーマ 暗い (dark)  Claude Code 2.1.304  ペイン mod-check')
  expect(lines[2]).toBe('全 41 本  入っている 37  コマンドあり 37  予備名 1  見つからない 1  確かめられない 3')
  expect(lines[3]).toBe('daily-quest      見つからない')
  expect(lines[4]).toBe('agent-watch      予備名 /agent-watch state まだ /agents は組み込みのコマンド')
  expect(text).not.toMatch(/[|\[\]]/)
})

for (const surface of SURFACES) {
  test(`${surface}: 全部入っている時は 38 本が入っていて、3 本は確かめられない`, async ($, on) => {
    await boot($, on, { alive: () => ALL_ALIVE })
    const r = await $.command.run({ command: 'mod-check', ...RUN })
    expect(r.text).toMatch(/全 41 本 {2}入っている 38 {2}コマンドあり 38 {2}予備名 0 {2}見つからない 0 {2}確かめられない 3/)
    expect(r.text).toMatch(/Claude Code 2\.1\.304/)
    expect(r.text).toMatch(/aqua-pet {9}入っている \/aquarium state あり/)

    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'again' })).toBeDefined()
    if (surface === 'vscode') {
      const svgs = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
      expect(svgs.length).toBe(2)
      expect(svgs[0]).toMatch(/入っている/)
      expect(svgs[0]).toMatch(/>vscode</)
      expect(svgs[1]).toMatch(/aqua-pet/)
      expect(svgs.join('')).not.toMatch(/<svg[^>]*\swidth=/)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^aqua-pet +入っている/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /確かめられない 3/ })).toBeDefined()
    }
  })
}

test('他の mod が 1 つも無い時は、自分だけ入っていて、ほかは見つからない', async ($, on) => {
  await boot($, on, { commands: () => SELF_ONLY })
  const r = await $.command.run({ command: 'mod-check', ...RUN })
  expect(r.text).toMatch(/全 41 本 {2}入っている 1 {2}コマンドあり 1 {2}予備名 0 {2}見つからない 37 {2}確かめられない 3/)
  expect(r.text).toMatch(/mod-check {8}入っている \/mod-check state あり/)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^git-pane +見つからない/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /^reply-frame +確かめられない/ }))?.props.color).toBe('subtle')
})

test('予備名に回った mod があると数に出て、本来の名前の持ち主を書き添える', async ($, on) => {
  const commands = [
    ...ALL_COMMANDS.filter(c => c.name !== 'agents' && c.name !== 'history'),
    { name: 'agents', source: 'builtin' },
    { name: 'agent-watch', source: 'plugin', plugin: 'agent-watch@takosasi-dev' },
    { name: 'history', source: 'plugin', plugin: 'other-history@x' },
    { name: 'usage-history', source: 'plugin', plugin: 'usage-history' },
  ]
  await boot($, on, { commands: () => commands, alive: () => ALL_ALIVE })
  const r = await $.command.run({ command: 'mod-check', ...RUN })
  expect(r.text).toMatch(/予備名 2 {2}見つからない 0/)
  expect(r.text).toMatch(/agent-watch {6}予備名 \/agent-watch state あり \/agents は組み込みのコマンド/)
  expect(r.text).toMatch(/usage-history {4}予備名 \/usage-history state あり \/history は other-history が使っている/)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const rows = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))[1]
  expect(rows).toMatch(/予備名/)
  expect(rows).toMatch(/\/agents は組み込みのコマンド/)
})

test('調べ直すと、その時のコマンドの一覧で描き直す', async ($, on) => {
  let commands: readonly CommandLike[] = SELF_ONLY
  await boot($, on, { commands: () => commands })
  await $.command.run({ command: 'mod-check', ...RUN })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /見つからない 37/ })).toBeDefined()
  commands = ALL_COMMANDS
  await ui.press({ key: 'again' })
  expect(await ui.find({ type: 'Text', text: /見つからない 0/ })).toBeDefined()
})

test('調べる前に開かれたペインは、まだと出して調べ直すボタンを置く', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /まだ調べていません/ })).toBeDefined()
  await ui.press({ key: 'again' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

test('/mod-check が拒まれたら /modcheck にして、/mod-check は横取りしない', async ($, on) => {
  const tried: string[] = []
  await boot($, on, { taken: true, tried })
  expect(tried).toEqual(['mod-check', 'modcheck'])
  expect((await $.command.run({ command: 'mod-check', ...RUN })).text).toBe('別の /mod-check')
  expect((await $.command.run({ command: 'modcheck', ...RUN })).text).toMatch(/mod-check の結果/)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^\/modcheck の返事に/ })).toBeDefined()
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light-daltonized'
  await boot($, on, { theme: () => theme, alive: () => ALL_ALIVE })
  const r = await $.command.run({ command: 'mod-check', ...RUN })
  expect(r.text).toMatch(/テーマ 明るい \(light-daltonized\)/)
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
  setTheme(false)
})

test('絵は幅を持たず、制御文字の混じった名前でも崩れない', () => {
  const rows = buildRows(SELF_ONLY, { 'mod-check': true }, [{ name: 'git-pane', version: '1\u0007', refused: 'x\u0000y' }])
  const report = { at: NOW, env: { surface: 'vscode', theme: '', engine: '', panes: [] }, rows }
  for (const svg of [summarySvg(report), rowsSvg(rows)]) {
    expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
    expect(svg).not.toMatch(/[\x00-\x08]/)
  }
  expect(countRows(rows).missing).toBe(37)
  expect(reportText(report)).toMatch(/git-pane {9}拒まれた v1 読み込みを拒まれた: xy/)
})
