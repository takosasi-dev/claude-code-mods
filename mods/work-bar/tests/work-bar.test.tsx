import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { barSvg, short } from '../hooks/svg'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const BAND = {
  plugin: 'work-bar',
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

// エンジンの代役を下に置き、入力欄に入った文を集める
const setup = (on: On, below?: string) => {
  const clock = mock.clock(on, { now: NOW })
  // 帯の下: 既定はエンジンが描く印 (誰も描かない)、below を渡すと別の mod の帯
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    if (below === undefined) return { type: 'engine', ref: 0 } as never
    const { Text } = $.ui.resolve(e)
    return <Text>{below}</Text>
  })
  const filled: { text: string; mode: string }[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.fill', ($, e) => {
    filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  return { clock, filled }
}

const start = ($: Engine, agentId?: string) =>
  $.turn.start({ text: 'やって', turnId: 't1', ...(agentId ? { agentId } : {}) })
const complete = ($: Engine, durationMs: number, agentId?: string) =>
  $.turn.complete({ answer: 'ok', durationMs, isAborted: false, turnId: 't1', reason: 'answer', ...(agentId ? { agentId } : {}) })

// まだ一度も書かれていない $.state の値を、前のモジュールが残した値に見せる(書かれた後は本物を返す)
const seed = (on: On, key: string, value: unknown) =>
  on('state.get', async (_$, e, next) => {
    const r = await next(e)
    return e.plugin === 'work-bar' && e.key === key && r.value?.version === 0 ? { value: { value, version: 0 } } : r
  })

