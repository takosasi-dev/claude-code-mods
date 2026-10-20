import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CanvasBoard } from '../types'
import { DESCRIPTION as TOOL_DESCRIPTION, INPUT_SCHEMA, KEEP, KIND_NAME, TOOL_NAME, drawChart, parseShow } from './canvas'
import { followTheme, readTheme } from './style'

const PANE = 'canvas-pane'
const TITLE = 'キャンバス'
const DESCRIPTION = 'Claude が描いたグラフ・表・図のペインを開く'
const TOOL = 'mcp__canvas-pane__show'
const EMPTY_HINT = 'Claude に「〜をグラフにしてペインに出して」と頼むと、ここに描かれます'

const EMPTY: CanvasBoard = { items: [], pos: 0, seq: 1 }
const BOARD = atom({ plugin: 'canvas-pane', key: 'board' } as const, EMPTY)

type $ = EngineInterface

let ownsMain = false

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'キャンバスのペインを開きました。' }
}

const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 前へ・次へ。端では動かない */
const move = ($: $, by: number) =>
  update($, BOARD, b => ({ ...b, pos: Math.max(0, Math.min(b.items.length - 1, b.pos + by)) }))

/** 見ている 1 枚を消す */
const remove = ($: $) =>
  update($, BOARD, b => {
    if (b.items.length === 0) return b
    const items = b.items.filter((_, i) => i !== b.pos)
    return { ...b, items, pos: Math.min(b.pos, Math.max(0, items.length - 1)) }
  })

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    await $.tool
      .register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA })
      .catch((err: unknown) => $.ui.log(`canvas-pane: ツールを登録できませんでした (${err instanceof Error ? err.message : String(err)})`))
    // /canvas が拒まれたら (組み込みや他の mod と被ったら) /canvas-pane にする
    const got = await $.command.register({ name: 'canvas', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'canvas'
    if (!ownsMain) await $.command.register({ name: 'canvas-pane', description: DESCRIPTION }).catch(() => {})
    return started
  })

  // /canvas を持てなかった時は、元の /canvas に回す
  on('command.run', { command: 'canvas' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'canvas-pane' }, openPane)

  // Claude が呼ぶツール。入力はモデルから来る外の値なので、全部確かめてから描く
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const parsed = parseShow(e)
    if ('error' in parsed) return { deny: `描けませんでした: ${parsed.error}` }
    const at = await $.clock.now()
    let count = 0
    await update($, BOARD, b => {
      const items = [...b.items, { ...parsed.item, id: b.seq, at }].slice(-KEEP)
      count = items.length
      return { items, pos: items.length - 1, seq: b.seq + 1 }
    })
    const opened = await $.ui.open({ id: PANE, title: TITLE }).catch((err: unknown) => ({
      isPlaced: false as const,
      reason: err instanceof Error ? err.message : String(err),
    }))
    const where = opened.isPlaced ? '' : `(ペインはまだ表に出ていません: ${opened.reason}。ユーザーは /canvas で開けます)`
    return { result: `「${parsed.item.title}」(${KIND_NAME[parsed.item.kind]}) をペインに描きました${where}。直近 ${KEEP} 枚まで残り、今は ${count} 枚です。` }
  }).catch(() => ({ deny: 'canvas-pane: 描く途中で失敗しました。もう一度呼ぶか、データを小さくしてください' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const board = await read($, BOARD)
    const item = board.items[board.pos]

    if (!item)
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{EMPTY_HINT}</Text>
        </Box>
      )

    const n = board.items.length
    const isFirst = board.pos === 0
    const isLast = board.pos === n - 1
    let body
    if (item.kind === 'markdown') body = <Markdown key={`md-${item.id}`} text={item.markdown ?? ''} />
    // source が変われば伸びるアニメは頭から出る。この mod が組む図は今のテーマの色で組み直す
    else if (Svg && item.svg !== undefined) body = <Svg source={item.chart ? drawChart(item.chart) : item.svg} alt={item.alt} />
    else
      body = (
        <Box key={`lines-${item.id}`} flexDirection="column">
          {item.lines.map(l => (
            <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
              {l.text}
            </Text>
          ))}
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1}>
        <Box key="head" flexDirection="column">
          <Text bold>{item.title}</Text>
          <Text dimColor>{`${board.pos + 1} / ${n} 枚目 ─ ${KIND_NAME[item.kind]} ─ ${hhmm(item.at)}`}</Text>
        </Box>
        {body}
        <Box key="actions" flexDirection="row" gap={1}>
          <Button key="prev" label="前へ" dimColor={isFirst} onPress={() => void move($, -1)} />
          <Button key="next" label="次へ" dimColor={isLast} onPress={() => void move($, 1)} />
          <Button key="remove" label="消す" onPress={() => void remove($)} />
        </Box>
      </Box>
    )
  })
}
