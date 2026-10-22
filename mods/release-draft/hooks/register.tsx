import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DraftBump, DraftReport } from '../types'
import { MAX_BUMPS, MAX_COMMITS, askText, commitDirOf, draftText, isCommit, isVersionFile, paneLines, paneSvg, parseLog, resolveDir, versionOf } from './draft'
import { followTheme, readTheme, short } from './style'

const PANE = 'release-draft'
const TITLE = 'リリースノートの下書き'
const DESCRIPTION = '前のタグからの変更で CHANGELOG の下書きと次の版の候補を作るペインを開く'
/** ペインに出す下書きの行の上限 */
const DRAFT_LINES = 40

const REPORT = atom({ plugin: 'release-draft', key: 'report' } as const, { kind: 'idle' })
const REPO = atom({ plugin: 'release-draft', key: 'repo' } as const, '')

type $ = EngineInterface

let ownsMain = false
let loadSeq = 0

const SHELL_TOOLS = ['Bash', 'PowerShell']

// git を読むだけ。書き込む操作は呼ばない。
// GIT_OPTIONAL_LOCKS=0 で index を書き直さない。core.fsmonitor=false と --no-textconv / --no-ext-diff で
// リポジトリの設定が指すコマンドを走らせない。--literal-pathspecs でパスをワイルドカードとして読まない
const git = ($: $, cwd: string, args: string[]) =>
  $.process.run(['git', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '--literal-pathspecs', ...args], {
    cwd,
    env: { GIT_OPTIONAL_LOCKS: '0' },
    timeoutMs: 20_000,
  })

const lines = (out: string) => out.split(/\r?\n/).filter(l => l !== '')

async function readReport($: $): Promise<DraftReport> {
  const cwd = await $.session.cwd()
  const dir = (await read($, REPO)) || cwd
  try {
    const top = await git($, dir, ['rev-parse', '--show-toplevel'])
    if (top.exitCode !== 0) return { kind: 'not-repo', dir }
    const root = top.stdout.trim()
    const described = await git($, root, ['describe', '--tags', '--abbrev=0'])
    const tag = described.exitCode === 0 && described.stdout.trim() !== '' ? described.stdout.trim() : null
    const range = tag ? `${tag}..HEAD` : 'HEAD'
    const [log, count, changed, untracked] = await Promise.all([
      git($, root, ['log', '--no-merges', '--format=%h%x00%s', '-n', String(tag ? MAX_COMMITS : 50), range]),
      tag ? git($, root, ['rev-list', '--count', '--no-merges', range]) : undefined,
      // タグと作業ツリーを比べる (まだコミットしていない版上げも拾う)
      tag ? git($, root, ['diff', '--name-only', '--no-renames', '--no-textconv', '--no-ext-diff', tag]) : undefined,
      git($, root, ['ls-files', '--others', '--exclude-standard']),
    ])
    const commits = log.exitCode === 0 ? parseLog(log.stdout) : []
    const commitCount = count && count.exitCode === 0 ? Number(count.stdout.trim()) || commits.length : commits.length
    const tracked = changed && changed.exitCode === 0 ? lines(changed.stdout) : []
    const fresh = untracked.exitCode === 0 ? lines(untracked.stdout) : []
    const bumps: DraftBump[] = []
    if (tag) {
      const paths = [...tracked, ...fresh].filter(isVersionFile).slice(0, MAX_BUMPS)
      const read1 = async (path: string) => {
        const old = tracked.includes(path) ? await git($, root, ['show', `${tag}:${path}`]) : undefined
        const from = old && old.exitCode === 0 ? versionOf(old.stdout) : undefined
        const now = versionOf(await $.fs.read(`${root.replace(/[\\/]+$/, '')}/${path}`).catch(() => undefined))
        if (now && now.version !== from?.version) bumps.push({ path, name: now.name || from?.name || path, ...(from ? { from: from.version } : {}), to: now.version })
      }
      for (const path of paths) await read1(path)
    }
    bumps.sort((a, b) => a.name.localeCompare(b.name))
    return {
      kind: 'ready',
      dir: root,
      loadedAt: await $.clock.now(),
      tag,
      commits,
      commitCount,
      isCut: commitCount > commits.length,
      bumps,
      fileCount: new Set([...tracked, ...fresh]).size,
    }
  } catch (err) {
    return { kind: 'error', message: short(err instanceof Error ? err.message : String(err), 200) }
  }
}

