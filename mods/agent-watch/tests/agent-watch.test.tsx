import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { ListedAgent } from '../hooks/watch'
import { applyList, clean, countsOf, dur, onTurnComplete, onTurnStart, paneSvg } from '../hooks/watch'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
const BLUE = '#58a6ff'
const RED = '#f85149'
const GREEN = '#3fb950'
const presentation = { isFullscreen: false, columns: 80 }

const pane = (surface: (typeof SURFACES)[number], view: { agentId?: string } = {}) =>
  ({
    plugin: 'agent-watch',
    component: 'Pane',
    requestId: 'agent-watch',
    surface,
    props: {
      title: 'サブエージェント',
      isFocused: false,
      bodyColumns: 29,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view,
    },
  }) as const

type World = {
  list: ListedAgent[]
  isOpen: boolean
  listCalls: number
  views: { agentId?: string }[]
  viewDeny?: string
}

/** エンジンの代わりに一番下で答える */
const engine = (on: On, world: World, register?: (name: string) => string | undefined) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // register が理由を返したら、その名前の登録を断る
  on('command.register', (_$, e) => {
    const deny = register?.(e.name)
    return deny ? { deny } : { value: { command: e.name } }
  })
  on('agent.list', () => {
    world.listCalls++
    return { value: world.list }
  })
  on('ui.panes', () => ({
    value: world.isOpen ? [{ id: 'agent-watch', title: 'サブエージェント', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', () => {
    world.isOpen = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.view', (_$, e) => {
    world.views.push({ ...e })
    return { value: world.viewDeny ? { deny: world.viewDeny } : {} }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', (_$, e) =>
    e.tool === 'Bash' && e.command === 'fail'
      ? { isError: true as const, result: 'boom' }
      : e.tool === 'Bash' && e.command === 'deny'
        ? { deny: 'だめ' }
        : { result: 'ok' },
  )
}

const newWorld = (list: ListedAgent[] = []): World => ({ list, isOpen: false, listCalls: 0, views: [] })

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })

const subTurn = async ($: Engine, agentId: string, turnId: string) => $.turn.start({ text: 'p', turnId, agentId })
/** サブエージェントの中のツール。$.tool.call の型は agentId を取らないので、エンジンが付ける形をそのまま渡す */
const subTool = ($: Engine, agentId: string, input: { tool: string; [k: string]: unknown }) => $.tool.call({ ...input, agentId } as never)
const subEnd = async ($: Engine, agentId: string, turnId: string, durationMs: number, reason: 'answer' | 'error' | 'aborted' = 'answer') =>
  $.turn.complete({ answer: 'a', durationMs, isAborted: reason === 'aborted', turnId, reason, agentId })

type Found = { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }
const svgOf = async (ui: Found) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const altOf = async (ui: Found) => String((await ui.find({ type: 'Svg' }))?.props.alt ?? '')

const A1: ListedAgent = { id: 'a1', type: 'Explore', description: 'テストの場所を探す', status: 'running' }
const A2: ListedAgent = { id: 'a2', type: 'general-purpose', description: 'README を直す', status: 'running' }

test('純関数: 一覧を合わせる・終わり方・消えた物・経過の書き方', () => {
  expect(dur(0)).toBe('0:00')
  expect(dur(75_000)).toBe('1:15')
  expect(dur(3_725_000)).toBe('1:02:05')

  let a = applyList({}, [A1], NOW)
  expect(a.a1).toMatchObject({ type: 'Explore', status: 'running', isListed: true, startedAt: NOW })
  // 変わらなければ同じ物 (描き直さない)
  expect(applyList(a, [A1], NOW + 2000)).toBe(a)

  // 答えて終わったターンだけ「終わり」 (C5)
  expect(onTurnComplete(a, 'a1', NOW + 5000, 5000, 'answer').a1?.status).toBe('completed')
  expect(onTurnComplete(a, 'a1', NOW + 5000, 5000, 'error').a1?.status).toBe('failed')
  expect(onTurnComplete(a, 'a1', NOW + 5000, 5000, 'refusal').a1?.status).toBe('failed')
  expect(onTurnComplete(a, 'a1', NOW + 5000, 5000, 'aborted').a1?.status).toBe('killed')

  // 終わりを聞いた後に一覧がまだ「実行中」と言っても、終わりのまま
  a = onTurnComplete(a, 'a1', NOW + 5000, 5000, 'answer')
  expect(applyList(a, [A1], NOW + 6000).a1?.status).toBe('completed')
  // 動き出したら (turn.start) 実行中に戻る
  const again = onTurnStart(a, 'a1', NOW + 9000)
  expect(again.a1?.status).toBe('running')
  expect(again.a1?.endedAt).toBeUndefined()

  // 一覧から消えた動いている物は終わったとみなす
  const gone = applyList(applyList({}, [A1, A2], NOW), [A2], NOW + 3000)
  expect(gone.a1).toMatchObject({ status: 'completed', endedAt: NOW + 3000 })
  expect(gone.a2?.status).toBe('running')

  // turn.complete で初めて知った物は、所要時間から始まりを逆算する
  const late = onTurnComplete({}, 'z', NOW, 8000, 'answer')
  expect(late.z).toMatchObject({ startedAt: NOW - 8000, endedAt: NOW, durationMs: 8000 })

  // 一覧に出ない物 (エンジンの内部の fork) は数えない
  expect(countsOf(Object.values(late).filter(r => r.isListed)).done).toBe(0)
})

test('純関数: 外から来る文字の制御文字を落とす (C3)', () => {
  expect(clean('a\u0007b\bc\u001bd\u007fe')).toBe('abcde')
  expect(clean('一行目\n二行目\t三\r\n')).toBe('一行目 二行目 三') // 共通の clean (style.ts) は前後の空白も落とす
  const dirty: ListedAgent = { id: 'x', type: 'Exp\u0000lore\u001b', description: 'ベル\u0007と\n改行\fと<b>&"', status: 'failed' }
  const a = applyList({}, [dirty], NOW)
  expect(a.x?.type).toBe('Explore')
  expect(a.x?.description).toBe('ベルと 改行と<b>&"')
  const svg = paneSvg({ shown: Object.values(a), counts: countsOf(Object.values(a)), hidden: 0, now: NOW })
  expect(svg).not.toMatch(CTRL)
  expect(svg).toContain('&lt;b&gt;&amp;&quot;')
  expect(svg).toContain(`fill="${RED}"`)
})

test('SVG: 実行中は流れる縞、上限内、width を付けない', () => {
  const many = Array.from({ length: 40 }, (_, i): ListedAgent => ({ ...A1, id: `x${i}`, description: 'あ'.repeat(200) }))
  const a = applyList({}, many, NOW)
  const svg = paneSvg({ shown: Object.values(a), counts: countsOf(Object.values(a)), hidden: 0, now: NOW + 10_000 })
  expect(svg).toContain('attributeName="stroke-dashoffset"')
  expect(svg).toContain('repeatCount="indefinite"')
  // 2 秒ごとの描き直しで縞が跳ねないよう、位相は時刻から (begin が負)
  expect(svg).toMatch(/dur="0\.6s" begin="-0\.\d\ds"/)
  expect(svg).toContain(`stroke="${BLUE}"`)
  expect(svg).not.toMatch(/<svg[^>]* width=/)
  expect(svg.length).toBeLessThan(131_072)
  // 持つのは 30 体まで (終わった物から捨てる。全部動いていれば捨てずに描くのは 30 まで)
  expect((svg.match(/stroke-dasharray/g) ?? []).length).toBe(30)
})

for (const surface of SURFACES) {
  test(`${surface}: 0 体の時は「サブエージェントはまだいません」`, async ($, on) => {
    mock.clock(on, { now: NOW })
    engine(on, newWorld())
    const ui = await $.ui.mount(pane(surface))
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('サブエージェントはまだいません')
    else expect(await ui.find({ type: 'Text', text: 'サブエージェントはまだいません' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'main' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeDefined()
  })

  test(`${surface}: ツールの回数・最後のツール・エラーを数え、帯とボタンを出す`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = newWorld([A1])
    engine(on, world)
    await start($)
    await subTurn($, 'a1', 't1')
    await subTool($, 'a1', { tool: 'Read', file_path: '/tmp/demo/a.ts' })
    // サブエージェントが呼んだ Agent も (別のフックで) 数える
    await subTool($, 'a1', { tool: 'Agent', description: '孫', prompt: 'p' })
    await subTool($, 'a1', { tool: 'Bash', command: 'fail' })
    await subTool($, 'a1', { tool: 'Bash', command: 'deny' })
    // メインのツールは数えない
    await $.tool.call({ tool: 'Bash', command: 'fail' })
    await clock.advance(65_000)

    const ui = await $.ui.mount(pane(surface))
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('>Explore<')
      expect(svg).toContain('テストの場所を探す')
      expect(svg).toContain('1:05  ツール 4')
      expect(svg).toContain('最後 Bash')
      expect(svg).toContain(`<tspan fill="${RED}">エラー 1</tspan>`)
      expect(svg).toContain('attributeName="stroke-dashoffset"')
      expect(await altOf(ui)).toBe('動いている 1 / 終わった 0 / エラー 0')
      expect(await ui.find({ key: 'lines' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: '● Explore 実行中 1:05 ツール 4' }))?.props.color).toBe('blue')
      expect(await ui.find({ type: 'Text', text: '  テストの場所を探す / 最後 Bash / エラー 1' })).toBeDefined()
    }
    expect((await ui.find({ type: 'Button', key: 'view-a1' }))?.props.label).toBe('会話を見る: Explore テストの場所を探す')

    // 終わると緑、所要時間はターンの長さ
    await subEnd($, 'a1', 't1', 42_000)
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('0:42  ツール 4')
      expect(svg).toContain(`fill="${GREEN}"`)
      expect(await altOf(ui)).toBe('動いている 0 / 終わった 1 / エラー 0')
    } else expect((await ui.find({ type: 'Text', text: '○ Explore 終わり 0:42 ツール 4' }))?.props.color).toBe('green')
  })

  test(`${surface}: 「会話を見る」で view を切り替え、断られたら理由を出す`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const world = newWorld([A1, A2])
    engine(on, world)
    await start($)
    await subTurn($, 'a1', 't1')
    await subTurn($, 'a2', 't2')
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'view-a2' })
    expect(world.views).toEqual([{ agentId: 'a2' }])
    expect(await ui.find({ type: 'Text', text: /^切り替えられませんでした/ })).toBeUndefined()

    world.viewDeny = 'no agent holds the id'
    await ui.press({ key: 'view-a1' })
    expect(await ui.find({ type: 'Text', text: '切り替えられませんでした: no agent holds the id' })).toBeDefined()

    world.viewDeny = undefined
    await ui.press({ key: 'main' })
    expect(world.views[2]).toEqual({})
    expect(await ui.find({ type: 'Text', text: /^切り替えられませんでした/ })).toBeUndefined()
  })

  test(`${surface}: 見ている物は「表示中」、メインに戻るが主ボタン`, async ($, on) => {
    mock.clock(on, { now: NOW })
    engine(on, newWorld([A1, A2]))
    await start($)
    await subTurn($, 'a1', 't1')
    await subTurn($, 'a2', 't2')
    const ui = await $.ui.mount(pane(surface, { agentId: 'a2' }))
    expect((await ui.find({ type: 'Button', key: 'view-a2' }))?.props.label).toBe('表示中: general-purpose README を直す')
    expect((await ui.find({ type: 'Button', key: 'view-a1' }))?.props.label).toBe('会話を見る: Explore テストの場所を探す')
    expect((await ui.find({ type: 'Button', key: 'main' }))?.props.variant).toBe('primary')
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('表示中: general-purpose')
    await ui.unmount()
    const main = await $.ui.mount(pane(surface))
    expect((await main.find({ type: 'Button', key: 'main' }))?.props.variant).toBe('secondary')
  })

  test(`${surface}: 「終わった物を隠す」の切替`, async ($, on) => {
    mock.clock(on, { now: NOW })
    engine(on, newWorld([A1, { ...A2, status: 'completed' }]))
    await start($)
    await subTurn($, 'a1', 't1')
    await subTurn($, 'a2', 't2')
    await subEnd($, 'a2', 't2', 3000)
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Button', key: 'view-a2' })).toBeDefined()
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Button', key: 'view-a2' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'view-a1' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'hide' }))?.props.label).toBe('終わった物も出す')
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('終わった物を 1 体隠しています')
    await subEnd($, 'a1', 't1', 3000)
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('終わった物を隠しています (2 体)')
    else expect(await ui.find({ type: 'Text', text: '終わった物を隠しています (2 体)' })).toBeDefined()
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Button', key: 'view-a1' })).toBeDefined()
  })

  test(`${surface}: 制御文字を含む説明でも木が拒まれない (C3)`, async ($, on) => {
    mock.clock(on, { now: NOW })
    engine(on, newWorld([{ id: 'c1', type: 'Exp\u001blore', description: 'ベル\u0007\b\n改行', status: 'running' }]))
    await start($)
    await subTurn($, 'c1', 't1')
    const ui = await $.ui.mount(pane(surface))
    const label = String((await ui.find({ type: 'Button', key: 'view-c1' }))?.props.label)
    expect(label).toBe('会話を見る: Explore ベル 改行')
    if (surface === 'vscode') {
      expect(await svgOf(ui)).not.toMatch(CTRL)
      expect(await altOf(ui)).not.toMatch(CTRL)
    } else expect(await ui.find({ type: 'Text', text: '  ベル 改行 / 最後 なし / エラー 0' })).toBeDefined()
  })
}

