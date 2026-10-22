import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TodoFilter, TodoItem, TodoSnapshot } from '../types'
import { KINDS, PATTERN, causePrompt, fixPrompt, headFit, itemId, kindColor, paneLines, paneSvg, parseGrep, tally, walk } from './todo'
import { followTheme, readTheme } from './style'

const PANE = 'todo-board'
const TITLE = 'TODO'
const DESCRIPTION = '今の作業フォルダの TODO・FIXME・HACK・XXX を拾ってペインで見る'
const GAP = 2000
const HISTORY_MAX = 20
/** 一覧に並べるボタンの数 */
const SHOW = 100
// ファイルを変えうるツール。終わったらペインを読み直す
const WRITERS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])

const SNAP = atom({ plugin: 'todo-board', key: 'snap' } as const, { kind: 'idle' })
const HISTORY = atom({ plugin: 'todo-board', key: 'history' } as const, [])
const FILTER = atom({ plugin: 'todo-board', key: 'filter' } as const, 'ALL')
const SELECTED = atom({ plugin: 'todo-board', key: 'selected' } as const, '')
const NOTE = atom({ plugin: 'todo-board', key: 'note' } as const, '')
const RUNNING = atom({ plugin: 'todo-board', key: 'running' } as const, false)

// ponytail: 読み込みの連番はモジュール変数。リロードをまたいだ読み込みの前後は見ない
let loads = 0
let ownsMain = false

// git は読むだけ。index を書かない (--no-optional-locks)、fsmonitor も起こさない
const git = ($: EngineInterface, cwd: string, args: string[]) =>
  $.process.run(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], { cwd, timeoutMs: 15_000 })

async function load($: EngineInterface) {
  const mine = ++loads
  await update($, RUNNING, () => true)
  const cwd = await $.session.cwd().catch(() => '')
  let snap: TodoSnapshot
  try {
    if (cwd === '') throw new Error('作業フォルダが分かりません')
    // git が無い・git の外なら、フォルダを歩く
    const inside = await git($, cwd, ['rev-parse', '--is-inside-work-tree']).catch(() => undefined)
    if (inside?.exitCode === 0 && inside.stdout.trim() === 'true') {
      // --untracked: 追跡していない新しいファイルも見る (.gitignore の物は見ない)
      const r = await git($, cwd, ['grep', '-n', '-I', '-z', '--no-color', '--untracked', '-E', PATTERN])
      // 1 は「見つからない」。それより大きいのが失敗
      if (r.exitCode > 1) throw new Error(r.stderr.trim() || 'git grep が失敗しました')
      const at = await $.clock.now()
      const isCut = r.isStdoutTruncated
      snap = { kind: 'repo', cwd, via: 'git', cut: isCut ? 'output' : '', loadedAt: at, isCut, ...parseGrep(r.exitCode === 0 ? r.stdout : '') }
    } else {
      const w = await walk({ list: p => $.fs.list(p), read: p => $.fs.read(p), now: () => $.clock.now() }, cwd)
      const at = await $.clock.now()
      snap = { kind: 'repo', cwd, via: 'walk', scanned: w.scanned, cut: w.cut, loadedAt: at, isCut: w.cut !== '', ...tally(w.rows) }
    }
  } catch (err) {
    snap = { kind: 'error', cwd, message: err instanceof Error ? err.message : String(err) }
  }
  // 後から始めた読み込みがあれば、その結果が新しいので書かない
  if (mine !== loads) return
  await update($, RUNNING, () => false)
  const prev = await read($, SNAP)
  await update($, SNAP, () => snap)
  // 推移は同じフォルダの中だけ。フォルダが変わったら消す
  const isSameDir = prev.kind === 'idle' || prev.cwd === snap.cwd
  const point = snap.kind === 'repo' ? { at: snap.loadedAt, total: snap.total } : undefined
  await update($, HISTORY, h => {
    const kept = isSameDir ? h : []
    return point ? [...kept, point].slice(-HISTORY_MAX) : kept
  })
}

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(p => p.id === PANE)

