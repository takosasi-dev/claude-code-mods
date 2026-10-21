import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  KINDS,
  applyPending,
  countTool,
  countTurn,
  dayOf,
  EMPTY,
  fromSaved,
  isCommitCommand,
  isTestCommand,
  jstDate,
  lastDays,
  paneLines,
  paneSvg,
  questsFor,
  streakOf,
} from '../hooks/quest'
import { setTheme } from '../hooks/style'
import type { QuestDay, QuestKind, QuestSave } from '../types'

// JST で 2026-10-20 の 12:00
const NOW = Date.parse('2026-10-20T03:00:00Z')
const DATE = jstDate(NOW)
const DAY = 86_400_000
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'daily-quest',
  component: 'Pane',
  requestId: 'daily-quest',
  props: { title: 'きょうのお題', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

/** エンジンの代わりに一番下で答える。store は手元の Map、トーストは集める。Bash は command に FAIL があれば失敗 */
const boot = async ($: Engine, on: On, init?: unknown) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(init === undefined ? [] : [['quest', init]])
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // 作ったファイルは「ある」に変わる
  const files = new Set<string>(['D:\\work\\app\\old.ts'])
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('tool.call', (_$, e) => {
    const x = e as unknown as { command?: string; file_path?: string }
    if (x.command === 'DENY') return { deny: '断りました' } as never
    if (e.tool === 'Write' && x.file_path) files.add(x.file_path)
    return x.command?.includes('FAIL') ? { isError: true as const, result: 'x', text: 'x' } : { result: 'ok' as never }
  })
  // test の $ に state は無いので、書かれた値を下で拾う
  const state: Record<string, unknown> = {}
  on('state.set', async (_$, e, next) => {
    const r = await next(e)
    if (e.plugin === 'daily-quest' && r.value?.isSet) state[e.key] = e.value
    return r
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return {
    clock,
    toasts,
    stored: () => m.get('quest') as QuestSave | undefined,
    put: (v: unknown) => m.set('quest', v),
    today: () => state.today as QuestDay,
    streak: () => state.streak as number,
    total: () => state.totalDone as number,
  }
}

let n = 0
const call = ($: Engine, tool: string, input: Record<string, unknown> = {}, agentId?: string) =>
  $.tool.call({ tool, ...input, ...(agentId ? { agentId } : {}) } as never)

/** その種類を 1 回分こなすツール呼び出し (turns と clean はターンなので null) */
const unit = (kind: QuestKind): [string, Record<string, unknown>] | null =>
  kind === 'edits'
    ? ['Edit', { file_path: 'D:\\work\\app\\old.ts', old_string: 'a', new_string: 'b' }]
    : kind === 'tests'
      ? ['Bash', { command: 'npm test' }]
      : kind === 'commits'
        ? ['Bash', { command: 'git commit -m "x"' }]
        : kind === 'newFiles'
          ? ['Write', { file_path: `D:\\work\\app\\new-${++n}.ts`, content: 'x' }]
          : kind === 'reads'
            ? ['Read', { file_path: 'D:\\work\\app\\old.ts' }]
            : kind === 'shells'
              ? ['Bash', { command: 'ls' }]
              : null

const turn = async ($: Engine, body: () => Promise<unknown> = async () => {}, reason: 'answer' | 'aborted' = 'answer') => {
  const turnId = `t${++n}`
  await $.turn.start({ text: 'p', turnId })
  await body()
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: reason === 'aborted', turnId, reason } as never)
}

/** その日のお題を全部こなす */
const clearAll = async ($: Engine, date: string) => {
  for (const q of questsFor(date)) {
    const u = unit(q.kind)
    if (u) await turn($, async () => {
      for (let i = 0; i < q.goal; i++) await call($, ...u)
    })
    else for (let i = 0; i < q.goal; i++) await turn($)
  }
}

