import type { On, PromptComposeSection } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUILTIN, boardSvg, clean, EMPTY, fromSaved, MAX_CUSTOM, MAX_TEXT, SECTION_ID, sectionText, withAdded, withRemoved, withToggle } from '../hooks/rules'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'rule-switch',
  component: 'Pane',
  requestId: 'rule-switch',
  props: {
    title: 'ルールスイッチ',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** エンジンの組んだ節の代わり (shared 2 本 + session 1 本) */
const BASE: PromptComposeSection[] = [
  { id: 'intro', text: 'You are Claude Code.', scope: 'shared' },
  { id: 'system', text: 'System rules.', scope: 'shared' },
  { id: 'memory', text: 'Memory of this session.', scope: 'session' },
]
const FACTS = { model: 'claude-test', promptModel: 'claude-test', surfaces: ['vscode' as const], tools: [], outputStyle: null, traits: [] }

/** エンジンの代わりに一番下で答える。store は手元の Map */
const boot = async ($: Engine, on: On, init?: unknown, opts: { start?: boolean } = {}) => {
  mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(init === undefined ? [] : [['save', init]])
  let sets = 0
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    sets++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: BASE }))
  if (opts.start !== false) await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return {
    raw: () => m.get('save'),
    saved: () => fromSaved(m.get('save')) ?? EMPTY,
    /** 別のセッションが書いたことにする */
    poke: (v: unknown) => m.set('save', v),
    sets: () => sets,
  }
}

const compose = async ($: Engine) => (await $.prompt.compose(FACTS)).sections

const svgOf = async (ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) =>
  String((await ui.find({ type: 'Svg' }))?.props.source ?? '')

test('純関数: 形の確かめ・制御文字・節の文・1 件だけ変える', () => {
  expect(fromSaved(undefined)).toEqual({ on: {}, custom: [] })
  expect(fromSaved('broken')).toBeUndefined()
  expect(fromSaved([])).toBeUndefined()
  expect(fromSaved({ on: [] })).toBeUndefined()
  expect(fromSaved({ custom: {} })).toBeUndefined()
  expect(fromSaved({})).toEqual({ on: {}, custom: [] })
  // 形の違う項目・決まったルールと同じ id・重複は捨てる
  expect(
    fromSaved({
      on: { ja: true, plan: false, x: 1 },
      custom: [{ id: 'c1', text: ' a\u0007\nb ' }, { id: 'c1', text: 'dup' }, { id: 'ja', text: 'bad' }, { id: 'c2', text: 3 }, 'x', { id: 'c3', text: '\u0001' }],
    }),
  ).toEqual({ on: { ja: true }, custom: [{ id: 'c1', text: 'a b' }] })

  expect(clean('a\u0000b\u0007c\u007f\td\r\ne')).toBe('abc d e')
  expect(clean('x'.repeat(500))).toHaveLength(MAX_TEXT)
  expect(BUILTIN.length).toBe(8)
  expect(new Set(BUILTIN.map(b => b.id)).size).toBe(8)

  expect(sectionText(EMPTY)).toBeNull()
  const s = withAdded(withToggle(withToggle(EMPTY, 'ja', true), 'nogit', true), { id: 'c1', text: '自作の約束' })
  expect(sectionText(s)).toBe(
    '# ユーザーが決めた約束ごと\nユーザーがルールスイッチでオンにした約束ごとです。この会話では次を守ってください。\n- 日本語で答える\n- git commit と git push をしない\n- 自作の約束',
  )
  expect(withToggle(s, 'ja', false).on).toEqual({ nogit: true, c1: true })
  expect(withRemoved(s, 'c1')).toEqual({ on: { ja: true, nogit: true }, custom: [] })
  // 知らない id のオンは節に入らない (別の画面で消した自分のルールなど)
  expect(sectionText({ on: { gone: true }, custom: [] })).toBeNull()
})

test('SVG: viewBox だけ、上限内、灯ったランプは脈打つ、制御文字なし', () => {
  const off = boardSvg(EMPTY)
  expect(off).not.toMatch(/<svg[^>]* width=/)
  expect(off).toContain('オン 0 個')
  expect(off).not.toContain('repeatCount="indefinite"') // 灯ったランプが無ければ脈打たない (1 回きりの出る動きはある)
  const many = { on: { ja: true as const }, custom: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, text: `<長い>${'約'.repeat(MAX_TEXT)}` })) }
  const svg = boardSvg(many)
  expect(svg).toContain('オン 1 個')
  expect(svg).toContain('ほか 20 個')
  expect(svg).toContain('&lt;長い&gt;')
  expect(svg).toContain('repeatCount="indefinite"')
  expect(svg.length).toBeLessThan(131_072)
  expect(boardSvg({ on: {}, custom: [{ id: 'c', text: 'a\u0007b' }] })).not.toMatch(CTRL)
})

