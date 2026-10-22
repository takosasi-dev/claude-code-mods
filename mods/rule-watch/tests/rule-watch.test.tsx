import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { endsWithQuestion, isEnglish, mentionsDir, proseOf, questionLine } from '../hooks/rules'

const NOW = Date.parse('2026-10-22T05:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const MEMO = 'D:\\notes\\handoff'
const SET = { options: { memoDir: MEMO } }
const BAND = {
  plugin: 'rule-watch',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const
const PANE = {
  plugin: 'rule-watch',
  component: 'Pane',
  requestId: 'rule-watch',
  props: { title: '約束ごとの見張り', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const ENGLISH = 'I updated the README and the changelog, then ran all the tests. Everything passes now, and the release is ready to go.'
const JAPANESE = 'README と CHANGELOG を直して、試験を全部走らせました。すべて通っています。'
const ASKING = `${JAPANESE}\n\n続けて公開しますか？`

type World = { toasts: string[]; filled: string[]; registered: string[]; invalidated: string[]; below: 'none' | 'text' }

// エンジンの代役を下に置く (下の hook はテストの最初の $ より前に全部登録する)
const setup = (on: On, below: World['below'] = 'none') => {
  mock.clock(on, { now: NOW })
  const w: World = { toasts: [], filled: [], registered: [], invalidated: [], below }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_$, e) => {
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.invalidate', (_$, e) => {
    w.invalidated.push(e.event)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    w.filled.push(e.text)
    return { isFilled: true }
  })
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (w.below === 'text') return <Text>作業バー</Text>
    return { type: 'engine', ref: 0 } as never
  })
  return w
}

const begin = ($: Engine) => $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
/** メインの 1 ターン。中で fn (ツール呼び出し) をして、answer で終える */
const turn = async ($: Engine, answer: string, fn: () => Promise<unknown> = async () => {}) => {
  await $.turn.start({ text: 'やって', turnId: 't1' })
  await fn()
  await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
}
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const write = ($: Engine, file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x' } as never)
const ask = ($: Engine) =>
  $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '公開しますか？', header: '確認', multiSelect: false, options: [{ label: 'する', description: '' }, { label: 'しない', description: '' }] }] } as never)

type View = Pick<Mounted, 'findAll'>
const shown = async (ui: View) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.alt)}\n${String(s.props.source)}`), ...texts.map(t => t.text)].join('\n')
}
const band = async ($: Engine) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  await ui.unmount()
  return text
}

test('純関数: 英語の返事の見分け (コード・パス・URL は数えない)', () => {
  expect(isEnglish(ENGLISH)).toBe(true)
  expect(isEnglish(JAPANESE)).toBe(false)
  expect(isEnglish('Done.')).toBe(false)
  const codey = `直しました。\n\n\`\`\`ts\nexport function registerTheHooksForTheEngine(on: On) { return on('session.start') }\n\`\`\`\n\`D:\\github\\claude-code-mods\\mods\\rule-watch\\hooks\\register.tsx\` と https://github.com/takosasi-dev/claude-code-mods を見てください。`
  expect(isEnglish(codey)).toBe(false)
  expect(proseOf('a `code` b')).toBe('a   b')
  expect(proseOf('[x](https://e.com/a/b)')).toBe('[x]')
})

test('純関数: 文で質問して終わったかの見分け', () => {
  expect(endsWithQuestion(ASKING)).toBe(true)
  expect(endsWithQuestion('どれにしますか。')).toBe(true)
  expect(endsWithQuestion('直しました。')).toBe(false)
  expect(endsWithQuestion('次は公開でよいですか')).toBe(true)
  expect(endsWithQuestion('Shall I push it?')).toBe(true)
  expect(endsWithQuestion(`なぜ落ちたのか？ 原因は改行でした。\n\n直して、試験も通りました。\n\n以上です。`)).toBe(false)
  expect(endsWithQuestion('直しました。\n\n```\nwhat?\n```')).toBe(false)
  expect(endsWithQuestion('直しました。\n\n> 本当に？')).toBe(false)
  expect(questionLine(ASKING)).toBe('続けて公開しますか？')
  expect(mentionsDir('cp a.md "D:/notes/handoff/x.md"', MEMO)).toBe(true)
  expect(mentionsDir('cp a.md /d/notes/handoff/x.md', MEMO)).toBe(true)
  expect(mentionsDir('cp a.md /d/notes/handoff2/x.md', MEMO)).toBe(false)
})