test('お題は日付だけで決まり、1 日 3 つで種類はかぶらない。種類は 8 以上', () => {
  expect(KINDS.length).toBeGreaterThanOrEqual(8)
  expect(questsFor(DATE)).toEqual(questsFor(DATE))
  const days = lastDays(DATE, 60)
  const seen = new Set<string>()
  for (const d of days) {
    const qs = questsFor(d)
    expect(qs).toHaveLength(3)
    expect(new Set(qs.map(q => q.kind)).size).toBe(3)
    for (const q of qs) {
      seen.add(q.kind)
      expect(q.id).toBe(`${q.kind}-${q.goal}`)
      expect(q.reward.exp).toBeGreaterThan(0)
      expect(q.reward.pulls).toBeGreaterThan(0)
    }
  }
  // 日によって違い、60 日あれば全部の種類が出る
  expect(new Set(days.map(d => questsFor(d).map(q => q.id).join(','))).size).toBeGreaterThan(30)
  expect(seen.size).toBe(KINDS.length)
})

test('数え方: テスト・コミット・新しいファイル。落ちたテストも走らせた数に入る', () => {
  for (const c of ['npm test', 'pnpm run test', 'npx vitest run', 'python -m pytest -q', 'cargo test', 'go test ./...', 'claude plugin test mods/x', 'node --test'])
    expect([c, isTestCommand(c)]).toEqual([c, true])
  for (const c of ['ls tests', 'git status', 'echo latest']) expect([c, isTestCommand(c)]).toEqual([c, false])
  expect(['git commit -m x', 'git -C D:/work commit --amend', 'git status', 'echo commit'].map(isCommitCommand)).toEqual([true, true, false, false])
  expect(countTool('Bash', 'npm test', true, false)).toEqual({ tests: 1 })
  expect(countTool('Bash', 'git commit -m x', false, false)).toEqual({ shells: 1, commits: 1 })
  expect(countTool('Bash', 'git commit -m x', true, false)).toEqual({})
  expect(countTool('Write', '', false, true)).toEqual({ edits: 1, newFiles: 1 })
  expect(countTool('Write', '', false, false)).toEqual({ edits: 1 })
  expect(countTool('Grep', '', false, false)).toEqual({ reads: 1 })
  expect(countTurn(0)).toEqual({ turns: 1, clean: 1 })
  expect(countTurn(2)).toEqual({ turns: 1 })
})

test('保存の形: 足し算・7 日より古い数は落とす・全部こなした日と連続日数', () => {
  expect(fromSaved('x')).toEqual(EMPTY)
  expect(fromSaved({ days: { [DATE]: { turns: 3, nope: 9, edits: -1 }, bad: { turns: 1 } }, fullDays: ['2026-10-19', 'x', 3], totalDone: 2.5 })).toEqual({
    days: { [DATE]: { turns: 3 } },
    fullDays: ['2026-10-19'],
    totalDone: 2,
  })
  const qs = questsFor(DATE)
  const all = Object.fromEntries(qs.map(q => [q.kind, q.goal]))
  const old = { days: { '2026-10-01': { turns: 4 } }, fullDays: ['2026-10-18', '2026-10-19'], totalDone: 6 }
  const half = applyPending(old, DATE, { [qs[0]!.kind]: qs[0]!.goal })
  expect(half.newly.map(q => q.id)).toEqual([qs[0]!.id])
  expect(half.isFull).toBe(false)
  expect(half.next.days['2026-10-01']).toBeUndefined()
  expect(half.next.totalDone).toBe(7)
  const full = applyPending(half.next, DATE, all)
  expect(full.newly).toHaveLength(2)
  expect(full.isFull).toBe(true)
  expect(full.next.fullDays).toEqual(['2026-10-18', '2026-10-19', DATE])
  expect(full.next.totalDone).toBe(9)
  // 2 度目は数えない
  expect(applyPending(full.next, DATE, all)).toMatchObject({ newly: [], isFull: false })

  expect(streakOf(['2026-10-18', '2026-10-19'], DATE)).toBe(2)
  expect(streakOf(['2026-10-18', '2026-10-19', DATE], DATE)).toBe(3)
  expect(streakOf(['2026-10-17', '2026-10-19'], DATE)).toBe(1)
  expect(streakOf(['2026-10-18'], DATE)).toBe(0)
  // 月をまたぐ
  expect(streakOf(['2026-09-30', '2026-10-01'], '2026-10-02')).toBe(2)
  expect(dayOf(DATE, { [qs[0]!.kind]: 999 }).quests[0]).toMatchObject({ progress: qs[0]!.goal, done: true })
})

