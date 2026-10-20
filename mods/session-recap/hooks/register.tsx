import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { RecapSummary, RecapTurn } from '../types'
import { busySvg, clock, dur, head, hm, timelineSvg, totalsSvg } from './svg'

const PANE = 'session-recap'
const TITLE = 'ふりかえり'
const KEEP_TURNS = 100
/** コマンドを見てからこの間にターンが始まらなければ、そのコマンドはターンを起こさなかったと見る */
const PENDING_MS = 30_000

const turnsA = atom({ plugin: 'session-recap', key: 'turns' } as const, [] as RecapTurn[])
const startedA = atom({ plugin: 'session-recap', key: 'startedAt' } as const, 0)
const pendingA = atom({ plugin: 'session-recap', key: 'pending' } as const, null as { name: string; args: string; at: number } | null)
const selectedA = atom({ plugin: 'session-recap', key: 'selected' } as const, null as string | null)
const IDLE: RecapSummary = { status: 'idle', text: '', scope: '', at: 0 }
const summaryA = atom({ plugin: 'session-recap', key: 'summary' } as const, IDLE)
const noticeA = atom({ plugin: 'session-recap', key: 'notice' } as const, '')
const commandA = atom({ plugin: 'session-recap', key: 'command' } as const, '')

type $ = EngineInterface

/** 走っている (end の無い) 最後のターンに fn をかける */
const onOpenTurn = (list: RecapTurn[], fn: (t: RecapTurn) => RecapTurn) => {
  const i = list.findLastIndex(t => t.end === undefined)
  return i < 0 ? list : list.map((t, j) => (j === i ? fn(t) : t))
}

const ASK = [
  'ここまでのこのセッションをふりかえってください。',
  '日本語で、次の 3 つの見出しの下に、それぞれ箇条書きを 3 つずつ書いてください。',
  '## やったこと',
  '## 決めたこと',
  '## 残っていること',
  'ツールは使わず、この返答の文だけで答えてください。',
].join('\n')

const askFor = (upTo?: RecapTurn) =>
  upTo
    ? `${ASK}\n対象は ${hm(upTo.start)} に始まったターン(依頼:「${head(upTo.prompt, 100)}」)までです。それより後のやり取りは無いものとして扱ってください。`
    : ASK

const whyNot = (r: ModelForkResult): string => {
  if (r.isAnswered) return ''
  switch (r.reason) {
    case 'nothing-to-fork':
      return 'まだ要約できるやり取りがありません(最初の返答の前か /clear の直後です)'
    case 'api-error':
      return `API のエラーで要約できませんでした(${r.status ?? '応答なし'} ${r.error})`
    case 'empty-reply':
      return '返答に文がありませんでした'
    case 'aborted':
      return '要約が中断されました'
  }
}

const summarize = async ($: $, upTo?: RecapTurn) => {
  if ((await read($, summaryA)).status === 'running') return
  const at = await $.clock.now()
  const scope = upTo ? `${hm(upTo.start)} のターンまで` : 'ここまで'
  await update($, summaryA, () => ({ status: 'running', text: '', scope, at }))
  await update($, noticeA, () => '')
  let r: ModelForkResult
  try {
    r = await $.model.fork({ prompt: askFor(upTo) })
  } catch (err) {
    await update($, summaryA, () => ({ status: 'failed', text: `要約を頼めませんでした(${err instanceof Error ? err.message : String(err)})`, scope, at }))
    return
  }
  await update($, summaryA, () => (r.isAnswered ? { status: 'done', text: r.text, scope, at } : { status: 'failed', text: whyNot(r), scope, at }))
}