test('一覧はペインが開いている間だけ 2 秒ごとに読み、経過時間を描き直す', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = newWorld([A1])
  engine(on, world)
  await start($)
  await clock.advance(10_000)
  expect(world.listCalls).toBe(0)

  // 新しいエージェントの始まりで 1 回だけ読む
  await subTurn($, 'a1', 't1')
  expect(world.listCalls).toBe(1)
  await clock.advance(10_000)
  expect(world.listCalls).toBe(1)

  // ペインを開くと 2 秒ごと
  world.isOpen = true
  const ui = await $.ui.mount(pane('vscode'))
  expect(await svgOf(ui)).toContain('0:10  ツール 0')
  await clock.advance(2000)
  expect(world.listCalls).toBe(2)
  expect(await svgOf(ui)).toContain('0:12  ツール 0')
  await clock.advance(4000)
  expect(world.listCalls).toBe(4)
  expect(await svgOf(ui)).toContain('0:16  ツール 0')

  // 一覧の状態の変化 (待ち) を拾う
  world.list = [{ ...A1, status: 'waiting' }]
  await clock.advance(2000)
  expect(await svgOf(ui)).toContain('>待ち<')

  // 閉じたら読まない
  world.isOpen = false
  await clock.advance(10_000)
  expect(world.listCalls).toBe(5)
})

