import type { ModelCompleteInput, ModelCompleteResult, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HaikuPoem } from '../types'
import { KIGO, askFor, cleanAnswer, columnsOf, digestOf, fileOf, jstMonth, kigoFor, mergePoems, poemsOf, seasonOf, shouldCompose, tanzakuSvg } from '../hooks/haiku'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const presentation = { isFullscreen: false, columns: 80 }
const HAIKU = '秋の夜 直したテストの 緑かな'
const PANE = {
  plugin: 'turn-haiku',
  component: 'Pane',
  requestId: 'turn-haiku',
  props: {
    title: 'ターンの俳句',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const answered = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })

type World = {
  store: Map<string, unknown>
  asked: ModelCompleteInput[]
  /** model.complete の答え (文字は断る理由)。1 件より多ければ順に使い、最後の 1 件は使い回す */
  answers: (ModelCompleteResult | string)[]
  failGet: boolean
  denyRegister?: string
  registered: string[]
  isOpen: boolean
}

/** エンジンの代わりに一番下で答える */
const engine = (on: On, init: Record<string, unknown> = {}, denyRegister?: string): World => {
  const w: World = { store: new Map(Object.entries(init)), asked: [], answers: [answered(HAIKU)], failGet: false, denyRegister, registered: [], isOpen: false }
  mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    if (w.denyRegister === e.name) return { deny: '組み込みのコマンドです' }
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', () => {
    w.isOpen = true
    return { value: { isPlaced: true as const } }
  })
  on('store.get', (_$, e) => (w.failGet ? { deny: '読めない' } : { value: w.store.get(e.key) }))
  on('store.set', (_$, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', (_$, e) => (e.tool === 'Bash' && e.command === 'deny' ? { deny: 'だめ' } : { result: 'ok' }))
  on('model.complete', (_$, e) => {
    w.asked.push(e)
    const a = w.answers.length > 1 ? w.answers.shift()! : w.answers[0]!
    return typeof a === 'string' ? { deny: a } : { value: a }
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
const poems = (w: World) => (w.store.get('poems') ?? []) as HaikuPoem[]

/** 詠みはターンの終わりを待たせずに走るので、終わるまで回す */
const settle = async () => {
  for (let i = 0; i < 2000; i++) await Promise.resolve()
}

type TurnOpts = { tools?: ['Read' | 'Edit' | 'Bash', string][]; ms?: number; reason?: 'answer' | 'aborted' | 'error'; answer?: string; agentId?: string }

/** ターンを 1 本流す。tools は [ツール名, パスか Bash のコマンド] */
const turn = async ($: Engine, id: string, o: TurnOpts = {}) => {
  // agentId はエンジンが付ける値なので、型の上では広げて渡す
  const sub = o.agentId ? { agentId: o.agentId } : {}
  await $.turn.start({ text: '依頼', turnId: id, ...sub })
  for (const [tool, arg] of o.tools ?? []) {
    if (tool === 'Bash') await $.tool.call({ tool: 'Bash', command: arg, ...sub })
    else if (tool === 'Edit') await $.tool.call({ tool: 'Edit', file_path: arg, old_string: 'a', new_string: 'b', ...sub })
    else await $.tool.call({ tool: 'Read', file_path: arg, ...sub })
  }
  const reason = o.reason ?? 'answer'
  await $.turn.complete({ answer: o.answer ?? '直しました。', durationMs: o.ms ?? 3_000, isAborted: reason === 'aborted', turnId: id, reason, ...sub })
  await settle()
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text)
const svgOf = async (ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) =>
  String((await ui.find({ type: 'Svg' }))?.props.source ?? '')

// ---------------------------------------------------------------- 純関数

test('詠む/詠まない の判定: メインで答えて終わり、ツール 1 回以上か 20 秒以上', () => {
  const e = (o: { reason?: string; agentId?: string; durationMs?: number }) => ({ reason: 'answer', durationMs: 3_000, ...o })
  expect(shouldCompose(e({}), 1)).toBe(true)
  expect(shouldCompose(e({}), 0)).toBe(false)
  expect(shouldCompose(e({ durationMs: 20_000 }), 0)).toBe(true)
  expect(shouldCompose(e({ durationMs: 19_999 }), 0)).toBe(false)
  for (const reason of ['aborted', 'error', 'refusal']) expect(shouldCompose(e({ reason }), 5)).toBe(false)
  expect(shouldCompose(e({ agentId: 'sub' }), 5)).toBe(false)
})

test('材料: ファイルは名前だけ、ツールは多い順、答えの頭は 300 字、制御文字を落とす', () => {
  expect(fileOf({ file_path: '/tmp/demo/src/a.ts' })).toBe('a.ts')
  expect(fileOf({ notebook_path: 'C:\\work\\n.ipynb' })).toBe('n.ipynb')
  expect(fileOf({ command: 'ls' })).toBe('')
  const d = digestOf('t1', new Map([['Read', 1], ['Edit', 3]]), ['a.ts'], 'x\u0007'.repeat(400), 42_000)
  expect(d.tools).toEqual([['Edit', 3], ['Read', 1]])
  expect(d.answerHead).toHaveLength(300)
  expect(d.answerHead).not.toMatch(CTRL)
  const { system, prompt } = askFor(d, 10)
  expect(system).toContain('五七五')
  expect(system).toContain('季語')
  expect(system).toContain('絵文字')
  expect(prompt).toContain('Edit 3 回、Read 1 回')
  expect(prompt).toContain('a.ts')
  expect(prompt).toContain('42 秒')
  expect(prompt).toContain('10 月')
})

test('答えの掃除: 制御文字・絵文字・かぎかっこを落とし、3 行はつなぎ、説明は捨て、40 字で切る', () => {
  expect(cleanAnswer(`「${HAIKU}」`)).toBe(HAIKU)
  expect(cleanAnswer('秋の夜\n直したテストの\n緑かな')).toBe('秋の夜 直したテストの 緑かな')
  expect(cleanAnswer(`${HAIKU}\n\nこの句は、テストが通った喜びを秋の夜に重ねて詠みました。季語は秋の夜です。`)).toBe(HAIKU)
  expect(cleanAnswer('秋の\u001b[31m夜\u0000 \u2728 緑かな')).not.toMatch(CTRL)
  expect(cleanAnswer('秋の夜 \u{1F41F} 緑かな')).toBe('秋の夜 緑かな')
  expect([...cleanAnswer('あ'.repeat(41))]).toHaveLength(40)
  expect(cleanAnswer('   \n\n')).toBe('')
})

test('store の合わせ方: 別のセッションの句を残し、同じ id は新しい方、古い順で 50 句まで、形が違えば書かない', () => {
  const p = (id: string, at: number, text = id): HaikuPoem => ({ id, at, text })
  expect(mergePoems([p('a', 1), p('b', 3)], [p('c', 2)])?.map(x => x.id)).toEqual(['a', 'c', 'b'])
  expect(mergePoems([p('a', 1, '古い')], [p('a', 5, '新しい')])).toEqual([p('a', 5, '新しい')])
  expect(mergePoems([p('a', 9, '別の窓')], [p('a', 5, 'こちら')])).toEqual([p('a', 9, '別の窓')])
  const many = Array.from({ length: 60 }, (_, i) => p(`t${i}`, i))
  const merged = mergePoems(many, [p('new', 100)])!
  expect(merged).toHaveLength(50)
  expect(merged[49]?.id).toBe('new')
  expect(merged[0]?.id).toBe('t11')
  expect(mergePoems(undefined, [p('a', 1)])).toEqual([p('a', 1)])
  expect(mergePoems({ x: 1 }, [p('a', 1)])).toBeUndefined()
  expect(mergePoems('壊れた', [p('a', 1)])).toBeUndefined()
  // 壊れた句は 1 つずつ捨てる、文字は掃除する
  expect(poemsOf([p('a', 1, 'よい\u0007句'), { id: 1, at: 2, text: 'x' }, null, { id: 'b', at: 'x', text: 'y' }])).toEqual([p('a', 1, 'よい句')])
})

test('短冊の SVG: 縦に 1 字ずつ、右の列から、viewBox だけ、制御文字なし、同じ句は同じ', () => {
  expect(columnsOf('秋の夜 直したテストの 緑かな')).toEqual([[...'秋の夜'], [...'直したテストの'], [...'緑かな']])
  expect(columnsOf('あ'.repeat(30)).map(c => c.length)).toEqual([13, 13, 4])
  const poem: HaikuPoem = { id: 't1', at: NOW, text: '秋の夜 直したテストの 緑かな' }
  const svg = tanzakuSvg(poem)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).not.toMatch(/<svg[^>]* width=/)
  expect(svg).toContain('font-family="sans-serif"')
  expect(svg).toBe(tanzakuSvg(poem))
  expect(svg.length).toBeLessThan(131_072)
  // 1 列目 (上五) が一番右、字は上から下へ
  const pos = (ch: string) => {
    const m = new RegExp(`<text x="([0-9.]+)" y="([0-9.]+)"[^>]*>${ch}<`).exec(svg)
    return { x: Number(m?.[1]), y: Number(m?.[2]) }
  }
  expect(pos('秋').x).toBeGreaterThan(pos('直').x)
  expect(pos('直').x).toBeGreaterThan(pos('緑').x)
  expect(pos('夜').y).toBeGreaterThan(pos('秋').y)
  // 墨がにじむ (ぼかしが引いていく)
  expect(svg).toContain('attributeName="stdDeviation"')
  // にじみの丸は広がりながら消え、終わった後に字の後ろへ残らない
  const blooms = [...svg.matchAll(/<animate attributeName="opacity" values="([^"]*)" dur="1\.4s"/g)].map(m => m[1])
  expect(blooms).toHaveLength([...'秋の夜直したテストの緑かな'].length)
  for (const v of blooms) expect(v?.split(';').at(-1)).toBe('0')
  // 外から来た字は掃除してエスケープする
  const bad = tanzakuSvg({ id: 'x', at: NOW, text: '<b>&\u0007"' })
  expect(bad).not.toMatch(CTRL)
  expect(bad).toContain('&lt;')
  expect(bad).not.toContain('<b>')
  expect(tanzakuSvg(undefined)).toContain('>ま<')
})

// ---------------------------------------------------------------- エンジン経由

test('ツールを使って答えたターンを 1 回だけ詠み、材料を渡し、store に日時と残す', async ($, on) => {
  const w = engine(on)
  await start($)
  await turn($, 't1', { tools: [['Read', '/tmp/demo/src/a.ts'], ['Edit', '/tmp/demo/src/a.ts'], ['Bash', 'npm test']], answer: 'テストが通りました。' })
  expect(w.asked).toHaveLength(1)
  const ask = w.asked[0]!
  expect(ask).toMatchObject({ model: 'haiku', effort: 'low', timeoutMs: 15_000 })
  expect(ask.prompt).toContain('Read 1 回')
  expect(ask.prompt).toContain('Bash 1 回')
  expect(ask.prompt).toContain('a.ts')
  expect(ask.prompt).not.toContain('/tmp/demo')
  expect(ask.prompt).toContain('テストが通りました。')
  expect(poems(w)).toEqual([{ id: 't1', at: NOW, text: HAIKU }])
})

test('20 秒以上かかったターンはツールなしでも詠み、短いターン・断られたツールだけのターンは詠まない', async ($, on) => {
  const w = engine(on)
  await start($)
  await turn($, 't1', { ms: 19_000 })
  await turn($, 't2', { ms: 5_000, tools: [['Bash', 'deny']] })
  expect(w.asked).toHaveLength(0)
  await turn($, 't3', { ms: 20_000 })
  expect(w.asked).toHaveLength(1)
  expect(poems(w).map(p => p.id)).toEqual(['t3'])
})

test('中断・エラー・サブエージェントのターンは詠まない (C5)', async ($, on) => {
  const w = engine(on)
  await start($)
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a.ts']], reason: 'aborted' })
  await turn($, 't2', { tools: [['Read', '/tmp/demo/a.ts']], reason: 'error' })
  await turn($, 'a1', { tools: [['Read', '/tmp/demo/a.ts']], ms: 60_000, agentId: 'sub' })
  expect(w.asked).toHaveLength(0)
  expect(w.store.get('poems')).toBeUndefined()
  // サブエージェントのツールはメインのターンの材料に入らない
  await $.turn.start({ text: '依頼', turnId: 't3' })
  const sub = { agentId: 'sub' }
  await $.tool.call({ tool: 'Read', file_path: '/tmp/demo/sub.ts', ...sub })
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't3', reason: 'answer' })
  await settle()
  expect(w.asked).toHaveLength(0)
})

test('「自動で詠む」をオフにすると詠まず、store に残り、次のセッションでもオフ', async ($, on) => {
  const w = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Button', key: 'auto' }))?.props.label).toBe('自動で詠む: オン')
  await ui.press({ key: 'auto' })
  expect(w.store.get('auto')).toBe(false)
  expect((await ui.find({ type: 'Button', key: 'auto' }))?.props.label).toBe('自動で詠む: オフ')
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a.ts']] })
  expect(w.asked).toHaveLength(0)
  // 詠み直すは自動でなくても使える
  await ui.press({ key: 'recompose' })
  expect(w.asked).toHaveLength(1)
  expect(poems(w)).toHaveLength(1)
})

test('store にオフが残っていれば、起動時からオフ', async ($, on) => {
  const w = engine(on, { auto: false })
  await start($)
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a.ts']] })
  expect(w.asked).toHaveLength(0)
})

test('詠めなかった時 (isAnswered: false・断られた・空の答え) は何も残さず、理由を弱い文字で出す', async ($, on) => {
  const w = engine(on)
  w.answers = [
    { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE },
    { isAnswered: false, reason: 'empty-reply', usage: USAGE },
    { isAnswered: false, reason: 'aborted', usage: USAGE },
    'model blocked',
    answered('\n\u0007\n'),
    answered(HAIKU),
  ]
  await start($)
  const expected = [/API のエラー 529 overloaded/, /答えが空でした/, /時間切れか中断/, /model blocked/, /答えに句がありませんでした/]
  for (const [i, re] of expected.entries()) {
    await turn($, `t${i}`, { tools: [['Read', '/tmp/demo/a.ts']] })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const note = await ui.find({ type: 'Text', text: /^詠めませんでした/ })
      expect(note?.text).toMatch(re)
      expect(note?.props.dimColor).toBe(true)
      await ui.unmount()
    }
    expect(w.store.get('poems')).toBeUndefined()
  }
  // 次に詠めたら理由は消える
  await turn($, 't9', { tools: [['Read', '/tmp/demo/a.ts']] })
  expect(poems(w)).toHaveLength(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^詠めませんでした/ })).toBeUndefined()
})

