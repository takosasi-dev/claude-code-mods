import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EditLogDetail, EditLogEntry } from '../types'
import { detailLines, detailSvg, diffBody, fileStats, linesOf, overviewLines, overviewSvg, parentDir, plain, relPath } from './editlog'
import { followTheme, readTheme } from './style'

const PANE = 'edit-log'
const TITLE = '変更ログ'
const DESCRIPTION = 'このセッションで Claude が変えたファイルを時系列で見る'
/** 覚えておく回数。超えたら古い物から捨てる */
const KEEP = 300
// ファイルを変えるツール。MultiEdit はこのビルドの表に無いので名前の文字列で比べる
const WRITERS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const ENTRIES = atom({ plugin: 'edit-log', key: 'entries' } as const, [] as EditLogEntry[])
const SELECTED = atom({ plugin: 'edit-log', key: 'selected' } as const, '')
const DETAIL = atom({ plugin: 'edit-log', key: 'detail' } as const, { kind: 'loading' } as EditLogDetail)
const NOTE = atom({ plugin: 'edit-log', key: 'note' } as const, '')

type $ = EngineInterface

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const message = (err: unknown) => plain(err instanceof Error ? err.message : String(err))

// ponytail: 主の名前を持てたかはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false

async function record($: $, tool: string, input: Record<string, unknown>, isError: boolean, isSub: boolean) {
  const file = str(input.file_path) || str(input.notebook_path)
  if (file === '') return
  const cwd = await $.session.cwd().catch(() => '')
  const at = await $.clock.now()
  await update($, ENTRIES, list => {
    const id = (list[list.length - 1]?.id ?? 0) + 1
    // file は git に渡すのでそのまま。label は画面と入力欄の文にだけ使うので制御文字を落とす
    const entry: EditLogEntry = { id, at, file, label: plain(relPath(cwd, file)), tool, isError, lines: linesOf(tool, input), isSub }
    return [...list, entry].slice(-KEEP)
  })
}

// git を読むだけ。書き込む操作は呼ばない。
// --literal-pathspecs: パスの [ ] * を形として読まない。core.fsmonitor=false: リポジトリが指すコマンドを走らせない。
// GIT_OPTIONAL_LOCKS=0: 読むついでに index を書き直さない
const git = ($: $, cwd: string, args: string[]) =>
  $.process.run(['git', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '--literal-pathspecs', ...args], {
    cwd,
    env: { GIT_OPTIONAL_LOCKS: '0' },
    timeoutMs: 15_000,
  })

// 差分の形。--no-textconv・--no-ext-diff: リポジトリの設定が指すコマンドを走らせない
const DIFF_OPTS = ['-p', '--no-color', '--no-ext-diff', '--no-textconv']

async function loadDiff($: $, label: string, file: string): Promise<EditLogDetail> {
  try {
    // ファイルの親フォルダで走らせる (作業フォルダの外の worktree のファイルもそのリポジトリで読む)
    const cwd = parentDir(file) || (await $.session.cwd())
    const inside = await git($, cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return { kind: 'not-repo' }
    // HEAD と比べて、git add した後の変更も出す。まだコミットが無ければ作業ツリーと index の差だけ。
    // git diff は GIT_OPTIONAL_LOCKS を見ずに index を書き直すので、書かない diff-index / diff-files を使う
    const head = await git($, cwd, ['diff-index', ...DIFF_OPTS, 'HEAD', '--', file])
    const d = head.exitCode === 0 ? head : await git($, cwd, ['diff-files', ...DIFF_OPTS, '--', file])
    if (d.exitCode !== 0) return { kind: 'error', message: plain(d.stderr.trim()) || `git diff が失敗しました (${label})` }
    const body = diffBody(d.stdout)
    if (body) return { kind: 'diff', ...body }
    return /^(?:Binary files |GIT binary patch|old mode )/m.test(d.stdout) ? { kind: 'meta' } : { kind: 'clean' }
  } catch (err) {
    return { kind: 'error', message: message(err) }
  }
}

async function openDetail($: $, label: string, file: string) {
  await update($, NOTE, () => '')
  await update($, SELECTED, () => label)
  await update($, DETAIL, () => ({ kind: 'loading' }))
  const detail = await loadDiff($, label, file)
  // 読んでいる間に別のファイルを開いたら捨てる
  if ((await read($, SELECTED)) === label) await update($, DETAIL, () => detail)
}

const closeDetail = async ($: $) => {
  await update($, SELECTED, () => '')
  await update($, NOTE, () => '')
}

async function reset($: $) {
  await update($, ENTRIES, () => [])
  await closeDetail($)
}

const REFUSAL: Record<string, string> = {
  no_composer: 'この画面には入力欄がありません',
  dialog: 'ダイアログが開いているので入れられませんでした',
}

async function fill($: $, text: string) {
  let note: string
  try {
    const r = await $.prompt.fill({ text, mode: 'insert' })
    note = r.isFilled
      ? '入力欄に入れました(送信はしていません)'
      : `入力欄に入れられませんでした: ${(r.refusal && REFUSAL[r.refusal]) || 'ほかの mod か画面に断られました'}`
  } catch (err) {
    note = `入力欄に入れられませんでした: ${message(err)}`
  }
  await update($, NOTE, () => note)
}

const reviewText = (label: string) =>
  `${label} をレビューしてください。このセッションで変えたところ(git diff)を中心に、` +
  'バグ・抜け・直したほうがよい点を、行を挙げて教えてください。'
const explainText = (label: string) =>
  `${label} にこのセッションで入れた変更(git diff)を読んで、何をなぜ変えたのかを短く説明してください。`

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '変更ログを開きました。' }
}

