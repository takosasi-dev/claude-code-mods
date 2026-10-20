import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { faceSvg } from '../hooks/face'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
const BAND = {
  plugin: 'face-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const
const presentation = { isFullscreen: false, columns: 80 }

type Below = 'none' | 'band' | 'text'
type Opts = { denyFace?: boolean; below?: Below; stored?: Record<string, unknown> }

// エンジンの代役を下に置く (下の hook はテストの最初の $ より前に全部登録する)
const setup = (on: On, opts: Opts = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: Record<string, unknown> = { ...opts.stored }
  const registered: string[] = []
  const invalidated: string[] = []
  const toolSeen: (() => Promise<void>)[] = []
  on('store.get', (_$, e) => ({ value: saved[e.key] }))
  on('store.set', (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_$, e) => {
    if (opts.denyFace && e.name === 'face') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.invalidate', (_$, e) => {
    invalidated.push(e.event)
    return { value: undefined }
  })
  on('tool.call', async () => {
    for (const f of toolSeen) await f()
    return { result: 'ok', text: 'ok' } as never
  })
  // 下の帯: none はエンジンの物 (誰も描かない) の印、band は work-bar のつもりの帯、text は 1 行
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    if (opts.below === 'band')
      return (
        <Box flexDirection="column">
          <Text>前のターン 0:05</Text>
          <Button key="wb-hide" label="隠す" onPress={() => {}} />
        </Box>
      )
    if (opts.below === 'text') return <Text>作業バー</Text>
    return { type: 'engine', ref: 0 } as never
  })
  return { clock, saved, registered, invalidated, toolSeen }
}

const begin = ($: Engine) => $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
const start = ($: Engine, agentId?: string) =>
  $.turn.start({ text: 'やって', turnId: agentId ? 'a1' : 't1', ...(agentId ? { agentId } : {}) })
const complete = ($: Engine, reason: 'answer' | 'error' | 'aborted', agentId?: string) =>
  $.turn.complete({
    answer: 'ok',
    durationMs: 5000,
    isAborted: reason === 'aborted',
    turnId: agentId ? 'a1' : 't1',
    reason,
    ...(agentId ? { agentId } : {}),
  })

