import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import type { CiSnap } from '../types'
import {
  DETACHED,
  NO_PR,
  PR_FIELDS,
  RUN_FIELDS,
  RUN_LIMIT,
  classify,
  clean,
  cut,
  firstLine,
  isRunning,
  missingOrError,
  parsePr,
  parseRuns,
  prLines,
  prSvg,
  runLines,
  runsSvg,
  stateLabel,
} from './ci'

const PANE = 'ci-pane'
const TITLE = 'CI'
const DESCRIPTION = '今のブランチの PR とチェック、GitHub Actions の結果をペインで見る (読むだけ)'
/** タイマーの刻み。走っている物がある時はこの間隔、無い時は SLOW_MS ごとに読む */
const FAST_MS = 20_000
const SLOW_MS = 60_000

const SNAP = atom({ plugin: 'ci-pane', key: 'snap' } as const, { kind: 'idle' })
const LOADING = atom({ plugin: 'ci-pane', key: 'isLoading' } as const, false)

type $ = EngineInterface
type Ran = { ok: true; r: ProcessRunResult } | { ok: false; message: string }

// ponytail: 主の名前を持てたか・最後に読んだ時刻・連番はモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false
let lastLoad = 0
let seq = 0

// 読むだけ。再実行・マージなど何かを起こす操作は呼ばない
const run = async ($: $, cwd: string, argv: string[]): Promise<Ran> => {
  try {
    // GIT_OPTIONAL_LOCKS=0: git が読むついでに index を書き直さない (gh の中で走る git にも効く)
    return { ok: true, r: await $.process.run(argv, { cwd, env: { GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, timeoutMs: 30_000 }) }
  } catch (err) {
    return { ok: false, message: clean(err instanceof Error ? err.message : String(err)) }
  }
}

async function readCi($: $): Promise<CiSnap> {
  const cwd = await $.session.cwd()
  const head = await run($, cwd, ['git', '-c', 'core.fsmonitor=false', 'rev-parse', '--abbrev-ref', 'HEAD'])
  if (!head.ok) return { kind: 'problem', problem: 'error', detail: `git を実行できません: ${head.message}` }
  if (head.r.exitCode !== 0) {
    const why = classify(head.r.stderr)
    return { kind: 'problem', problem: why === 'unsafe' ? 'unsafe' : 'not-git', detail: firstLine(head.r.stderr) }
  }
  const raw = head.r.stdout.trim()
  const branch = raw === 'HEAD' ? '' : raw

  const [pr, runs] = await Promise.all([
    branch === '' ? undefined : run($, cwd, ['gh', 'pr', 'view', '--json', PR_FIELDS]),
    run($, cwd, ['gh', 'run', 'list', ...(branch === '' ? [] : ['--branch', branch]), '--limit', String(RUN_LIMIT), '--json', RUN_FIELDS]),
  ])
  // gh が起動できない・ログインしていない・GitHub でない、は画面全体の問題として出す
  for (const x of [pr, runs]) {
    if (!x) continue
    if (!x.ok) return { kind: 'problem', problem: missingOrError(x.message), detail: x.message }
    if (x.r.exitCode === 0) continue
    const why = classify(x.r.stderr)
    if (why !== 'no-pr' && why !== 'other') return { kind: 'problem', problem: why, detail: firstLine(x.r.stderr) }
  }

  const snap: Extract<CiSnap, { kind: 'ok' }> = { kind: 'ok', branch, prNote: '', runs: [], runsNote: '', loadedAt: await $.clock.now() }
  if (!pr) snap.prNote = DETACHED
  else if (pr.ok && pr.r.exitCode === 0) {
    try {
      snap.pr = parsePr(pr.r.stdout)
    } catch (err) {
      snap.prNote = `PR を読めませんでした: ${clean(err instanceof Error ? err.message : String(err))}`
    }
  } else if (pr.ok) snap.prNote = classify(pr.r.stderr) === 'no-pr' ? NO_PR : `PR を読めませんでした: ${firstLine(pr.r.stderr)}`
  if (runs.ok && runs.r.exitCode === 0) {
    try {
      snap.runs = parseRuns(runs.r.stdout)
    } catch (err) {
      snap.runsNote = `Actions を読めませんでした: ${clean(err instanceof Error ? err.message : String(err))}`
    }
  } else if (runs.ok) snap.runsNote = `Actions を読めませんでした: ${firstLine(runs.r.stderr)}`
  return snap
}

async function load($: $) {
  const my = ++seq
  lastLoad = await $.clock.now()
  await update($, LOADING, () => true)
  const snap = await readCi($).catch((err: unknown): CiSnap => ({ kind: 'problem', problem: 'error', detail: clean(err instanceof Error ? err.message : String(err)) }))
  if (my !== seq) return
  await update($, SNAP, () => snap)
  await update($, LOADING, () => false)
}

const isOpen = async ($: $) => (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)

const openPane = async ($: $) => {
  void load($).catch(() => {})
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'CI のペインを開きました。' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // /ci が拒まれたら /ci-pane にする
    const got = await $.command.register({ name: 'ci', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'ci'
    if (!ownsMain) await $.command.register({ name: 'ci-pane', description: DESCRIPTION }).catch(() => {})
    lastLoad = 0
    // 開いている間だけ読む。走っている物があれば 20 秒、無ければ 60 秒ごと
    $.clock.every(FAST_MS, async () => {
      if (!(await isOpen($))) return
      const wait = isRunning(await read($, SNAP)) ? FAST_MS : SLOW_MS
      if ((await $.clock.now()) - lastLoad >= wait - 1000) await load($)
    })
    if (await isOpen($)) void load($).catch(() => {})
    return started
  })

  // /ci を持てなかった時は、その名前の持ち主に回す
  on('command.run', { command: 'ci' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'ci-pane' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Link } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const snap = await read($, SNAP)
    const isLoading = await read($, LOADING)
    const top = prLines(snap)
    const lines = (key: string, ls: ReturnType<typeof prLines>) => (
      <Box key={key} flexDirection="column">
        {ls.map(l => (
          <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
            {l.text}
          </Text>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? <Svg key="pr" source={prSvg(snap)} alt={top.map(l => l.text).join('\n')} /> : lines('pr-lines', top)}
        {snap.kind === 'ok' && snap.pr?.url && (
          <Link key="pr-link" href={snap.pr.url} label={`PR #${snap.pr.number} (${stateLabel(snap.pr)}) を GitHub で開く`} />
        )}
        {snap.kind === 'ok' &&
          (Svg ? (
            <Svg key="runs" source={runsSvg(snap)} alt={runLines(snap).map(l => l.text).join('\n')} />
          ) : (
            lines('run-lines', [{ text: 'Actions', isBold: true }, ...runLines(snap)])
          ))}
        {snap.kind === 'ok' && snap.runs.some(r => r.url !== '') && (
          <Box key="run-links" flexDirection="column">
            {snap.runs
              .slice(0, RUN_LIMIT)
              .filter(r => r.url !== '')
              .map((r, i) => (
                <Link key={`run-${i}`} href={r.url} label={`${cut(r.name, 24)} ${r.label}`} />
              ))}
          </Box>
        )}
        <Button key="reload" label={isLoading ? '読み込み中' : '読み直す'} variant="primary" onPress={() => void load($).catch(() => {})} />
      </Box>
    )
  })
}
