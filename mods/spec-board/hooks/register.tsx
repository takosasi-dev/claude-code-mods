import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SpecBoardItem, SpecBoardSnap } from '../types'
import {
  NEXT_ARGS,
  PROGRESS_ARGS,
  READ_ONLY,
  WAITING_ARGS,
  clean,
  cleanBlock,
  clockLabel,
  cut,
  headOf,
  isAbsolute,
  isPythonOk,
  noticeOf,
  paneSvg,
  parseList,
  parseNext,
  showArgs,
  sortWaiting,
  summaryLines,
  tagOf,
} from './board'
import { followTheme, readTheme } from './style'

const PANE = 'spec-board'
const TITLE = '仕様書'
const DESCRIPTION = 'SpecStatus の確認待ち・途中・おすすめの仕様書をペインで見る (読むだけ)'
/** 開いている間に読み直す間隔 */
const POLL_MS = 5 * 60_000
/** 一覧に出す上限。残りは「ほか N 件」 */
const MAX_ROWS = 40
/** 詳細に出す文字数の上限 */
const MAX_DETAIL = 20_000

const SNAP = atom({ plugin: 'spec-board', key: 'snap' } as const, { kind: 'idle' })
const LOADING = atom({ plugin: 'spec-board', key: 'isLoading' } as const, false)
const DETAIL = atom({ plugin: 'spec-board', key: 'detail' } as const, { kind: 'none' })

type $ = EngineInterface

// 設定は register で userConfig から入れる
const cfg = { python: '', script: '' }
// ponytail: 主の名前を持てたかはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false
// 読み込みの連番。遅れて返った古い結果で新しい結果を上書きしない
let seq = 0
let detailSeq = 0

type Ran = { ok: true; stdout: string; stderr: string } | { ok: false; message: string; head: string }

/** SpecStatus を読む物だけ呼ぶ。出力は日本語なので UTF-8 にさせる */
async function ss($: $, args: string[]): Promise<Ran> {
  if (!READ_ONLY.has(args[0] ?? '')) return { ok: false, message: `呼ばないコマンドです: ${args[0]}`, head: '' }
  try {
    const r = await $.process.run([cfg.python, cfg.script, ...args], {
      env: { PYTHONIOENCODING: 'utf-8' },
      timeoutMs: 120_000,
    })
    if (r.exitCode !== 0) return { ok: false, message: `終了コード ${r.exitCode}`, head: headOf(`${r.stdout}\n${r.stderr}`) }
    return { ok: true, stdout: r.stdout, stderr: r.stderr }
  } catch (err) {
    return { ok: false, message: `起動できません: ${clean(err instanceof Error ? err.message : String(err))}`, head: '' }
  }
}

const isConfigured = () => cfg.python !== '' && cfg.script !== ''

async function load($: $) {
  const my = ++seq
  if (!isConfigured()) {
    await update($, SNAP, () => ({ kind: 'unset' as const }))
    return
  }
  await update($, LOADING, () => true)
  const [w, p, n] = await Promise.all([ss($, WAITING_ARGS), ss($, PROGRESS_ARGS), ss($, NEXT_ARGS)])
  let snap: SpecBoardSnap
  const failed = (step: string, r: Ran): SpecBoardSnap | undefined =>
    r.ok ? undefined : { kind: 'error', step, message: r.message, head: r.head }
  snap = failed('list --waiting', w) ?? failed('list --state', p) ?? failed('next', n) ?? { kind: 'idle' }
  if (w.ok && p.ok && n.ok) {
    try {
      snap = {
        kind: 'ok',
        waiting: sortWaiting(parseList(w.stdout)),
        progress: parseList(p.stdout),
        next: parseNext(n.stdout),
        loadedAt: await $.clock.now(),
        notice: noticeOf(w.stderr || p.stderr || n.stderr),
      }
    } catch (err) {
      const message = `JSON として読めませんでした: ${clean(err instanceof Error ? err.message : String(err))}`
      snap = { kind: 'error', step: 'list', message, head: headOf(w.stdout) }
    }
  }
  if (my !== seq) return
  await update($, SNAP, () => snap)
  await update($, LOADING, () => false)
}

async function showDetail($: $, name: string) {
  const my = ++detailSeq
  await update($, DETAIL, () => ({ kind: 'loading' as const, name }))
  const r = await ss($, showArgs(name))
  if (my !== detailSeq) return
  await update($, DETAIL, () =>
    r.ok
      ? { kind: 'ok' as const, name, text: cleanBlock(r.stdout).trim().slice(0, MAX_DETAIL) }
      : { kind: 'error' as const, name, message: r.message, head: r.head },
  )
}

