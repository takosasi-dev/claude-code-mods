import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { INPUT_SCHEMA, LIMIT, SVG_SOURCE_MAX, barSvg, fmt, hhmm, lineSvg, parseShow, pieSvg, svgProblem, tableSvg, ticks } from '../hooks/canvas'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const TOOL = 'mcp__canvas-pane__show'
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'canvas-pane',
  component: 'Pane',
  requestId: 'canvas-pane',
  props: {
    title: 'キャンバス',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

const BAR = { title: '月ごとの売上', kind: 'bar', labels: ['1月', '2月', '3月'], values: [120, 135, 160] }

/** 型を外した入力 (モデルは何でも送れる) */
const bad = (input: Record<string, unknown>) => {
  const r = parseShow(input)
  return 'error' in r ? r.error : ''
}

type World = { registered: { name: string; description: string; inputSchema: Record<string, unknown> }[]; opened: string[]; isPlaced: boolean }

/** エンジンの代わりに一番下で答える */
const boot = async ($: Engine, on: On, opts: { isCanvasTaken?: boolean } = {}) => {
  mock.clock(on, { now: NOW })
  const world: World = { registered: [], opened: [], isPlaced: true }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => {
    world.registered.push({ name: e.name, description: e.description, inputSchema: e.inputSchema })
    return { value: { tool: `mcp__canvas-pane__${e.name}` } }
  })
  on('command.register', (_$, e) =>
    e.name === 'canvas' && opts.isCanvasTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } },
  )
  on('ui.open', (_$, e) => {
    world.opened.push(e.id)
    return { value: world.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: '画面が 144 桁より狭いので待っています' } }
  })
  await $.session.start({ cwd: '/tmp/demo', surface: 'vscode', isInteractive: true })
  return world
}

const show = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input })

test('純関数: 数の見せ方と目盛り', () => {
  expect([fmt(1234567), fmt(0.12345), fmt(-1500.26), fmt(0)]).toEqual(['1,234,567', '0.123', '-1,500.3', '0'])
  expect(ticks(0, 160)).toEqual([0, 50, 100, 150, 200])
  expect(ticks(-30, 70)).toEqual([-50, -25, 0, 25, 50, 75])
  expect(ticks(5, 5)).toEqual([0, 2, 4, 6])
  expect(ticks(0, 0)).toEqual([0, 0.25, 0.5, 0.75, 1])
})

