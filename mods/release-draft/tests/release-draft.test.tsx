import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import type { DraftReport } from '../types'
import { commitDirOf, draftText, groupsOf, nextVersion, parseLog, resolveDir, versionOf } from '../hooks/draft'

const NOW = Date.parse('2026-10-22T05:00:00Z')
const CWD = 'C:/work/notes'
const REPO = 'D:/repo'
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'release-draft',
  component: 'Pane',
  requestId: 'release-draft',
  props: { title: 'リリースノートの下書き', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const presentation = { isFullscreen: false, columns: 80 }

const A = 'mods/a/.claude-plugin/plugin.json'
const B = 'mods/b/.claude-plugin/plugin.json'

/** repos: 場所ごとのリポジトリ。tag が null ならタグ無し */
type Repo = { tag: string | null; log: string; count: number; changed: string[]; untracked: string[]; old: Record<string, string>; files: Record<string, string> }
type World = { repos: Record<string, Repo>; calls: { args: string; cwd?: string }[]; filled: string[]; toasts: string[]; isOpen: boolean }

const REPO_A: Repo = {
  tag: 'v0.8.0',
  log: ['c3\x00a 0.2.0: 足した', 'b2\x00直した: 落ちる時', 'a1\x00README の言葉'].join('\n'),
  count: 3,
  changed: [A, 'README.md'],
  untracked: [B],
  old: { [A]: '{ "name": "a", "version": "0.1.0" }' },
  files: { [A]: '{ "name": "a", "version": "0.2.0" }', [B]: '{ "name": "b", "version": "0.1.0" }' },
}

/** git の argv から全体オプション (-c の対と -- で始まる物) を飛ばした、サブコマンドから後ろ */
const sub = (argv: readonly string[]) => {
  let i = 1
  while (i < argv.length && (argv[i] === '-c' || (argv[i] ?? '').startsWith('--'))) i += argv[i] === '-c' ? 2 : 1
  return argv.slice(i)
}

// エンジンの代役を下に置く (下の hook はテストの最初の $ より前に全部登録する)
const setup = (on: On, repos: Record<string, Repo>) => {
  mock.clock(on, { now: NOW })
  const w: World = { repos, calls: [], filled: [], toasts: [], isOpen: false }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => {
    w.isOpen = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: w.isOpen ? [{ id: 'release-draft' }] : [] }) as never)
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    w.filled.push(e.text)
    return { isFilled: true }
  })
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('fs.read', (_$, e) => {
    const path = e.path.replace(/\\/g, '/')
    for (const [dir, r] of Object.entries(w.repos)) {
      const rel = path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : undefined
      if (rel !== undefined && r.files[rel] !== undefined) return { value: r.files[rel] }
    }
    return { deny: 'ENOENT' }
  })
  on('process.run', (_$, e) => {
    const a = sub(e.argv)
    const args = a.join(' ')
    const cwd = e.init?.cwd
    w.calls.push({ args, cwd })
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode === 0 ? '' : 'fatal', isStdoutTruncated: false, isStderrTruncated: false } })
    const r = cwd === undefined ? undefined : w.repos[cwd]
    if (!r) return out('', 128)
    if (args === 'rev-parse --show-toplevel') return out(`${cwd}\n`)
    if (args === 'describe --tags --abbrev=0') return r.tag ? out(`${r.tag}\n`) : out('', 128)
    if (a[0] === 'log') return out(`${r.log}\n`)
    if (a[0] === 'rev-list') return out(`${r.count}\n`)
    if (a[0] === 'diff') return out(r.changed.map(p => `${p}\n`).join(''))
    if (a[0] === 'ls-files') return out(r.untracked.map(p => `${p}\n`).join(''))
    if (a[0] === 'show') {
      const path = (a[1] ?? '').split(':').slice(1).join(':')
      return r.old[path] === undefined ? out('', 128) : out(r.old[path])
    }
    return out('', 1)
  })
  return w
}

const begin = ($: Engine) => $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
const open = ($: Engine) => $.command.run({ command: 'release', args: '', origin: { kind: 'composer' }, presentation })

