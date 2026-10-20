import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PreCheckLarge, PreCheckReport } from '../types'
import {
  LARGE_BYTES,
  UNSET_HINT,
  cut,
  detailLines,
  itemsOf,
  messageSvg,
  paneSvg,
  parseNumstat,
  plain,
  scanPatch,
  splitCommand,
  tailOf,
  verdictOf,
} from './check'
import { followTheme, readTheme } from './style'

const PANE = 'pre-check'
const TITLE = 'コミット前'
const DESCRIPTION = 'コミットの前に変更・秘密情報・衝突の印・大きいファイル・テストを確かめるペインを開く'
/** 時間の上限の上限 (1 時間) */
const MAX_TIMEOUT_SECONDS = 3600
/** 大きさを見るファイルの数の上限 */
const MAX_STATS = 300
// 出力はこの長さの末尾だけ持つ
const KEEP = 200_000

const REPORT = atom({ plugin: 'pre-check', key: 'report' } as const, { kind: 'idle' })
const TEST = atom({ plugin: 'pre-check', key: 'test' } as const, { kind: 'idle' })
const OPEN = atom({ plugin: 'pre-check', key: 'open' } as const, '')

type $ = EngineInterface

// 設定は register で userConfig から入れる
const cfg = { command: '', argv: [] as string[], timeoutMs: 300_000 }
// ponytail: 主の名前を持てたかはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false
let loadSeq = 0

// git を読むだけ。書き込む操作は呼ばない。
// GIT_OPTIONAL_LOCKS=0 と diff-index / diff-files で index を書き直さない。core.fsmonitor=false と --no-textconv で
// リポジトリの設定が指すコマンドを走らせない。--literal-pathspecs でパスをワイルドカードとして読まない
const git = ($: $, cwd: string, args: string[], stdin?: string) =>
  $.process.run(['git', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '--literal-pathspecs', ...args], {
    cwd,
    env: { GIT_OPTIONAL_LOCKS: '0' },
    timeoutMs: 20_000,
    ...(stdin === undefined ? {} : { stdin }),
  })
const PATCH = ['-p', '-U0', '--no-color', '--no-textconv', '--no-ext-diff', '--no-renames']

