import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { PromptBookItem } from '../types'
import { arrange, chartSvg, fromSaved, parseTags, seeds, summaryLines, tagCounts, titleOf, topUses } from '../hooks/book'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'prompt-book',
  component: 'Pane',
  requestId: 'prompt-book',
  props: {
    title: 'プロンプト帳',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const item = (id: string, title: string, uses: number, createdAt: number, tags: string[] = [], lastUsedAt = 0): PromptBookItem => ({
  id,
  title,
  body: `${title}の本文`,
  tags,
  uses,
  lastUsedAt,
  createdAt,
})

/** store を手元の Map で答え、書かれた値を test から読めるようにする */
const fakeStore = (on: On, init: Record<string, unknown> = {}) => {
  const m = new Map<string, unknown>(Object.entries(init))
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return () => (m.get('items') ?? []) as PromptBookItem[]
}

/** 下の hook は全部ここで足す (test が $ を呼んだ後は足せない) */
const boot = async ($: Engine, on: On, opts: { items?: unknown; fill?: boolean; draft?: string } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const saved = fakeStore(on, opts.items === undefined ? {} : { items: opts.items })
  const filled: string[] = []
  let submitted = 0
  on('prompt.submit', (_$, e, next) => {
    submitted++
    return next(e)
  })
  on('prompt.fill', (_$, e) => {
    filled.push(`${e.mode}:${e.text}`)
    return opts.fill === false ? { isFilled: false } : { isFilled: true }
  })
  on('prompt.read', () => ({ value: { text: opts.draft ?? '', cursor: 0 } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return { clock, saved, filled, submitted: () => submitted }
}

type Ui = { find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }
const svgOf = async (ui: Ui) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const rowKeys = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('use:'))
const noticeOf = async (ui: Ui) => (await ui.find({ key: 'notice' }))?.text ?? ''

test('タグの分け方・題・読み戻し', () => {
  expect(parseTags(' a, b 、c，d, a ,')).toEqual(['a', 'b', 'c'])
  expect(parseTags('')).toEqual([])
  expect(titleOf('', '\n  一行目です\n二行目')).toBe('一行目です')
  expect(titleOf('  題  ', '本文')).toBe('題')
  expect(fromSaved(undefined)).toBeUndefined()
  expect(fromSaved({})).toBeUndefined()
  expect(fromSaved([])).toEqual([])
  const back = fromSaved([null, { body: '' }, { id: 'x', body: '本文だけ', tags: ['t', 3, 't', 'u', 'v', 'w'], uses: -1 }, { id: 'x', title: 'B', body: 'b', uses: 2.7 }])
  expect(back?.map(p => [p.id, p.title, p.tags, p.uses])).toEqual([
    ['x', '本文だけ', ['t', 'u', 'v'], 0],
    ['old3', 'B', [], 2],
  ])
  expect(seeds(NOW)).toHaveLength(5)
})

test('並び替え・絞り込み・上位・タグの件数', () => {
  const items = [item('a', 'いろは', 3, 1, ['x']), item('b', 'あいう', 3, 3, ['x', 'y'], 9), item('c', 'うえお', 0, 2, ['y']), item('d', 'かき', 7, 0)]
  expect(arrange(items, 'uses', '').map(p => p.id)).toEqual(['d', 'b', 'a', 'c'])
  expect(arrange(items, 'new', '').map(p => p.id)).toEqual(['b', 'c', 'a', 'd'])
  expect(arrange(items, 'title', '').map(p => p.id)).toEqual(['b', 'a', 'c', 'd'])
  expect(arrange(items, 'uses', 'y').map(p => p.id)).toEqual(['b', 'c'])
  expect(topUses(items).map(p => p.id)).toEqual(['d', 'b', 'a'])
  expect(tagCounts(items)).toEqual([
    { tag: 'x', count: 2 },
    { tag: 'y', count: 2 },
  ])
  expect(summaryLines(items)[1]).toBe('1. かき 7回')

  const svg = chartSvg(items, 'y', false)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('font-family="sans-serif"')
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
  expect((svg.match(/attributeName="width"/g) ?? []).length).toBe(3)
  expect(svg).toContain('>x 2<')
  expect(svg).not.toContain('保存しました')
  expect(chartSvg(items, '', true)).toContain('保存しました')
  expect(chartSvg([item('e', '<&>', 1, 0)], '', false)).toContain('&lt;&amp;&gt;')
  expect(chartSvg([], '', false)).toContain('まだ使った依頼文はありません')
})

for (const surface of SURFACES) {
  test(`${surface}: 初めは例が 5 件入り、主な要素を描く`, async ($, on) => {
    const { saved } = await boot($, on)
    expect(saved()).toHaveLength(5)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await rowKeys(ui)).toHaveLength(5)
    for (const key of ['tag', 'sort', 'title', 'body', 'tags', 'save', 'from-prompt']) expect(await ui.find({ key })).toBeDefined()
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(svg).toContain('プロンプト帳')
      expect(svg).toContain('まだ使った依頼文はありません')
      expect(svg).toContain('>テスト 2<')
      expect(await ui.find({ key: 'summary' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'プロンプト帳 5 件' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^タグ: テスト 2/ })).toBeDefined()
    }
  })

  test(`${surface}: 押すと入力欄に入り (送信しない)、使った回数が増える`, async ($, on) => {
    const { saved, filled, submitted } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'use:seed2' })
    await ui.press({ key: 'use:seed2' })
    expect(filled).toEqual(['insert:テストを走らせて結果を教えて', 'insert:テストを走らせて結果を教えて'])
    expect(submitted()).toBe(0)
    expect(saved().find(p => p.id === 'seed2')).toMatchObject({ uses: 2, lastUsedAt: NOW })
    expect(await noticeOf(ui)).toBe('「テストを走らせる」を入力欄に入れました(送信はしていません)')
    // よく使う順で先頭に来る
    expect((await rowKeys(ui))[0]).toBe('use:seed2')
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('>2回<')
    else expect(await ui.find({ type: 'Text', text: '1. テストを走らせる 2回' })).toBeDefined()
  })

  test(`${surface}: 入力欄に入らなければ数えず、理由を出す`, async ($, on) => {
    const { saved } = await boot($, on, { fill: false })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'use:seed1' })
    expect(saved().find(p => p.id === 'seed1')?.uses).toBe(0)
    expect(await noticeOf(ui)).toBe('入力欄に入れられませんでした(VS Code では拒まれることがあります)')
  })

  test(`${surface}: 題・本文・タグを入れて保存すると増え、光ってから消える`, async ($, on) => {
    const { saved, clock } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'save' })
    expect(await noticeOf(ui)).toBe('本文を入れてください')
    await ui.input({ key: 'title', text: '型を直す', kind: 'change' })
    await ui.input({ key: 'body', text: '型エラーを全部直して' })
    await ui.input({ key: 'tags', text: '型, テスト', kind: 'change' })
    await ui.press({ key: 'save' })
    const added = saved().at(-1)
    expect(added).toMatchObject({ title: '型を直す', body: '型エラーを全部直して', tags: ['型', 'テスト'], uses: 0, createdAt: NOW })
    expect(await rowKeys(ui)).toHaveLength(6)
    expect(await noticeOf(ui)).toBe('「型を直す」を保存しました')
    expect((await ui.find({ key: 'body' }))?.props.value).toBe('')
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('保存しました')
    else expect(await ui.find({ type: 'Text', text: /^保存しました$/ })).toBeDefined()
    await clock.advance(3000)
    if (surface === 'vscode') expect(await svgOf(ui)).not.toContain('保存しました')
    else expect(await ui.find({ type: 'Text', text: /^保存しました$/ })).toBeUndefined()
  })

  test(`${surface}: 消すは 2 段押し`, async ($, on) => {
    const { saved } = await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'del:seed3' })
    expect(saved()).toHaveLength(5)
    expect((await ui.find({ key: 'del:seed3' }))?.props.label).toBe('本当に消す')
    expect((await ui.find({ key: 'del:seed1' }))?.props.label).toBe('消す')
    await ui.press({ key: 'del:seed3' })
    expect(saved().map(p => p.id)).toEqual(['seed1', 'seed2', 'seed4', 'seed5'])
    expect(await ui.find({ key: 'use:seed3' })).toBeUndefined()
    expect(await noticeOf(ui)).toBe('「レビュー」を消しました')
  })

  test(`${surface}: タグで絞り、並びを変える`, async ($, on) => {
    await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'tag', value: 'テスト' })
    expect((await rowKeys(ui)).sort()).toEqual(['use:seed2', 'use:seed5'])
    await ui.select({ key: 'sort', value: 'title' })
    expect(await rowKeys(ui)).toEqual(arrange(seeds(NOW), 'title', 'テスト').map(p => `use:${p.id}`))
    await ui.select({ key: 'tag', value: '' })
    await ui.select({ key: 'sort', value: 'new' })
    expect(await rowKeys(ui)).toEqual(['use:seed1', 'use:seed2', 'use:seed3', 'use:seed4', 'use:seed5'])
    if (surface === 'vscode') {
      await ui.select({ key: 'tag', value: '要約' })
      expect(await svgOf(ui)).toContain('fill="#58a6ff" stroke="#58a6ff"')
    }
  })
}

