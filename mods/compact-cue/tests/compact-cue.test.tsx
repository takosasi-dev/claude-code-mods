import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { advise, contextOf, isCommit, isTest, isUnder, segments, unquote, wrap } from '../hooks/cue'

const NOW = Date.parse('2026-10-22T05:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const MEMO = 'D:\\notes\\handoff'
const SET = { options: { notifyPercent: 50, urgentPercent: 75, memoDir: MEMO } }
const BAND = {
  plugin: 'compact-cue',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const
const PANE = {
  plugin: 'compact-cue',
  component: 'Pane',
  requestId: 'compact-cue',
  props: { title: 'compact の合図', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const SUMMARY = { role: 'user', text: 'これまでの要約', toolUses: [] }

type World = { percent?: number; threshold?: number; failing: string[]; toasts: string[]; registered: string[]; invalidated: string[]; below: 'none' | 'text' }

// エンジンの代役を下に置く (下の hook はテストの最初の $ より前に全部登録する)
const setup = (on: On, below: World['below'] = 'none') => {
  mock.clock(on, { now: NOW })
  const w: World = { failing: [], toasts: [], registered: [], invalidated: [], below }
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
  // threshold を入れると、内訳 (自動 compact の位置) も返す
  on('session.usage', (_$, e) => {
    const tokens = w.percent === undefined ? undefined : w.percent * 2000
    const breakdown = e.breakdown && w.threshold ? { rawMaxTokens: 200_000, autoCompactThreshold: w.threshold } : undefined
    return { value: { startedAt: NOW, context: { percent: w.percent, tokens, window: 200_000, ...(breakdown ? { breakdown } : {}) }, rateLimits: [] } } as never
  })
  on('session.compact', (_$, e) => ({ messages: e.messages, tokensAfter: 30_000 }) as never)
  // failing に入れたコマンドはエラーで返す
  on('tool.call', (_$, e) => {
    const command = String((e as unknown as { command?: unknown }).command ?? '')
    if (w.failing.includes(command)) return { isError: true, result: 'Exit code 1', text: 'Exit code 1' } as never
    return { result: 'ok', text: 'ok' } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (w.below === 'text') return <Text>作業バー</Text>
    return { type: 'engine', ref: 0 } as never
  })
  return w
}

const begin = ($: Engine) => $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
/** メインの 1 ターン。中で fn (ツール呼び出し) をして、終わりに使用量を読ませる */
const turn = async ($: Engine, w: World, percent: number | undefined, fn: () => Promise<unknown> = async () => {}) => {
  w.percent = percent
  await $.turn.start({ text: 'やって', turnId: 't1' })
  await fn()
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
}

type View = Pick<Mounted, 'findAll'>
const shown = async (ui: View) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.alt)}\n${String(s.props.source)}`), ...texts.map(t => t.text)].join('\n')
}

test('純関数: 合図の段階', () => {
  const ctx = (percent?: number) => ({ percent, window: 200_000 })
  const brk = { kind: 'commit' as const, at: NOW }
  expect(advise(null, 'clean', null, 50, 75).level).toBe('ok')
  expect(advise(ctx(undefined), 'clean', null, 50, 75).level).toBe('ok')
  expect(advise(ctx(49), 'clean', brk, 50, 75).level).toBe('ok')
  expect(advise(ctx(50), 'clean', brk, 50, 75)).toEqual({ level: 'good', word: '区切りです。今が /compact のよい時です', reason: 'コミットの後' })
  expect(advise(ctx(80), 'clean', brk, 50, 75).level).toBe('now')
  expect(advise(ctx(60), 'mid', brk, 50, 75).level).toBe('wait')
  expect(advise(ctx(90), 'mid', brk, 50, 75).level).toBe('soon')
  expect(advise(ctx(60), 'clean', null, 50, 75).reason).toBe('まだ編集していません')
})

test('純関数: コミットとテストの見分け (引用符とヒアドキュメントの中は見ない)', () => {
  expect(isCommit('git commit -m "x"')).toBe(true)
  expect(isCommit(`git -c credential.helper= -c credential.helper='!gh auth git-credential' commit -m "x"`)).toBe(true)
  expect(isCommit('cd repo && GIT_AUTHOR_NAME=a git -C sub commit --amend')).toBe(true)
  expect(isCommit('& "C:\\Program Files\\Git\\bin\\git.exe" commit -m x')).toBe(false) // 引用符の中のパスは読めない
  expect(isCommit('git log --grep commit')).toBe(false)
  expect(isCommit('echo "git commit"')).toBe(false)
  expect(isCommit("git add -A && git commit -F - <<'EOF'\nfix\ngit commit this\nEOF")).toBe(true)
  expect(isCommit("cat <<'EOF'\ngit commit\nEOF")).toBe(false)
  expect(unquote("a <<'EOF'\nbody\nEOF\nb")).toBe('a  Q\nb')
  expect(segments('A=1 npm test; echo ok | tee x')).toEqual(['npm test', 'echo ok', 'tee x'])

  for (const c of ['npm test', 'npm run test -- --watch=false', 'pnpm test', 'npx vitest run', 'pytest -q', 'python -m pytest', 'cargo test', 'go test ./...', 'node --test', 'cd x && node --test tests/', 'claude.exe plugin test mods/a', 'C:\\x\\claude.exe plugin test mods/a', 'dotnet test', './gradlew test'])
    expect(isTest(c)).toBe(true)
  for (const c of ['npm install', 'git commit -m "npm test"', 'echo test', 'node build.mts']) expect(isTest(c)).toBe(false)

  expect(isUnder('D:/notes/handoff/a.md', MEMO)).toBe(true)
  expect(isUnder('d:\\Notes\\Handoff\\sub\\a.md', MEMO)).toBe(true)
  expect(isUnder('D:\\notes\\handoff2\\a.md', MEMO)).toBe(false)
  expect(isUnder('D:\\notes\\handoff\\a.md', '')).toBe(false)
})

test('使用量が少ない間は帯を出さない。下の帯はそのまま', SET, async ($, on) => {
  const w = setup(on, 'text')
  await begin($)
  expect(w.registered).toContain('cue')
  expect(w.invalidated).toContain('ui.render')
  await turn($, w, 30, () => $.tool.call({ tool: 'Bash', command: 'git commit -m x' }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const s = await shown(ui)
    expect(s).toContain('作業バー')
    expect(s).not.toContain('compact')
    await ui.unmount()
  }
  expect(w.toasts).toEqual([])
})

test('区切り (コミット) の後で使用量が多い: 帯とトースト 1 回。編集すると「待って」に変わる', SET, async ($, on) => {
  const w = setup(on)
  await begin($)
  await turn($, w, 62, () => $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "done"' }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await shown(ui)).toContain('コンテキスト 62% ─ 区切りです。今が /compact のよい時です')
    await ui.unmount()
  }
  expect(w.toasts).toEqual(['区切りです。今が /compact のよい時です(コンテキスト 62%、コミットの後)'])

  // 同じ段階のままなら 2 回目は出さない
  await turn($, w, 63)
  expect(w.toasts.length).toBe(1)

  // 編集すると途中
  await turn($, w, 66, () => $.tool.call({ tool: 'Edit', file_path: 'D:\\repo\\a.ts', old_string: 'a', new_string: 'b' } as never))
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(ui)).toContain('区切り(テスト・コミット)まで進めてから /compact')
  expect(w.toasts.length).toBe(1)

  // 落ちたテストは途中のまま、通ったテストで区切り。段階が変わったのでもう一度知らせる
  w.failing.push('npm test')
  await turn($, w, 70, () => $.tool.call({ tool: 'Bash', command: 'npm test' }))
  expect(await shown(ui)).toContain('まで進めてから')
  w.failing.length = 0
  await turn($, w, 80, () => $.tool.call({ tool: 'Bash', command: 'npm test' }))
  expect(await shown(ui)).toContain('コンテキスト 80% ─ 今 /compact してください')
  expect(w.toasts.at(-1)).toBe('今 /compact してください(コンテキスト 80%、テストが通った後)')
})

test('引き継ぎメモを書くと区切り (Write と、シェルでの写し)', SET, async ($, on) => {
  const w = setup(on)
  await begin($)
  await turn($, w, 60, () => $.tool.call({ tool: 'Write', file_path: 'D:\\repo\\a.ts', content: 'x' } as never))
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(ui)).toContain('まで進めてから')
  await turn($, w, 60, () => $.tool.call({ tool: 'Write', file_path: 'D:\\notes\\handoff\\repo.md', content: 'x' } as never))
  expect(await shown(ui)).toContain('今が /compact のよい時です')
  expect(w.toasts.at(-1)).toContain('引き継ぎメモを書いた後')

  await turn($, w, 60, () => $.tool.call({ tool: 'Edit', file_path: 'D:\\repo\\a.ts', old_string: 'a', new_string: 'b' } as never))
  await turn($, w, 60, () => $.tool.call({ tool: 'Bash', command: 'cp /tmp/m.md "/d/notes/handoff/repo.md"' }))
  expect(await shown(ui)).toContain('今が /compact のよい時です')
})

test('compact が済んだら合図を下ろし、compact 後の使用量を出す', SET, async ($, on) => {
  const w = setup(on)
  await begin($)
  await turn($, w, 70, () => $.tool.call({ tool: 'Edit', file_path: 'D:\\repo\\a.ts', old_string: 'a', new_string: 'b' } as never))
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(band)).toContain('まで進めてから')
  // 前もって作るだけの compact では下ろさない
  await $.session.compact({ trigger: 'precompute', messages: [SUMMARY] } as never)
  expect(await shown(band)).toContain('まで進めてから')
  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] } as never)
  expect(await shown(band)).not.toContain('compact')
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await shown(pane)).toContain('コンテキスト 15%')
})

test('ペイン: vscode は Svg、terminal は文字。合図の値と作業の様子が出る', SET, async ($, on) => {
  const w = setup(on)
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await shown(ui)).toContain('次の返事で使用量を読みます')
    await ui.unmount()
  }
  await turn($, w, 55, () => $.tool.call({ tool: 'Bash', command: 'git commit -m x' }))
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await vs.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('55%')
  expect(String(svg?.props.source)).toContain('コミット・テスト通過・メモ')
  expect(String(svg?.props.alt)).toContain('区切りです')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  const s = await shown(term)
  expect(s).toContain('コンテキスト 55%')
  expect(s).toContain('最後の区切り: 14:00 コミットの後')
  expect(s).toContain('合図は 50% から、75% で急ぎ')
})

test('サブエージェントのターンの終わりでは使用量を読まない', SET, async ($, on) => {
  const w = setup(on)
  await begin($)
  w.percent = 90
  await $.turn.start({ text: 'x', turnId: 'a1', agentId: 'sub' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'sub' })
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(ui)).not.toContain('compact')
  expect(w.toasts).toEqual([])
})

test('純関数: ペインの言葉の折り返しは /compact の途中で切らない', () => {
  expect(wrap('区切りです。今が /compact のよい時です', 26)).toEqual(['区切りです。今が /compact', 'のよい時です'])
  expect(wrap('残りが少ないです。次の区切りで必ず /compact', 26)).toEqual(['残りが少ないです。次の区切', 'りで必ず /compact'])
  expect(wrap('', 26)).toEqual([])
})

test('純関数: 自動 compact の位置を 100% にする', () => {
  expect(contextOf({ tokens: 120_000, window: 1_000_000, percent: 12 })).toEqual({ percent: 12, tokens: 120_000, window: 1_000_000 })
  expect(contextOf({ tokens: 120_000, window: 1_000_000, percent: 12, breakdown: { rawMaxTokens: 1_000_000, autoCompactThreshold: 160_000 } })).toEqual({ percent: 75, tokens: 120_000, window: 160_000, isAutoLimit: true })
  expect(contextOf({ tokens: 100_000, window: 1_000_000, percent: 10, breakdown: { rawMaxTokens: 200_000 } })).toEqual({ percent: 50, tokens: 100_000, window: 200_000 })
  expect(contextOf({ window: 1_000_000, breakdown: { rawMaxTokens: 200_000, autoCompactThreshold: 160_000 } }).percent).toBeUndefined()
})

test('自動 compact が窓より手前で走る時は、その位置に対する割合で知らせる', SET, async ($, on) => {
  const w = setup(on)
  w.threshold = 100_000
  await begin($)
  // 窓 (200k) に対しては 30% でも、自動 compact (100k) に対しては 60%
  await turn($, w, 30, () => $.tool.call({ tool: 'Bash', command: 'git commit -m x' }))
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await shown(band)).toContain('コンテキスト 60% ─ 区切りです')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await shown(pane)).toContain('100% は自動 compact が走る位置です')
})