// 見えている物を 1 本の文字列に (vscode は Svg の alt と source、両方で Text)
type View = Pick<Mounted, 'findAll'>
const shown = async (ui: View) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.alt)}\n${String(s.props.source)}`), ...texts.map(t => t.text)].join('\n')
}


test('待ち: まばたきの顔と一言 (vscode は Svg、terminal は文字)', async ($, on) => {
  setup(on)
  await begin($)
  const vs = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const svg = await vs.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('attributeName="ry"')
  expect(String(svg?.props.alt)).toContain('待っています')
  expect(await vs.find({ type: 'Text', text: '待っています' })).toBeDefined()
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await shown(term)).toContain('(・_・)')
})

test('ターンの流れ: 考え中 → ツール実行中 → 考え中 → にっこり 3 秒 → 待ち', async ($, on) => {
  const { clock, toolSeen } = setup(on)
  const uis: View[] = []
  const during: string[] = []
  toolSeen.push(async () => {
    for (const ui of uis) during.push(await shown(ui))
  })
  await begin($)
  for (const surface of SURFACES) uis.push(await $.ui.mount({ ...BAND, surface }))
  const [vs, term] = uis

  await start($)
  expect(await shown(vs!)).toContain('考え中')
  expect(await shown(vs!)).toContain('attributeName="opacity"') // 流れる点
  expect(await shown(term!)).toContain('(・_・)...')

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(during.length).toBe(2)
  for (const s of during) expect(s).toContain('Bash を実行中')
  expect(during[0]).toContain('type="rotate"') // 手が動く
  expect(during[1]).toContain('(;・_・)')
  // 終わったら考え中に戻り、最後のツールが残る
  expect(await shown(vs!)).toContain('考え中')
  expect(await shown(vs!)).toContain('最後のツール: Bash')

  await complete($, 'answer')
  expect(await shown(vs!)).toContain('できました')
  expect(await shown(term!)).toContain('(^_^)')
  await clock.advance(2900)
  expect(await shown(vs!)).toContain('できました')
  await clock.advance(200)
  expect(await shown(vs!)).toContain('待っています')
  expect(await shown(term!)).toContain('(・_・)')
})

test('エラー・中断はしょんぼり。3 秒の間に次のターンが始まったら戻さない', async ($, on) => {
  const { clock } = setup(on)
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await start($)
  await complete($, 'error')
  expect(await shown(ui)).toContain('エラーで止まりました')
  expect(await shown(ui)).toContain('#d29922')
  await clock.advance(3100)
  await start($)
  await complete($, 'aborted')
  expect(await shown(ui)).toContain('中断しました')
  await clock.advance(1000)
  await start($)
  await clock.advance(3000)
  expect(await shown(ui)).toContain('考え中') // 前のしょんぼりの時計で待ちに戻らない
})

test('サブエージェントのターンとツールでは顔を変えない', async ($, on) => {
  setup(on)
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  await start($, 'sub-1')
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'sub-1' } as never)
  await complete($, 'error', 'sub-1')
  const s = await shown(ui)
  expect(s).toContain('待っています')
  expect(s).not.toContain('Grep')
})

test('帯を描く別の mod が下にいる時: 顔を左、その木を右に並べる (両方見える)', async ($, on) => {
  setup(on, { below: 'band' })
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const s = await shown(ui)
    expect(s).toContain('待っています')
    expect(s).toContain('前のターン 0:05')
    expect(await ui.find({ type: 'Button', text: '隠す' })).toBeDefined()
    const root = await ui.drawn()
    expect(root.type === 'Box' && root.props?.flexDirection).toBe('row')
    expect(await ui.find({ key: 'face' })).toBeDefined()
    expect(await ui.find({ key: 'below' })).toBeDefined()
    await ui.unmount()
  }
})

test('下に誰もいない時は顔だけを描く', async ($, on) => {
  setup(on)
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'below' })).toBeUndefined()
    expect(await ui.find({ key: 'face' })).toBeDefined()
    await ui.unmount()
  }
})

test('/face で隠すと下の mod の帯だけが残り、もう一度で戻る。store に残す', async ($, on) => {
  const { saved, registered } = setup(on, { below: 'text' })
  await begin($)
  expect(registered).toEqual(['face'])
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await ui.find({ key: 'face' })).toBeDefined()
  const off = await $.command.run({ command: 'face', args: '', origin: { kind: 'composer' }, presentation })
  expect(off).toMatchObject({ text: '顔の帯を隠しました。' })
  expect(await ui.find({ key: 'face' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '作業バー' })).toBeDefined()
  expect(saved.isHidden).toBe(true)
  const back = await $.command.run({ command: 'face', args: '', origin: { kind: 'composer' }, presentation })
  expect(back).toMatchObject({ text: '顔の帯を出しました。' })
  expect(await ui.find({ key: 'face' })).toBeDefined()
  expect(saved.isHidden).toBe(false)
})

test('隠した設定は次のセッションでも効く', async ($, on) => {
  setup(on, { stored: { isHidden: true }, below: 'text' })
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'face' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '作業バー' })).toBeDefined()
})

test('/face が拒まれたら /face-band で切り替え、/face は横取りしない (C2)', async ($, on) => {
  const { registered } = setup(on, { denyFace: true })
  on('command.run', { command: 'face' }, () => ({ text: '組み込みの face' }))
  await begin($)
  expect(registered).toEqual(['face-band'])
  const own = await $.command.run({ command: 'face-band', args: '', origin: { kind: 'composer' }, presentation })
  expect(own).toMatchObject({ text: '顔の帯を隠しました。' })
  const other = await $.command.run({ command: 'face', args: '', origin: { kind: 'composer' }, presentation })
  expect(other).toMatchObject({ text: '組み込みの face' })
})

test('ツール名の制御文字を落とす (C3)', async ($, on) => {
  setup(on)
  await begin($)
  await start($)
  await $.tool.call({ tool: 'mcp__x__a\u0007b\u001bc', input: {} } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const s = await shown(ui)
    expect(s).toContain('最後のツール: mcp__x__abc')
    expect(CTRL.test(s)).toBe(false)
    await ui.unmount()
  }
})

test('アンケートが帯を使う時は譲る', async ($, on) => {
  setup(on, { below: 'text' })
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ key: 'face' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '作業バー' })).toBeDefined()
})

test('セッション開始とターン開始で帯の描き直しを頼む', async ($, on) => {
  const { invalidated } = setup(on)
  await begin($)
  expect(invalidated).toContain('ui.render')
  invalidated.length = 0
  await start($)
  expect(invalidated).toContain('ui.render')
})

test('顔の SVG は viewBox だけで、気分ごとに違う', () => {
  const moods = ['idle', 'think', 'tool', 'happy', 'sad'] as const
  const sources = moods.map(faceSvg)
  expect(new Set(sources).size).toBe(5)
  for (const s of sources) {
    expect(s).toContain('viewBox="0 0 96 72"')
    expect(s).not.toMatch(/<svg[^>]* width=/)
  }
})
