import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { TestRunnerResult } from '../types'
import { HISTORY, UNSET_HINT, cardOf, claudeResult,countResults, failingLine, fixPrompt, isCommitCommand, isTestCommand, paneLines, paneSvg, splitCommand, statusOf, tailOf } from './runner'
import { followTheme, readTheme } from './style'

const PANE = 'test-runner'
const TITLE = 'テスト'
const DESCRIPTION = 'テストを走らせて結果を見るペインを開く'
// 出力はこの長さの末尾だけ持つ (数を拾うのも末尾 60 行もここから)
const KEEP = 200_000
/** 時間の上限の上限 (1 時間) */
const MAX_TIMEOUT_SECONDS = 3600

const RUN = atom({ plugin: 'test-runner', key: 'run' } as const, { kind: 'idle' })
const HIST = atom({ plugin: 'test-runner', key: 'history' } as const, [])
const NOTE = atom({ plugin: 'test-runner', key: 'note' } as const, '')

type $ = EngineInterface

// ponytail: 走っている子の止め方はモジュール変数。リロードで消えるが、その時は子もエンジンが止める
let stopActive: ((why: 'user' | 'timeout') => void) | undefined

// 設定は register で userConfig から入れる
const cfg = { command: '', argv: [] as string[], timeoutMs: 300_000 }
let ownsMain = false

async function runTests($: $) {
  const { command, argv, timeoutMs } = cfg
  if (argv.length === 0) {
    await update($, NOTE, () => UNSET_HINT)
    return
  }
  const startedAt = await $.clock.now()
  // 二重に走らせない: 実行中でなければ自分が「実行中」を書く
  let isMine = false
  await update($, RUN, r => {
    isMine = r.kind !== 'running'
    return isMine ? { kind: 'running' as const, command, startedAt } : r
  })
  if (!isMine) return
  await update($, NOTE, () => '')

  const cwd = await $.session.cwd()
  let out = ''
  let stoppedBy: 'user' | 'timeout' | undefined
  let code: number | null = null
  // シェルを通さずに起動する。npm などの .cmd もエンジンがそのまま起動する (Windows で確認)
  const stream = $.process.spawn({ argv, cwd })
  // 止める時は読み待ちを待たずにループを抜ける。抜けたら return() で子 (とその子) をエンジンが止める
  let wake = () => {}
  const stopped = new Promise<undefined>(resolve => (wake = () => resolve(undefined)))
  const stop = (why: 'user' | 'timeout') => {
    stoppedBy ??= why
    wake()
  }
  stopActive = stop
  const timer = $.clock.after(timeoutMs, () => stop('timeout'))
  try {
    for (;;) {
      const pending = stream.next()
      const step = await Promise.race([pending, stopped])
      if (!step) {
        pending.catch(() => {})
        void stream.return({ code: null, signal: null }).catch(() => {})
        break
      }
      if (step.done) {
        code = step.value.code
        break
      }
      out += step.value.text
      if (out.length > KEEP * 1.5) out = out.slice(-KEEP)
    }
  } catch (err) {
    // 起動できない時は最初の読み取りが reject する (ENOENT など)
    const message = err instanceof Error ? err.message : String(err)
    await update($, RUN, () => ({ kind: 'error' as const, command, message }))
    return
  } finally {
    timer.cancel()
    if (stopActive === stop) stopActive = undefined
  }

  const finishedAt = await $.clock.now()
  const counts = countResults(out)
  const result: TestRunnerResult = {
    status: statusOf(code, stoppedBy, counts.failed),
    command,
    exitCode: code,
    ms: finishedAt - startedAt,
    finishedAt,
    tail: tailOf(out),
    ...counts,
  }
  await update($, RUN, () => ({ kind: 'done' as const, result }))
  await update($, HIST, h => [...h, { status: result.status, ms: result.ms }].slice(-HISTORY))
}

/** Claude が Bash / PowerShell で走らせたテストを拾う。落ちたままコミットしようとしたらトーストで知らせる (止めない) */
async function watchShell<R extends { isError?: boolean; text?: string; result?: unknown; deny?: string }>($: $, command: string, isBackground: boolean, next: () => Promise<R>) {
  if (isCommitCommand(command)) {
    const run = await read($, RUN)
    if (failingLine(run) !== '') $.ui.toast('テストが落ちたままコミットしようとしています。/testrun で結果を見られます', { timeoutMs: 8000 })
  }
  if (isBackground || !isTestCommand(command, cfg.command)) return next()
  const startedAt = await $.clock.now()
  const r = await next()
  // 止められた・裏に回された物は数えない
  const out = (r.result ?? {}) as { interrupted?: unknown; backgroundTaskId?: unknown }
  if (r.deny !== undefined || typeof out.backgroundTaskId === 'string') return r
  const finishedAt = await $.clock.now()
  await keep($, claudeResult(command, typeof r.text === 'string' ? r.text : '', r.isError === true, out.interrupted === true, finishedAt - startedAt, finishedAt))
  return r
}