test('/agents を登録できればそれでペインを開く', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world = newWorld()
  const registered: string[] = []
  engine(on, world, name => void registered.push(name))
  on('command.run', { command: 'agent-watch' }, () => ({ text: 'ほかの agent-watch' }))
  await start($)
  expect(registered).toEqual(['agents'])
  // /agents を持てた時は、/agent-watch をその名前の持ち主に回す (横取りしない)
  const other = await $.command.run({ command: 'agent-watch', args: '', origin: { kind: 'composer' }, presentation })
  expect(other).toMatchObject({ text: 'ほかの agent-watch' })
  expect(world.isOpen).toBe(false)
  const r = await $.command.run({ command: 'agents', args: '', origin: { kind: 'composer' }, presentation })
  expect(r).toMatchObject({ text: 'サブエージェントのペインを開きました。' })
  expect(world.isOpen).toBe(true)
})

test('/agents が拒まれたら /agent-watch で開き、/agents は横取りしない (C2)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world = newWorld()
  const registered: string[] = []
  engine(on, world, name => (name === 'agents' ? '組み込みのコマンドです' : void registered.push(name)))
  on('command.run', { command: 'agents' }, () => ({ text: '組み込みの agents' }))
  await start($)
  expect(registered).toEqual(['agent-watch'])
  const builtin = await $.command.run({ command: 'agents', args: '', origin: { kind: 'composer' }, presentation })
  expect(builtin).toMatchObject({ text: '組み込みの agents' })
  expect(world.isOpen).toBe(false)
  const own = await $.command.run({ command: 'agent-watch', args: '', origin: { kind: 'composer' }, presentation })
  expect(own).toMatchObject({ text: 'サブエージェントのペインを開きました。' })
  expect(world.isOpen).toBe(true)
})

