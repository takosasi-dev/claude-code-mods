import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { buildRows, classify, countRows, diffVersions, MODS, parentDir, reportText, rowsSvg, siblingManifest, summarySvg, updateBand, versionOf } from '../hooks/check'
import type { CommandLike } from '../hooks/check'
import { checklistText, ITEMS, marksFrom, withMark } from '../hooks/checklist'
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
  /** 隣に並ぶ mod の plugin.json の版(名前 → 版)。無い mod は読めない。既定は全部 '1.0.0' */
  versions?: Map<string, string>
  /** $.store の中身 */
  store?: Map<string, unknown>
}

type World = { toasts: string[]; copied: string[]; reads: string[]; setCount: number }

/** フックを置いてセッションを始める。alive に無い mod の state.get には答えない(入っていない) */
const boot = async ($: Engine, on: On, opts: Boot = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const w: World = { toasts: [], copied: [], reads: [], setCount: 0 }
  const versions = opts.versions ?? new Map(MODS.map(m => [m.name, '1.0.0']))
  // plugin.json は偽の物だけ読める(本物のディスクは読まない)
  on('fs.read', (_$, e) => {
    w.reads.push(e.path)
    const name = /([^/\\]+)[/\\]\.claude-plugin[/\\]plugin\.json$/.exec(e.path)?.[1]
    const v = name === undefined ? undefined : versions.get(name)
    if (v === undefined) throw new Error('ENOENT')
    return { value: JSON.stringify({ name, version: v }) }
  })
  const store = opts.store ?? new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) as never }))
  on('store.set', (_$, e) => {
    w.setCount += 1
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    w.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
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
  return { w, clock, versions, store }
}

const BAND = {
  plugin: 'mod-check',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

const bandOf = async ($: Engine) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  await ui.unmount()
  return text
}

/** メインの 1 ターンを終える */
const endTurn = ($: Engine) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

const ALL_ALIVE = new Set(PROBED)

// 本数は表から読む(mod を足すたびに直さない)
const N = MODS.length

test('表は名前が重ならず、todo-scan を含まず、state を読む表と食い違わない', () => {
  expect(N).toBeGreaterThanOrEqual(46)
  expect(new Set(MODS.map(m => m.name)).size).toBe(N)
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
  expect(lines.length).toBe(3 + N)
  expect(lines[0]).toBe('mod-check の結果 2026-10-21 21:00 (日本時間)')
  expect(lines[1]).toBe('画面 vscode  テーマ 暗い (dark)  Claude Code 2.1.304  ペイン mod-check')
  expect(lines[2]).toBe(`全 ${N} 本  入っている ${N - 4}  コマンドあり ${N - 4}  予備名 1  見つからない 1  確かめられない 3`)
  expect(lines[3]).toBe('daily-quest      見つからない')
  expect(lines[4]).toBe('agent-watch      予備名 /agent-watch state まだ /agents は組み込みのコマンド')
  expect(text).not.toMatch(/[|\[\]]/)
})

for (const surface of SURFACES) {
  test(`${surface}: 全部入っている時は 3 本を除いて入っていて、3 本は確かめられない`, async ($, on) => {
    await boot($, on, { alive: () => ALL_ALIVE })
    const r = await $.command.run({ command: 'mod-check', ...RUN })
    expect(r.text).toMatch(new RegExp(`全 ${N} 本 {2}入っている ${N - 3} {2}コマンドあり ${N - 3} {2}予備名 0 {2}見つからない 0 {2}確かめられない 3`))
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
  expect(r.text).toMatch(new RegExp(`全 ${N} 本 {2}入っている 1 {2}コマンドあり 1 {2}予備名 0 {2}見つからない ${N - 4} {2}確かめられない 3`))
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
  expect(await ui.find({ type: 'Text', text: new RegExp(`見つからない ${N - 4}`) })).toBeDefined()
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
  expect(countRows(rows).missing).toBe(N - 4)
  expect(reportText(report)).toMatch(/git-pane {9}拒まれた v1 読み込みを拒まれた: xy/)
})

// ---- 版の見張り ----

test('純関数: 1 つ上のフォルダ・隣の plugin.json・版の差', () => {
  expect(parentDir('D:/repo/mods/mod-check')).toBe('D:/repo/mods')
  expect(parentDir('D:\\repo\\mods\\mod-check\\')).toBe('D:\\repo\\mods')
  expect(parentDir('mod-check')).toBe('')
  expect(siblingManifest('D:/repo/mods/mod-check', 'aqua-pet')).toBe('D:/repo/mods/aqua-pet/.claude-plugin/plugin.json')
  expect(versionOf('{"version":"0.5.0"}')).toBe('0.5.0')
  expect(versionOf('壊れた')).toBeUndefined()
  // 片方が読めない mod は比べない
  expect(diffVersions({ 'aqua-pet': '0.4.1', 'dev-rpg': '0.5.0', 'git-pane': '1.0.0' }, { 'aqua-pet': '0.5.0', 'dev-rpg': '0.5.0' })).toEqual([{ name: 'aqua-pet', from: '0.4.1', to: '0.5.0' }])
  expect(updateBand([{ name: 'aqua-pet', from: '0.4.1', to: '0.5.0' }])).toBe('mod が新しくなりました(aqua-pet 0.4.1→0.5.0)。VS Code を開き直してください')
})

test('隣の mod の版が変わったら、帯とトースト(1 回)で開き直しを頼み、ペインと貼る文にも出す', async ($, on) => {
  const { w, clock, versions } = await boot($, on)
  await endTurn($)
  expect(await bandOf($)).toBe('')
  // 60 秒たつまでは読み直さない
  versions.set('aqua-pet', '1.1.0')
  await endTurn($)
  expect(await bandOf($)).toBe('')
  await clock.advance(61_000)
  await endTurn($)
  const one = 'mod が新しくなりました(aqua-pet 1.0.0→1.1.0)。VS Code を開き直してください'
  expect(await bandOf($)).toBe(one)
  versions.set('rule-watch', '1.2.0')
  versions.set('dev-rpg', '2.0.0')
  await clock.advance(61_000)
  await endTurn($)
  expect(await bandOf($)).toBe('mod が新しくなりました(aqua-pet 1.0.0→1.1.0 ほか 2 本)。VS Code を開き直してください')
  expect(w.toasts.filter(t => t.startsWith('mod が新しく'))).toEqual([one])
  // 読んだのは隣に並ぶ mod の plugin.json
  expect(w.reads.some(p => /[/\\]aqua-pet[/\\]\.claude-plugin[/\\]plugin\.json$/.test(p))).toBe(true)

  const r = await $.command.run({ command: 'mod-check', ...RUN })
  const lines = String(r.text).split('\n')
  expect(lines[3]).toBe('開き直し待ち aqua-pet 1.0.0→1.1.0  dev-rpg 1.0.0→2.0.0  rule-watch 1.0.0→1.2.0')
  expect(lines.length).toBe(4 + N)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^mod が新しくなりました\(aqua-pet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('隣の plugin.json が読めない形(マーケットプレイスから入れた形)では何も出さない', async ($, on) => {
  const { w, clock } = await boot($, on, { versions: new Map() })
  await clock.advance(61_000)
  await endTurn($)
  expect(await bandOf($)).toBe('')
  expect(w.toasts).toEqual([])
})

// ---- 点検表 ----

test('純関数: 点検表の文は だめ・まだ を先に並べ、知らない欄を残して印を当てる', () => {
  const [a, b] = ITEMS
  const marks = { [a!.id]: 'good', [b!.id]: 'bad' } as const
  const lines = checklistText(marks, '2026-10-21 21:00').split('\n')
  expect(lines.length).toBe(2 + ITEMS.length)
  expect(lines[0]).toBe('mod-check の点検表 2026-10-21 21:00 (日本時間)')
  expect(lines[1]).toBe(`全 ${ITEMS.length} 項目  だめ 1  まだ ${ITEMS.length - 2}  よい 1`)
  expect(lines[2]).toBe(`${b!.mod.padEnd(16)} だめ ${b!.command} ${b!.look}`)
  expect(lines.at(-1)).toBe(`${a!.mod.padEnd(16)} よい ${a!.command} ${a!.look}`)
  expect(lines.join('\n')).not.toMatch(/[|\[\]]/)
  expect(withMark({ futureField: 1, marks: { x: 'good', [a!.id]: 'bad' } }, a!.id, 'todo')).toEqual({ futureField: 1, marks: { x: 'good' } })
  expect(withMark(undefined, a!.id, 'good')).toEqual({ marks: { [a!.id]: 'good' } })
  expect(marksFrom({ marks: { [a!.id]: 'good', y: 'へん' } })).toEqual({ [a!.id]: 'good' })
  // 項目の id は重ならない
  expect(new Set(ITEMS.map(i => i.id)).size).toBe(ITEMS.length)
})

for (const surface of SURFACES) {
  test(`${surface}: 点検表のタブで印を付けると store に残り、貼る文をコピーしてペインにも出す`, async ($, on) => {
    const { w, store } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab:list' })
    expect(await ui.find({ type: 'Text', text: `全 ${ITEMS.length} 項目  だめ 0  まだ ${ITEMS.length}  よい 0` })).toBeDefined()
    const [a, b] = ITEMS
    await ui.press({ key: `mark:${a!.id}:good` })
    await ui.press({ key: `mark:${b!.id}:bad` })
    expect(store.get('checklist')).toEqual({ marks: { [a!.id]: 'good', [b!.id]: 'bad' } })
    expect(await ui.find({ type: 'Text', text: `全 ${ITEMS.length} 項目  だめ 1  まだ ${ITEMS.length - 2}  よい 1` })).toBeDefined()

    await ui.press({ key: 'paste' })
    expect(w.copied.length).toBe(1)
    expect(w.copied[0]?.split('\n')[2]).toMatch(new RegExp(`^${b!.mod} +だめ`))
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    expect(w.toasts).toContain('点検の結果をコピーしました。そのまま貼ってください')

    // まだに戻すと印が消える
    await ui.press({ key: `mark:${a!.id}:todo` })
    expect(store.get('checklist')).toEqual({ marks: { [b!.id]: 'bad' } })
    await ui.press({ key: 'tab:check' })
    expect(await ui.find({ key: 'again' })).toBeDefined()
  })
}

test('点検表の記録は知らない欄を残して書く', async ($, on) => {
  const [a, b] = ITEMS
  const store = new Map<string, unknown>([['checklist', { futureField: 1, marks: { 'future-item': 'good', [a!.id]: 'bad' } }]])
  await boot($, on, { store })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab:list' })
  // 前に付けた印を読む
  expect(await ui.find({ type: 'Text', text: new RegExp(`だめ 1  まだ ${ITEMS.length - 1}`) })).toBeDefined()
  await ui.press({ key: `mark:${b!.id}:good` })
  await endTurn($)
  expect(store.get('checklist')).toEqual({ futureField: 1, marks: { 'future-item': 'good', [a!.id]: 'bad', [b!.id]: 'good' } })
})

// 共通の isStale は一度古いと分かると戻らないので、この試験は最後に置く
test('mod-check 自身の版が変わったら点検表の印を書かず、開き直しを頼む', async ($, on) => {
  const { w, clock, versions, store } = await boot($, on)
  const [a, b] = ITEMS
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'tab:list' })
  await ui.press({ key: `mark:${a!.id}:good` })
  expect(w.setCount).toBe(1)
  versions.set('mod-check', '9.9.9')
  await clock.advance(61_000)
  await ui.press({ key: `mark:${b!.id}:bad` })
  expect(w.setCount).toBe(1)
  expect(store.get('checklist')).toEqual({ marks: { [a!.id]: 'good' } })
  expect(w.toasts.some(t => t.includes('新しい版が入りました'))).toBe(true)
  await endTurn($)
  expect(await bandOf($)).toContain('mod-check 1.0.0→9.9.9')
})
