import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { approvedIn, outwardOf, rangeOf, repoDirOf, resolveDir, scanPush } from '../hooks/guard'

const NOW = Date.parse('2026-10-22T05:00:00Z')
const CWD = '/tmp/demo'
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'ship-guard',
  component: 'Pane',
  requestId: 'ship-guard',
  props: { title: '外に出す操作の見張り', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const PUSH = `git -c credential.helper= -c credential.helper='!gh auth git-credential' push`

/**
 * reply: その場で聞かれた時の答え。undefined なら聞けない (閉じられた)。
 * gitLog / gitExit: git log の出力と終了コード。git: 呼ばれた git の argv と場所
 */
type World = { reply?: string; asked: string[]; ran: string[]; registered: string[]; gitLog: string; gitExit: number; git: { argv: string[]; cwd?: string }[] }

// ソースに本物らしい個人情報を書かない (このリポジトリを push する時に自分で引っかからないように、つないで作る)
const AT = '@'
const PERSONAL = `ta${'ro'}.y${AT}gmail.com`
const HOME_WIN = ['C:', 'Users', `ke${'nta'}`, 'proj', 'a.ts'].join('\\')
const HOME_SHOWN = ['C:', 'Users', 'ke***'].join('\\')
const HOME_MSYS =['', 'c', 'Users', `ke${'nta'}`, 'x'].join('/')
const NOREPLY = `123+takosasi-dev${AT}users.noreply.github.com`
/** git log -p の 1 コミット分 */
const commit = (hash: string, email: string, added: string[], file = 'README.md') =>
  `\x01${hash}\x00takosasi-dev\x00${email}\x00takosasi-dev\x00${email}\n\ndiff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,0 +2,${added.length} @@\n${added.map(a => `+${a}`).join('\n')}\n`

// エンジンの代役を下に置く (下の hook はテストの最初の $ より前に全部登録する)
const setup = (on: On) => {
  mock.clock(on, { now: NOW })
  const w: World = { reply: '実行する', asked: [], ran: [], registered: [], gitLog: commit('a1', NOREPLY, ['ok']), gitExit: 0, git: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('process.run', (_$, e) => {
    w.git.push({ argv: [...e.argv], cwd: e.init?.cwd })
    const isOk = w.gitExit === 0
    return {
      value: { exitCode: w.gitExit, stdout: isOk ? w.gitLog : '', stderr: isOk ? '' : 'fatal: not a git repository\n', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('command.register', (_$, e) => {
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]?.question ?? ''
    w.asked.push(q)
    if (w.reply === undefined) throw new Error('dismissed')
    return {
      result: { questions: e.questions, answers: { [q]: w.reply } },
      text: `User has answered your questions: "${q}"="${w.reply}". You can now continue with the user's answers in mind.`,
    } as never
  })
  on('tool.call', (_$, e) => {
    w.ran.push(String((e as unknown as { command?: unknown }).command ?? ''))
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
  })
  return w
}

const begin = ($: Engine) => $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
const startTurn = ($: Engine) => $.turn.start({ text: 'やって', turnId: 't1' })
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
/** Claude が AskUserQuestion で聞いて、ユーザーが答えた */
const claudeAsks = ($: Engine, w: World, question: string, answer: string) => {
  w.reply = answer
  return $.tool.call({ tool: 'AskUserQuestion', questions: [{ question, header: '確認', multiSelect: false, options: [{ label: answer, description: '' }, { label: 'ほか', description: '' }] }] } as never)
}

type View = Pick<Mounted, 'findAll'>
const shown = async (ui: View) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.alt)}\n${String(s.props.source)}`), ...texts.map(t => t.text)].join('\n')
}

test('純関数: 外に出す操作の見分け', () => {
  expect(outwardOf('git push')).toBe('git push')
  expect(outwardOf(`${PUSH} origin main`)).toBe('git push')
  expect(outwardOf('cd "D:/x" && git -C repo push --tags')).toBe('git push')
  expect(outwardOf('C:\\Git\\bin\\git.exe push')).toBe('git push')
  expect(outwardOf('gh release create v0.8.0 --verify-tag --prerelease --notes-file n.md')).toBe('gh release')
  expect(outwardOf('gh release upload v1 a.exe')).toBe('gh release')
  expect(outwardOf('gh repo create takosasi-dev/x --public --source .')).toBe('gh repo create')
  expect(outwardOf('npm publish --access public')).toBe('npm publish')
  expect(outwardOf('pnpm publish')).toBe('npm publish')
  expect(outwardOf('git status; if ($?) { gh release create v1 }')).toBe('gh release')
  for (const c of ['git status', 'git commit -m "git push later"', 'echo git push', 'gh release view v1', 'gh repo view', 'npm install', 'git log --grep push', "git commit -F - <<'EOF'\nthen git push\nEOF"])
    expect(outwardOf(c)).toBeUndefined()
})

test('純関数: AskUserQuestion の答えの読み取り', () => {
  const said = (q: string, a: string) => `User has answered your questions: "${q}"="${a}". You can now continue.`
  expect(approvedIn(said('どこまでやりますか？', '公開+リリース v0.1.0'))).toBe('どこまでやりますか？')
  expect(approvedIn(said('GitHub へ push してよいですか？', 'はい'))).toBe('GitHub へ push してよいですか？')
  expect(approvedIn(said('GitHub へ push してよいですか？', 'やめる'))).toBeUndefined()
  expect(approvedIn(said('どうしますか？', '公開しない'))).toBeUndefined()
  expect(approvedIn(said('色はどれにしますか？', '青'))).toBeUndefined()
  expect(approvedIn('読めない文')).toBeUndefined()
  expect(approvedIn(`${said('色は？', '青').slice(0, -14)}, "リリースしますか？"="する". You can now continue.`)).toBe('リリースしますか？')
})

test('外に出す操作でなければ聞かずに通す', async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  await bash($, 'git status')
  await $.tool.call({ tool: 'PowerShell', command: 'git log -1' } as never)
  expect(w.asked).toEqual([])
  expect(w.ran).toEqual(['git status', 'git log -1'])
})

test('確認が無ければその場で聞く。「実行する」なら通し、同じターンの続き (リリース) は聞き直さない', async ($, on) => {
  const w = setup(on)
  await begin($)
  expect(w.registered).toContain('guard')
  await startTurn($)
  const r = await bash($, `${PUSH} origin main`)
  expect(r.deny).toBeUndefined()
  expect(w.asked.length).toBe(1)
  expect(w.asked[0]).toContain('外に出す操作 (git push) を実行しようとしています')
  expect(w.ran).toEqual([`${PUSH} origin main`])
  await bash($, 'gh release create v1 --verify-tag')
  expect(w.asked.length).toBe(1)
  expect(w.ran.length).toBe(2)
})

test('「やめる」と答えたら止め、理由を Claude に返す (PowerShell でも)', async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  w.reply = 'やめる'
  const r = await $.tool.call({ tool: 'PowerShell', command: 'git push origin main' } as never)
  expect(r.deny).toBe('ship-guard: ユーザーが実行しないと答えたので git push を止めました。返事に従ってください。')
  expect(w.ran).toEqual([])
  w.reply = 'まだテストが落ちているので待って'
  const r2 = await bash($, 'npm publish')
  expect(r2.deny).toContain('(ユーザーの返事:「まだテストが落ちているので待って」)')
})

test('聞けない時 (閉じられた・-p) は止めて、AskUserQuestion で聞くように返す', async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  w.reply = undefined
  const r = await bash($, 'git push')
  expect(r.deny).toContain('AskUserQuestion で実行してよいか確かめてから')
  expect(w.ran).toEqual([])
})

test('Claude が AskUserQuestion で公開の許可を取っていれば、そのターンと次のターンは聞かない', async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  await claudeAsks($, w, 'GitHub に公開しますか？', '公開+リリース v0.8.0')
  w.asked.length = 0
  await bash($, 'git push')
  await startTurn($)
  await bash($, 'gh release create v0.8.0')
  expect(w.asked).toEqual([])
  expect(w.ran).toEqual(['git push', 'gh release create v0.8.0'])
  // 2 つ先のターンでは効かない
  await startTurn($)
  w.reply = 'やめる'
  const r = await bash($, 'git push')
  expect(r.deny).toBeDefined()
  expect(w.asked.length).toBe(1)
})

test('断った AskUserQuestion では許可にしない', async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  await claudeAsks($, w, 'push しますか？', 'やめておく')
  w.asked.length = 0
  w.reply = 'やめる'
  const r = await bash($, 'git push')
  expect(r.deny).toBeDefined()
  expect(w.asked.length).toBe(1)
})

test('ペイン: 記録と状態。「このセッションは見張らない」で聞かずに通す', async ($, on) => {
  const w = setup(on)
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await shown(ui)).toContain('見張り中')
    expect(await shown(ui)).toContain('まだありません')
    await ui.unmount()
  }
  await startTurn($)
  w.reply = 'やめる'
  await bash($, 'git push')
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await vs.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('断られたので止めた')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await shown(term)).toContain('14:00 git push ─ 断られたので止めた')

  await term.press({ key: 'off' })
  expect(await shown(term)).toContain('このセッションは見張っていません')
  w.asked.length = 0
  await bash($, 'git push')
  expect(w.asked).toEqual([])
  expect(w.ran).toEqual(['git push'])
  await term.press({ key: 'on' })
  expect(await shown(term)).toContain('見張り中')
})

test('純関数: push を読む場所・送る範囲', () => {
  expect(repoDirOf(`cd "D:/public-copy/claude-code-mods" && ${PUSH} origin main --tags`)).toBe('D:/public-copy/claude-code-mods')
  expect(repoDirOf('cd /d/repo && git status && cd sub; git push')).toBe('sub')
  expect(repoDirOf("git -C 'C:/a b/repo' push")).toBe('C:/a b/repo')
  expect(repoDirOf('Set-Location -LiteralPath "D:\\x"; if ($?) { git push }')).toBe('D:\\x')
  expect(repoDirOf('git push')).toBeUndefined()
  expect(repoDirOf('git push; cd elsewhere')).toBeUndefined()
  expect(resolveDir(undefined, 'C:/w')).toBe('C:/w')
  expect(resolveDir('/d/repo', 'C:/w')).toBe('D:/repo')
  expect(resolveDir('sub', 'C:/w/')).toBe('C:/w/sub')
  expect(resolveDir('/home/x/r', '/tmp')).toBe('/home/x/r')
  expect(rangeOf('git push')).toEqual(['HEAD', '--not', '--remotes'])
  expect(rangeOf('git push origin main --tags')).toEqual(['--branches', '--tags', '--not', '--remotes'])
  expect(rangeOf('git commit -m " --tags" && git push')).toEqual(['HEAD', '--not', '--remotes'])
})

test('純関数: 公開前のチェック', () => {
  const cfg = { allowed: [] as string[], words: [] as string[] }
  expect(scanPush(commit('a1', NOREPLY, ['const x = 1', `noreply${AT}anthropic.com`, `me${AT}example.com`, 'react@18.3.1', 'C:\\Users\\<名前>\\x','/home/runner/work', '/home/a/x']), cfg)).toEqual([])
  const found = scanPush(commit('a1', PERSONAL, [`mail: ${PERSONAL}`, `path ${HOME_WIN}`]) + commit('b2', PERSONAL, [`also ${HOME_MSYS}`], 'docs/b.md'), cfg)
  expect(found).toEqual(['作者のメールが noreply ではない: ta***@gmail.com (2 コミット)', '個人のメールらしい文字列: ta***@gmail.com (README.md)', `ユーザー名入りのパス: ${HOME_SHOWN} (README.md ほか 1 件)`])
  // 許したメールと、気にする言葉 (大文字小文字は見ない)
  expect(scanPush(commit('a1', PERSONAL, ['by Nakano']), { allowed: ['@gmail.com'], words: ['nakano'] })).toEqual(['気にする言葉「nakano」 (README.md)'])
  // 消した行 (-) と、ファイル名の行 (+++) は見ない
  expect(scanPush(`\x01c3\x00a\x00${NOREPLY}\x00a\x00${NOREPLY}\n--- a/${PERSONAL}\n+++ b/x.md\n-${PERSONAL}\n`, cfg)).toEqual([])
})

test('git push: 確認済みで中身もきれいなら聞かずに通す。読む場所は cd の先', async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  await claudeAsks($, w, 'GitHub に公開しますか？', '公開する')
  w.asked.length = 0
  const r = await bash($, `cd "D:/public-copy/claude-code-mods" && ${PUSH} origin main`)
  expect(r.deny).toBeUndefined()
  expect(w.asked).toEqual([])
  expect(w.git.length).toBe(1)
  expect(w.git[0]?.cwd).toBe('D:/public-copy/claude-code-mods')
  expect(w.git[0]?.argv).toContain('log')
  expect(w.git[0]?.argv.slice(-3)).toEqual(['HEAD', '--not', '--remotes'])
  // gh release は読まない
  await bash($, 'gh release create v1')
  expect(w.git.length).toBe(1)
})

test('git push: 気になる所があれば確認済みでも聞き直し、断られたら中身ごと Claude に返す', async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  await claudeAsks($, w, 'GitHub に公開しますか？', '公開する')
  w.asked.length = 0
  w.gitLog = commit('a1', PERSONAL, [`see ${HOME_WIN}`])
  w.reply = 'やめる'
  const r = await bash($, 'git push')
  expect(w.asked.length).toBe(1)
  expect(w.asked[0]).toContain('公開前のチェックで気になる所がありました。')
  expect(w.asked[0]).toContain('・作者のメールが noreply ではない: ta***@gmail.com (1 コミット)')
  expect(r.deny).toContain('公開前のチェックで気になった所:\n・作者のメールが noreply ではない')
  expect(r.deny).toContain(`・ユーザー名入りのパス: ${HOME_SHOWN} (README.md)`)
  expect(w.ran).toEqual([])
  // ペインに数と中身
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = await shown(ui)
    expect(text).toContain('断られたので止めた・気になる所 2 件')
    expect(text).toContain('最後の公開前チェックで気になった所')
    expect(text).not.toContain(PERSONAL)
    await ui.unmount()
  }
  // 「実行する」なら通す
  w.reply = '実行する'
  const r2 = await bash($, 'git push')
  expect(r2.deny).toBeUndefined()
  expect(w.ran).toEqual(['git push'])
})

test('git push: 送るコミットを読めない時は、理由を付けてその場で聞く', async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  await claudeAsks($, w, 'push してよい？', 'はい')
  w.asked.length = 0
  w.gitExit = 128
  w.reply = undefined
  const r = await bash($, 'git push')
  expect(w.asked[0]).toContain(`送るコミットを読めませんでした (${CWD}: fatal: not a git repository)`)
  expect(r.deny).toContain('AskUserQuestion で実行してよいか確かめてから')
})

test('設定: checkBeforePush を切ると読まない。気にしないメールは引っかけない', { options: { checkBeforePush: false } }, async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  await claudeAsks($, w, 'push してよい？', 'はい')
  w.gitLog = commit('a1', PERSONAL, ['x'])
  await bash($, 'git push')
  expect(w.git).toEqual([])
  expect(w.ran).toEqual(['git push'])
})

test('設定: allowedEmails のドメインは気にしない', { options: { allowedEmails: '@gmail.com' } }, async ($, on) => {
  const w = setup(on)
  await begin($)
  await startTurn($)
  await claudeAsks($, w, 'push してよい？', 'はい')
  w.asked.length = 0
  w.gitLog = commit('a1', PERSONAL, [`mail ${PERSONAL}`])
  await bash($, 'git push')
  expect(w.asked).toEqual([])
  expect(w.ran).toEqual(['git push'])
})