test('答えの制御文字は落として 40 字で残す (C3)、壊れた句が store にあってもペインは描ける', async ($, on) => {
  const w = engine(on, { poems: [{ id: 'old', at: NOW - 60_000, text: '古い\u0007句\u001b' }] })
  w.answers = [answered(`秋の\u0000夜${'あ'.repeat(60)}`)]
  await start($)
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a\u0007.ts']] })
  const saved = poems(w)
  expect(saved).toHaveLength(2)
  expect(saved[1]?.text).not.toMatch(CTRL)
  expect([...(saved[1]?.text ?? '')]).toHaveLength(40)
  expect(w.asked[0]?.prompt).not.toMatch(/a\u0007/)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const t of await texts(ui)) expect(t).not.toMatch(CTRL)
    if (surface === 'vscode') {
      expect(await svgOf(ui)).not.toMatch(CTRL)
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).not.toMatch(CTRL)
    }
    expect((await texts(ui)).some(t => t.includes('古い句'))).toBe(true)
    await ui.unmount()
  }
})

test('別のセッションが書いた句を消さずに足す (C1)、store の形が違えば上書きしない', async ($, on) => {
  const w = engine(on)
  await start($)
  // 別の窓が詠んだ
  w.store.set('poems', [{ id: 'other', at: NOW - 1000, text: '別の窓の句' }])
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a.ts']] })
  expect(poems(w).map(p => p.id)).toEqual(['other', 't1'])
  // 形が違う値は読めない扱い: 書かない。画面には出し、理由を出す
  w.store.set('poems', { broken: true })
  await turn($, 't2', { tools: [['Read', '/tmp/demo/a.ts']] })
  expect(w.store.get('poems')).toEqual({ broken: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /保存していません/ })).toBeDefined()
  // 読めない時も書かない
  w.store.set('poems', [])
  w.failGet = true
  await turn($, 't3', { tools: [['Read', '/tmp/demo/a.ts']] })
  expect(w.store.get('poems')).toEqual([])
})