test('作業でお題が進み、こなすとトースト。3 つ全部で連続日数が伸び、他の mod が読む state が置かれる', async ($, on) => {
  const { toasts, stored, today, streak, total } = await boot($, on, { days: {}, fullDays: [lastDays(DATE, 2)[0]], totalDone: 4 })
  expect(today().date).toBe(DATE)
  expect(today().quests.map(q => q.id)).toEqual(questsFor(DATE).map(q => q.id))
  expect(today().quests.every(q => !q.done && q.progress === 0)).toBe(true)
  // 昨日こなしていれば、今日はまだでも連続 1 日
  expect([streak(), total()]).toEqual([1, 4])

  await clearAll($, DATE)
  expect(today().quests.every(q => q.done && q.progress === q.goal)).toBe(true)
  for (const q of today().quests) {
    expect(Object.keys(q).sort()).toEqual(['done', 'goal', 'id', 'progress', 'reward', 'title'])
    expect(Object.keys(q.reward).sort()).toEqual(['exp', 'pulls'])
  }
  expect([streak(), total()]).toEqual([2, 7])
  expect(stored()).toMatchObject({ totalDone: 7, fullDays: [lastDays(DATE, 2)[0], DATE] })
  // こなしたお題ごとに 1 回、全部こなした時に 1 回
  expect(toasts).toEqual([...questsFor(DATE).map(q => `お題「${q.title}」をこなした`), 'きょうのお題を全部こなした。連続 2 日'])
  // こなした後に続けても、もう知らせない
  await clearAll($, DATE)
  expect(toasts).toHaveLength(4)
  expect(total()).toBe(7)
})

test('サブエージェント・中断したターン・断られたツールは数えない。失敗のあったターンは「失敗なし」に入らない', async ($, on) => {
  const { stored } = await boot($, on)
  const day = () => stored()?.days[DATE] ?? {}
  await turn($, () => call($, 'Read', {}, 'sub-1'))
  await turn($, () => call($, 'Bash', { command: 'DENY' }))
  expect(day()).toEqual({ turns: 2, clean: 2 })
  await turn($, () => call($, 'Bash', { command: 'npm test FAIL' }))
  expect(day()).toEqual({ turns: 3, clean: 2, tests: 1 })
  await turn($, () => call($, 'Read'), 'aborted')
  expect(day()).toEqual({ turns: 3, clean: 2, tests: 1, reads: 1 })
  // 次のターンでは失敗を数え直す
  await turn($)
  expect(day()).toMatchObject({ turns: 4, clean: 3 })
  // あったファイルへの Write は新しいファイルではない
  await turn($, () => call($, 'Write', { file_path: 'D:\\work\\app\\old.ts', content: 'x' }))
  expect(day()).toMatchObject({ edits: 1 })
  expect(day().newFiles).toBeUndefined()
})

test('ツールのたびには書かず、ターンの終わりに書く。別のセッションの進みを消さない', async ($, on) => {
  const { stored, put, today } = await boot($, on)
  await $.turn.start({ text: 'p', turnId: 'm1' })
  await call($, 'Read')
  expect(stored()).toBeUndefined()
  // ペインの進みには、まだ書いていない分も入る
  const reads = questsFor(DATE).find(q => q.kind === 'reads')
  if (reads) expect(today().quests.find(q => q.id === reads.id)?.progress).toBe(1)
  // 別のセッションがその間に書いた
  put({ days: { [DATE]: { reads: 5, turns: 2 } }, fullDays: [], totalDone: 1 })
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 'm1', reason: 'answer' } as never)
  expect(stored()?.days[DATE]).toEqual({ reads: 6, turns: 3, clean: 1 })
  expect(stored()?.totalDone).toBeGreaterThanOrEqual(1)
  // 同じ時にもう一度流しても二重に足さない
  await Promise.all([$.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } } as never), $.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } } as never)])
  expect(stored()?.days[DATE]).toEqual({ reads: 6, turns: 3, clean: 1 })
})