test('「今の入力欄を保存」は入力欄の中身を本文にする (空なら理由を出す)', async ($, on) => {
  const { saved } = await boot($, on, { draft: '  ここまでの差分を説明して\n詳しく  ' })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.input({ key: 'tags', text: '説明', kind: 'change' })
  await ui.press({ key: 'from-prompt' })
  expect(saved().at(-1)).toMatchObject({ title: 'ここまでの差分を説明して', body: 'ここまでの差分を説明して\n詳しく', tags: ['説明'] })
})

test('入力欄が空なら「今の入力欄を保存」は保存しない', async ($, on) => {
  const { saved } = await boot($, on, { draft: '   ' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'from-prompt' })
  expect(saved()).toHaveLength(5)
  expect(await noticeOf(ui)).toMatch(/^入力欄が空か、読めませんでした/)
})

test('store に残した一覧を読み込み、例は足さない', async ($, on) => {
  const mine = [item('m1', '自分の', 4, 1, ['私'])]
  const { saved } = await boot($, on, { items: mine })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await rowKeys(ui)).toEqual(['use:m1'])
  expect(saved()).toEqual(mine)
})

test('/prompts で開き、拒まれたら /prompt-book にする', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'prompts' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  let opened = ''
  on('ui.open', (_$, e) => {
    opened = e.id
    return { value: { isPlaced: true as const } }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['prompts'])
  isTaken = true
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['prompts', 'prompts', 'prompt-book'])
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  const r = await $.command.run({ command: 'prompt-book', ...run })
  expect(r.text).toBe('プロンプト帳を開きました。')
  expect(opened).toBe('prompt-book')
})