// 主な表示を 1 本の文字列で取る (vscode は Svg の alt と source、terminal は Text)
type View = Pick<Mounted, 'find' | 'findAll'>
const shown = async (ui: View) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.alt)}\n${String(s.props.source)}`), ...texts.map(t => t.text)].join('\n')
}

test('待機中: 定型ボタンを押すと入力欄に入る(送信はしない)', async ($, on) => {
  const { filled } = setup(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    for (const label of ['続けて', 'テスト', 'レビュー', '要約', '隠す']) {
      expect(await ui.find({ type: 'Button', text: label })).toBeDefined()
    }
    await ui.press({ key: 'preset-1' })
    await ui.unmount()
  }
  expect(filled).toEqual([
    { text: 'テストを走らせて結果を教えて', mode: 'insert' },
    { text: 'テストを走らせて結果を教えて', mode: 'insert' },
  ])
})

test('実行中: 経過時間・ツール名・回数・エラーの点・帯の色', async ($, on) => {
  const { clock } = setup(on)
  let failNext = false
  const seenDuring: string[] = []
  const uis: View[] = []
  on('tool.call', async () => {
    for (const ui of uis) seenDuring.push(await shown(ui))
    return failNext ? ({ isError: true, result: 'boom', text: 'boom' } as never) : ({ result: 'ok', text: 'ok' } as never)
  })
  for (const surface of SURFACES) uis.push(await $.ui.mount({ ...BAND, surface }))

  await start($)
  for (const ui of uis) {
    const s = await shown(ui)
    expect(s).toContain('0:00')
    expect(s).toContain('考え中')
    expect(await ui.find({ type: 'Button', key: 'preset-0' })).toBeUndefined()
  }

  await clock.advance(61_000)
  for (const ui of uis) expect(await shown(ui)).toContain('1:01')

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  // ツール実行中は名前が出る
  for (const s of seenDuring) expect(s).toContain('Bash')
  for (const ui of uis) {
    const s = await shown(ui)
    expect(s).toContain('ツール 1回')
    expect(s).not.toContain('●')
    expect(s).not.toContain('attributeName="opacity"')
  }

  failNext = true
  await $.tool.call({ tool: 'Bash', command: 'false' })
  const [vs, term] = uis
  expect(await shown(vs!)).toContain('attributeName="opacity"') // 赤い点の点滅
  expect((await term!.find({ type: 'Text', text: /^● / }))?.props.color).toBe('red')

  // 帯の色: 120 秒まで青、超えたら黄、300 秒超で赤
  expect(await shown(vs!)).toContain('stop-color="#58a6ff"')
  await clock.advance(60_000)
  expect(await shown(vs!)).toContain('stop-color="#d29922"')
  await clock.advance(180_000)
  expect(await shown(vs!)).toContain('stop-color="#f85149"')
  expect(await shown(term!)).toContain('5:01')
})

test('終わると前のターンの要約に変わり、サブエージェントは数えない', async ($, on) => {
  setup(on)
  on('tool.call', () => ({ isError: true, result: 'x', text: 'x' }) as never)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await start($, 'sub-1') // サブエージェントのターンとツールは無視
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'sub-1' } as never)
  await complete($, 9_000, 'sub-1')
  await complete($, 125_000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const s = await shown(ui)
    expect(s).toContain('前のターン 2:05 / ツール 1回 / エラー 1件')
    expect(await ui.find({ type: 'Button', key: 'preset-0' })).toBeDefined()
    await ui.unmount()
  }
})

test('隠すで消え、/work-bar で戻る', async ($, on) => {
  setup(on)
  on('ui.render', () => <></>)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeUndefined()
    const res = await $.command.run({ command: 'work-bar', args: '' } as never)
    expect(res).toMatchObject({ text: '作業バーを表示しました。' })
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeDefined()
    await ui.unmount()
  }
})

test(
  '定型が多いと Select と「入れる」になる',
  { options: { presets: 'a=文A|b=文B|c=文C|d=文D|e=文E|f' } },
  async ($, on) => {
    const { filled } = setup(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Button', key: 'preset-0' })).toBeUndefined()
      await ui.select({ key: 'pick', value: '5' })
      await ui.press({ key: 'fill' })
      await ui.unmount()
    }
    expect(filled.map(f => f.text)).toEqual(['f', 'f'])
  },
)

test(
  '定型を減らして選んでいた番号が範囲外になったら 0 番に戻す(空文字を入れない)',
  { options: { presets: 'a=文A|b=文B|c=文C|d=文D|e=文E' } },
  async ($, on) => {
    const { filled } = setup(on)
    // 前の設定(6 本)で 5 番を選んでいた状態が $.state に残っている
    seed(on, 'pick', '5')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect((await ui.find({ key: 'pick' }))?.props.value).toBe('0')
      await ui.press({ key: 'fill' })
      await ui.unmount()
    }
    expect(filled.map(f => f.text)).toEqual(['文A', '文A'])
  },
)

test('ターンの途中でリロードしても経過時間が進む', async ($, on) => {
  const { clock } = setup(on)
  // リロード前のモジュールが残した「実行中」(タイマーはリロードで消えている)
  seed(on, 'run', { startedAt: NOW, elapsed: 0, calls: 0, errors: 0, active: [], lastError: false })
  await $.session.start({ cwd: '/tmp/demo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(5_000)
  expect(await shown(ui)).toContain('0:05')
  await ui.unmount()
})

test('アンケート中は譲る', async ($, on) => {
  setup(on)
  on('ui.render', () => <></>)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'vscode' })
  expect(await ui.find({ type: 'Button', key: 'hide' })).toBeUndefined()
})

test('ツール名の制御文字を SVG と表示から落とす', () => {
  const bad = `mcp__x${String.fromCharCode(7)}y${String.fromCharCode(27)}`
  expect(barSvg({ elapsed: 0, tool: bad, calls: 0, lastError: false })).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/)
  expect(short(bad)).toBe('mcp__xy')
})

test('帯を描く別の mod が下にいれば、その帯も自分の下に並べる', async ($, on) => {
  setup(on, '顔の帯')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Button', text: '続けて' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '顔の帯' })).toBeDefined()
    await ui.unmount()
  }
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  setup(on)
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(ui)).toContain('fill="#f6f8fa"') // 帯の面は明るい灰
  expect(await shown(ui)).toContain('stop-color="#0969da"') // 流れる光は明るい青
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await shown(ui)).toContain('fill="#161b22"')
  expect(await shown(ui)).toContain('stop-color="#58a6ff"')
})