test('入力: 断る物ごとに、直し方の分かる理由を返す', () => {
  expect(bad({ kind: 'bar' })).toContain('title は文字列')
  expect(bad({ title: '  ', kind: 'bar' })).toContain('title が空')
  expect(bad({ title: 'x'.repeat(81), kind: 'bar' })).toContain('80 字まで')
  expect(bad({ title: 't', kind: 'scatter' })).toContain('kind は bar / line / pie / table / markdown / svg')
  expect(bad({ title: 't', kind: 7 })).toContain('今は number')
  expect(bad({ title: 't', kind: 'bar', values: [1] })).toContain('labels が要ります')
  expect(bad({ title: 't', kind: 'bar', labels: ['a', 'b'], values: [1] })).toContain('labels 2 件に対し values が 1 件')
  expect(bad({ title: 't', kind: 'bar', labels: ['a'], values: ['1'] })).toContain('values[0] が数ではありません')
  expect(bad({ title: 't', kind: 'line', labels: ['a'], values: [null] })).toContain('今は null')
  expect(bad({ title: 't', kind: 'bar', labels: ['a', 'b'], values: [1, -1e300] })).toContain('values[1] が数ではありません(±1e15 まで')
  expect(bad({ title: 't', kind: 'table', columns: ['c'], rows: [[1e16]] })).toContain('±1e15 まで')
  expect(bad({ title: 't', kind: 'line', labels: ['a', 'b'], values: [{ name: 's', values: [1, Infinity] }] })).toContain('values[0].values[1] が数ではありません')
  expect(bad({ title: 't', kind: 'line', labels: ['a'], values: [1, { name: 's', values: [1] }] })).toContain('values[0] は { "name"')
  expect(bad({ title: 't', kind: 'bar', labels: Array(51).fill('a'), values: Array(51).fill(1) })).toContain('labels は 50 件まで')
  expect(bad({ title: 't', kind: 'bar', labels: ['x'.repeat(41)], values: [1] })).toContain('labels[0] は 40 字まで')
  const seven = Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, values: [1] }))
  expect(bad({ title: 't', kind: 'bar', labels: ['a'], values: seven })).toContain('系列は 6 本まで')
  expect(bad({ title: 't', kind: 'pie', labels: Array(11).fill('a'), values: Array(11).fill(1) })).toContain('labels は 10 件まで')
  expect(bad({ title: 't', kind: 'pie', labels: ['a'], values: [{ name: 'a', values: [1] }, { name: 'b', values: [1] }] })).toContain('pie は系列 1 つだけ')
  expect(bad({ title: 't', kind: 'pie', labels: ['a', 'b'], values: [3, -1] })).toContain('負の数')
  expect(bad({ title: 't', kind: 'pie', labels: ['a', 'b'], values: [0, 0] })).toContain('合計が 0')
  expect(bad({ title: 't', kind: 'table', rows: [['a']] })).toContain('columns が要ります')
  expect(bad({ title: 't', kind: 'table', columns: Array(9).fill('c'), rows: [['a']] })).toContain('8 列まで')
  expect(bad({ title: 't', kind: 'table', columns: ['c'], rows: Array(51).fill(['a']) })).toContain('50 行まで')
  expect(bad({ title: 't', kind: 'table', columns: ['c'], rows: [['a', 'b']] })).toContain('rows[0] のセルが 2 個')
  expect(bad({ title: 't', kind: 'table', columns: ['c'], rows: ['a'] })).toContain('rows[0] はセルの配列')
  expect(bad({ title: 't', kind: 'table', columns: ['c'], rows: [[{ a: 1 }]] })).toContain('rows[0][0] は文字列か数')
  expect(bad({ title: 't', kind: 'table', columns: ['c'], rows: [['x'.repeat(61)]] })).toContain('60 字まで')
  expect(bad({ title: 't', kind: 'markdown' })).toContain('text は文字列')
  expect(bad({ title: 't', kind: 'markdown', text: 'x'.repeat(LIMIT.text + 1) })).toContain('20000 字まで')
  expect(bad({ title: 't', kind: 'svg' })).toContain('svg は文字列')
})

test('svg: スクリプト・on* 属性・外部参照・先頭違い・長すぎを断り、data: とふつうの図は通す', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
  expect(svgProblem(ok)).toBeUndefined()
  expect(svgProblem('  \n<svg viewBox="0 0 1 1"><image href="data:image/png;base64,AAAA"/></svg>')).toBeUndefined()
  // 文の中の「online = 」は属性ではないので通す
  expect(svgProblem('<svg><text>online = yes</text></svg>')).toBeUndefined()
  expect(svgProblem('<?xml version="1.0"?><svg/>')).toContain('<svg で始めて')
  expect(svgProblem('<div><svg/></div>')).toContain('<svg で始めて')
  expect(svgProblem('<svg><SCRIPT>alert(1)</SCRIPT></svg>')).toContain('<script>')
  expect(svgProblem('<svg onload="x()"></svg>')).toContain('on で始まる属性')
  expect(svgProblem('<svg><rect\nonClick = "x()"/></svg>')).toContain('on で始まる属性')
  expect(svgProblem('<svg><image href="https://example.com/a.png"/></svg>')).toContain('外の物')
  expect(svgProblem("<svg><use xlink:href='//example.com/a.svg#x'/></svg>")).toContain('外の物')
  expect(svgProblem('<svg><a href="javascript:x()">a</a></svg>')).toContain('外の物')
  expect(svgProblem('<svg><style>rect{fill:url( "http://e.com/p.svg#g")}</style></svg>')).toContain('CSS から外の物')
  expect(svgProblem('<svg><style>@import "x.css";</style></svg>')).toContain('CSS から外の物')
  expect(svgProblem(`<svg>${' '.repeat(LIMIT.svg)}</svg>`)).toContain('100000 字まで')
  // 通った svg も制御文字は落とす
  const r = parseShow({ title: 't', kind: 'svg', svg: '<svg viewBox="0 0 1 1">\x07<text>a\x1bb\x85</text></svg>' })
  expect('item' in r && r.item.svg).toBe('<svg viewBox="0 0 1 1"><text>ab</text></svg>')
})