test('英語の返事と文での質問を帯で知らせ、次のターンの頭で下ろす', async ($, on) => {
  const w = setup(on)
  await begin($)
  expect(w.registered).toContain('rulewatch')
  expect(w.invalidated).toContain('ui.render')
  await turn($, JAPANESE)
  expect(await band($)).toBe('')
  await turn($, `${ENGLISH}\n\nShall I push it now?`)
  expect(await band($)).toBe('約束ごと: 返事が英語でした ・ 選択肢を使わずに文で質問しました')
  await $.turn.start({ text: 'つぎ', turnId: 't2' })
  expect(await band($)).toBe('')
})

test('AskUserQuestion を使ったターンは、文で質問して終わっても知らせない', async ($, on) => {
  setup(on)
  await begin($)
  await turn($, ASKING, () => ask($))
  expect(await band($)).toBe('')
  await turn($, ASKING)
  expect(await band($)).toContain('選択肢を使わずに文で質問しました')
})

test('サブエージェントの返事と、中断・空の返事は見ない', async ($, on) => {
  setup(on)
  await begin($)
  await $.turn.start({ text: 'やって', turnId: 't1' })
  await $.turn.complete({ answer: ENGLISH, durationMs: 1, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'agent-1' })
  await $.turn.complete({ answer: ENGLISH, durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(await band($)).toBe('')
})

test('コミットの後に引き継ぎメモを書かないと知らせ、書いたら下ろす (数えるのは 1 回)', SET, async ($, on) => {
  setup(on)
  await begin($)
  await turn($, JAPANESE, () => bash($, 'git add -A && git commit -m "x"'))
  expect(await band($)).toBe('約束ごと: コミットの後、引き継ぎメモが未更新です')
  // 次のターンでも残る。英語の分とは別に出す
  await turn($, ENGLISH)
  expect(await band($)).toBe('約束ごと: 返事が英語でした ・ コミットの後、引き継ぎメモが未更新です')
  await write($, 'D:/notes/handoff/proj.md')
  expect(await band($)).toBe('約束ごと: 返事が英語でした')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = await shown(ui)
  expect(text).toContain('区切りで引き継ぎメモ: 1 回')
  expect(text).toContain('日本語で答える: 1 回')
})

test('シェルでメモのフォルダへ写しても書いたとみなす。メモのフォルダが無ければメモは見ない', SET, async ($, on) => {
  setup(on)
  await begin($)
  await turn($, JAPANESE, async () => {
    await bash($, 'git commit -m "x"')
    await bash($, 'cp /tmp/m.md "/d/notes/handoff/proj.md"')
  })
  expect(await band($)).toBe('')
})

test('メモのフォルダが無ければメモは見ない', async ($, on) => {
  setup(on)
  await begin($)
  await turn($, JAPANESE, () => bash($, 'git commit -m "x"'))
  expect(await band($)).toBe('')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = await shown(ui)
  expect(text).toContain('区切りで引き継ぎメモ(見ていない): 0 回')
  expect(text).toContain('memoDir に引き継ぎメモのフォルダを入れると始まります')
})

test('memoGraceTurns: 1 ならコミットの次のターンの終わりに知らせる', { options: { memoDir: MEMO, memoGraceTurns: 1 } }, async ($, on) => {
  setup(on)
  await begin($)
  await turn($, JAPANESE, () => bash($, 'git commit -m "x"'))
  expect(await band($)).toBe('')
  await turn($, JAPANESE)
  expect(await band($)).toBe('約束ごと: コミットの後、引き継ぎメモが未更新です')
})

test('設定で英語・質問の見張りを切れる', { options: { checkEnglish: false, checkQuestion: false } }, async ($, on) => {
  setup(on)
  await begin($)
  await turn($, `${ENGLISH}\n\nShall I push it now?`)
  expect(await band($)).toBe('')
})

test('帯は下の mod の帯の上に重ねる', async ($, on) => {
  setup(on, 'text')
  await begin($)
  await turn($, ENGLISH)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['約束ごと: 返事が英語でした', '作業バー'])
})

test('ペイン: 数と記録。「Claude に伝える」で入力欄に入れる', async ($, on) => {
  const w = setup(on)
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await shown(ui)).toContain('前の返事は約束どおりでした')
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
  await turn($, ASKING)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await vs.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('前の返事で 1 つ外れました')
  expect(String(svg?.props.alt)).toContain('・選択肢を使わずに文で質問しました(続けて公開しますか？)')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await shown(term)).toContain('14:00 選択肢を使わずに文で質問しました ─ 続けて公開しますか？')
  await term.press({ key: 'remind' })
  expect(w.filled[0]).toBe('さっきの返事は約束ごとから外れていました。\n- 確認は選択肢で聞く: 選択肢を使わずに文で質問しました(続けて公開しますか？)\n約束に沿って直してください。')
  expect(w.toasts).toEqual(['入力欄に入れました(送信はしていません)'])
})