test('日付が変わると前の日の分を先に流し、新しい日のお題に替わる', async ($, on) => {
  const { clock, stored, today } = await boot($, on)
  await $.turn.start({ text: 'p', turnId: 'x1' })
  await call($, 'Read')
  await clock.advance(DAY)
  const next = jstDate(NOW + DAY)
  expect(today().date).toBe(next)
  expect(today().quests.map(q => q.id)).toEqual(questsFor(next).map(q => q.id))
  await call($, 'Read')
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 'x1', reason: 'answer' } as never)
  expect(stored()?.days[DATE]).toEqual({ reads: 1 })
  expect(stored()?.days[next]).toEqual({ reads: 1, turns: 1, clean: 1 })
})

for (const surface of SURFACES) {
  test(`${surface}: ペインにお題 3 つの進み・ごほうび・連続日数`, async ($, on) => {
    await boot($, on, { days: {}, fullDays: lastDays(DATE, 4).slice(0, 3), totalDone: 12 })
    const ui = await $.ui.mount({ ...PANE, surface })
    const qs = questsFor(DATE)
    if (surface === 'vscode') {
      const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(svg).toContain('きょうのお題')
      for (const q of qs) expect(svg).toContain(q.title)
      expect(svg).toContain(`ごほうび 経験値 +${qs[0]!.reward.exp} / ガチャ ${qs[0]!.reward.pulls} 回`)
      expect(svg).toContain('3 日')
      expect(svg).toContain('12 個')
      expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toMatch(/^きょうのお題 10\/20 連続 3 日 通算 12 個/)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'きょうのお題 10/20 連続 3 日 通算 12 個' })).toBeDefined()
      for (const q of qs) expect(await ui.find({ type: 'Text', text: new RegExp(`^まだ ${q.title} 0/${q.goal} `) })).toBeDefined()
    }
    await clearAll($, DATE)
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('>達成<')
    else expect((await ui.find({ type: 'Text', text: new RegExp(`^達成 ${qs[0]!.title}`) }))?.props.color).toBe('green')
  })
}

test('/quest を登録して開く。取れなければ /daily-quest にして、/quest は横取りしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'quest' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  on('command.run', { command: 'quest' }, () => ({ text: 'ほかの quest' }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['quest'])
  expect(await $.command.run({ command: 'quest', ...RUN })).toMatchObject({ text: 'きょうのお題を開きました。' })
  isTaken = true
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['quest', 'quest', 'daily-quest'])
  expect(await $.command.run({ command: 'quest', ...RUN })).toMatchObject({ text: 'ほかの quest' })
  expect(await $.command.run({ command: 'daily-quest', ...RUN })).toMatchObject({ text: 'きょうのお題を開きました。' })
})

test('store が読めない形なら書かずに知らせる', async ($, on) => {
  const { stored } = await boot($, on, 'broken')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await turn($, () => call($, 'Read'))
  expect(stored()).toBe('broken' as never)
  expect(await ui.find({ type: 'Text', text: /記録を読めなかった/ })).toBeDefined()
})

test('多い数と長い通算でも SVG は上限に収まり、行に制御文字が入らない', () => {
  const day = dayOf(DATE, Object.fromEntries(KINDS.map(k => [k.kind, 1e9])))
  const svg = paneSvg(day, 400, 1e6, lastDays(DATE, 400))
  expect(svg.length).toBeLessThan(131_072)
  expect(paneLines(day, 400, 1e6, []).every(l => !/[\x00-\x1f]/.test(l.text))).toBe(true)
  expect(paneSvg({ date: '', quests: [] }, 0, 0, [])).toContain('お題を読み込んでいます')
})

test('知らない欄 (新しい版が書いた物) は、1 ターン後も store に残る。その日の知らない種類の数も', async ($, on) => {
  const { stored } = await boot($, on, {
    ...EMPTY,
    futureField: 1,
    days: { [DATE]: { turns: 2, futureKind: 3 }, meta: { v: 2 } },
  })
  await turn($)
  // 書いたこと (ターンが増えた) と、知らない欄が残ったこと
  expect(stored() as object).toMatchObject({ futureField: 1, days: { [DATE]: { turns: 3, futureKind: 3 }, meta: { v: 2 } } })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/fill="#ffffff"/)
  expect(await source()).not.toMatch(/#0d1117/)
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await source()).toMatch(/fill="#0d1117"/)
  setTheme(false)
})