async function fixIt($: $) {
  const run = await read($, RUN)
  if (run.kind !== 'done') return
  const filled = await $.prompt.fill({ text: fixPrompt(run.result), mode: 'insert' }).then(
    r => (r.isFilled ? '' : r.refusal === 'dialog' ? '(ダイアログが開いています)' : r.refusal === 'no_composer' ? '(入力欄がありません)' : '(断られました)'),
    (err: unknown) => `(${err instanceof Error ? err.message : String(err)})`,
  )
  await update($, NOTE, () => (filled === '' ? '入力欄に入れました(送信はしていません)' : `入力欄に入れられませんでした${filled}`))
}

/** 結果を「今の結果」と履歴に入れる。ボタンで走らせている最中は「今の結果」を上書きしない */
async function keep($: $, result: TestRunnerResult) {
  await update($, RUN, r => (r.kind === 'running' ? r : { kind: 'done' as const, result }))
  await update($, HIST, h => [...h, { status: result.status, ms: result.ms }].slice(-HISTORY))
}

const SHELL_TOOLS = ['Bash', 'PowerShell']
const drawsSomething = (tree: RenderElement) => tree.type !== 'engine'

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'テストのペインを開きました。' }
}

export const register: Register = (on, options) => {
  cfg.argv = splitCommand(String(options.testCommand ?? ''))
  // 見せるのは実際に起動する argv。長い空白の後ろの引数が … に隠れないように
  cfg.command = cfg.argv.join(' ')
  cfg.timeoutMs = Math.min(MAX_TIMEOUT_SECONDS, Math.max(1, Number(options.timeoutSeconds) || 300)) * 1000

  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // 途中で読み込まれた時も帯を聞きに来るように (docs/mod-guide.md の 3 節)
    $.ui.invalidate('ui.render')
    // /testrun が拒まれたら (組み込みと被ったら) /test-runner にする
    const got = await $.command.register({ name: 'testrun', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'testrun'
    if (!ownsMain) await $.command.register({ name: 'test-runner', description: DESCRIPTION }).catch(() => {})
    return started
  })

  on('command.run', { command: 'testrun' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  // /testrun を持てた時は予備名を開かない (同じ名前の別のコマンドを横取りしない)
  on('command.run', { command: 'test-runner' }, ($, e, next) => (ownsMain ? next(e) : openPane($)))

  // Claude が走らせたテスト (サブエージェントの分も) を履歴に入れる。見ているだけなので失敗しても止めない
  on('tool.call', ($, e, next) => {
    const args = e as unknown as { command?: unknown; run_in_background?: unknown }
    if (!SHELL_TOOLS.includes(String(e.tool)) || typeof args.command !== 'string') return next(e)
    return watchShell($, args.command, args.run_in_background === true, () => next(e))
  }).catch(($, e, next) => next(e))

  // 入力欄の上の帯。最後のテストが落ちている間だけ 1 行出す
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = e.props.hasSurvey ? '' : failingLine(await read($, RUN))
    if (line === '') return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const band = (
      <Box key="test-runner" flexShrink={0}>
        <Text color="error">{line}</Text>
      </Box>
    )
    if (!drawsSomething(below)) return band
    return (
      <Box flexDirection="column">
        {band}
        <Box key="below">{below}</Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Code } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const run = await read($, RUN)
    const history = await read($, HIST)
    const note = await read($, NOTE)
    const lines = paneLines(run, history, cfg.command)
    const isRunning = run.kind === 'running'
    const failed = run.kind === 'done' && (run.result.status === 'fail' || run.result.status === 'timeout') ? run.result : undefined
    const card = cardOf(run, cfg.command)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={paneSvg(run, history, cfg.command)} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        {/* 操作のカード: 状態の色の枠と見出し、主のボタン 1 つと脇のボタン */}
        <Box key="card" flexDirection="column" borderStyle="round" borderColor={card.tone} paddingX={1} paddingY={1} gap="xs">
          <Text bold color={card.tone}>
            {card.title}
          </Text>
          <Text dimColor>{card.sub}</Text>
          <Box key="card-buttons" flexDirection="row" flexWrap="wrap" gap="sm">
            {isRunning ? (
              <Button
                key="stop"
                label="止める"
                // リロードで止め方を失っていたら (子はもう止まっている) 未実行に戻す
                onPress={() => (stopActive ? stopActive('user') : void update($, RUN, () => ({ kind: 'idle' as const })))}
              />
            ) : failed ? (
              [
                <Button key="fix" label="この失敗を直して" variant="primary" onPress={() => void fixIt($)} />,
                <Button key="run" label="もう一度走らせる" dimColor onPress={() => void runTests($).catch(() => {})} />,
              ]
            ) : (
              <Button key="run" label="テストを走らせる" variant="primary" onPress={() => void runTests($).catch(() => {})} />
            )}
          </Box>
        </Box>
        {note !== '' && <Text dimColor>{note}</Text>}
        {run.kind === 'done' && run.result.tail !== '' && <Code source={run.result.tail} />}
      </Box>
    )
  })
}
