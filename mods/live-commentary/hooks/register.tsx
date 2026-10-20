import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { LiveCommentaryClock, LiveCommentaryLine, LiveCommentaryScore } from '../types'
import type { Scene, Style } from './phrases'
import { KIND, PHRASES, duration, fileOf, fill, pickIndex, sceneOf, toStyle } from './phrases'
import { KIND_COLOR, boardSvg, clockLabel, stadiumSvg, tickerSvg } from './svg'

const PANE = 'live-commentary'
const TITLE = '実況席'
const DESCRIPTION = 'Claude の動きをスポーツ実況風に伝える実況席を開く'
const STORE_KEY = 'isOn'
const LOG_MAX = 100
/** ターンが終わってからステータス行を消すまで */
export const CLEAR_MS = 20_000
/** これより長いターンの決着はトーストで知らせる */
export const LONG_MS = 5 * 60_000

const LOG = atom({ plugin: 'live-commentary', key: 'log' } as const, [] as LiveCommentaryLine[])
const SCORE = atom({ plugin: 'live-commentary', key: 'score' } as const, { ok: 0, err: 0, streak: 0 } as LiveCommentaryScore)
const CLOCK = atom({ plugin: 'live-commentary', key: 'clock' } as const, { startedAt: 0, now: 0, lastMs: 0 } as LiveCommentaryClock)
const ON = atom({ plugin: 'live-commentary', key: 'isOn' } as const, true)

type $ = EngineInterface

// 口調は register で userConfig から入れる
let style: Style = '熱血'
// ponytail: 描画が読まない値はモジュール変数。リロードで消えても、同じ言い回しが 1 回続くか、立て直しを 1 回言い逃すだけ
const lastPick = new Map<string, number>()
let isAfterError = false
let clearTimer: Timer | undefined

function phrase(scene: Scene, vars: Readonly<Record<string, string | number>>): string {
  const list = PHRASES[style][scene]
  const key = `${style}:${scene}`
  const i = pickIndex(list.length, lastPick.get(key) ?? -1, Math.random)
  lastPick.set(key, i)
  return fill(list[i] ?? '', vars)
}

/** 実況する。オフの時は何も言わない (ステータス行もトーストも出さない) */
async function say($: $, scene: Scene, vars: Readonly<Record<string, string | number>>, isToast = false) {
  if (!(await read($, ON))) return
  const line: LiveCommentaryLine = { at: await $.clock.now(), text: phrase(scene, vars), kind: KIND[scene] }
  await update($, LOG, log => [line, ...log].slice(0, LOG_MAX))
  $.ui.status(line.text)
  if (isToast) $.ui.toast(line.text, { timeoutMs: 6000 })
}

const setOn = async ($: $, isOn: boolean) => {
  await update($, ON, () => isOn)
  await $.store.set(STORE_KEY, isOn)
  if (!isOn) {
    clearTimer?.cancel()
    $.ui.status(undefined)
  }
}

const clearLog = ($: $) => update($, LOG, () => [])

/** ターン中でペインが開いている時だけ、時計を 1 秒ごとに進める */
async function tick($: $) {
  const c = await read($, CLOCK)
  if (c.startedAt === 0) return
  if (!(await $.ui.panes()).some(p => p.id === PANE)) return
  const now = await $.clock.now()
  if (Math.floor((now - c.startedAt) / 1000) === Math.floor((c.now - c.startedAt) / 1000)) return
  await update($, CLOCK, x => ({ ...x, now }))
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '実況席を開きました。' }
}

export const register: Register = (on, options) => {
  style = toStyle(options.style)

  on('session.start', async ($, e, next) => {
    // /jikkyo が拒まれたら (組み込みと被ったら) /live-commentary にする
    const got = await $.command.register({ name: 'jikkyo', description: DESCRIPTION }).catch(() => undefined)
    if (got?.command !== 'jikkyo') await $.command.register({ name: 'live-commentary', description: DESCRIPTION }).catch(() => {})
    const saved = await $.store.get(STORE_KEY).catch(() => undefined)
    await update($, ON, () => saved !== false)
    $.clock.every(1000, () => void tick($).catch(() => {}))
    return next(e)
  })

  on('command.run', { command: 'jikkyo' }, openPane)
  on('command.run', { command: 'live-commentary' }, openPane)

  // 主ループのターンだけ実況する (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      clearTimer?.cancel()
      const now = await $.clock.now()
      await update($, CLOCK, c => ({ ...c, startedAt: now, now }))
      await say($, 'start', {})
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, CLOCK, () => ({ startedAt: 0, now, lastMs: e.durationMs }))
      const time = duration(e.durationMs)
      if (e.isAborted) await say($, 'abort', { time })
      else if (e.durationMs >= LONG_MS) await say($, 'long', { time }, true)
      else await say($, 'end', { time })
      clearTimer?.cancel()
      clearTimer = $.clock.after(CLEAR_MS, () => $.ui.status(undefined))
    }
    return next(e)
  })

  // 見るだけ。ツールは止めない
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const tool = String(e.tool)
    const vars = { tool, file: fileOf(e as Record<string, unknown>) }
    await say($, sceneOf(tool), vars)
    const ran = await next(e)
    if ('deny' in ran && ran.deny !== undefined) return ran
    if (ran.isError) {
      await update($, SCORE, s => ({ ...s, err: s.err + 1, streak: 0 }))
      isAfterError = true
      await say($, 'error', vars)
      return ran
    }
    const s = await update($, SCORE, x => ({ ...x, ok: x.ok + 1, streak: x.streak + 1 }))
    if (isAfterError) {
      isAfterError = false
      await say($, 'comeback', vars, true)
    } else if (s.streak % 10 === 0) await say($, 'ten', { n: s.streak }, true)
    else if (s.streak % 5 === 0) await say($, 'streak', { n: s.streak })
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined

    const isOn = await read($, ON)
    const log = await read($, LOG)
    // 最新の実況はログの先頭
    const line = log[0] ?? null
    const score = await read($, SCORE)
    const clock = await read($, CLOCK)
    const scoreText = `成功 ${score.ok} / エラー ${score.err} / 連続 ${score.streak}`

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Box key="art" flexDirection="column">
            <Svg source={stadiumSvg(isOn, style)} alt={`実況席 ${isOn ? `${style} 実況中` : '実況オフ'}`} />
            <Svg source={boardSvg(score, clock)} alt={`${scoreText} ${clockLabel(clock)}`} />
            <Svg source={tickerSvg(line, isOn)} alt={line?.text ?? ''} />
          </Box>
        ) : (
          <Box key="head" flexDirection="column">
            <Text bold>{`実況席 (${style}) ${isOn ? '実況中' : '実況オフ'}`}</Text>
            <Text>{scoreText}</Text>
            <Text dimColor>{clockLabel(clock)}</Text>
            {line !== null && <Text bold color={KIND_COLOR[line.kind]}>{line.text}</Text>}
          </Box>
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="toggle" label={isOn ? '実況オフ' : '実況オン'} variant="primary" onPress={() => void setOn($, !isOn)} />
          <Button key="clear" label="ログを消す" onPress={() => void clearLog($)} />
        </Box>
        <Box key="log" flexDirection="column">
          <Text dimColor>{`実況ログ ${log.length} 行 (新しい順)`}</Text>
          {log.map(l => (
            <Text color={l.kind === 'error' ? KIND_COLOR.error : undefined} dimColor={l.kind === 'play'}>
              {l.text}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