const isOpen = async ($: $) => (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)

const openPane = async ($: $) => {
  void load($).catch(() => {})
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '仕様書のペインを開きました。' }
}

export const register: Register = (on, options) => {
  const python = String(options.pythonPath ?? '').trim()
  const script = String(options.specstatusScript ?? '').trim()
  // 空・相対パスは未設定と同じ。空を「今のフォルダ」と読まない
  cfg.python = isPythonOk(python) ? python : ''
  cfg.script = isAbsolute(script) ? script : ''

  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // /specs が拒まれたら /spec-board にする
    const got = await $.command.register({ name: 'specs', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'specs'
    if (!ownsMain) await $.command.register({ name: 'spec-board', description: DESCRIPTION }).catch(() => {})
    $.clock.every(POLL_MS, async () => {
      if (await isOpen($)) await load($)
    })
    if (await isOpen($)) void load($).catch(() => {})
    return started
  })

  // /specs を持てなかった時は、その名前の持ち主に回す
  on('command.run', { command: 'specs' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'spec-board' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Code } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const snap = await read($, SNAP)
    const isLoading = await read($, LOADING)
    const detail = await read($, DETAIL)
    const lines = summaryLines(snap)

    const section = (key: string, title: string, items: SpecBoardItem[], empty: string) => (
      <Box key={key} flexDirection="column">
        <Text bold>{`${title} ${items.length} 件`}</Text>
        {items.length === 0 && <Text dimColor>{empty}</Text>}
        {items.slice(0, MAX_ROWS).map((i, n) => (
          <Box key={`${key}-${n}`} flexDirection="column">
            <Button key={`${key}-b-${n}`} plain onPress={() => void showDetail($, i.name).catch(() => {})}>
              {cut(i.name, 26)} <Text dimColor>{tagOf(i)}</Text>
            </Button>
            {i.note !== '' && <Text dimColor>{`  ${cut(i.note, 52)}`}</Text>}
          </Box>
        ))}
        {items.length > MAX_ROWS && <Text dimColor>{`ほか ${items.length - MAX_ROWS} 件`}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={paneSvg(snap)} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        <Button key="reload" label={isLoading ? '読み込み中' : '読み直す'} variant="primary" onPress={() => void load($).catch(() => {})} />
        {snap.kind === 'error' && snap.head !== '' && <Code key="err" source={snap.head} />}
        {snap.kind === 'ok' && section('wait', '待ち', snap.waiting, '待っている仕様書はありません')}
        {snap.kind === 'ok' && section('prog', '途中', snap.progress, '途中の仕様書はありません')}
        {snap.kind === 'ok' && (
          <Box key="next" flexDirection="column">
            <Text bold>{`おすすめ ${snap.next.length} 件`}</Text>
            {snap.next.length === 0 && <Text dimColor>おすすめはありません</Text>}
            {snap.next.map((r, n) => (
              <Box key={`next-${n}`} flexDirection="column">
                <Button key={`next-b-${n}`} plain onPress={() => void showDetail($, r.name).catch(() => {})}>
                  {`${r.score} ${cut(r.name, 24)}`} <Text dimColor>{r.state}</Text>
                </Button>
                {r.reasons !== '' && <Text dimColor>{`  ${cut(r.reasons, 52)}`}</Text>}
              </Box>
            ))}
          </Box>
        )}
        {detail.kind !== 'none' && (
          <Box key="detail" flexDirection="column">
            <Text bold>{`詳細: ${cut(detail.name, 40)}`}</Text>
            {detail.kind === 'loading' && <Text dimColor>読み込み中</Text>}
            {detail.kind === 'ok' && <Code source={detail.text} />}
            {detail.kind === 'error' && <Text color="red">{`show が失敗しました: ${detail.message}`}</Text>}
            {detail.kind === 'error' && detail.head !== '' && <Code source={detail.head} />}
            <Button key="close-detail" dimColor label="詳細を閉じる" onPress={() => void update($, DETAIL, () => ({ kind: 'none' as const }))} />
          </Box>
        )}
        {snap.kind === 'ok' && (
          <Text dimColor>{`読込 ${clockLabel(snap.loadedAt)}${snap.notice !== '' ? ` / ${snap.notice}` : ''}`}</Text>
        )}
      </Box>
    )
  })
}
