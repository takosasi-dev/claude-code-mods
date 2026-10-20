import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TestRunnerResult } from '../types'
import { HISTORY, UNSET_HINT, countResults, fixPrompt, paneLines, paneSvg, splitCommand, statusOf, tailOf } from './runner'
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
  const result: TestRunnerResult = {
    status: statusOf(code, stoppedBy),
    command,
    exitCode: code,
    ms: finishedAt - startedAt,
    finishedAt,
    tail: tailOf(out),
    ...countResults(out),
  }
  await update($, RUN, () => ({ kind: 'done' as const, result }))
  await update($, HIST, h => [...h, { status: result.status, ms: result.ms }].slice(-HISTORY))
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
    // /testrun が拒まれたら (組み込みと被ったら) /test-runner にする
    const got = await $.command.register({ name: 'testrun', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'testrun'
    if (!ownsMain) await $.command.register({ name: 'test-runner', description: DESCRIPTION }).catch(() => {})
    return started
  })

  on('command.run', { command: 'testrun' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'test-runner' }, openPane)

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
        <Box flexDirection="column">
          {isRunning ? (
            <Button
              key="stop"
              label="止める"
              // リロードで止め方を失っていたら (子はもう止まっている) 未実行に戻す
              onPress={() => (stopActive ? stopActive('user') : void update($, RUN, () => ({ kind: 'idle' as const })))}
            />
          ) : (
            <Button key="run" label="テストを走らせる" variant="primary" onPress={() => void runTests($).catch(() => {})} />
          )}
          {failed && <Button key="fix" label="この失敗を直して" onPress={() => void fixIt($)} />}
        </Box>
        {note !== '' && <Text dimColor>{note}</Text>}
        {run.kind === 'done' && run.result.tail !== '' && <Code source={run.result.tail} />}
      </Box>
    )
  })
}