test('エラーで終わったターンは「失敗」、中断は「止めた」 (C5)', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, newWorld([A1, A2]))
  await start($)
  await subTurn($, 'a1', 't1')
  await subTurn($, 'a2', 't2')
  await subEnd($, 'a1', 't1', 1000, 'error')
  await subEnd($, 'a2', 't2', 1000, 'aborted')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: '動いている 0 / 終わった 1 / エラー 1' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '○ Explore 失敗 0:01 ツール 0' }))?.props.color).toBe('red')
  expect(await ui.find({ type: 'Text', text: '○ general-purpose 止めた 0:01 ツール 0' })).toBeDefined()
})

test('/clear で記録を消す', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, newWorld([A1]))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await start($)
  await subTurn($, 'a1', 't1')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Button', key: 'view-a1' })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } } as never)
  expect(await ui.find({ type: 'Button', key: 'view-a1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'サブエージェントはまだいません' })).toBeDefined()
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, newWorld([A1]))
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await start($)
  await subTurn($, 'a1', 't1')
  const ui = await $.ui.mount(pane('vscode'))
  expect(await svgOf(ui)).toMatch(/fill="#ffffff"/)
  expect(await svgOf(ui)).toContain('stroke="#0969da"') // 実行中の縞は明るい青
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await svgOf(ui)).toMatch(/fill="#0d1117"/)
  expect(await svgOf(ui)).toContain(`stroke="${BLUE}"`)
})