type View = Pick<Mounted, 'findAll'>
const shown = async (ui: View) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.alt)}\n${String(s.props.source)}`), ...texts.map(t => t.text)].join('\n')
}

const READY: Extract<DraftReport, { kind: 'ready' }> = {
  kind: 'ready',
  dir: REPO,
  loadedAt: NOW,
  tag: 'v0.8.0',
  commits: parseLog(REPO_A.log),
  commitCount: 3,
  isCut: false,
  bumps: [
    { path: A, name: 'a', from: '0.1.0', to: '0.2.0' },
    { path: B, name: 'b', to: '0.1.0' },
  ],
  fileCount: 3,
}

test('純関数: コミットした場所・版・次の版', () => {
  expect(commitDirOf(`cd "D:/public-copy/claude-code-mods" && git add -A && git commit -m "x"`)).toBe('D:/public-copy/claude-code-mods')
  expect(commitDirOf('git -C sub commit -m x')).toBe('sub')
  expect(commitDirOf('git commit -m x')).toBeUndefined()
  expect(resolveDir('/d/repo', 'C:/w')).toBe('D:/repo')
  expect(parseLog('c3\x00subject one\nbroken\n')).toEqual([{ hash: 'c3', subject: 'subject one' }])
  expect(versionOf('{ "name": "a", "version": "1.2.3" }')).toEqual({ name: 'a', version: '1.2.3' })
  expect(versionOf('{ "name": "a" }')).toBeUndefined()
  expect(versionOf('not json')).toBeUndefined()
  expect(nextVersion('v0.8.0', true)).toBe('v0.9.0')
  expect(nextVersion('v0.8.3', false)).toBe('v0.8.4')
  expect(nextVersion('1.2.3', true)).toBe('1.3.0')
  expect(nextVersion(null, true)).toBeUndefined()
})

test('純関数: Added / Changed / Fixed への分け方と下書き', () => {
  const g = groupsOf(READY)
  expect(g).toEqual({
    added: ['b 0.1.0(新しく足した)', 'a 0.2.0: 足した'],
    changed: ['a 0.1.0 → 0.2.0', 'README の言葉'],
    fixed: ['直した: 落ちる時'],
    next: 'v0.9.0',
  })
  expect(draftText(READY, '2026-10-22')).toBe(
    '## [0.9.0] - 2026-10-22\n\n### Added\n\n- b 0.1.0(新しく足した)\n- a 0.2.0: 足した\n\n### Changed\n\n- a 0.1.0 → 0.2.0\n- README の言葉\n\n### Fixed\n\n- 直した: 落ちる時\n',
  )
  // 前の版のリリースのコミットは入れない
  expect(groupsOf({ ...READY, bumps: [], commits: [{ hash: 'x', subject: 'v0.8.0: まとめ' }] }).changed).toEqual([])
})

test('セッションの場所が git でなければそう出す', async ($, on) => {
  setup(on, {})
  await begin($)
  const r = await open($)
  expect(r).toMatchObject({ text: 'リリースノートの下書きのペインを開きました。' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await shown(ui)).toContain('git のリポジトリではありません')
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['読み直す'])
    await ui.unmount()
  }
})

test('Claude が cd してコミットしたリポジトリを読み、下書きと次の版を出す。ボタンで Claude に頼む', async ($, on) => {
  const w = setup(on, { [REPO]: REPO_A })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: `cd "${REPO}" && git commit -m "x"` } as never)
  expect(w.calls).toEqual([]) // ペインが閉じている間は読まない
  await open($)
  expect(w.calls.every(c => c.cwd === REPO)).toBe(true)
  expect(w.calls.some(c => c.args === 'show v0.8.0:' + A)).toBe(true)
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await vs.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('v0.8.0 から 3 コミット')
  expect(String(svg?.props.source)).toContain('0.1.0 → 0.2.0')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  const text = await shown(term)
  expect(text).toContain('次の版の候補: v0.9.0  Added 2・Changed 2・Fixed 1')
  expect(text).toContain('## [0.9.0] - 2026-10-22')
  expect(text).toContain('- a 0.1.0 → 0.2.0')
  await term.press({ key: 'ask' })
  expect(w.filled[0]).toContain('前のタグ v0.8.0 から今までの変更で、CHANGELOG.md に次の版 (v0.9.0 の候補)の節を書いてください。場所は D:/repo です。')
  expect(w.filled[0]).toContain('公開 (push・リリース) はしないでください。')
  expect(w.toasts).toEqual(['入力欄に入れました(送信はしていません)'])
  // ペインが開いている間にコミットしたら読み直す
  const before = w.calls.length
  await $.tool.call({ tool: 'Bash', command: `cd "${REPO}" && git commit -m "y"` } as never)
  expect(w.calls.length).toBeGreaterThan(before)
  // セッションの場所に戻す
  await term.press({ key: 'here' })
  expect(await shown(term)).toContain('git のリポジトリではありません')
})

test('タグが無ければ最近のコミットを出し、版は比べない', async ($, on) => {
  const w = setup(on, { [CWD]: { ...REPO_A, tag: null } })
  await begin($)
  await open($)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = await shown(term)
  expect(text).toContain('タグがありません (最近の 3 コミット)')
  expect(text).toContain('次の版の候補: ─')
  expect(text).toContain('## [Unreleased] - 2026-10-22')
  expect(w.calls.some(c => c.args.startsWith('show'))).toBe(false)
})