test('svg: 監査のすり抜け (文字参照・CSS のエスケープ・file:・image-set・制御文字) を断る', () => {
  const bad: [string, string][] = [
    ['<svg><image href="&#104;ttps://evil.example/x.png"/></svg>', '外の物'],
    ['<svg><image href="&#x68;ttps://evil.example/x.png"/></svg>', '外の物'],
    ['<svg><image href=" h&#116;tps://evil.example/x.png"/></svg>', '外の物'],
    ['<svg><image href="ht\ntps://evil.example/x.png"/></svg>', '外の物'],
    ['<svg><rect style="fill:url(&#104;ttps://evil.example/a#b)"/></svg>', 'CSS から外の物'],
    ['<svg><style>rect{fill:url(\\68ttps://evil.example/a)}</style><rect/></svg>', 'CSS から外の物'],
    ['<svg><style>rect{fill:url(\\000068 ttps://evil.example/a)}</style><rect/></svg>', 'CSS から外の物'],
    ['<svg><style>rect{background-image:image-set("https://evil.example/a" 1x)}</style><rect/></svg>', 'CSS から外の物'],
    ['<svg><style>@\\69mport "https://evil.example/a.css";</style></svg>', 'CSS から外の物'],
    ['<svg><style>@\\import "a.css";</style></svg>', 'CSS から外の物'],
    ['<svg><image href="file:///D:/secret.png"/></svg>', '外の物'],
    ['<svg><style>rect{fill:url(file:///D:/a.svg#g)}</style></svg>', 'CSS から外の物'],
    ['<svg><a href="javascript&#58;alert(1)"><text>x</text></a></svg>', '外の物'],
    ['<svg><svg onload=alert(1)/></svg>', 'on で始まる属性'],
    ['<svg><script>x</script></svg>', '<script>'],
    ['<svg><scr\u0000ipt>x</script></svg>', '<script>'],
    ['<svg><scr\u0085ipt>x</script></svg>', '<script>'],
    ['<svg><svg:script>x</svg:script></svg>', '<script>'],
    ['<svg><&#115;cript>x</script></svg>', '<script>'],
  ]
  for (const [s, why] of bad) expect([s, why, (svgProblem(s) ?? '').includes(why)]).toEqual([s, why, true])
  // 外れる側: ふつうの文字参照・エスケープ・data: は通す
  for (const s of [
    '<svg><text>A &amp; B &#12354; &#x3042;</text></svg>',
    '<svg><style>text{font-family:"\\30b4\\30b7\\30c3\\30af"}</style><text>x</text></svg>',
    '<svg><text>C:\\work\\a.txt</text></svg>',
    '<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>',
    '<svg><text>profile: yes</text></svg>',
  ])
    expect([s, svgProblem(s)]).toEqual([s, undefined])
  // 時刻は日本時間
  expect(hhmm(Date.parse('2026-10-22T15:30:00Z'))).toBe('00:30')
})

test('外から来る文字列の制御文字を、題・項目名・系列名・セル・alt・Markdown・SVG から落とす', () => {
  const r = parseShow({
    title: '\x07売上\x1b[31m\r\n速報',
    kind: 'bar',
    labels: ['a\x00b', 'c\td'],
    values: [{ name: 's\x0b1', values: [1, 2] }, { name: 's2', values: [3, 4] }],
  })
  if (!('item' in r)) throw new Error('通るはず')
  expect(r.item.title).toBe('売上[31m 速報')
  expect(r.item.alt).not.toMatch(CTRL)
  expect(r.item.svg).not.toMatch(CTRL)
  expect(r.item.svg).toContain('>ab<')
  expect(r.item.svg).toContain('>s1<')
  for (const l of r.item.lines) expect(l.text).not.toMatch(/[\x00-\x1f\x7f]/)

  const t = parseShow({ title: 't', kind: 'table', columns: ['名\x1b前', 'n'], rows: [['x\x07y', 1], [null]] })
  if (!('item' in t)) throw new Error('通るはず')
  expect(t.item.svg).toContain('>名前<')
  expect(t.item.svg).toContain('>xy<')
  expect(t.item.lines.map(l => l.text)).toEqual(['名前 | n', 'xy | 1', ' | '])

  const m = parseShow({ title: 't', kind: 'markdown', text: '# 見出し\r\n\x1b本文\t\x00です' })
  expect('item' in m && m.item.markdown).toBe('# 見出し\n本文\tです')
})

