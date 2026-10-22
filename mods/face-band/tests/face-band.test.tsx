import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clean, faceSvg } from '../hooks/face'

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
type Opts = { denyFace?: boolean; below?: Below; stored?: Record<string, unknown>; now?: number }

// エンジンの代役を下に置く (下の hook はテストの最初の $ より前に全部登録する)
const setup = (on: On, opts: Opts = {}) => {
  const clock = mock.clock(on, { now: opts.now ?? NOW })
  // 何も渡さなければ、/face で出した後の人 (store に false) として始める
  const saved: Record<string, unknown> = { ...(opts.stored ?? { isHidden: false }) }
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

test('入れただけでは帯を出さず、下の mod の帯だけ。/face で出すと store に残る', async ($, on) => {
  const { saved } = setup(on, { stored: {}, below: 'text' })
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'face' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '作業バー' })).toBeDefined()
  const on1 = await $.command.run({ command: 'face', args: '', origin: { kind: 'composer' }, presentation })
  expect(on1).toMatchObject({ text: '顔の帯を出しました。' })
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
  const sources = moods.map(m => faceSvg(m))
  expect(new Set(sources).size).toBe(5)
  for (const s of sources) {
    expect(s).toContain('viewBox="0 0 96 72"')
    expect(s).not.toMatch(/<svg[^>]* width=/)
  }
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  setup(on)
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await begin($)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(ui)).toContain('fill="#f6f8fa" stroke="#656d76"') // 顔の面と、待ちの顔の明るい灰の縁
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  await ui.unmount()
  // setup が ui.invalidate を受け止めて描き直さないので、付け直して見る
  const again = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(again)).toContain('fill="#161b22" stroke="#8b949e"')
})

// ---- 0.4.0 時間帯と季節で小物が変わる ----

const jst = (s: string) => Date.parse(`${s}+09:00`)

test('夜の待ちは眠そう (目を閉じて z、ナイトキャップ)。terminal も眠そうな顔', async ($, on) => {
  setup(on, { now: jst('2026-10-20T22:00:00') })
  await begin($)
  const vs = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const svg = await shown(vs)
  expect(svg).toContain('id="nightcap"')
  expect(svg).toContain('id="sky-night"')
  expect(svg).toContain('>z<')
  expect(svg).not.toContain('attributeName="ry" values="4.5;4.5;0.6;4.5"') // 昼のまばたきではない
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await shown(term)).toContain('(-_-)zzz')
  // 夜でも考え中は目を開ける (帽子はそのまま)
  await start($)
  const busy = await shown(vs)
  expect(busy).toContain('id="nightcap"')
  expect(busy).not.toContain('>z<')
})

test('時計が進んで夕方から夜になると、描き直して小物が替わる', async ($, on) => {
  const { clock } = setup(on, { now: jst('2026-10-20T18:58:00') })
  await begin($)
  const vs = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(vs)).toContain('id="sky-evening"')
  expect(await shown(vs)).not.toContain('id="nightcap"')
  await clock.advance(3 * 60_000)
  expect(await shown(vs)).toContain('id="sky-night"')
  expect(await shown(vs)).toContain('id="nightcap"')
})

test('季節の小物: 春は花びら、夏は昼に麦わら帽子・夜に蛍、秋は葉、冬はマフラーと雪', () => {
  const has = (s: string, ids: string[]) => ids.filter(id => s.includes(`id="${id}"`))
  const all = ['petals', 'straw-hat', 'fireflies', 'leaves', 'scarf', 'snow', 'nightcap']
  expect(has(faceSvg('idle', '昼', '春'), all)).toEqual(['petals'])
  expect(has(faceSvg('idle', '昼', '夏'), all)).toEqual(['straw-hat'])
  expect(has(faceSvg('idle', '夜', '夏'), all)).toEqual(['fireflies', 'nightcap'])
  expect(has(faceSvg('idle', '朝', '秋'), all)).toEqual(['leaves'])
  expect(has(faceSvg('idle', '夕', '冬'), all)).toEqual(['scarf', 'snow'])
  // 朝・昼・夕・夜で空が違う (昼は何も無い)
  const skies = (['朝', '昼', '夕', '夜'] as const).map(p => faceSvg('happy', p, '秋'))
  expect(new Set(skies).size).toBe(4)
  expect(skies[1]).not.toContain('id="sky-')
  // 小物を足しても顔の円と viewBox は変わらない
  for (const s of skies) {
    expect(s).toContain('viewBox="0 0 96 72"')
    expect(s).toContain('<circle cx="48" cy="40" r="28"')
  }
})

// ---- 0.4.1 で直した物 ----

test('/face を持てた時は、/face-band をその名前の持ち主に回す (横取りしない)', async ($, on) => {
  const { saved } = setup(on)
  on('command.run', { command: 'face-band' }, () => ({ text: '別の face-band' }))
  await begin($)
  const other = await $.command.run({ command: 'face-band', args: '', origin: { kind: 'composer' }, presentation })
  expect(other).toMatchObject({ text: '別の face-band' })
  expect(saved.isHidden).toBe(false)
})

test('制御文字は C1 も落とす', () => {
  expect(clean('a\u0007b\u0085c\u009bd')).toBe('abcd')
})

// isStale は style.ts のモジュールの値を持つので、この試験は最後に置く
test('新しい版が入ったら、古い版のこのセッションは store に書かず、トーストで 1 回だけ開き直しを頼む', async ($, on) => {
  let version = '0.4.1'
  on('fs.read', (_$, e) => {
    if (e.path.replace(/\\/g, '/').endsWith('/plugin.json')) return { value: JSON.stringify({ name: 'face-band', version }) }
    throw new Error('ENOENT')
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const { saved, clock } = setup(on)
  await begin($)
  const face = () => $.command.run({ command: 'face', args: '', origin: { kind: 'composer' }, presentation })
  await face()
  expect(saved.isHidden).toBe(true)
  version = '0.5.0'
  await clock.advance(61_000)
  expect(await face()).toMatchObject({ text: '顔の帯を出しました。(新しい版が入ったので設定は残していません。VS Code を開き直してください)' })
  await face()
  expect(saved.isHidden).toBe(true)
  expect(toasts.filter(t => t.includes('開き直す'))).toHaveLength(1)
})
