import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'
import type { RecapSummary, RecapTurn } from '../types'

const NOW = Date.parse('2026-10-03T07:15:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'session-recap',
  component: 'Pane',
  requestId: 'session-recap',
  props: {
    title: 'ふりかえり',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BLUE = '#58a6ff'
const ORANGE = '#f78166'
const PURPLE = '#bc8cff'
const RED = '#f85149'
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const SUMMARY_MD = '## やったこと\n- 帯を描いた\n## 決めたこと\n- 縦長にする\n## 残っていること\n- 実機で見る'

// エンジンの代わりに一番下で答えるフック
const bottom = (on: On) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'fail' ? { isError: true as const, result: 'boom' } : { result: 'ok' }))
}

// mod が書いた state を一番下で覗く
const spy = (on: On) => {
  const last: Record<string, unknown> = {}
  on('state.set', ($, e, next) => {
    if (e.plugin === 'session-recap') last[e.key] = e.value
    return next(e)
  })
  return last
}

type Clock = { advance: (ms: number) => Promise<void> }

/** メインのターンを 1 回流す。tools は [ツール名, Bash の command] */
const turn = async ($: Engine, clock: Clock, id: string, text: string, ms: number, tools: [string, string?][] = [], agentId?: string) => {
  const sub = agentId ? { agentId } : {}
  await $.turn.start({ text, turnId: id, ...sub })
  for (const [tool, command] of tools) {
    if (tool === 'Bash') await $.tool.call({ tool: 'Bash', command: command ?? 'ls', ...sub })
    else if (tool === 'Edit') await $.tool.call({ tool: 'Edit', file_path: '/tmp/demo/a.ts', old_string: 'a', new_string: 'b', ...sub })
    else await $.tool.call({ tool: 'Read', file_path: '/tmp/demo/a.ts', ...sub })
  }
  await clock.advance(ms)
  await $.turn.complete({ answer: 'ok', durationMs: ms, isAborted: false, turnId: id, reason: 'answer', ...sub })
}

/** 編集のターン → 3 分待ち → 実行(1 回失敗)のターン → 調べのターン */
const threeTurns = async ($: Engine, clock: Clock) => {
  await turn($, clock, 't1', '帯のタイムラインを作って', 4 * 60_000, [['Edit'], ['Edit'], ['Read']])
  await clock.advance(3 * 60_000)
  await turn($, clock, 't2', 'テストを走らせて', 2 * 60_000, [['Bash', 'ls'], ['Bash', 'fail']])
  await clock.advance(60_000)
  await turn($, clock, 't3', '型を調べて', 30_000, [['Read'], ['Read']])
}

type Found = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
const svgByAlt = async (ui: Found, alt: RegExp) => (await ui.findAll({ type: 'Svg' })).find(el => alt.test(String(el.props.alt)))?.props
const svgSource = async (ui: Found, alt: RegExp) => String((await svgByAlt(ui, alt))?.source ?? '')

const forkAnswer = (text: string): { value: ModelForkResult } => ({ value: { isAnswered: true, text, usage: USAGE } })

test('ターンを流すと一覧と帯が出る (サブエージェントは数えない)', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  await threeTurns($, clock)
  await turn($, clock, 'sub', 'サブの仕事', 99_000, [['Bash', 'ls']], 'agent-1')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // 一覧: 新しい順に 1 行 1 Button
    const rows = (await ui.findAll({ type: 'Button' })).filter(b => String(b.props.key ?? '').startsWith('turn-'))
    expect(rows.map(b => b.props.key)).toEqual(['turn-t3', 'turn-t2', 'turn-t1'])
    expect((await ui.find({ key: 'turn-t1' }))?.text).toMatch(/^\s*\d{1,2}:\d{2} 4分 帯のタイムラインを作って$/)
    expect((await ui.find({ key: 'turn-t2' }))?.text).toMatch(/^● \d{1,2}:\d{2} 2分 テストを走らせて$/)
    expect((await ui.find({ key: 'turn-t3' }))?.text).toMatch(/30秒 型を調べて$/)
    expect(await ui.find({ key: 'turn-sub' })).toBeUndefined()
    expect(await ui.find({ key: 'summarize' })).toBeDefined()

    if (surface === 'vscode') {
      expect((await svgByAlt(ui, /^経過/))?.alt).toBe('経過 0:12 ターン 3 ツール 7 エラー 1') // サブの 99 秒も経過には入る
      const totals = await svgSource(ui, /^経過/)
      expect(totals).toContain('最長 4分')
      expect(totals).toContain('待機中')
      const tl = await svgSource(ui, /^帯のタイムライン/)
      expect(tl).toContain(`fill="${BLUE}"/>`) // t1 は編集が一番多い
      expect(tl).toContain(`fill="${ORANGE}"/>`) // t2 は実行
      expect(tl).toContain(`fill="${PURPLE}"/>`) // t3 は調べ
      expect(tl).toContain(`<circle`) // エラーの印
      expect(tl).toContain(`r="4" fill="${RED}"`)
      expect(tl).toContain('stroke-dasharray="2 3"') // 待ち時間
      expect(tl).toContain('1行 = 2分')
      expect(tl).toContain('エージェント')
      expect(tl.length).toBeLessThan(131_072)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^経過/ }))?.text).toBe('経過 0:12 ターン 3 ツール 7 エラー 1')
      expect((await ui.find({ type: 'Text', text: /^最長/ }))?.text).toBe('最長 4分 帯のタイムラインを作って')
    }
    await ui.unmount()
  }
})