test('SVG: 軸・凡例・数値ラベル・伸びるアニメ、width/height を付けない', () => {
  const bar = barSvg(['1月', '2月'], [{ name: '2025', values: [120, -30] }, { name: '2026', values: [140, 150] }])
  expect(bar).toContain('>2025<')
  expect(bar).toContain('>-30<')
  expect(bar).toContain('attributeName="width"')
  expect(bar).toContain('attributeName="x"')
  expect(bar).not.toMatch(/<svg[^>]* width=/)
  const line = lineSvg(['a', 'b', 'c'], [{ name: '', values: [1, 5, 3] }])
  expect(line).toContain('stroke-dashoffset')
  expect(line).toContain('url(#area)')
  expect(line).toContain('>5<')
  const pie = pieSvg(['犬', '猫'], [3, 1])
  expect(pie).toContain('>75%<')
  expect(pie).toContain('>75.0%<')
  expect(pie).toContain('>合計<')
  expect(pie).toContain('stroke-dasharray')
  const table = tableSvg(['名前', '数'], [['あ&い', 1200]])
  expect(table).toContain('>あ&amp;い<')
  expect(table).toContain('>1,200<')
})

test('いちばん大きい入力でも Svg の上限 (131072 字) に収まる', () => {
  const labels = Array.from({ length: LIMIT.points }, (_, i) => `&<"${i}`.padEnd(LIMIT.label, '&'))
  const series = Array.from({ length: LIMIT.series }, (_, j) => ({ name: '&'.repeat(LIMIT.label), values: labels.map((_, i) => -123456.789 * (i + j)) }))
  const pieLabels = labels.slice(0, LIMIT.pie)
  const cases: Record<string, unknown>[] = [
    { title: '&'.repeat(80), kind: 'bar', labels, values: series },
    { title: '&'.repeat(80), kind: 'bar', labels, values: series.slice(0, 3) },
    { title: 't', kind: 'bar', labels, values: series[0]!.values },
    { title: 't', kind: 'line', labels, values: series },
    { title: 't', kind: 'line', labels: labels.slice(0, 24), values: series.map(s => ({ ...s, values: s.values.slice(0, 24) })) },
    { title: 't', kind: 'pie', labels: pieLabels, values: pieLabels.map((_, i) => i + 1) },
    {
      title: 't',
      kind: 'table',
      columns: Array(LIMIT.columns).fill('&'.repeat(LIMIT.label)),
      rows: Array.from({ length: LIMIT.rows }, () => Array(LIMIT.columns).fill('&'.repeat(LIMIT.cell))),
    },
    { title: 't', kind: 'table', columns: ['a'], rows: Array.from({ length: LIMIT.rows }, () => ['&'.repeat(LIMIT.cell)]) },
  ]
  for (const c of cases) {
    const r = parseShow(c)
    if (!('item' in r)) throw new Error(`${String(c.kind)}: ${r.error}`)
    expect(r.item.svg!.length).toBeLessThan(SVG_SOURCE_MAX)
  }
})

test('session.start でツール show を登録する (説明に使う場面と例、入力の形)', async ($, on) => {
  const world = await boot($, on)
  expect(world.registered).toHaveLength(1)
  const spec = world.registered[0]!
  expect(spec.name).toBe('show')
  expect(spec.description).toContain('ユーザーに図・グラフ・表を見せたい時に使う。ペインに描かれる')
  expect(spec.description).toContain('例: {"title"')
  expect(spec.inputSchema).toEqual(JSON.parse(JSON.stringify(INPUT_SCHEMA)))
})

test('ツール: 描けたらペインを開き「ペインに描きました」、断る時は理由を返し何も積まない', async ($, on) => {
  const world = await boot($, on)
  const ok = await show($, BAR)
  expect(ok.deny).toBeUndefined()
  expect(String(ok.result)).toContain('「月ごとの売上」(棒グラフ) をペインに描きました')
  expect(String(ok.result)).toContain('今は 1 枚')
  expect(world.opened).toEqual(['canvas-pane'])

  const ng = await show($, { title: 't', kind: 'bar', labels: ['a', 'b'], values: [1] })
  expect(JSON.stringify(ng)).toContain('描けませんでした: labels 2 件に対し values が 1 件です')
  expect(world.opened).toHaveLength(1)
  const ng2 = await show($, { title: 't', kind: 'svg', svg: '<svg onload="x()"/>' })
  expect(JSON.stringify(ng2)).toContain('on で始まる属性')

  // 狭い画面などでペインが出なかった時は、/canvas で開けると伝える
  world.isPlaced = false
  const waiting = await show($, { title: '表', kind: 'table', columns: ['a'], rows: [[1]] })
  expect(String(waiting.result)).toContain('/canvas で開けます')
  expect(String(waiting.result)).toContain('今は 2 枚')
})