test('季語: 季節ごとに 16 語以上で重なりなし、候補はその季節から 3 つ、JST の月で決める', () => {
  const all = Object.values(KIGO).flat()
  for (const list of Object.values(KIGO)) expect(list.length).toBeGreaterThanOrEqual(16)
  expect(new Set(all).size).toBe(all.length)
  expect(all.join('')).not.toMatch(/[\p{Extended_Pictographic}★☆♪]/u)
  expect([1, 2, 3, 5, 6, 8, 9, 11, 12].map(seasonOf)).toEqual(['冬', '冬', '春', '春', '夏', '夏', '秋', '秋', '冬'])
  // 11/30 15:30 UTC は JST の 12/1
  expect(jstMonth(Date.parse('2026-11-30T15:30:00Z'))).toBe(12)
  expect(jstMonth(Date.parse('2026-11-30T14:30:00Z'))).toBe(11)
  const picks = kigoFor('t1', 10)
  expect(picks).toHaveLength(3)
  expect(new Set(picks).size).toBe(3)
  for (const k of picks) expect(KIGO['秋']).toContain(k)
  expect(kigoFor('t1', 10)).toEqual(picks) // 詠み直しても同じ候補
  // ターンが変わると候補もばらける
  expect(new Set(Array.from({ length: 20 }, (_, i) => kigoFor(`t${i}`, 4).join())).size).toBeGreaterThan(10)
  const { prompt } = askFor(digestOf('t1', new Map(), [], '', 1_000), 10)
  expect(prompt).toContain(`季語はこの中から 1 つ選んでください: ${picks.join('、')}`)
  for (const k of KIGO['夏']) expect(prompt).not.toContain(k)
})

