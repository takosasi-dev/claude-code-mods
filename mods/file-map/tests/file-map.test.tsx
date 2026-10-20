import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { OUTSIDE, ROOT, fileMapSvg, fit, groupLines, layout, pathOf, placeOf, squarify } from '../hooks/filemap'
import type { FileTouch } from '../types'

const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'file-map',
  component: 'Pane',
  requestId: 'file-map',
  props: {
    title: 'ファイルの地図',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
// Windows の作業フォルダ。ツールのパスは \ と / が混ざって来る
const CWD = 'D:\\proj'
const ORANGE = '#f78166'
const BLUE = '#58a6ff'

/** エンジンの代わりに一番下で答える。file_path が fail.ts なら失敗、deny.ts なら断る */
const bottom = (on: On) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T03:00:00Z') })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', () => ({ value: CWD }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('tool.call', (_$, e) => {
    const p = String((e as unknown as Record<string, unknown>).file_path ?? '')
    if (p.endsWith('deny.ts')) return { deny: 'だめ' }
    return p.endsWith('fail.ts') ? { isError: true as const, result: 'boom' } : { result: 'ok' }
  })
  return clock
}

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool, ...input, ...(agentId ? { agentId } : {}) } as never)

/** 読む・書く・調べるを混ぜて流す */
const flow = async ($: Engine) => {
  for (let i = 0; i < 3; i++) await call($, 'Read', { file_path: 'D:\\proj\\src\\hooks\\register.tsx' })
  await call($, 'Edit', { file_path: 'D:/proj/src/hooks/register.tsx', old_string: 'a', new_string: 'b' })
  await call($, 'Read', { file_path: 'D:\\proj\\src\\hooks\\deep\\x\\y.ts' }) // 3 段目より下も src/hooks にまとまる
  await call($, 'Write', { file_path: 'D:\\proj\\README.md', content: 'x' })
  await call($, 'Read', { file_path: 'E:\\home\\me\\.claude\\settings.json' }) // 外
  await call($, 'NotebookEdit', { notebook_path: 'D:\\proj\\docs\\a.ipynb', new_source: 'x' }, 'agent-1')
  await call($, 'Grep', { pattern: 'x', path: 'D:\\proj\\tests' })
  await call($, 'Grep', { pattern: 'x' }) // path が無いので数えない
  await call($, 'Glob', { pattern: '*.ts' }) // 同じく
  await call($, 'Read', { file_path: 'D:\\proj\\src\\fail.ts' }) // 失敗は数えない
  await call($, 'Edit', { file_path: 'D:\\proj\\src\\deny.ts', old_string: 'a', new_string: 'b' }) // 断られた物も
  await call($, 'Bash', { command: 'cat D:\\proj\\x.ts' }) // 見ないツール
}

type Found = { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }
const svgOf = async (ui: Found) => String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(x => String(x.text))

test('触ったファイルをフォルダごとにまとめて描き、多く触った順の一覧を出す', async ($, on) => {
  bottom(on)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  await flow($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(all).toContain('多く触った順 6 件')
    const top = all.filter(s => /^\d+回 /.test(s))
    expect(top[0]).toBe('4回 書1 読3 src/hooks/register.tsx')
    expect(top).toContain('1回 書1 README.md')
    expect(top).toContain('1回 読1 tests')
    expect(top).toContain('1回 書1 docs/a.ipynb')
    expect(top).toContain('1回 読1 E:/home/me/.claude/settings.json')
    expect(top).toContain('1回 読1 src/hooks/deep/x/y.ts')
    expect((await ui.find({ type: 'Text', text: /README\.md$/ }))?.props.color).toBe('yellow')
    if (surface === 'vscode') {
      const svg = await svgOf(ui)
      expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toBe('ファイル 6 件 フォルダ 4 書いた 3 件 9 回')
      expect(svg).toContain('ファイルの地図')
      expect(svg).toContain('>src/hooks<')
      expect(svg).toContain('>register.tsx<')
      expect(svg).toContain(`fill="${ORANGE}" fill-opacity="1.00"`) // 一番多く触って書いた物が一番濃い
      expect(svg).toContain(`fill="${BLUE}"`) // 読んだだけ
      expect(svg).toContain('r="2.5"') // サブエージェントの印
      expect(svg).not.toContain('fail.ts')
      expect(svg).not.toContain('deny.ts')
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(all[0]).toBe('ファイル 6 件 フォルダ 4 書いた 3 件 9 回')
      expect(all[1]).toBe('src/hooks 5回 2件 書いた1')
      expect(all).toContain(`${OUTSIDE} 1回 1件`)
      expect(all).toContain(`${ROOT} 2回 2件 書いた1`) // tests はフォルダだが、見分けずに直下の物として数える
    }
    await ui.unmount()
  }
})