export const register: Register = on => {
  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // /edits が拒まれたら (組み込みと被ったら) /edit-log にする
    const got = await $.command.register({ name: 'edits', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'edits'
    if (!ownsMain) await $.command.register({ name: 'edit-log', description: DESCRIPTION }).catch(() => {})
    return started
  })

  // /edits を持てなかった時は、その名前の持ち主 (組み込みなど) に回す
  on('command.run', { command: 'edits' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'edit-log' }, openPane)

  // /clear で記録を空にする
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)
    return next(e)
  })

  // 見るだけ。ツールが終わってから記録する (失敗してもツールは止めない)
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (WRITERS.has(tool)) {
      const isError = ran.deny !== undefined || ran.isError === true
      await record($, tool, e as unknown as Record<string, unknown>, isError, e.agentId !== undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Code } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const entries = await read($, ENTRIES)
    const selected = await read($, SELECTED)
    const note = await read($, NOTE)
    const noteText = note !== '' && <Text color={note.startsWith('入力欄に入れました') ? 'green' : 'warning'}>{note}</Text>

    const linesBox = (lines: ReturnType<typeof overviewLines>) => (
      <Box key="lines" flexDirection="column">
        {lines.map(l => (
          <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
            {l.text}
          </Text>
        ))}
      </Box>
    )

    if (selected === '') {
      const lines = overviewLines(entries)
      const stats = fileStats(entries)
      return (
        <Box flexDirection="column" gap={1}>
          {Svg ? <Svg source={overviewSvg(entries)} alt={lines.map(l => l.text).join('\n')} /> : linesBox(lines)}
          {stats.length > 0 && (
            <Box key="files" flexDirection="column">
              <Text dimColor>ファイルを押すと履歴と差分</Text>
              {stats.map(f => (
                <Button key={`file:${f.label}`} plain onPress={() => void openDetail($, f.label, f.file)}>
                  {f.label} <Text dimColor>{f.fails ? `${f.count}回 失敗${f.fails}` : `${f.count}回`}</Text>
                </Button>
              ))}
            </Box>
          )}
          {entries.length > 0 && <Button key="reset" label="リセット" onPress={() => void reset($)} />}
          {noteText}
        </Box>
      )
    }

    const detail = await read($, DETAIL)
    const lines = detailLines(selected, entries)
    let diff
    if (detail.kind === 'loading') diff = <Text dimColor>差分を読み込み中</Text>
    else if (detail.kind === 'not-repo') diff = <Text color="warning">差分は git のフォルダでだけ出ます</Text>
    else if (detail.kind === 'clean')
      diff = <Text dimColor>git の差分はありません(コミット済みか、git が追っていない新しいファイル)</Text>
    else if (detail.kind === 'meta') diff = <Text dimColor>バイナリか権限だけの変更です</Text>
    else if (detail.kind === 'error') diff = <Text color="red">{`git の差分を読めません: ${detail.message}`}</Text>
    else
      diff = (
        <Box key="diff" flexDirection="column">
          <Code source={detail.diff} format="diff" />
          {detail.isCut && <Text dimColor>長いので途中までです</Text>}
        </Box>
      )
    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? <Svg source={detailSvg(selected, entries)} alt={lines.map(l => l.text).join('\n')} /> : linesBox(lines)}
        <Text bold>git の差分</Text>
        {diff}
        <Box key="actions" flexDirection="column">
          <Button key="review" label="このファイルをレビューして" variant="primary" onPress={() => void fill($, reviewText(selected))} />
          <Button key="explain" label="この変更を説明して" onPress={() => void fill($, explainText(selected))} />
          <Button key="back" label="一覧に戻る" onPress={() => void closeDetail($)} />
        </Box>
        {noteText}
      </Box>
    )
  })
}