test('prompt.compose: オンが 0 なら何も足さない。オンの物だけが 1 つの節として最後に入り、他の節はそのまま', async ($, on) => {
  await boot($, on)
  expect(await compose($)).toEqual(BASE)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'rule-ja' })
  await ui.press({ key: 'rule-nogit' })
  const sections = await compose($)
  expect(sections).toHaveLength(BASE.length + 1)
  expect(sections.slice(0, BASE.length)).toEqual(BASE)
  const last = sections[BASE.length]
  expect(last).toMatchObject({ id: SECTION_ID, scope: 'session' })
  expect(last?.text).toContain('- 日本語で答える')
  expect(last?.text).toContain('- git commit と git push をしない')
  expect(last?.text).not.toContain('答えは短く')
  expect(sections.filter(s => s.id === SECTION_ID)).toHaveLength(1)

  // 1 つ切ると、その文だけ消える。全部切ると元どおり
  await ui.press({ key: 'rule-ja' })
  expect((await compose($))[BASE.length]?.text).not.toContain('日本語で答える')
  await ui.press({ key: 'rule-nogit' })
  expect(await compose($)).toEqual(BASE)
})

test('prompt.compose: state をまだ読んでいなくても (/clear の後など) store のオンが入る', async ($, on) => {
  await boot($, on, { on: { short: true }, custom: [] }, { start: false })
  const sections = await compose($)
  expect(sections.at(-1)).toMatchObject({ id: SECTION_ID, scope: 'session' })
  expect(sections.at(-1)?.text).toContain('- 答えは短く、要点だけにする')
})

for (const surface of SURFACES) {
  test(`${surface}: ルールが並び、押すとオン (primary) になり数が変わる`, async ($, on) => {
    const { saved } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const b of BUILTIN) expect(await ui.find({ type: 'Button', key: `rule-${b.id}` })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'rule-ja' }))?.props.variant).toBe('secondary')
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('オン 0 個')
    else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'オン 0 個 / 全 8 個' })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^切り替えは次の依頼から効きます。/ })).toBeDefined()

    await ui.press({ key: 'rule-ja' })
    expect(saved().on).toEqual({ ja: true })
    const button = await ui.find({ type: 'Button', key: 'rule-ja' })
    expect(button?.props.variant).toBe('primary')
    expect(button?.props.label).toBe('● 日本語で答える')
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('オン 1 個')
      expect(svg).toContain('<animate')
    } else expect(await ui.find({ type: 'Text', text: 'オン 1 個 / 全 8 個' })).toBeDefined()

    await ui.press({ key: 'rule-ja' })
    expect(saved().on).toEqual({})
    expect((await ui.find({ type: 'Button', key: 'rule-ja' }))?.props.label).toBe('○ 日本語で答える')
  })

  test(`${surface}: 自分のルールを足す (制御文字は落ちる)・消すは 2 段押し`, async ($, on) => {
    const { saved } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: 'new', text: '  関数には\u0007日本語の\nコメント\u001b  ' })
    const added = saved().custom
    expect(added).toHaveLength(1)
    expect(added[0]?.text).toBe('関数には日本語の コメント')
    const id = added[0]?.id ?? ''
    // 足したらオン。節にそのまま入る
    expect(saved().on[id]).toBe(true)
    expect((await compose($)).at(-1)?.text).toContain('- 関数には日本語の コメント')
    expect((await compose($)).at(-1)?.text).not.toMatch(CTRL)
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('自作')
      expect(svg).not.toMatch(CTRL)
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).not.toMatch(CTRL)
    }
    expect((await ui.find({ type: 'Button', key: `rule-${id}` }))?.props.label).toBe('● 関数には日本語の コメント')

    // 空・空白だけは足さない
    await ui.input({ key: 'new', text: ' \u0007 ' })
    expect(saved().custom).toHaveLength(1)

    // 1 回目は消えない
    await ui.press({ key: `del-${id}` })
    expect(saved().custom).toHaveLength(1)
    expect((await ui.find({ type: 'Button', key: `del-${id}` }))?.props.label).toBe('本当に消す(もう一度押す)')
    // 間に別の操作を挟むと印は戻る
    await ui.press({ key: 'rule-ja' })
    expect((await ui.find({ type: 'Button', key: `del-${id}` }))?.props.label).toBe('消す')
    await ui.press({ key: `del-${id}` })
    await ui.press({ key: `del-${id}` })
    expect(saved().custom).toEqual([])
    expect(saved().on).toEqual({ ja: true })
    expect(await ui.find({ type: 'Button', key: `rule-${id}` })).toBeUndefined()
  })
}

test('mobile: 入力欄が無い画面でも切り替えはできる', async ($, on) => {
  const { saved } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ key: 'new' })).toBeUndefined()
  await ui.press({ key: 'rule-short' })
  expect(saved().on).toEqual({ short: true })
})