// ---- 0.1.1 で直した物 ----

const mine = (n: number) => Array.from({ length: n }, (_, i) => item(`m${i}`, `t${i}`, 0, i))

/** store を手元の Map で答える。get / set を落とす切り替え付き */
const sharedStore = (on: On, init: Record<string, unknown>) => {
  const m = new Map<string, unknown>(Object.entries(init))
  const fail = { get: 0, set: 0 }
  on('store.get', (_$, e) => {
    if (fail.get > 0) {
      fail.get--
      return { deny: '読めない' }
    }
    return { value: m.get(e.key) }
  })
  on('store.set', (_$, e) => {
    if (fail.set > 0) {
      fail.set--
      return { deny: '書けない' }
    }
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return { m, fail }
}

test('別のセッションが足した依頼文は、このセッションで「使う」「保存」「消す」をしても消えない', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { m } = sharedStore(on, { items: mine(2) })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  // 窓 B が保存した (store に直接足す)
  const other = item('other', '別の窓', 3, 5)
  m.set('items', [...(m.get('items') as PromptBookItem[]), other])
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'use:m0' })
  const ids = () => (m.get('items') as PromptBookItem[]).map(x => x.id)
  expect(ids()).toEqual(['m0', 'm1', 'other'])
  expect((m.get('items') as PromptBookItem[]).find(x => x.id === 'other')?.uses).toBe(3)
  // 画面にも B の分が出る
  expect(await ui.find({ key: 'use:other' })).toBeDefined()
  // B がさらに使った回数を、A の写しで巻き戻さない
  m.set('items', (m.get('items') as PromptBookItem[]).map(x => (x.id === 'm0' ? { ...x, uses: 10 } : x)))
  await ui.press({ key: 'use:m0' })
  expect((m.get('items') as PromptBookItem[]).find(x => x.id === 'm0')?.uses).toBe(11)
  await ui.input({ key: 'body', text: '新しい依頼' })
  await ui.press({ key: 'save' })
  expect(ids()).toHaveLength(4)
  await ui.press({ key: 'del:m1' })
  await ui.press({ key: 'del:m1' })
  expect(ids()).toEqual(['m0', 'other', ids()[2]!])
})