/** 読み直す。遅れて終わった古い読み込みで新しい結果を上書きしない */
async function load($: $) {
  const seq = ++loadSeq
  await update($, REPORT, r => (r.kind === 'ready' ? r : { kind: 'loading' as const }))
  const report = await readReport($)
  if (seq === loadSeq) await update($, REPORT, () => report)
}

const isOpen = async ($: $) => (await $.ui.panes()).some(p => p.id === PANE)

const todayOf = (ms: number) => {
  const d = new Date(ms)
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n, k) => (k === 0 ? String(n) : String(n).padStart(2, '0'))).join('-')
}

async function ask($: $) {
  const report = await read($, REPORT)
  if (report.kind !== 'ready') return
  const r = await $.prompt.fill({ text: askText(report, todayOf(await $.clock.now())), mode: 'insert' }).catch(() => ({ isFilled: false, refusal: undefined }))
  const why = r.refusal === 'dialog' ? '(ダイアログが開いています)' : r.refusal === 'no_composer' ? '(この画面には入力欄がありません)' : ''
  $.ui.toast(r.isFilled ? '入力欄に入れました(送信はしていません)' : `入力欄に入れられませんでした${why}`, { timeoutMs: 5000 })
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  await load($)
  return { text: 'リリースノートの下書きのペインを開きました。' }
}

export const register: Register = on => {
  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    const got = await $.command.register({ name: 'release', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'release'
    if (!ownsMain) await $.command.register({ name: 'release-draft', description: DESCRIPTION }).catch(() => {})
    return started
  })

  on('command.run', { command: 'release' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'release-draft' }, openPane)

  // Claude がコミットしたら、その場所を覚えて (cd してからのコミットが多いので)、ペインが開いていれば読み直す
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true || !SHELL_TOOLS.includes(String(e.tool))) return r
    const command = (e as unknown as { command?: unknown }).command
    if (typeof command !== 'string' || !isCommit(command)) return r
    const dir = resolveDir(commitDirOf(command), await $.session.cwd())
    await update($, REPO, () => dir)
    if (await isOpen($)) await load($)
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const report = await read($, REPORT)
    const repo = await read($, REPO)
    const today = todayOf(await $.clock.now())
    const input = { report, today, isOverridden: repo !== '' }
    const head = paneLines(input)
    const draft = report.kind === 'ready' ? draftText(report, today).split('\n') : []
    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={paneSvg(input)} alt={head.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {head.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        {draft.length > 0 ? (
          <Box key="draft" flexDirection="column">
            {draft.slice(0, DRAFT_LINES).map(l => (
              <Text bold={l.startsWith('#')}>{l === '' ? ' ' : l}</Text>
            ))}
            {draft.length > DRAFT_LINES ? <Text dimColor>…ほか {draft.length - DRAFT_LINES} 行</Text> : null}
          </Box>
        ) : null}
        <Box key="buttons" flexDirection="row" gap={1}>
          {report.kind === 'ready' ? <Button key="ask" label="これで CHANGELOG を書いて" variant="primary" onPress={() => void ask($)} /> : null}
          <Button key="reload" label="読み直す" onPress={() => void load($)} />
          {repo !== '' ? <Button key="here" label="セッションの場所で読む" onPress={() => void update($, REPO, () => '').then(() => load($))} /> : null}
        </Box>
        <Text dimColor>git は読むだけです。「これで CHANGELOG を書いて」は入力欄に入れるだけで、送信はしません。</Text>
      </Box>
    )
  })
}
