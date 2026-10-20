import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ListedAgent } from './watch'
import { followTheme, readTheme } from './style'
import {
  applyList,
  clean,
  countsOf,
  cut,
  dur,
  elapsedOf,
  kindOf,
  onTurnComplete,
  onTurnStart,
  paneSvg,
  shownOf,
  STATUS_WORD,
  titleOf,
  touch,
} from './watch'

const PANE = 'agent-watch'
const TITLE = 'サブエージェント'
const DESCRIPTION = 'サブエージェントの動きを見るペインを開く'
/** ペインが開いている間、一覧を読む間隔 */
const POLL_MS = 2000
/** Agent 以外のツール。フックは自分の下で入れ子になった同じフックには呼ばれないので、Agent を包むフックは分けておく */
const NOT_AGENT = /^(?!Agent$)/

const AGENTS = atom({ plugin: 'agent-watch', key: 'agents' } as const, {})
const NOW = atom({ plugin: 'agent-watch', key: 'now' } as const, 0)
const HIDE = atom({ plugin: 'agent-watch', key: 'hideDone' } as const, false)
const NOTE = atom({ plugin: 'agent-watch', key: 'note' } as const, '')

type $ = EngineInterface

let ownsMain = false

/** 一覧を読んで $.state に置く。描画フックの外 (タイマー・コマンド・新しいエージェントの始まり) で呼ぶ */
async function refresh($: $) {
  const listed = (await $.agent.list().catch(() => undefined)) as readonly ListedAgent[] | undefined
  if (!listed) return
  const now = await $.clock.now()
  const before = await read($, AGENTS)
  if (applyList(before, listed, now) !== before) await update($, AGENTS, a => applyList(a, listed, now))
  // 動いている物がある間だけ時刻を書き、経過時間を描き直させる
  const after = await read($, AGENTS)
  if (Object.values(after).some(r => r.isListed && r.endedAt === undefined)) await update($, NOW, () => now)
}

/** ボタンから見る会話を切り替える。拒まれたら理由を出す */
async function view($: $, arg: { agentId?: string }) {
  const r = await $.ui.view(arg).catch((err: unknown) => ({ deny: err instanceof Error ? err.message : String(err) }))
  await update($, NOTE, () => (r.deny ? `切り替えられませんでした: ${cut(clean(r.deny), 200)}` : ''))
}

const openPane = async ($: $) => {
  await refresh($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'サブエージェントのペインを開きました。' }
}

export const register: Register = on => {
  followTheme(on)
  on('session.start', async ($, e, next) => {
    await readTheme($)
    const started = await next(e)
    // /agents は組み込みと被りやすい。拒まれたら /agent-watch にする
    const got = await $.command.register({ name: 'agents', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'agents'
    if (!ownsMain) await $.command.register({ name: 'agent-watch', description: DESCRIPTION }).catch(() => {})
    $.clock.every(POLL_MS, async () => {
      const panes = await $.ui.panes().catch(() => [])
      if (panes.some(p => p.id === PANE)) await refresh($)
    })
    return started
  })

  // /clear で記録を消す
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, AGENTS, () => ({}))
      await update($, NOTE, () => '')
    }
    return next(e)
  })

  // /agents を持てなかった時は、元の /agents (組み込み) に回す
  on('command.run', { command: 'agents' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'agent-watch' }, openPane)

  // サブエージェントのターンの始まり。初めて見る物は一覧から種類と説明を読む
  on('turn.start', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const now = await $.clock.now()
      const isNew = !(await read($, AGENTS))[id]?.isListed
      await update($, AGENTS, a => onTurnStart(a, id, now))
      if (isNew) await refresh($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const now = await $.clock.now()
      await update($, AGENTS, a => onTurnComplete(a, id, now, e.durationMs, e.reason))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // サブエージェントのツール。見るだけ。中断 (next が投げる) と deny はエラーに数えない
  on('tool.call', { tool: NOT_AGENT }, async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    const tool = cut(clean(String(e.tool)), 60)
    const now = await $.clock.now()
    await update($, AGENTS, a => touch(a, id, now, r => ({ ...r, tools: r.tools + 1, lastTool: tool })))
    let isError = false
    try {
      const r = await next(e)
      isError = r.isError === true
      return r
    } finally {
      if (isError) await update($, AGENTS, a => touch(a, id, now, r => ({ ...r, errors: r.errors + 1 })))
    }
  }).catch(($, e, next) => next(e))

  // Agent の呼び出しは別のフックで数える。上のフックが Agent を包むと、その下で動くエージェントのツールを上のフックが聞けなくなる
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const now = await $.clock.now()
      await update($, AGENTS, a => touch(a, id, now, r => ({ ...r, tools: r.tools + 1, lastTool: 'Agent' })))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const agents = await read($, AGENTS)
    const hideDone = await read($, HIDE)
    const note = await read($, NOTE)
    await read($, NOW) // 2 秒ごとの描き直しを受ける
    const now = await $.clock.now()
    const { all, shown } = shownOf(agents, hideDone)
    const counts = countsOf(all)
    const hidden = all.length - shown.length
    const viewingId = e.props.view?.agentId
    const viewing = viewingId === undefined ? undefined : agents[viewingId]
    const summary = `動いている ${counts.live} / 終わった ${counts.done} / エラー ${counts.failed}`
    const empty = hidden > 0 ? `終わった物を隠しています (${hidden} 体)` : 'サブエージェントはまだいません'

    return (
      <Box flexDirection="column" gap={1}>
        <Box key="top" flexDirection="column">
          <Button key="main" label="メインに戻る" variant={viewingId !== undefined ? 'primary' : 'secondary'} onPress={() => view($, {})} />
          <Button key="hide" label={hideDone ? '終わった物も出す' : '終わった物を隠す'} onPress={() => update($, HIDE, v => !v)} />
        </Box>
        {Svg ? (
          <Svg
            source={paneSvg({ shown, counts, hidden, now, viewing: viewing ? titleOf(viewing) : viewingId === undefined ? undefined : '(一覧に無い物)' })}
            alt={summary}
          />
        ) : (
          <Box key="lines" flexDirection="column">
            <Text bold>{summary}</Text>
            {shown.length === 0 && <Text dimColor>{empty}</Text>}
            {shown.map(r => {
              const kind = kindOf(r.status)
              const color = kind === 'run' ? 'blue' : kind === 'wait' ? 'yellow' : kind === 'done' ? 'green' : kind === 'fail' ? 'red' : undefined
              return (
                <Box key={`row-${r.id}`} flexDirection="column">
                  <Text color={color}>{`${kind === 'run' ? '●' : '○'} ${cut(titleOf(r), 18)} ${STATUS_WORD[kind]} ${dur(elapsedOf(r, now))} ツール ${r.tools}`}</Text>
                  <Text dimColor>{`  ${cut(r.description || '(説明なし)', 24)} / 最後 ${cut(r.lastTool || 'なし', 16)} / エラー ${r.errors}`}</Text>
                </Box>
              )
            })}
          </Box>
        )}
        {shown.length > 0 && (
          <Box key="views" flexDirection="column">
            {shown.map(r => (
              <Button
                key={`view-${r.id}`}
                label={`${r.id === viewingId ? '表示中' : '会話を見る'}: ${cut(titleOf(r), 16)} ${cut(r.description, 12)}`.trim()}
                onPress={() => view($, { agentId: r.id })}
              />
            ))}
          </Box>
        )}
        {note !== '' && <Text dimColor>{note}</Text>}
      </Box>
    )
  })
}
