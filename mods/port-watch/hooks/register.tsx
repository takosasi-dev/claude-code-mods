import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PortWatchList, PortWatchRow } from '../types'
import { canStop, countsOf, cut, isWindowsCwd, mergeRows, parseLsof, parseNetstat, parseTasklist, plain, rowKey, stopArgv, summaryOf, tilesSvg } from './ports'

const PANE = 'port-watch'
const TITLE = 'ポート'
const DESCRIPTION = '待ち受けている TCP のポートとプロセスをペインで見る'
/** ペインが開いている間、一覧を読む間隔 */
const POLL_MS = 5000
/** 「止める」の 1 回目から、2 回目を受け付ける時間 */
const ARM_MS = 10_000

const LIST = atom({ plugin: 'port-watch', key: 'list' } as const, { kind: 'idle' })
const BASE = atom({ plugin: 'port-watch', key: 'baseline' } as const, null)
const ARMED = atom({ plugin: 'port-watch', key: 'armed' } as const, null)
const NARROW = atom({ plugin: 'port-watch', key: 'isNarrow' } as const, true)
const NOTE = atom({ plugin: 'port-watch', key: 'note' } as const, '')

type $ = EngineInterface

// ponytail: 主の名前を持てたか・読み込み中かはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false
let isLoading = false

const firstLine = (s: string) => cut(plain(s.trim().split(/\r?\n/)[0] ?? ''), 120)

/** 今の一覧を読む。書き込みはしない */
async function readList($: $): Promise<PortWatchList> {
  const cwd = await $.session.cwd()
  const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 15_000 })
  try {
    if (isWindowsCwd(cwd)) {
      // -p TCP だと v6 の行が出ないので、全部読んで TCP の行だけ拾う
      const [ns, tl] = await Promise.all([run(['netstat', '-ano']), run(['tasklist', '/FO', 'CSV', '/NH']).catch(() => undefined)])
      if (ns.exitCode !== 0) return { kind: 'error', message: `netstat が失敗しました: ${firstLine(ns.stderr || ns.stdout) || `終了コード ${ns.exitCode}`}` }
      const names = tl && tl.exitCode === 0 ? parseTasklist(tl.stdout) : new Map<number, string>()
      return { kind: 'ok', rows: mergeRows(parseNetstat(ns.stdout).map(r => ({ ...r, name: names.get(r.pid) ?? '?' }))) }
    }
    const r = await run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'])
    // 待ち受けが 1 本も無い時、lsof は何も書かずに 1 で終わる
    if (r.exitCode !== 0 && r.stdout.trim() === '' && r.stderr.trim() !== '') return { kind: 'error', message: `lsof が失敗しました: ${firstLine(r.stderr)}` }
    return { kind: 'ok', rows: mergeRows(parseLsof(r.stdout)) }
  } catch (err) {
    return { kind: 'error', message: `一覧のコマンドを実行できません: ${firstLine(err instanceof Error ? err.message : String(err))}` }
  }
}

/** 読んで $.state に置く。初めて読めた一覧をセッションの始めの一覧として覚える */
async function refresh($: $) {
  if (isLoading) return
  isLoading = true
  try {
    const list = await readList($)
    await update($, LIST, () => list)
    if (list.kind === 'ok') await update($, BASE, b => b ?? list.rows.map(rowKey))
    const now = await $.clock.now()
    const armed = await read($, ARMED)
    if (armed && now - armed.at > ARM_MS) await update($, ARMED, () => null)
  } finally {
    isLoading = false
  }
}

async function copyUrl($: $, row: PortWatchRow, surface: Parameters<$['ui']['copy']>[0]['surface']) {
  const text = `http://localhost:${row.port}`
  const r = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false as const, reason: 'refused' as const }))
  await update($, NOTE, () => (r.isCopied ? `${text} を写しました` : `写せませんでした (${r.reason})`))
}