const fillPrompt = async ($: $) => {
  const s = await read($, summaryA)
  if (s.status !== 'done') return
  const r = await $.prompt.fill({ text: `${s.text}\n`, mode: 'insert' })
  const why = r.refusal === 'dialog' ? '(ダイアログが開いています)' : r.refusal === 'no_composer' ? '(入力欄がありません)' : ''
  await update($, noticeA, () => (r.isFilled ? '入力欄に入れました(送信はしていません)' : `入力欄に入れられませんでした${why}`))
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'ふりかえりを開きました。' }
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    // /recap は組み込み (2.1.300 で確認) と被って拒まれる。取れなければ /session-recap にする
    const description = 'セッションのふりかえりをペインに表示'
    const got = await $.command.register({ name: 'recap', description }).catch(() => undefined)
    if (got?.command === 'recap') {
      await update($, commandA, () => 'recap')
    } else {
      await $.command.register({ name: 'session-recap', description }).catch(() => {})
      await update($, commandA, () => 'session-recap')
    }
    const now = await $.clock.now()
    await update($, startedA, v => v || now)
    // 経過の分と実行中の帯が動くので 1 分ごとに描き直す
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, startedA, () => now)
      await update($, turnsA, () => [])
      await update($, pendingA, () => null)
      await update($, selectedA, () => null)
      await update($, summaryA, () => IDLE)
      await update($, noticeA, () => '')
    }
    return next(e)
  })

  // 組み込みの /recap を横取りしない: 自分で登録できた時だけ答える
  on('command.run', { command: 'recap' }, async ($, e, next) => ((await read($, commandA)) === 'recap' ? openPane($) : next(e))).catch(
    ($, e, next) => next(e),
  )
  on('command.run', { command: 'session-recap' }, async $ => openPane($))

  // スラッシュコマンドだけ覚えておく (turn.start の text は展開後の本文になるため)
  on('prompt.submit', async ($, e, next) => {
    if (e.command && e.turnId === undefined) {
      const { name, args } = e.command
      const at = await $.clock.now()
      await update($, pendingA, () => ({ name, args, at }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    const p = await read($, pendingA)
    await update($, pendingA, () => null)
    const cmd = p && now - p.at <= PENDING_MS ? p : null
    const prompt = cmd ? `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ''}` : e.text
    const turn: RecapTurn = {
      turnId: e.turnId,
      start: now,
      label: cmd ? `/${cmd.name}` : head(e.text, 60) || '(続き)',
      prompt: head(prompt, 300),
      tools: {},
      errors: 0,
    }
    // 前のターンが閉じずに残っていたら、ここで閉じる
    await update($, turnsA, list => [...onOpenTurn(list, t => ({ ...t, end: now })), turn].slice(-KEEP_TURNS))
    return next(e)
  })

  // 見るだけ。落ちても呼び出しは止めない
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const tool = String(e.tool)
    let isError = true
    try {
      const r = await next(e)
      isError = r.deny !== undefined || r.isError === true
      return r
    } finally {
      await update($, turnsA, list =>
        onOpenTurn(list, t => ({ ...t, tools: { ...t.tools, [tool]: (t.tools[tool] ?? 0) + 1 }, errors: t.errors + (isError ? 1 : 0) })),
      )
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    await update($, turnsA, list => {
      if (list.some(t => t.turnId === e.turnId)) {
        return list.map(t => (t.turnId === e.turnId ? { ...t, end: t.start + e.durationMs, reason: e.reason } : t))
      }
      // 始まりを聞いていないターン (読み込み前に始まった等)
      const t: RecapTurn = { turnId: e.turnId, start: now - e.durationMs, end: now, label: '(始まりを見ていないターン)', prompt: '', tools: {}, errors: 0, reason: e.reason }
      return [...list, t].slice(-KEEP_TURNS)
    })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = t
    const Svg = e.surface === 'terminal' || !('Svg' in t) ? undefined : t.Svg
    const now = await $.clock.now()
    const turns = await read($, turnsA)
    const selected = await read($, selectedA)
    const summary = await read($, summaryA)
    const notice = await read($, noticeA)
    const startedAt = (await read($, startedA)) || turns[0]?.start || now

    const done = turns.filter(x => x.end !== undefined)
    const longest = done.reduce<RecapTurn | undefined>((a, x) => (!a || x.end! - x.start > a.end! - a.start ? x : a), undefined)
    const totals = {
      elapsedMs: now - startedAt,
      turns: turns.length,
      tools: turns.reduce((n, x) => n + Object.values(x.tools).reduce((a, b) => a + b, 0), 0),
      errors: turns.reduce((n, x) => n + x.errors, 0),
      longest,
      isRunning: turns.some(x => x.end === undefined),
    }
    const totalsAlt = `経過 ${clock(totals.elapsedMs)} ターン ${totals.turns} ツール ${totals.tools} エラー ${totals.errors}`

    const lenOf = (x: RecapTurn) => (x.end === undefined ? '実行中' : dur(x.end - x.start))
    const toolsOf = (x: RecapTurn) =>
      Object.entries(x.tools)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k.startsWith('mcp__') ? k.split('__').pop() : k} ${n}`)
        .join('、') || 'なし'

    const sel = turns.find(x => x.turnId === selected)
    const detail = sel && (
      <Box key="detail" flexDirection="column" borderStyle="round" paddingX={1}>
        <Text key="detail-head" bold>{`${hm(sel.start)} から ${lenOf(sel)}`}</Text>
        <Text key="detail-prompt">{sel.prompt || '(依頼の文なし)'}</Text>
        <Text key="detail-tools" dimColor>{`ツール: ${toolsOf(sel)}`}</Text>
        {sel.errors > 0 || sel.reason === 'error' ? (
          <Text key="detail-errors" color="red">{`エラー ${sel.errors} 回${sel.reason === 'error' ? '(ターンもエラーで終了)' : ''}`}</Text>
        ) : null}
        <Box key="detail-actions" flexDirection="row" gap={1}>
          <Button key="summarize-upto" label="この時点までを要約" onPress={() => summarize($, sel)} />
          <Button key="detail-close" label="閉じる" onPress={() => update($, selectedA, () => null)} />
        </Box>
      </Box>
    )

    const summaryView =
      summary.status === 'running' ? (
        Svg ? (
          <Svg key="busy" source={busySvg()} alt="要約中…" />
        ) : (
          <Text key="busy" color="blue">要約中…</Text>
        )
      ) : summary.status === 'failed' ? (
        <Text key="summary-error" color="red">{`要約できませんでした: ${summary.text}`}</Text>
      ) : summary.status === 'done' ? (
        <Box key="summary" flexDirection="column">
          <Text key="summary-scope" dimColor>{`${hm(summary.at)} に作った要約(${summary.scope})`}</Text>
          <Markdown key="summary-text" text={summary.text} />
          <Button key="summary-fill" label="入力欄に入れる" onPress={() => fillPrompt($)} />
          {notice ? <Text key="notice" dimColor>{notice}</Text> : null}
        </Box>
      ) : null

    // 新しい順。1 行 1 Button
    const list = [...turns].reverse().map(x => (
      <Button key={`turn-${x.turnId}`} plain onPress={() => update($, selectedA, v => (v === x.turnId ? null : x.turnId))}>
        {x.errors > 0 || x.reason === 'error' ? <Text color="red">● </Text> : x.end === undefined ? <Text color="green">● </Text> : '  '}
        {`${hm(x.start)} `}
        <Text dimColor>{`${lenOf(x)} `}</Text>
        {head(x.label, 16)}
      </Button>
    ))

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Box key="charts" flexDirection="column" gap={1}>
            <Svg key="totals" source={totalsSvg(totals)} alt={totalsAlt} />
            <Svg key="timeline" source={timelineSvg(turns, now, selected)} alt={`帯のタイムライン ${turns.length}ターン`} />
          </Box>
        ) : (
          <Box key="charts" flexDirection="column">
            <Text key="totals" color={totals.isRunning ? 'green' : undefined}>{totalsAlt}</Text>
            {longest ? <Text key="longest" dimColor>{`最長 ${lenOf(longest)} ${head(longest.label, 20)}`}</Text> : null}
          </Box>
        )}
        <Box key="summary-actions" flexDirection="row" gap={1}>
          <Button key="summarize" variant="primary" label="ここまでを要約" onPress={() => summarize($)} />
        </Box>
        {summaryView}
        {detail}
        <Box key="turns" flexDirection="column">
          {list.length ? list : <Text key="empty" dimColor>まだターンがありません</Text>}
        </Box>
      </Box>
    )
  })
}