test('ターンの句を足しても、store の句の知らない欄 (新しい版が足した欄) は消さない', async ($, on) => {
  const w = engine(on, { poems: [{ id: 'old', at: NOW - 1000, text: '古い句', futureField: 1 }] })
  await start($)
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a.ts']] })
  const saved = w.store.get('poems') as (HaikuPoem & { futureField?: number })[]
  expect(saved.map(p => p.id)).toEqual(['old', 't1'])
  expect(saved[0]?.futureField).toBe(1)
  expect(w.asked[0]?.prompt).toMatch(/季語はこの中から 1 つ選んでください: /)
})

test('同時に 2 回詠んでも 1 本ずつ流し、どちらも残る', async ($, on) => {
  const w = engine(on)
  await start($)
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a.ts']] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  w.answers = [answered('一の句'), answered('二の句')]
  await Promise.all([ui.press({ key: 'recompose' }), turn($, 't2', { tools: [['Read', '/tmp/demo/b.ts']] })])
  await settle()
  expect(poems(w).map(p => p.id).sort()).toEqual(['t1', 't2'])
})

test('詠み直すと同じターンの句を置き換える', async ($, on) => {
  const w = engine(on)
  w.answers = [answered('一度目の句'), answered('二度目の句')]
  await start($)
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a.ts']] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '一度目の句' })).toBeDefined()
  await ui.press({ key: 'recompose' })
  expect(w.asked).toHaveLength(2)
  expect(poems(w)).toEqual([{ id: 't1', at: NOW, text: '二度目の句' }])
  expect(await ui.find({ type: 'Text', text: '二度目の句' })).toBeDefined()
})

