import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

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
const setup = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
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

test('アンケート中は譲る', async ($, on) => {
  setup(on)
  on('ui.render', () => <></>)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'vscode' })
  expect(await ui.find({ type: 'Button', key: 'hide' })).toBeUndefined()
})