for (const surface of SURFACES) {
  test(`${surface}: 空の時は頼み方の案内`, async ($, on) => {
    await boot($, on)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Claude に「〜をグラフにしてペインに出して」と頼むと、ここに描かれます' })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test(`${surface}: 最新を大きく、前へ・次へでめくり、消すで減る`, async ($, on) => {
    await boot($, on)
    await show($, BAR)
    await show($, { title: '推移', kind: 'line', labels: ['a', 'b'], values: [1, 2] })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '推移' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2 \/ 2 枚目 ─ 折れ線グラフ ─ \d\d:\d\d$/ })).toBeDefined()
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toContain('stroke-dashoffset')
      expect(String(svg?.props.alt)).toContain('推移(折れ線グラフ)')
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'a: 1' })).toBeDefined()
    }

    await ui.press({ key: 'prev' })
    expect(await ui.find({ type: 'Text', text: '月ごとの売上' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 \/ 2 枚目 ─ 棒グラフ/ })).toBeDefined()
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('月ごとの売上(棒グラフ)')
    else expect(await ui.find({ type: 'Text', text: /^3月 ■+ 160$/ })).toBeDefined()
    // 端では動かない
    await ui.press({ key: 'prev' })
    expect(await ui.find({ type: 'Text', text: /^1 \/ 2 枚目/ })).toBeDefined()
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /^2 \/ 2 枚目/ })).toBeDefined()

    await ui.press({ key: 'remove' })
    expect(await ui.find({ type: 'Text', text: /^1 \/ 1 枚目 ─ 棒グラフ/ })).toBeDefined()
    await ui.press({ key: 'remove' })
    expect(await ui.find({ type: 'Text', text: /^Claude に「/ })).toBeDefined()
  })

  test(`${surface}: markdown は Markdown 部品、svg は terminal では案内`, async ($, on) => {
    await boot($, on)
    await show($, { title: 'メモ', kind: 'svg', svg: '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>' })
    await show($, { title: '手順', kind: 'markdown', text: '1. 読む\n2. 書く' })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe('1. 読む\n2. 書く')
    await ui.press({ key: 'prev' })
    if (surface === 'vscode') expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('<rect')
    else expect(await ui.find({ type: 'Text', text: 'この図は SVG です。VS Code のペインで見られます' })).toBeDefined()
  })
}

test('21 枚目で最も古い 1 枚が落ち、最新を見せる', async ($, on) => {
  await boot($, on)
  for (let i = 1; i <= 21; i++) await show($, { ...BAR, title: `図${i}` })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: '図21' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^20 \/ 20 枚目/ })).toBeDefined()
  for (let i = 0; i < 25; i++) await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: '図2' })).toBeDefined()
})

test('/canvas でペインを開く', async ($, on) => {
  const world = await boot($, on)
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'canvas', ...run })).toMatchObject({ text: 'キャンバスのペインを開きました。' })
  expect(world.opened).toEqual(['canvas-pane'])
})

test('C2: /canvas が取れなかった時は /canvas-pane にし、元の /canvas を横取りしない', async ($, on) => {
  on('command.run', { command: 'canvas' }, () => ({ text: '別の canvas' }))
  const world = await boot($, on, { isCanvasTaken: true })
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'canvas', ...run })).toMatchObject({ text: '別の canvas' })
  expect(world.opened).toEqual([])
  expect(await $.command.run({ command: 'canvas-pane', ...run })).toMatchObject({ text: 'キャンバスのペインを開きました。' })
  expect(world.opened).toEqual(['canvas-pane'])
})

test('/canvas を持てた時は、予備名の /canvas-pane を横取りしない', async ($, on) => {
  on('command.run', { command: 'canvas-pane' }, () => ({ text: '別の canvas-pane' }))
  const world = await boot($, on)
  const run = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
  expect(await $.command.run({ command: 'canvas-pane', ...run })).toMatchObject({ text: '別の canvas-pane' })
  expect(world.opened).toEqual([])
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await boot($, on)
  await show($, BAR)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/fill="#ffffff"/)
  expect(await source()).toContain('fill="#0969da">') // 棒は明るい青
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  // 描いた後でテーマを替えても、元のデータから今の色で組み直す
  expect(await source()).toMatch(/fill="#0d1117"/)
  expect(await source()).toContain('fill="#58a6ff">')
})