async function readReport($: $): Promise<PreCheckReport> {
  const cwd = await $.session.cwd()
  try {
    const inside = await git($, cwd, ['rev-parse', '--is-inside-work-tree', '--show-toplevel'])
    if (inside.exitCode !== 0 && /dubious ownership/.test(inside.stderr)) return { kind: 'unsafe' }
    const [isInside, root = ''] = inside.stdout.trim().split(/\r?\n/)
    if (inside.exitCode !== 0 || isInside !== 'true') return { kind: 'not-repo' }
    // コミットがまだ無ければ空の木と比べる (sha256 のリポジトリでも合うように git に作らせる。-w が無いので書かない)
    const head = await git($, cwd, ['rev-parse', '-q', '--verify', 'HEAD'])
    const base = head.exitCode === 0 ? 'HEAD' : (await git($, cwd, ['hash-object', '-t', 'tree', '--stdin'], '')).stdout.trim()
    const [sn, un, sp, up, ut] = await Promise.all([
      git($, cwd, ['diff-index', '--cached', '--numstat', '--no-renames', base]),
      git($, cwd, ['diff-files', '--numstat', '--no-renames']),
      git($, cwd, ['diff-index', '--cached', ...PATCH, base]),
      git($, cwd, ['diff-files', ...PATCH]),
      git($, cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
    ])
    if (sn.exitCode !== 0) throw new Error(sn.stderr.trim() || 'git diff-index が失敗しました')
    const files = parseNumstat(sn.stdout, un.exitCode === 0 ? un.stdout : '')
    const staged = scanPatch(sp.exitCode === 0 ? sp.stdout : '', true)
    const unstaged = scanPatch(up.exitCode === 0 ? up.stdout : '', false)
    const untracked = ut.exitCode === 0 ? ut.stdout.split('\0').filter(Boolean).map(plain) : []
    // 大きさは作業ツリーのファイルで見る。消したファイルは stat が失敗するので数えない
    const paths = [...files.map(f => f.path), ...untracked].slice(0, MAX_STATS)
    const sizes = await Promise.all(
      paths.map(async (path): Promise<PreCheckLarge | undefined> => {
        const st = await $.fs.stat(`${root.replace(/[\\/]+$/, '')}/${path}`).catch(() => undefined)
        return st?.kind === 'file' && st.size > LARGE_BYTES ? { path, size: st.size } : undefined
      }),
    )
    return {
      kind: 'repo',
      loadedAt: await $.clock.now(),
      files,
      untracked: untracked.slice(0, 200),
      untrackedCount: untracked.length,
      secrets: [...staged.secrets, ...unstaged.secrets],
      conflicts: [...staged.conflicts, ...unstaged.conflicts],
      large: sizes.filter((l): l is PreCheckLarge => l !== undefined).sort((a, b) => b.size - a.size),
      isCut: [sn, un, sp, up, ut].some(r => r.isStdoutTruncated),
    }
  } catch (err) {
    return { kind: 'error', message: cut(plain(err instanceof Error ? err.message : String(err)), 300) }
  }
}

/** 読み直す。遅れて終わった古い読み込みで新しい結果を上書きしない */
async function load($: $) {
  const seq = ++loadSeq
  await update($, REPORT, r => (r.kind === 'repo' ? r : { kind: 'loading' as const }))
  const report = await readReport($)
  if (seq === loadSeq) await update($, REPORT, () => report)
}

/** テストを走らせる。test-runner と同じく、シェルを通さずに起動して時間の上限で止める */
async function runTest($: $) {
  const { command, argv, timeoutMs } = cfg
  if (argv.length === 0) return
  const startedAt = await $.clock.now()
  let isMine = false
  await update($, TEST, t => {
    isMine = t.kind !== 'running'
    return isMine ? { kind: 'running' as const, command, startedAt } : t
  })
  if (!isMine) return
  const cwd = await $.session.cwd()
  let out = ''
  let isTimeout = false
  let code: number | null = null
  const stream = $.process.spawn({ argv, cwd })
  let wake = () => {}
  const stopped = new Promise<undefined>(resolve => (wake = () => resolve(undefined)))
  const timer = $.clock.after(timeoutMs, () => {
    isTimeout = true
    wake()
  })
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
    // 起動できない時は最初の読み取りが reject する
    await update($, TEST, () => ({ kind: 'error' as const, command, message: cut(plain(err instanceof Error ? err.message : String(err)), 300) }))
    return
  } finally {
    timer.cancel()
  }
  const ms = (await $.clock.now()) - startedAt
  const status = isTimeout ? ('timeout' as const) : code === 0 ? ('pass' as const) : ('fail' as const)
  await update($, TEST, () => ({ kind: 'done' as const, status, command, exitCode: code, ms, tail: tailOf(out) }))
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  await load($)
  return { text: 'コミット前のペインを開きました。' }
}

const MESSAGE: Record<'not-repo' | 'unsafe', [string, string[]]> = {
  'not-repo': ['git のフォルダではありません', ['今の作業フォルダは git のリポジトリの', '中ではありません']],
  unsafe: ['git が所有者の確認で止めました', ['このフォルダの持ち主が違うため、', 'git は読むのを断りました。', 'git の safe.directory を確かめてください']],
}