async function fill($: EngineInterface, text: string) {
  const r = await $.prompt.fill({ text, mode: 'insert' }).catch(() => ({ isFilled: false, refusal: undefined }))
  const why = r.refusal === 'dialog' ? '(ダイアログが開いています)' : r.refusal === 'no_composer' ? '(この画面には入力欄がありません)' : ''
  await update($, NOTE, () => (r.isFilled ? '入力欄に入れました(送信はしていません)' : `入力欄に入れられませんでした${why}`))
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
      // ponytail: フォルダを歩く読み方は 1 回に数秒かかるので、ツールの後には読み直さない (「再読込」で読む)
      const snap = await read($, SNAP)
      if (snap.kind === 'repo' && snap.via === 'walk') return
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
  await $.ui.open({ id: PANE, title: TITLE })
  // 読むのは裏で。フォルダを歩くのに数秒かかっても、コマンドの返事は待たせない
  void reload($).catch(() => {})
  return { text: 'TODO のペインを開きました。' }
}

const loc = (it: TodoItem) => `${it.path}:${it.line}`
// 行の中の種類の語より後ろ (無ければ行そのもの)
const body = (it: TodoItem) => it.text.slice(it.text.indexOf(it.kind) + it.kind.length).replace(/^[\s:：(（)）\]-]+/, '') || it.text

export const register: Register = on => {
  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // /todos が拒まれたら (組み込みと被ったら) /todo-board にする
    const got = await $.command.register({ name: 'todos', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'todos'
    if (!ownsMain) await $.command.register({ name: 'todo-board', description: DESCRIPTION }).catch(() => {})
    if (await isOpen($)) void load($).catch(() => {})
    return started
  })

  // /todos を持てなかった時は、その名前の持ち主 (組み込みなど) に回す
  on('command.run', { command: 'todos' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'todo-board' }, async $ => openPane($))

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
    const history = await read($, HISTORY)
    const filter = await read($, FILTER)
    const selected = await read($, SELECTED)
    const note = await read($, NOTE)
    const running = await read($, RUNNING)
    const lines = paneLines(snap, history)
    const setFilter = (v: TodoFilter) => () => void update($, FILTER, () => v)

    let list = null
    if (snap.kind === 'repo' && snap.total > 0) {
      const hits = filter === 'ALL' ? snap.items : snap.items.filter(it => it.kind === filter)
      const shown = hits.slice(0, SHOW)
      const more = (filter === 'ALL' ? snap.total : snap.counts[filter]) - shown.length
      const open = snap.items.find(it => itemId(it) === selected)
      list = (
        <Box key="list" flexDirection="column" gap={1}>
          <Box key="filters" flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key="filter-ALL" dimColor={filter !== 'ALL'} label={`全部 ${snap.total}`} variant={filter === 'ALL' ? 'primary' : undefined} onPress={setFilter('ALL')} />
            {KINDS.map(k => (
              <Button key={`filter-${k}`} dimColor={filter !== k} label={`${k} ${snap.counts[k]}`} variant={filter === k ? 'primary' : undefined} onPress={setFilter(k)} />
            ))}
          </Box>
          {open ? (
            <Box key="detail" flexDirection="column">
              <Text bold color={kindColor(open.kind)}>{`${open.kind}  ${loc(open)}`}</Text>
              <Text>{open.text}</Text>
              <Button key="fix" label={`この ${open.kind} を片付けて`} variant="primary" onPress={() => void fill($, fixPrompt(open))} />
              <Button key="cause" dimColor label={`この ${open.kind} の原因を調べて`} onPress={() => void fill($, causePrompt(open))} />
              <Button key="close" dimColor label="閉じる" onPress={() => void update($, SELECTED, () => '')} />
            </Box>
          ) : null}
          <Box key="items" flexDirection="column">
            {shown.map(it => (
              <Button key={`item:${itemId(it)}`} plain onPress={() => void update($, SELECTED, () => itemId(it))}>
                <Text color={kindColor(it.kind)}>{it.kind}</Text> {loc(it)} <Text dimColor>{headFit(body(it), 40)}</Text>
              </Button>
            ))}
            {shown.length === 0 && <Text dimColor>この種類はありません</Text>}
            {more > 0 && <Text dimColor>{`ほか ${more} 件`}</Text>}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={paneSvg(snap, history)} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        <Box key="actions" flexDirection="row" gap={1}>
          <Button key="reload" label="再読込" variant="primary" onPress={() => void reload($)} />
          {running && <Text key="running" dimColor>読んでいます…</Text>}
        </Box>
        {note !== '' && <Text dimColor>{note}</Text>}
        {list}
      </Box>
    )
  })
}
