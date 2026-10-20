import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { cardSvg, extractLines, freshnessSvg, obsidianUrl, toProject } from '../hooks/board'

const NOW = Date.parse('2026-10-20T03:00:00Z')
const DAY = 86_400_000
const DIR = 'E:\\V\\memo'
const OPTIONS = { options: { memoDir: DIR, vaultRoot: 'E:\\V', vaultName: 'Claude' } }
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'project-board',
  component: 'Pane',
  requestId: 'project-board',
  props: {
    title: 'プロジェクト',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const ALPHA = '# Alpha 引き継ぎメモ\r\n\r\n最終更新: 2026-10-19\r\n状態: **実装完了**・確認待ち\r\n\r\n## 現状\r\n\r\n- v1.0 を `公開済み`\r\n\r\n## 次にやること\r\n\r\n1. 実機で確かめる\r\n'
const BETA = `# Beta\n\n## 次にやること\n\n- 宿題を片付ける\n\n${'あ'.repeat(5000)}\n`
const GAMMA = '# Gamma\n\nただのメモ。\n二行目。\n'

const files: Record<string, { text: string; mtimeMs: number }> = {
  'Alpha.md': { text: ALPHA, mtimeMs: NOW - 1 * DAY },
  'Beta.md': { text: BETA, mtimeMs: NOW - 10 * DAY },
  'Gamma.md': { text: GAMMA, mtimeMs: NOW - 30 * DAY },
}

// fs を差し替える。フォルダと .md 以外のファイルも混ぜておく
const mockFs = (on: On, state = { lists: 0, fail: false }) => {
  on('fs.list', (_$, e) => {
    state.lists++
    if (state.fail || e.path !== DIR) return { deny: 'ENOENT' }
    return {
      value: [
        ...Object.entries(files).map(([name, f]) => ({ name, kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })),
        { name: 'sub', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false },
        { name: 'note.txt', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false },
      ],
    }
  })
  on('fs.read', (_$, e) => {
    const name = e.path.slice(DIR.length + 1)
    const f = files[name]
    return f && e.path.startsWith(`${DIR}\\`) ? { value: f.text } : { deny: 'ENOENT' }
  })
  return state
}

const rowKeys = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('open:'))

test('抜き出し: 状態・現状・次にやること・待ち、無ければ先頭の行', async () => {
  expect(extractLines(ALPHA.replace(/\r/g, ''))).toEqual(['状態: 実装完了・確認待ち', 'v1.0 を 公開済み', '次: 実機で確かめる'])
  expect(extractLines(BETA)).toEqual(['次: 宿題を片付ける'])
  expect(extractLines(GAMMA)).toEqual(['ただのメモ。', '二行目。'])
  const p = toProject('Alpha.md', `${DIR}\\Alpha.md`, 1, ALPHA)
  expect(p.name).toBe('Alpha')
  expect(p.title).toBe('Alpha 引き継ぎメモ')
  expect(cardSvg(p, NOW)).toMatch(/Alpha 引き継ぎメモ/)
  expect(extractLines('## 現状\n### Phase1\n- 作った\n### 次にやること\n1. 試す\n')).toEqual(['作った', '次: 試す'])
  expect(obsidianUrl(`${DIR}\\Alpha.md`, 'E:\\V', 'Claude')).toBe('obsidian://open?vault=Claude&file=memo%2FAlpha.md')
  expect(obsidianUrl('D:\\other\\x.md', 'E:\\V', 'Claude')).toBeUndefined()
  // 未設定なら作らない (空の根を全部に当てない)
  expect(obsidianUrl('/home/a/x.md', '', 'Claude')).toBeUndefined()
  expect(obsidianUrl(`${DIR}\\Alpha.md`, 'E:\\V', '')).toBeUndefined()
})

test('ファイル名の制御文字を落とす(Text と SVG が拒まれない)', () => {
  const p = toProject('a\x07b\x1b.md', '/tmp/demo/a.md', NOW, '# t\n')
  expect(p.name).toBe('ab')
  expect(freshnessSvg([{ ...p, name: 'x\x08y' }], NOW)).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/)
})