test('C1: 別のセッションが書いた切り替えと自分のルールを消さない', async ($, on) => {
  const { saved, poke } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'rule-ja' })
  // このセッションが開いた後に、別のセッションが nodep をオンにし、自分のルールを足した
  poke({ on: { ja: true, nodep: true, other: true }, custom: [{ id: 'other', text: '別の窓で足した' }] })
  await ui.press({ key: 'rule-plan' })
  expect(saved()).toEqual({ on: { ja: true, nodep: true, other: true, plan: true }, custom: [{ id: 'other', text: '別の窓で足した' }] })
  await ui.input({ key: 'new', text: '自分の窓で足した' })
  expect(saved().custom.map(c => c.text)).toEqual(['別の窓で足した', '自分の窓で足した'])
  // 画面も store に合わせて描き直る
  expect(await ui.find({ type: 'Text', text: 'オン 5 個 / 全 10 個' })).toBeDefined()
})

test('知らない欄 (新しい版が書いた物) は、ターンと切り替えの後も store に残る', async ($, on) => {
  const { raw } = await boot($, on, { ...EMPTY, on: { ja: true }, futureField: 1 })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.turn.start({ text: 'p', turnId: 't1' })
  await ui.press({ key: 'rule-plan' })
  // 書いたこと (plan がオンになった) と、知らない欄が残ったこと
  expect(raw() as object).toEqual({ futureField: 1, on: { ja: true, plan: true }, custom: [] })
})

test('C1: 同時に押しても 1 つも消えない', async ($, on) => {
  const { saved } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await Promise.all([ui.press({ key: 'rule-ja' }), ui.press({ key: 'rule-plan' }), ui.press({ key: 'rule-test' }), ui.input({ key: 'new', text: 'x' })])
  expect(Object.keys(saved().on).length).toBe(4)
  expect(saved().custom).toHaveLength(1)
})

test('C1: 別の窓で消された自分のルールはオンにしない', async ($, on) => {
  const { saved, poke } = await boot($, on, { on: {}, custom: [{ id: 'c1', text: 'あとで消える' }] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  poke({ on: {}, custom: [] })
  await ui.press({ key: 'rule-c1' })
  expect(saved()).toEqual({ on: {}, custom: [] })
  expect(await ui.find({ type: 'Text', text: 'そのルールは別の画面で消されました' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'rule-c1' })).toBeUndefined()
})

test('C1: store が読めない形なら書かずに知らせ、節も足さない', async ($, on) => {
  const { raw, sets } = await boot($, on, 'broken')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'rule-ja' })
  await ui.input({ key: 'new', text: 'x' })
  expect(raw()).toBe('broken')
  expect(sets()).toBe(0)
  expect(await ui.find({ type: 'Text', text: /記録を読めなかった/ })).toBeDefined()
  expect(await compose($)).toEqual(BASE)
})

test('ターンの始まりで、別のセッションの切り替えを読み直す (メインのターンだけ)', async ($, on) => {
  const { poke } = await boot($, on)
  poke({ on: { visual: true }, custom: [] })
  await $.turn.start({ text: 'p', turnId: 's1', agentId: 'sub-1' } as never)
  expect(await compose($)).toEqual(BASE)
  await $.turn.start({ text: 'p', turnId: 't1' } as never)
  expect((await compose($)).at(-1)?.text).toContain('- 説明には図や表を使う')
})

test('自分のルールの数と長さには上限がある。同じ文は足さない', async ($, on) => {
  const { saved } = await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'new', text: 'y'.repeat(1000) })
  expect(saved().custom[0]?.text).toHaveLength(MAX_TEXT)
  await ui.input({ key: 'new', text: '日本語で答える' })
  expect(saved().custom).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: '同じルールがもうあります' })).toBeDefined()
  for (let i = 1; i < MAX_CUSTOM + 3; i++) await ui.input({ key: 'new', text: `rule ${i}` })
  expect(saved().custom).toHaveLength(MAX_CUSTOM)
  expect(await ui.find({ type: 'Text', text: `自分のルールは ${MAX_CUSTOM} 個までです` })).toBeDefined()
})

const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('/rules を登録できればそれでペインを開く', async ($, on) => {
  mock.store(on)
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
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['rules'])
  expect(await $.command.run({ command: 'rules', ...run })).toMatchObject({ text: 'ルールスイッチを開きました。' })
  expect(opened).toEqual(['rule-switch:ルールスイッチ'])
})

test('C2: /rules が拒まれたら /rule-switch で開き、元の /rules は横取りしない', async ($, on) => {
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    if (e.name === 'rules') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.run', { command: 'rules' }, () => ({ text: '組み込みの rules' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(registered).toEqual(['rule-switch'])
  expect(await $.command.run({ command: 'rule-switch', ...run })).toMatchObject({ text: 'ルールスイッチを開きました。' })
  expect(await $.command.run({ command: 'rules', ...run })).toMatchObject({ text: '組み込みの rules' })
  expect(opened).toEqual(['rule-switch'])
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'rule-ja' })
  expect(await svgOf(ui)).toMatch(/fill="#ffffff"/)
  expect(await svgOf(ui)).toContain('fill="#1a7f37"/>') // 灯ったランプは明るい緑
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await svgOf(ui)).toMatch(/fill="#0d1117"/)
  expect(await svgOf(ui)).toContain('fill="#3fb950"/>')
})