test('「書いた物だけ」で読んだだけの物を外し、「全部」で戻す', async ($, on) => {
  bottom(on)
  await flow($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'filter-written' })
    const top = (await texts(ui)).filter(s => /^\d+回 /.test(s))
    expect(top[0]).toBe('4回 書1 読3 src/hooks/register.tsx')
    expect(top.slice(1).sort()).toEqual(['1回 書1 README.md', '1回 書1 docs/a.ipynb'])
    expect((await ui.find({ key: 'filter-written' }))?.props.variant).toBe('primary')
    if (surface === 'vscode') expect(await svgOf(ui)).toContain('書いた物だけ 3 件')
    else expect((await texts(ui))[0]).toBe('書いた物 ファイル 3 件 フォルダ 3 書いた 3 件 6 回')
    await ui.press({ key: 'filter-all' })
    expect((await texts(ui)).filter(s => /^\d+回 /.test(s)).length).toBe(6)
    await ui.unmount()
  }
})

test('/clear と「記録を消す」で空になる', async ($, on) => {
  bottom(on)
  await flow($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(await ui.find({ type: 'Text', text: 'まだファイルに触っていません' })).toBeDefined()
  await call($, 'Read', { file_path: 'D:\\proj\\a.ts' })
  expect(await ui.find({ type: 'Text', text: '1回 読1 a.ts' })).toBeDefined()
  await ui.press({ key: 'reset' })
  expect(await ui.find({ type: 'Text', text: 'まだファイルに触っていません' })).toBeDefined()
})

test('/filemap を登録して開く。取れなければ /file-map にして、/filemap は横取りしない', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  const tried: string[] = []
  let isTaken = false
  on('command.register', (_$, e) => {
    tried.push(e.name)
    return e.name === 'filemap' && isTaken ? { deny: '組み込みと被っています' } : { value: { command: e.name } }
  })
  on('command.run', { command: 'filemap' }, () => ({ text: 'ほかの filemap' }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(await $.command.run({ command: 'filemap', ...RUN })).toMatchObject({ text: 'ファイルの地図を開きました。' })
  isTaken = true
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  expect(tried).toEqual(['filemap', 'filemap', 'file-map'])
  expect(await $.command.run({ command: 'filemap', ...RUN })).toMatchObject({ text: 'ほかの filemap' })
  expect(await $.command.run({ command: 'file-map', ...RUN })).toMatchObject({ text: 'ファイルの地図を開きました。' })
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', async ($, on) => {
  bottom(on)
  let theme = 'light-ansi'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  await flow($)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await svgOf(ui)).toMatch(/fill="#ffffff"/)
  expect(await svgOf(ui)).toContain('fill="#bc4c00"') // 明るい橙
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light-ansi', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await svgOf(ui)).toMatch(/fill="#0d1117"/)
})

test('パスのまとめ方: 相対・上の 2 段・直下・外。区切りは \\ と / のどちらでも', () => {
  expect(placeOf('D:\\proj', 'D:\\proj\\src\\a\\b\\c.ts')).toEqual({ label: 'src/a/b/c.ts', group: 'src/a' })
  expect(placeOf('D:/proj/', 'd:\\PROJ\\src\\c.ts')).toEqual({ label: 'src/c.ts', group: 'src' })
  expect(placeOf('D:\\proj', 'D:\\proj\\c.ts')).toEqual({ label: 'c.ts', group: ROOT })
  expect(placeOf('D:\\proj', 'D:\\project\\c.ts')).toEqual({ label: 'D:/project/c.ts', group: OUTSIDE })
  expect(placeOf('/home/me/p', '/etc/hosts')).toEqual({ label: '/etc/hosts', group: OUTSIDE })
  expect(placeOf('/home/me/p', './src/x.ts')).toEqual({ label: 'src/x.ts', group: 'src' })
  expect(placeOf('D:\\proj', 'D:\\proj')).toEqual({ label: '.', group: ROOT })
  expect(placeOf('', 'D:\\a\\b.ts')).toEqual({ label: 'D:/a/b.ts', group: OUTSIDE })
  expect(placeOf('D:\\proj', 'D:\\proj\\a\u0007b.ts').label).toBe('ab.ts')
  expect(pathOf('Grep', { pattern: 'x' })).toBe('')
  expect(pathOf('Glob', { pattern: 'x', path: 'D:\\p' })).toBe('D:\\p')
  expect(pathOf('NotebookEdit', { notebook_path: 'a.ipynb' })).toBe('a.ipynb')
})

test('squarified: 面積の比が回数の比に合い、枠からはみ出さず、すき間も重なりも無い', () => {
  const rect = { x: 10, y: 20, w: 356, h: 250 }
  const weights = [40, 17, 9, 9, 6, 4, 3, 2, 1, 1, 1, 0]
  const cells = squarify(
    weights.map((w, i) => ({ key: `f${i}`, weight: w })),
    rect,
  )
  expect(cells.length).toBe(11) // 0 は置かない
  const total = weights.reduce((a, b) => a + b, 0)
  const eps = 1e-6
  let area = 0
  for (const c of cells) {
    const w = weights[Number(c.key.slice(1))]!
    expect(Math.abs((c.w * c.h) / (rect.w * rect.h) - w / total)).toBeLessThan(1e-9)
    expect(c.x).toBeGreaterThanOrEqual(rect.x - eps)
    expect(c.y).toBeGreaterThanOrEqual(rect.y - eps)
    expect(c.x + c.w).toBeLessThanOrEqual(rect.x + rect.w + eps)
    expect(c.y + c.h).toBeLessThanOrEqual(rect.y + rect.h + eps)
    area += c.w * c.h
  }
  expect(Math.abs(area - rect.w * rect.h)).toBeLessThan(1e-6)
  // 重なりが無い
  for (const a of cells)
    for (const b of cells) {
      if (a === b) continue
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      expect(ox <= eps || oy <= eps).toBe(true)
    }
  // 正方形に近い: 一番大きい物の縦横比は 3 以下
  const big = cells[0]!
  expect(Math.max(big.w / big.h, big.h / big.w)).toBeLessThan(3)

  expect(squarify([], rect)).toEqual([])
  expect(squarify([{ key: 'a', weight: 5 }], rect)).toEqual([{ key: 'a', ...rect }])
  expect(squarify([{ key: 'a', weight: 1 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([])
})

test('2 段の配置: ファイルの四角はそのフォルダの四角の中に入る。文字は入りきらなければ省く', () => {
  const f = (label: string, group: string, reads: number, writes = 0): FileTouch => ({ label, group, reads, writes, subs: 0, last: 0 })
  const files = [f('src/a.ts', 'src', 10, 2), f('src/b.ts', 'src', 3), f('README.md', ROOT, 1, 1), f('docs/x.md', 'docs', 5)]
  const map = layout(files, 'all', { x: 0, y: 0, w: 300, h: 200 })
  for (const c of map.cells) {
    const g = map.groups.find(g => g.key === c.file.group)!
    expect(c.x).toBeGreaterThanOrEqual(g.x - 1e-6)
    expect(c.y).toBeGreaterThanOrEqual(g.y - 1e-6)
    expect(c.x + c.w).toBeLessThanOrEqual(g.x + g.w + 1e-6)
    expect(c.y + c.h).toBeLessThanOrEqual(g.y + g.h + 1e-6)
  }
  const src = map.groups.find(g => g.key === 'src')!
  expect(src.count).toBe(15)
  expect(Math.abs((src.w * src.h) / (300 * 200) - 15 / 22)).toBeLessThan(1e-9)
  expect(fit('register.tsx', 200)).toBe('register.tsx')
  expect(fit('register.tsx', 40)).toBe('regi…')
  expect(fit('register.tsx', 20)).toBe('')
  // 多くても制御文字があっても SVG は上限に収まる
  const many = Array.from({ length: 1000 }, (_, i) => f(`d${i % 40}/s/f${i}\u0007<x>.ts`, `d${i % 40}/s`, 1 + (i % 9), i % 3 ? 0 : 1))
  const svg = fileMapSvg(many, 'all')
  expect(svg.length).toBeLessThan(131_072)
  expect(svg).toContain('1000 件(上位 200 を描く)')
  expect(svg).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/)
  expect(groupLines(many, 'written')[0]!.text).toMatch(/^書いた物 ファイル 334 件/)
})