test('実行中のターンは点滅する帯と緑の印、合計は「実行中」', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  await $.turn.start({ text: '長い仕事', turnId: 'run' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(90_000)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgSource(vs, /^経過/)).toContain('実行中')
  expect(await svgSource(vs, /^帯のタイムライン/)).toContain('<animate attributeName="opacity"')
  expect((await vs.find({ key: 'turn-run' }))?.text).toMatch(/^● \d{1,2}:\d{2} 実行中 長い仕事$/)
  await vs.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^経過/ }))?.props.color).toBe('green')
})

test('スラッシュコマンドは「/名前」で記録し、ターンを起こさなかった古いコマンドは使わない', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  const last = spy(on)
  await $.prompt.submit({ text: '/review the diff', wait: false, origin: { kind: 'composer' }, command: { name: 'review', args: 'the diff' } })
  await turn($, clock, 'c1', '展開されたスキルの本文がここに来る', 10_000)
  // ターンを起こさない組み込みコマンドの後、時間が経ってから普通の依頼
  await $.prompt.submit({ text: '/status', wait: false, origin: { kind: 'composer' }, command: { name: 'status', args: '' } })
  await clock.advance(60_000)
  await turn($, clock, 'p1', 'ふつうの依頼', 10_000)

  const turns = last.turns as RecapTurn[]
  expect(turns.map(t => [t.label, t.prompt])).toEqual([
    ['/review', '/review the diff'],
    ['ふつうの依頼', 'ふつうの依頼'],
  ])
})

test('一覧の行を押すと詳細が開き、もう一度押すか「閉じる」で閉じる', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  const last = spy(on)
  const long = 'あ'.repeat(350)
  await turn($, clock, 'L', long, 5_000, [['Bash', 'ls'], ['Bash', 'fail'], ['Read']])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'summarize-upto' })).toBeUndefined()
    await ui.press({ key: 'turn-L' })
    expect(last.selected).toBe('L')
    expect((await ui.find({ type: 'Text', text: /^ツール:/ }))?.text).toBe('ツール: Bash 2、Read 1')
    expect((await ui.find({ type: 'Text', text: /^エラー/ }))?.text).toBe('エラー 1 回')
    expect((await ui.find({ type: 'Text', text: /^あ+…$/ }))?.text).toBe(`${'あ'.repeat(300)}…`)
    expect(await ui.find({ key: 'summarize-upto' })).toBeDefined()
    if (surface === 'vscode') expect(await svgSource(ui, /^帯のタイムライン/)).toContain('stroke-width="1.5"')
    await ui.press({ key: 'turn-L' })
    expect(last.selected).toBe(null)
    await ui.press({ key: 'turn-L' })
    await ui.press({ key: 'detail-close' })
    expect(last.selected).toBe(null)
    expect(await ui.find({ key: 'summarize-upto' })).toBeUndefined()
    await ui.unmount()
  }
})

test('「ここまでを要約」で fork の答えを Markdown で出し、「入力欄に入れる」で入力欄へ', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  const last = spy(on)
  const asked: string[] = []
  on('model.fork', ($, e) => {
    asked.push(e.prompt)
    return forkAnswer(SUMMARY_MD)
  })
  const filled: string[] = []
  on('prompt.fill', ($, e) => {
    filled.push(`${e.mode}:${e.text}`)
    return { isFilled: true }
  })
  await threeTurns($, clock)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') expect(await ui.find({ key: 'summary-fill' })).toBeUndefined()
    await ui.press({ key: 'summarize' })
    expect((last.summary as RecapSummary).status).toBe('done')
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(SUMMARY_MD)
    expect((await ui.find({ type: 'Text', text: /に作った要約/ }))?.text).toMatch(/要約\(ここまで\)$/)
    await ui.press({ key: 'summary-fill' })
    expect(filled.at(-1)).toBe(`insert:${SUMMARY_MD}\n`)
    expect((await ui.find({ type: 'Text', text: /^入力欄に/ }))?.text).toBe('入力欄に入れました(送信はしていません)')
    await ui.unmount()
  }
  expect(asked).toHaveLength(2)
  expect(asked[0]).toContain('## やったこと')
  expect(asked[0]).toContain('## 決めたこと')
  expect(asked[0]).toContain('## 残っていること')
  expect(asked[0]).not.toContain('対象は')
})