/** 1 回目は構えるだけ。2 回目で一覧を読み直し、その PID がまだそのポートを持っていれば止める */
async function pressStop($: $, row: PortWatchRow) {
  const now = await $.clock.now()
  const armed = await read($, ARMED)
  if (!armed || armed.port !== row.port || armed.pid !== row.pid || now - armed.at > ARM_MS) {
    await update($, ARMED, () => ({ port: row.port, pid: row.pid, at: now }))
    await update($, NOTE, () => `もう一度押すと ${row.name} (PID ${row.pid}) を止めます`)
    return
  }
  await update($, ARMED, () => null)
  const fresh = await readList($)
  const still = fresh.kind === 'ok' ? fresh.rows.find(r => r.port === row.port && r.pid === row.pid) : undefined
  const argv = still && canStop(still) ? stopArgv(isWindowsCwd(await $.session.cwd()), still.pid) : undefined
  if (!argv) {
    await update($, NOTE, () => (fresh.kind === 'ok' ? `ポート ${row.port} の持ち主が変わったので止めませんでした` : '一覧を読み直せなかったので止めませんでした'))
    await update($, LIST, () => fresh)
    return
  }
  const r = await $.process.run(argv, { timeoutMs: 15_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }))
  await update($, NOTE, () =>
    r.exitCode === 0 ? `${row.name} (PID ${row.pid}) を止めました` : `止められませんでした: ${firstLine(r.stderr || r.stdout) || `終了コード ${r.exitCode}`}`,
  )
  await refresh($)
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  await refresh($)
  return { text: 'ポートのペインを開きました。' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // /ports が拒まれたら /port-watch にする
    const got = await $.command.register({ name: 'ports', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'ports'
    if (!ownsMain) await $.command.register({ name: 'port-watch', description: DESCRIPTION }).catch(() => {})
    // 始めの一覧は起動を待たせずに読む。リロードでは覚えた一覧を残す (refresh は未設定の時だけ書く)
    $.clock.after(1000, () => void refresh($).catch(() => {}))
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const panes = await $.ui.panes().catch(() => [])
        if (panes.some(p => p.id === PANE)) await refresh($)
      })().catch(() => {})
    })
    return started
  })

  // /ports を持てなかった時は、その名前の持ち主に回す
  on('command.run', { command: 'ports' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'port-watch' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const list = await read($, LIST)
    const baseline = await read($, BASE)
    const armed = await read($, ARMED)
    const isNarrow = await read($, NARROW)
    const note = await read($, NOTE)
    const rows = list.kind === 'ok' ? list.rows : []
    const counts = countsOf(rows, baseline)
    const isAdded = (r: PortWatchRow) => baseline !== null && !baseline.includes(rowKey(r))
    const shown = isNarrow ? rows.filter(r => canStop(r) || isAdded(r)) : rows
    const hidden = rows.length - shown.length

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={tilesSvg(counts, list.kind === 'error')} alt={summaryOf(counts)} />
        ) : (
          <Text key="summary" bold>
            {summaryOf(counts)}
          </Text>
        )}
        {list.kind === 'error' && (
          <Text key="error" color="red">
            {list.message}
          </Text>
        )}
        {list.kind === 'idle' && <Text dimColor>読み込み中…</Text>}
        <Box key="top" flexDirection="row" gap={1}>
          <Button key="reload" label="読み直す" onPress={() => void refresh($).catch(() => {})} />
          <Button key="narrow" label={isNarrow ? '全部出す' : '開発用だけ'} onPress={() => void update($, NARROW, v => !v)} />
        </Box>
        {list.kind === 'ok' && shown.length === 0 && (
          <Text dimColor>{hidden > 0 ? `開発用の待ち受けはありません (ほか ${hidden} 本)` : '待ち受けているポートはありません'}</Text>
        )}
        {shown.map(r => {
          const id = `${r.port}-${r.pid}`
          const isArmed = armed?.port === r.port && armed.pid === r.pid
          return (
            <Box key={`row-${id}`} flexDirection="column">
              <Text color={isAdded(r) ? 'yellow' : undefined} bold>
                {`${isAdded(r) ? '●' : '○'} ${r.port}  ${cut(r.name, 18)}`}
              </Text>
              <Text dimColor>{`  PID ${r.pid}${isAdded(r) ? '  このセッションで増えた' : ''}`}</Text>
              {/* 29 桁のペインで 2 つ並べると折れるので縦に置く */}
              <Box flexDirection="column">
                <Button key={`copy-${id}`} label="URL を写す" onPress={press => void copyUrl($, r, press.surface)} />
                {canStop(r) && (
                  <Button
                    key={`stop-${id}`}
                    label={isArmed ? 'もう一度押すと止めます' : '止める'}
                    variant={isArmed ? 'primary' : undefined}
                    onPress={() => void pressStop($, r).catch(() => {})}
                  />
                )}
              </Box>
            </Box>
          )
        })}
        {isNarrow && hidden > 0 && shown.length > 0 && <Text dimColor>{`ほか ${hidden} 本は「全部出す」で`}</Text>}
        {note !== '' && <Text dimColor>{note}</Text>}
      </Box>
    )
  })
}
