import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitPaneSnapshot } from '../types'
import { paneLines, paneSvg, toRepo } from './git'
import { followTheme, readTheme } from './style'

const PANE = 'git-pane'
const TITLE = 'git'
const DESCRIPTION = '今の作業フォルダの git の様子(変更・行数・ブランチ・直近コミット)をペインで見る'
const GAP = 2000
// ファイルを変えうるツール。終わったらペインを読み直す
const WRITERS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])

const SNAP = atom({ plugin: 'git-pane', key: 'snap' } as const, { kind: 'idle' })
const NOTE = atom({ plugin: 'git-pane', key: 'note' } as const, '')

const REVIEW =
  '今の作業フォルダの git の差分(git diff と git diff --cached)を読んで、レビューしてください。' +
  'バグ・抜け・直したほうがよい点を、ファイルと行を挙げて教えてください。'
const COMMIT_MSG =
  '今の git の変更(ステージ済みと未ステージ)を読んで、コミットメッセージを考えてください。' +
  '1 行目は短い要約、空行のあとに中身を箇条書きで。コミットはまだしないでください。'

// git を読むだけ。書き込む操作 (commit・add・stash など) は呼ばない。
// GIT_OPTIONAL_LOCKS=0: status が読むついでに index を書き直さない (Claude の git add/commit と index.lock でぶつからない)。
// core.fsmonitor=false: リポジトリの設定が指すコマンドを走らせない
const git = ($: EngineInterface, cwd: string, args: string[]) =>
  $.process.run(['git', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...args], {
    cwd,
    env: { GIT_OPTIONAL_LOCKS: '0' },
    timeoutMs: 15_000,
  })

// ponytail: 主の名前を持てたかはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false

async function load($: EngineInterface) {
  const cwd = await $.session.cwd()
  let snap: GitPaneSnapshot
  try {
    const inside = await git($, cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside.exitCode !== 0 && /dubious ownership/.test(inside.stderr)) snap = { kind: 'unsafe', cwd }
    else if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') snap = { kind: 'not-repo', cwd }
    else {
      const [st, un, ca, lg] = await Promise.all([
        git($, cwd, ['status', '--porcelain=v1', '-b', '--no-renames']),
        // 作業ツリーと index の比べ。git diff は GIT_OPTIONAL_LOCKS を見ずに index を書き直すので diff-files にする
        git($, cwd, ['diff-files', '--numstat', '--no-renames']),
        git($, cwd, ['diff', '--cached', '--numstat', '--no-renames']),
        // 題を最後に置く (題にタブがあっても崩れない)。コミットが無いと失敗するので空として読む
        git($, cwd, ['log', '-8', '--format=%h%x09%ct%x09%s']),
      ])
      if (st.exitCode !== 0) throw new Error(st.stderr.trim() || 'git status が失敗しました')
      const at = await $.clock.now()
      snap = { kind: 'repo', cwd, loadedAt: at, ...toRepo(st.stdout, un.stdout, ca.stdout, lg.exitCode === 0 ? lg.stdout : '') }
    }
  } catch (err) {
    snap = { kind: 'error', cwd, message: err instanceof Error ? err.message : String(err) }
  }
  await update($, SNAP, () => snap)
}

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(p => p.id === PANE)

async function fill($: EngineInterface, text: string) {
  const isFilled = await $.prompt.fill({ text, mode: 'insert' }).then(
    r => r.isFilled,
    () => false,
  )
  await update($, NOTE, () => (isFilled ? '入力欄に入れました(送信はしていません)' : '入力欄に入れられませんでした'))
}

const clockLabel = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

// ponytail: 間引きの印はモジュール変数。リロードで消えても 1 回多く読むだけ
let lastAuto = 0
let isPending = false

// ツールが終わるたびに呼ばれる。2 秒に 1 回まで、間の分は最後に 1 回まとめて読む
async function schedule($: EngineInterface) {
  if (isPending) return
  isPending = true
  const wait = Math.max(1, lastAuto + GAP - (await $.clock.now()))
  $.clock.after(wait, () => {
    void (async () => {
      isPending = false
      if (!(await isOpen($))) return
      lastAuto = await $.clock.now()
      await load($)
    })().catch(() => {})
  })
}

const reload = async ($: EngineInterface) => {
  await update($, NOTE, () => '')
  await load($)
}

const openPane = async ($: EngineInterface) => {
  await reload($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'git のペインを開きました。' }
}

export const register: Register = on => {
  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // /git が組み込みと被って拒まれたら /gitpane にする
    const got = await $.command.register({ name: 'git', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'git'
    if (!ownsMain) await $.command.register({ name: 'gitpane', description: DESCRIPTION }).catch(() => {})
    if (await isOpen($)) void load($).catch(() => {})
    return started
  })

  // /git を持てなかった時は、その名前の持ち主 (組み込みなど) に回す
  on('command.run', { command: 'git' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'gitpane' }, async $ => openPane($))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (WRITERS.has(String(e.tool))) void schedule($).catch(() => {})
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const snap = await read($, SNAP)
    const note = await read($, NOTE)
    const now = await $.clock.now()
    const lines = paneLines(snap, now)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={paneSvg(snap, now)} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column">
          <Button key="reload" label="再読込" variant="primary" onPress={() => void reload($)} />
          <Button key="review" dimColor label="差分をレビューして" onPress={() => void fill($, REVIEW)} />
          <Button key="commit-msg" dimColor label="コミットメッセージを考えて" onPress={() => void fill($, COMMIT_MSG)} />
        </Box>
        {note !== '' && <Text dimColor>{note}</Text>}
        {snap.kind === 'repo' && <Text dimColor>{`読込 ${clockLabel(snap.loadedAt)}`}</Text>}
      </Box>
    )
  })
}