test('入力欄に入らなかった時は「入力欄に入れられませんでした」と出す', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  on('model.fork', () => forkAnswer('- まとめ'))
  on('prompt.fill', () => ({ isFilled: false, refusal: 'no_composer' as const }))
  await turn($, clock, 't1', '何か', 1_000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'summarize' })
    await ui.press({ key: 'summary-fill' })
    // フックが書いた refusal は site が落とす (エンジン自身の no_composer だけが届く) ので、ここでは理由なしの文になる
    expect((await ui.find({ type: 'Text', text: /^入力欄に/ }))?.text).toBe('入力欄に入れられませんでした')
    await ui.unmount()
  }
})

test('始まりを見ていないターンが後から足されても帯は枠の中に描く', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  await clock.advance(10 * 60_000)
  await turn($, clock, 't1', '後の依頼', 60_000)
  await $.turn.complete({ answer: 'a', durationMs: 20 * 60_000, isAborted: false, turnId: 'early', reason: 'answer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const tl = await svgSource(ui, /^帯のタイムライン/)
  const ys = [...tl.matchAll(/<rect x="[\d.]+" y="(-?[\d.]+)" width="[\d.]+" height="12"/g)].map(m => Number(m[1]))
  expect(ys.length).toBeGreaterThan(0)
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(44)
})

test('「この時点までを要約」は prompt にそのターンの時刻と依頼を入れる', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  const last = spy(on)
  const asked: string[] = []
  on('model.fork', ($, e) => {
    asked.push(e.prompt)
    return forkAnswer('- まとめ')
  })
  await threeTurns($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'turn-t2' })
  await ui.press({ key: 'summarize-upto' })
  const start = (last.turns as RecapTurn[]).find(t => t.turnId === 't2')!.start
  const d = new Date(start)
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  expect(asked[0]).toContain(`対象は ${hm} に始まったターン(依頼:「テストを走らせて」)まで`)
  expect((last.summary as RecapSummary).scope).toBe(`${hm} のターンまで`)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('- まとめ')
})

test('要約の失敗は理由を赤で出す', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  const answers: ModelForkResult[] = [
    { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE },
    { isAnswered: false, reason: 'nothing-to-fork' },
    { isAnswered: false, reason: 'empty-reply', usage: USAGE },
    { isAnswered: false, reason: 'aborted', usage: USAGE },
  ]
  const expected = [/API のエラー.*529 overloaded/, /まだ要約できるやり取りがありません/, /返答に文がありませんでした/, /中断されました/]
  let i = 0
  on('model.fork', () => ({ value: answers[i]! }))
  await turn($, clock, 't1', '何か', 1_000)
  for (; i < answers.length; i++) {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'summarize' })
      const err = await ui.find({ type: 'Text', text: /^要約できませんでした/ })
      expect(err?.props.color).toBe('red')
      expect(err?.text).toMatch(expected[i]!)
      expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
      expect(await ui.find({ key: 'summary-fill' })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('要約中は点滅する「要約中」を出し、二度押しでは呼ばない', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  const last = spy(on)
  let calls = 0
  let release = () => {}
  on('model.fork', () => {
    calls++
    return new Promise<{ value: ModelForkResult }>(r => (release = () => r(forkAnswer('- 済み'))))
  })
  await turn($, clock, 't1', '何か', 1_000)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const pressing = vs.press({ key: 'summarize' })
  for (let n = 0; n < 100 && (last.summary as RecapSummary | undefined)?.status !== 'running'; n++) await Promise.resolve()
  expect((last.summary as RecapSummary).status).toBe('running')
  expect(await svgSource(vs, /^要約中/)).toContain('<animate attributeName="opacity"')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: '要約中…' }))?.props.color).toBe('blue')
  await term.press({ key: 'summarize' }) // 走っている間の二度押し
  await term.unmount()
  release()
  await pressing
  expect((last.summary as RecapSummary).status).toBe('done')
  expect(calls).toBe(1)
})

test('記録は直近 100 ターンまで、/clear で空に戻る', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  bottom(on)
  const last = spy(on)
  for (let i = 0; i < 105; i++) await turn($, clock, `n${i}`, `依頼 ${i}`, 1_000)
  const turns = last.turns as RecapTurn[]
  expect(turns).toHaveLength(100)
  expect(turns[0]?.turnId).toBe('n5')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(last.turns).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgSource(ui, /^帯のタイムライン/)).toContain('まだターンがありません')
})

test('/recap が組み込みで拒まれたら /session-recap でペインを開き、/recap は横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  bottom(on)
  on('command.register', ($, e) => (e.name === 'recap' ? { deny: 'built-in' } : { value: { command: e.name } }))
  on('command.run', ($, e) => ({ text: `builtin ${e.command}` }))
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(`${e.id}:${e.title}`)
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  const run = (command: string) =>
    $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(await run('session-recap')).toMatchObject({ text: 'ふりかえりを開きました。' })
  expect(await run('recap')).toMatchObject({ text: 'builtin recap' })
  expect(opened).toEqual(['session-recap:ふりかえり'])
})

test('/recap を登録できた時は /recap で開く', async ($, on) => {
  mock.clock(on, { now: NOW })
  bottom(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  const r = await $.command.run({ command: 'recap', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(r).toMatchObject({ text: 'ふりかえりを開きました。' })
  expect(opened).toEqual(['session-recap'])
})