test('同じ依頼文を続けて 2 回押すと 2 回と数える (書き込みを 1 本ずつ流す)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { m } = sharedStore(on, { items: mine(1) })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await Promise.all([ui.press({ key: 'use:m0' }), ui.press({ key: 'use:m0' })])
  for (let n = 0; n < 200; n++) await Promise.resolve()
  expect((m.get('items') as PromptBookItem[])[0]?.uses).toBe(2)
})

test('起動時に store を読めなくても、次の保存で保存済みを上書きしない', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { m, fail } = sharedStore(on, { items: mine(10) })
  fail.get = 1
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await noticeOf(ui)).toMatch(/読めませんでした/)
  await ui.input({ key: 'body', text: '新しい依頼' })
  await ui.press({ key: 'save' })
  expect(m.get('items') as PromptBookItem[]).toHaveLength(11)
})

test('書く直前に store を読めなければ書かずに知らせる', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { m, fail } = sharedStore(on, { items: mine(3) })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  fail.get = 1
  await ui.input({ key: 'body', text: '新しい依頼' })
  await ui.press({ key: 'save' })
  expect(m.get('items') as PromptBookItem[]).toHaveLength(3)
  expect(await noticeOf(ui)).toMatch(/読めなかったので保存しませんでした/)
  // 下書きは消さない
  expect((await ui.find({ key: 'body' }))?.props.value).toBe('新しい依頼')
})

test('store の値が配列でない時は例で上書きせず、書かない', async ($, on) => {
  mock.clock(on, { now: NOW })
  const broken = { items: mine(10) }
  const { m } = sharedStore(on, { items: broken })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  expect(m.get('items')).toEqual(broken)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await noticeOf(ui)).toMatch(/読めませんでした/)
  await ui.input({ key: 'body', text: '新しい依頼' })
  await ui.press({ key: 'save' })
  expect(m.get('items')).toEqual(broken)
})

test('store への書き込みが失敗したら知らせる', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { fail } = sharedStore(on, { items: mine(1) })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  fail.set = 1
  await ui.input({ key: 'body', text: '新しい依頼' })
  await ui.press({ key: 'save' })
  expect(await noticeOf(ui)).toMatch(/保存できませんでした/)
})

test('/prompts が拒まれた時は /prompts を組み込みに任せる (横取りしない)', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (e.name === 'prompts' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  on('command.run', (_$, e) => ({ text: `builtin ${e.command}` }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'prompts', ...run })).toMatchObject({ text: 'builtin prompts' })
  expect(await $.command.run({ command: 'prompt-book', ...run })).toMatchObject({ text: 'プロンプト帳を開きました。' })
})

test('タグのチップは 30 個まで、残りは「ほか N」', () => {
  const many = Array.from({ length: 40 }, (_, i) => item(`i${i}`, `t${i}`, 0, i, [`tag${String(i).padStart(2, '0')}`]))
  const svg = chartSvg(many, '', false)
  expect((svg.match(/>tag\d\d 1</g) ?? []).length).toBe(30)
  expect(svg).toContain('ほか 10')
})