for (const surface of SURFACES) {
  test(`${surface}: 再読込で一覧が出る・並び替え・絞り込み`, OPTIONS, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockFs(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '読み込み中' })).toBeDefined()
    await ui.press({ key: 'reload' })

    expect(await rowKeys(ui)).toEqual(['open:Alpha', 'open:Beta', 'open:Gamma'])
    expect(await ui.find({ key: 'open:Beta', text: /10日前/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3 / 3 件' })).toBeDefined()
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toMatch(/鮮度/)
      // 凡例の色の並び: 3日以内は緑、14日以内は黄、それ以上は弱い色
      expect(String(svg?.props.source)).toMatch(/fill="#3fb950"\/><text[^>]*>3日以内<[\s\S]*fill="#d29922"\/><text[^>]*>14日以内<[\s\S]*fill="#8b949e"\/><text[^>]*>それ以上</)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^鮮度 / }))?.text).toBe('鮮度 3日以内 1 / 14日以内 1 / それ以上 1')
    }

    await ui.select({ key: 'sort', value: 'old' })
    expect(await rowKeys(ui)).toEqual(['open:Gamma', 'open:Beta', 'open:Alpha'])
    await ui.select({ key: 'sort', value: 'name' })
    expect(await rowKeys(ui)).toEqual(['open:Alpha', 'open:Beta', 'open:Gamma'])

    await ui.input({ key: 'filter', text: 'AL', kind: 'change' })
    expect(await rowKeys(ui)).toEqual(['open:Alpha'])
    await ui.input({ key: 'filter', text: 'zzz' })
    expect(await rowKeys(ui)).toEqual([])
    expect(await ui.find({ type: 'Text', text: '該当するメモがありません' })).toBeDefined()
  })

  test(`${surface}: 詳細画面・続きを読む・戻る`, OPTIONS, async ($, on) => {
    mock.clock(on, { now: NOW })
    mockFs(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    await ui.press({ key: 'open:Beta' })

    expect(await ui.find({ key: 'back' })).toBeDefined()
    const head = await ui.find({ key: 'body' })
    expect(head?.type).toBe('Markdown')
    expect(head?.text.length).toBe(4000)
    expect(await ui.find({ key: 'more' })).toBeDefined()
    if (surface === 'vscode') {
      expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/次: 宿題を片付ける/)
      expect((await ui.find({ type: 'Code' }))?.text).toBe(`${DIR}\\Beta.md\nobsidian://open?vault=Claude&file=memo%2FBeta.md`)
      expect(await ui.find({ type: 'Link' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '・次: 宿題を片付ける' })).toBeDefined()
      expect((await ui.find({ type: 'Link' }))?.props.href).toBe('obsidian://open?vault=Claude&file=memo%2FBeta.md')
    }

    await ui.press({ key: 'more' })
    expect((await ui.find({ key: 'body' }))?.text).toBe(BETA)
    expect(await ui.find({ key: 'more' })).toBeUndefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    expect(await rowKeys(ui)).toHaveLength(3)
  })
}