export const register: Register = (on, options) => {
  cfg.argv = splitCommand(String(options.testCommand ?? ''))
  cfg.command = cfg.argv.join(' ')
  cfg.timeoutMs = Math.min(MAX_TIMEOUT_SECONDS, Math.max(1, Number(options.timeoutSeconds) || 300)) * 1000

  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // /precheck が拒まれたら /pre-check にする
    const got = await $.command.register({ name: 'precheck', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'precheck'
    if (!ownsMain) await $.command.register({ name: 'pre-check', description: DESCRIPTION }).catch(() => {})
    // テストの途中でリロードされたら子はエンジンが止めている。実行中のまま残さない
    if ((await read($, TEST)).kind === 'running') await update($, TEST, () => ({ kind: 'idle' as const }))
    return started
  })

  // /precheck を持てなかった時は、その名前の持ち主に回す
  on('command.run', { command: 'precheck' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'pre-check' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Code } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const report = await read($, REPORT)
    const test = await read($, TEST)
    const open = await read($, OPEN)
    const isTestSet = cfg.argv.length > 0
    const reload = <Button key="reload" label="もう一度" onPress={() => void load($).catch(() => {})} />

    if (report.kind !== 'repo') {
      const [title, lines] =
        report.kind === 'not-repo' || report.kind === 'unsafe'
          ? MESSAGE[report.kind]
          : report.kind === 'error'
            ? ['git を実行できません', (report.message.match(/.{1,30}/g) ?? []).slice(0, 4)]
            : ['読み込み中…', []]
      const color = report.kind === 'error' ? 'red' : report.kind === 'unsafe' ? 'yellow' : undefined
      return (
        <Box flexDirection="column" gap={1}>
          {Svg ? (
            <Svg source={messageSvg(title, lines, report.kind === 'error' ? 'red' : report.kind === 'unsafe' ? 'yellow' : 'gray')} alt={[title, ...lines].join('\n')} />
          ) : (
            <Box key="message" flexDirection="column">
              <Text color={color} bold>
                {report.kind === 'error' ? `${title}: ${report.message}` : title}
              </Text>
              {report.kind !== 'error' && lines.map(l => <Text dimColor>{l}</Text>)}
            </Box>
          )}
          {reload}
        </Box>
      )
    }

    const items = itemsOf(report, test, isTestSet)
    const verdict = verdictOf(items, isTestSet)
    const opened = items.find(i => i.id === open)
    const lineColor = { green: 'green', yellow: 'yellow', red: 'red', gray: undefined } as const

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={paneSvg(items, verdict)} alt={[verdict.text, ...items.map(i => `${i.label}: ${i.summary}`)].join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            <Text color={lineColor[verdict.light]} bold>
              {verdict.light === 'green' ? `■ ${verdict.text} ■` : verdict.text}
            </Text>
            {items.map(i => (
              <Text color={lineColor[i.light]}>{`${i.light === 'gray' ? '○' : '●'} ${i.label}: ${i.summary}`}</Text>
            ))}
          </Box>
        )}
        {report.isCut && <Text color="yellow">差分が長すぎて、頭の部分しか見ていません</Text>}
        <Box key="actions" flexDirection="row" gap={1}>
          {reload}
          {isTestSet && test.kind !== 'running' && (
            <Button key="run-test" label="テストも走らせる" variant="primary" onPress={() => void runTest($).catch(() => {})} />
          )}
        </Box>
        <Box key="items" flexDirection="column">
          {items.map(i => (
            <Button
              key={`open-${i.id}`}
              plain
              label={`${open === i.id ? '─ 閉じる' : '▶ 中身'}: ${i.label}`}
              onPress={() => void update($, OPEN, o => (o === i.id ? '' : i.id))}
            />
          ))}
        </Box>
        {opened && opened.id !== 'test' && (
          <Box key="detail" flexDirection="column">
            {detailLines(opened.id, report).map(l => (
              <Text dimColor>{l}</Text>
            ))}
          </Box>
        )}
        {opened?.id === 'test' && !isTestSet && <Text dimColor>{UNSET_HINT}</Text>}
        {opened?.id === 'test' && isTestSet && test.kind === 'idle' && <Text dimColor>{`「テストも走らせる」で ${cfg.command} を走らせます`}</Text>}
        {opened?.id === 'test' && test.kind === 'running' && <Text dimColor>{`${test.command} を実行中…`}</Text>}
        {opened?.id === 'test' && test.kind === 'error' && <Text color="red">{`起動できません: ${test.message}`}</Text>}
        {opened?.id === 'test' && test.kind === 'done' && <Text dimColor>{`${test.command} / 終了コード ${test.exitCode ?? '─'} / ${Math.round(test.ms / 100) / 10} 秒`}</Text>}
        {opened?.id === 'test' && test.kind === 'done' && test.tail !== '' && <Code source={test.tail} />}
      </Box>
    )
  })
}