for (const surface of SURFACES) {
  test(`${surface}: 句が無い時と、最新の句・過去の句の一覧・ボタンを描く`, async ($, on) => {
    const w = engine(on)
    w.answers = [answered('一の句'), answered('二の句'), answered('三の句')]
    await start($)
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await texts(ui)).some(t => t.includes('まだ一句も詠んでいません'))).toBe(surface === 'terminal')
    expect(await ui.find({ type: 'Button', key: 'recompose' })).toBeUndefined()
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('>ま<')
    await ui.unmount()
    for (const id of ['t1', 't2', 't3']) await turn($, id, { tools: [['Read', '/tmp/demo/a.ts']] })
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'auto' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'recompose' })).toBeDefined()
    const all = await texts(ui)
    expect(all).toContain('過去の句')
    // 過去の一覧は新しい順で、最新の句は入れない
    const past = all.filter(t => /の句$/.test(t) && /\d+:\d\d/.test(t))
    expect(past.map(t => t.slice(-3))).toEqual(['二の句', '一の句'])
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('>三<')
      expect(svg).not.toContain('>二<')
      expect(await ui.find({ type: 'Text', text: '三の句' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '三の句' })).toBeDefined()
    }
  })
}

test('/config の theme が light 系なら明るい壁で描き、切り替えにも付いていく。短冊の紙は同じ色', async ($, on) => {
  engine(on)
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await start($)
  await turn($, 't1', { tools: [['Read', '/tmp/demo/a.ts']] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const light = await svgOf(ui)
  expect(light).toContain('stop-color="#ffffff"')
  expect(light).toContain('stop-color="#f6eedb"')

  theme = 'dark'
  await $.config.set({
    key: 'theme',
    value: 'dark',
    previous: 'light',
    provider: { plugin: 'core', tier: 'core' } as never,
    origin: { kind: 'composer' },
  })
  const dark = await svgOf(ui)
  expect(dark).toContain('stop-color="#0d1117"')
  expect(dark).toContain('stop-color="#f6eedb"')
})

test('/haiku でペインを開く', async ($, on) => {
  const w = engine(on)
  await start($)
  expect(w.registered).toEqual(['haiku'])
  const r = await $.command.run({ command: 'haiku', args: '', origin: { kind: 'composer' }, presentation })
  expect(r).toMatchObject({ text: '俳句のペインを開きました。' })
  expect(w.isOpen).toBe(true)
})

test('/haiku が拒まれたら /turn-haiku で開き、/haiku は横取りしない (C2)', async ($, on) => {
  const w = engine(on, {}, 'haiku')
  on('command.run', { command: 'haiku' }, () => ({ text: '別の haiku' }))
  await start($)
  expect(w.registered).toEqual(['turn-haiku'])
  const other = await $.command.run({ command: 'haiku', args: '', origin: { kind: 'composer' }, presentation })
  expect(other).toMatchObject({ text: '別の haiku' })
  expect(w.isOpen).toBe(false)
  const own = await $.command.run({ command: 'turn-haiku', args: '', origin: { kind: 'composer' }, presentation })
  expect(own).toMatchObject({ text: '俳句のペインを開きました。' })
  expect(w.isOpen).toBe(true)
})