test('フォルダを読めないときは赤い説明文', OPTIONS, async ($, on) => {
  mock.clock(on, { now: NOW })
  mockFs(on, { lists: 0, fail: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reload' })
  const el = await ui.find({ type: 'Text', text: /メモのフォルダを読めません/ })
  expect(el?.props.color).toBe('red')
  expect(await rowKeys(ui)).toEqual([])
})

test('フォルダが未設定なら読まずに設定のしかたを出す', async ($, on) => {
  mock.clock(on, { now: NOW })
  const fs = mockFs(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reload' })
  expect(await ui.find({ type: 'Text', text: /未設定/ })).toBeDefined()
  expect(fs.lists).toBe(0)
})

test('/projects で読んで開き、5 分ごとに読み直す(開く前は読まない)', OPTIONS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const fs = mockFs(on)
  let opened = ''
  on('ui.open', (_$, e) => {
    opened = e.id
    return { value: { isPlaced: true as const } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })

  await clock.advance(5 * 60_000)
  expect(fs.lists).toBe(0)

  const ran = await $.command.run({
    command: 'projects',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: 'プロジェクトのペインを開きました。' })
  expect(opened).toBe('project-board')
  expect(fs.lists).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await rowKeys(ui)).toHaveLength(3)
  files['Delta.md'] = { text: '# Delta\n状態: 新規\n', mtimeMs: NOW }
  try {
    await clock.advance(5 * 60_000)
    expect(fs.lists).toBe(2)
    expect((await rowKeys(ui))[0]).toBe('open:Delta')
  } finally {
    delete files['Delta.md']
  }
})

test('メモが多くても鮮度の SVG は上限内(上位 100 件と「ほか N 件」)', () => {
  const many = Array.from({ length: 600 }, (_, i) => ({
    name: `P${String(i).padStart(3, '0')}`,
    path: `/tmp/demo/${i}.md`,
    mtimeMs: NOW - i * DAY,
    title: '',
    lines: [],
  }))
  const svg = freshnessSvg(many, NOW)
  expect(svg.length).toBeLessThan(131072)
  expect(svg).toContain('ほか 500 件')
  expect(svg).toContain('>P099<')
  expect(svg).not.toContain('>P100<')
})

// どのパスでも 1 本のメモを返す fs。見に来たパスを集める
const anyFs = (on: On, text: string) => {
  const seen = { lists: [] as string[], reads: [] as string[] }
  on('fs.list', (_$, e) => {
    seen.lists.push(e.path)
    return { value: [{ name: 'Alpha.md', kind: 'file' as const, size: text.length, mtimeMs: NOW, isLink: false }] }
  })
  on('fs.read', (_$, e) => {
    seen.reads.push(e.path)
    return { value: text }
  })
  return seen
}

for (const memoDir of ['notes', './notes', 'C:', 'C:notes']) {
  test(`メモのフォルダが絶対パスでなければ未設定と同じ扱い(${memoDir})`, { options: { memoDir } }, async ($, on) => {
    mock.clock(on, { now: NOW })
    const seen = anyFs(on, GAMMA)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'reload' })
    expect(await ui.find({ type: 'Text', text: /未設定/ })).toBeDefined()
    expect(seen.lists).toEqual([])
  })
}

test('ドライブの根は区切りを残す(C:\\ を C: にしない)', { options: { memoDir: 'C:\\' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = anyFs(on, GAMMA)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reload' })
  expect(seen.lists).toEqual(['C:\\'])
  expect(seen.reads).toEqual(['C:\\Alpha.md'])
  expect(await rowKeys(ui)).toEqual(['open:Alpha'])
})

test('本文の file: リンクは押せない(https: はそのまま)', { options: { memoDir: '/tmp/demo/memo' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  anyFs(on, '# Alpha\n\n[手元のメモ](file:///C:/x/a.md) と [サイト](https://example.com) と <file:///C:/y.md>\n')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reload' })
    await ui.press({ key: 'open:Alpha' })
    const body = await ui.find({ key: 'body' })
    expect(body?.props.pressableLinks).toEqual(['file:///C:/x/a.md', 'file:///C:/y.md'])
    // 押しても何も起きない(落ちない)
    await ui.press({ key: 'body', link: { href: 'file:///C:/x/a.md' } })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('/config の theme が light 系なら明るい色で描き、切り替えにも付いていく', OPTIONS, async ($, on) => {
  mock.clock(on, { now: NOW })
  mockFs(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let theme = 'light'
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'core', tier: 'core' }, isLocked: false }] as never }))
  on('config.set', (_$, e) => ({ value: e.value }))
  await $.session.start({ cwd: '', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'reload' })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toMatch(/<rect width="380" height="\d+" rx="10" fill="#ffffff"\/>/)
  expect(await source()).toContain('fill="#1a7f37"') // 明るい緑(3日以内)
  theme = 'dark'
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'core', tier: 'core' } as never, origin: { kind: 'composer' } })
  expect(await source()).toMatch(/<rect width="380" height="\d+" rx="10" fill="#0d1117"\/>/)
})
