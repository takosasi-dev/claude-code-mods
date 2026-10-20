import { expect, test } from 'claude-code/testing'

import { isDangerous } from '../hooks/danger'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

// 文字列として判定するだけ。実行はしない
const DANGEROUS = [
  'git push',
  'git push --force origin main',
  'git push -f',
  'cd repo && git push origin main',
  'git reset --hard HEAD~1',
  'git clean -fd',
  'git clean -xdf',
  'git branch -D feature',
  'git checkout -- src/app.ts',
  'git restore .',
  'rm -rf node_modules',
  'rm -r build',
  'rm -f a.txt',
  'rm a.txt -f',
  'rm -R dist',
  'Remove-Item C:\\tmp\\x -Recurse -Force',
  'remove-item x -r',
  'robocopy C:\\a D:\\b /MIR',
  'robocopy a b /purge',
  'gh repo delete owner/repo --yes',
  'gh release delete v1.0.0',
  'del /s /q *.tmp',
  'DEL C:\\x /S',
  'rmdir /s /q build',
  'rd /S x',
  'format D: /q',
  'Stop-Process -Name notepad',
  'Get-Process foo | stop-process',
  // 方針: 引用符の中も危ない扱い（用心側）
  'echo "rm -rf /"',
  // git の後ろの全体オプション
  'git -C /repo push --force',
  'git --no-pager push',
  'git -c a=b clean -fdx',
  'git --git-dir=/x/.git reset --hard',
  // 足した物
  'git checkout .',
  'git branch --delete --force feature',
  'git branch -d -f feature',
  'git stash clear',
  "find . -name '*.tmp' -delete",
  'Remove-Item x -Force',
  'git restore --staged --worktree a.ts',
  'git rm -rf dist',
  '/bin/rm -rf x',
]

const SAFE = [
  'git status',
  'git pushd',
  'git log --format=%H',
  'git log --format %H',
  'git reset --soft HEAD~1',
  'git clean -n',
  'git branch -d merged',
  'git checkout main',
  'rm a.txt',
  'rm -i a.txt',
  'rm a.txt; ls -f',
  'pushd dir',
  'Remove-Item a.txt',
  'Remove-Item a.txt; Get-ChildItem -Recurse',
  'robocopy a b /E',
  'gh repo view',
  'gh release list',
  'del a.txt',
  'model /s',
  'rmdir build',
  'dir /s',
  'Format-Table',
  'echo format string',
  'Get-Process',
  'npm run format',
  // 改行の先の別コマンドの -r を拾わない
  'rm build.log\ngrep -rn TODO src',
  'rm a.txt\nls -f',
  // --rm は rm ではない
  'docker run --rm -it ubuntu bash',
  'perm -rf',
  // 誤検知を外す
  'git restore --staged a.ts',
  'git restore -S a.ts',
  'git rm -r --cached dist',
  'git branch --delete merged',
  'git stash list',
  "find . -name '*.tmp'",
]

test('危ないコマンドの判定', () => {
  // 外れた物を全部並べる
  expect(DANGEROUS.filter(c => !isDangerous(c))).toEqual([])
  expect(SAFE.filter(c => isDangerous(c))).toEqual([])
})

test('長い入力でも判定が遅くならない（先頭だけ見る）', () => {
  const t0 = Date.now()
  expect(isDangerous('rm '.repeat(30000))).toBe(false)
  expect(isDangerous('git reset '.repeat(10000))).toBe(false)
  expect(Date.now() - t0).toBeLessThan(1000)
  // 先頭 10000 字の中にあれば見つける
  expect(isDangerous('git push; ' + 'x'.repeat(50000))).toBe(true)
})

const row = (tool: string, command: string) => ({
  tool_use_id: 't1',
  tool,
  input: { command },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
})

test('危ない行は標準の行を赤枠で包む（全画面種・代役は Text）', async ($, on) => {
  // 標準の描画の代役
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const surface of SURFACES) {
    for (const tool of ['Bash', 'PowerShell']) {
      const ui = await $.ui.mount({
        plugin: 'danger-frame',
        surface,
        component: 'ToolUse',
        props: row(tool, 'git push --force'),
      })
      expect(await ui.drawn()).toMatchObject({
        type: 'Box',
        props: { borderStyle: 'round', borderColor: 'red' },
      })
      expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('危ない行は core 自身の描画 { type: "engine" } も包める（全画面種）', async ($, on) => {
  // 実セッションで next(e) が返す形
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine', ref: 0 }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'danger-frame',
      surface,
      component: 'ToolUse',
      props: row('Bash', 'rm -rf build'),
    })
    expect(await ui.drawn()).toMatchObject({
      type: 'Box',
      props: { borderColor: 'red' },
      children: [{ type: 'engine' }],
    })
    await ui.unmount()
  }
})

test('危なくない行・別ツールは標準のまま（全画面種）', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const cases = [row('Bash', 'git status'), row('Read', 'rm -rf x'), { ...row('Bash', ''), input: { file_path: 'a' } }]
  for (const surface of SURFACES) {
    for (const props of cases) {
      const ui = await $.ui.mount({ plugin: 'danger-frame', surface, component: 'ToolUse', props })
      expect(await ui.drawn()).toMatchObject({ type: 'Text' })
      expect(await ui.find({ type: 'Box' })).toBeUndefined()
      await ui.unmount()
    }
  }
})
