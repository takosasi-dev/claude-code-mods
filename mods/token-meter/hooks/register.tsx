import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TokenMeterTurn, TokenMeterUsage } from '../types'
import { barsSvg, hitRate, short, sum, summarySvg } from './svg'
import { followTheme, readTheme } from './style'

const PANE = 'token-meter'
const TITLE = 'トークン'
const KEEP = 50

const ZERO: TokenMeterUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const turnsA = atom({ plugin: 'token-meter', key: 'turns' } as const, [] as TokenMeterTurn[])
const totalA = atom({ plugin: 'token-meter', key: 'total' } as const, ZERO)
const subA = atom({ plugin: 'token-meter', key: 'sub' } as const, { ...ZERO, runs: 0 })
const countA = atom({ plugin: 'token-meter', key: 'count' } as const, 0)
const heaviestA = atom({ plugin: 'token-meter', key: 'heaviest' } as const, null as TokenMeterTurn | null)

type $ = EngineInterface

// /tokens を自分で取れたか (取れなければ組み込みの /tokens には触らない)
let ownsTokens = false

const add = (a: TokenMeterUsage, b: TokenMeterUsage): TokenMeterUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

const reset = async ($: $) => {
  await update($, turnsA, () => [])
  await update($, totalA, () => ZERO)
  await update($, subA, () => ({ ...ZERO, runs: 0 }))
  await update($, countA, () => 0)
  await update($, heaviestA, () => null)
}

const open = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'トークンのペインを開きました。' }
}

export const register: Register = on => {
  followTheme(on)
  on('session.start', async ($, e, next) => {
    await readTheme($)
    // /tokens が組み込みにあると拒まれる。その時は /token-meter にし、/tokens は組み込みに任せる
    const got = await $.command.register({ name: 'tokens', description: 'ターンごとのトークン数とキャッシュの当たり率をペインに表示' }).catch(() => undefined)
    ownsTokens = got?.command === 'tokens'
    if (!ownsTokens) {
      await $.command.register({ name: 'token-meter', description: 'ターンごとのトークン数とキャッシュの当たり率をペインに表示' }).catch(() => {})
    }
    return next(e)
  })

  on('command.run', { command: 'tokens' }, ($, e, next) => (ownsTokens ? open($) : next(e))).catch(($, e, next) => next(e))
  // /tokens を持てた時は /token-meter を登録していないので、その名前の持ち主に回す
  on('command.run', { command: 'token-meter' }, ($, e, next) => (ownsTokens ? next(e) : open($))).catch(($, e, next) => next(e))

  // /clear で数え直す
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)
    return next(e)
  })

  // 中断や API エラーのターンには usage が無い。サブエージェント (agentId 付き) は棒に混ぜず合計だけ別に持つ
  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      const t: TokenMeterUsage = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
      }
      if (e.agentId !== undefined) {
        await update($, subA, s => ({ ...add(s, t), runs: s.runs + 1 }))
      } else {
        let n = 0
        await update($, countA, c => (n = c + 1))
        const turn = { ...t, n }
        await update($, turnsA, list => [...list, turn].slice(-KEEP))
        await update($, totalA, s => add(s, t))
        await update($, heaviestA, h => (h === null || sum(turn) > sum(h) ? turn : h))
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const turns = await read($, turnsA)
    const total = await read($, totalA)
    const sub = await read($, subA)
    const heaviest = await read($, heaviestA)
    const rate = hitRate(total)
    const rateText = rate === null ? '─' : `${Math.round(rate * 100)}%`
    const resetButton = <Button key="reset" dimColor label="リセット" onPress={() => reset($)} />

    // terminal の部品表にも Svg の名前はあるので、画面の種類でも分ける
    if (e.surface === 'terminal' || !('Svg' in t)) {
      const last = turns[turns.length - 1]
      return (
        <Box flexDirection="column">
          <Text key="io">{`入力 ${short(total.input)}  出力 ${short(total.output)}`}</Text>
          <Text key="cache">{`キャッシュ 読み ${short(total.cacheRead)}  書き ${short(total.cacheWrite)}`}</Text>
          <Text key="rate" color={rate === null ? undefined : rate >= 0.7 ? 'green' : rate >= 0.4 ? 'yellow' : 'red'}>
            {`当たり率 ${rateText}`}
          </Text>
          <Text key="last" dimColor>
            {last ? `最新 #${last.n} ${short(sum(last))}` : 'まだターンがありません'}
          </Text>
          {heaviest && <Text key="heaviest" dimColor>{`一番重かったターン #${heaviest.n} ${short(sum(heaviest))}`}</Text>}
          {sub.runs > 0 && <Text key="sub" dimColor>{`サブエージェント ${sub.runs}回 計 ${short(sum(sub))}`}</Text>}
          {resetButton}
        </Box>
      )
    }

    const { Svg } = t
    return (
      <Box flexDirection="column" gap={1}>
        <Svg
          key="summary"
          source={summarySvg(total, sub)}
          alt={`合計 入力 ${short(total.input)} 出力 ${short(total.output)} キャッシュ読み ${short(total.cacheRead)} キャッシュ書き ${short(total.cacheWrite)} 当たり率 ${rateText}`}
        />
        <Svg key="bars" source={barsSvg(turns, heaviest)} alt={`ターンごとの積み上げ棒 直近${Math.min(20, turns.length)}ターン`} />
        {resetButton}
      </Box>
    )
  })
}
