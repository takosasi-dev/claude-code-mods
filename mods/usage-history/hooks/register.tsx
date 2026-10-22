import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayRec, Days, HistoryMetric, HistoryRange } from '../types'
import { addDay, asDays, asHeat, busiest, chartSvg, dayKey, dayLabel, EMPTY_DAY, fmtNum, heatSvg, lastDays, mergeDays, mergeHeat, slot, SLOTS, summarize, UNIT, withUnknown } from './history'
import { followTheme, readTheme } from './style'

type $ = EngineInterface

const PANE = 'usage-history'
const TITLE = '使い方の記録'
const DESCRIPTION = '日ごとのターン数やトークンの記録をグラフで見る'

const DAYS = atom({ plugin: 'usage-history', key: 'days' } as const, {} as Days)
const HEAT = atom({ plugin: 'usage-history', key: 'heat' } as const, [] as number[])
const RANGE = atom({ plugin: 'usage-history', key: 'range' } as const, 7 as HistoryRange)
const METRIC = atom({ plugin: 'usage-history', key: 'metric' } as const, 'turns' as HistoryMetric)

// /history を自分で取れたか (取れなければ /usage-history にして、/history は横取りしない)
let ownsMain = false

// まだ store に書いていない差分。メインのターンの終わりにまとめて 1 回書く
let pendingDays: Days = {}
let pendingHeat: number[] = []
const bump = (key: string, d: Partial<DayRec>) => {
  pendingDays[key] = addDay(pendingDays[key] ?? EMPTY_DAY, d)
}

// store への書き込みは 1 本ずつ
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(f: () => Promise<T>) => {
  const p = chain.then(f, f)
  chain = p.catch(() => {})
  return p
}

// 書く直前に読み直し、差分だけを足す (他のセッションが足した分を消さない)
const flush = ($: $) =>
  serial(async () => {
    if (Object.keys(pendingDays).length === 0 && pendingHeat.length === 0) return
    const days = pendingDays
    const heat = pendingHeat
    pendingDays = {}
    pendingHeat = []
    const rawDays = await $.store.get('days').catch(() => undefined)
    const savedDays = asDays(rawDays) ?? (await read($, DAYS))
    const savedHeat = asHeat(await $.store.get('heat').catch(() => undefined)) ?? (await read($, HEAT))
    const nextDays = mergeDays(savedDays, days)
    const nextHeat = mergeHeat(savedHeat, heat)
    await update($, DAYS, () => nextDays)
    await update($, HEAT, () => nextHeat)
    // この版の知らない欄 (新しい版が足した物) は読んだまま残す
    await $.store.set('days', withUnknown(rawDays, nextDays)).catch(() => {})
    if (heat.length > 0) await $.store.set('heat', nextHeat).catch(() => {})
  })

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '使い方の記録を開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const got = await $.command.register({ name: 'history', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'history'
    if (!ownsMain) await $.command.register({ name: 'usage-history', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    const days = asDays(await $.store.get('days').catch(() => undefined))
    if (days) await update($, DAYS, () => days)
    const heat = asHeat(await $.store.get('heat').catch(() => undefined))
    if (heat) await update($, HEAT, () => heat)
    return started
  })

  on('session.end', async ($, e, next) => {
    await flush($).catch(() => {})
    return next(e)
  })

  // 数えるだけ。結果を待たず、落ちても呼び出しは止めない
  on('tool.call', async ($, e, next) => {
    bump(dayKey(await $.clock.now()), { tools: 1 })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    const isMain = e.agentId === undefined
    const isTurn = isMain && e.reason === 'answer'
    const u = e.usage
    bump(dayKey(at), {
      turns: isTurn ? 1 : 0,
      subTurns: isMain ? 0 : 1,
      durationMs: isMain ? e.durationMs : 0,
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      cacheRead: u?.cache_read_input_tokens ?? 0,
    })
    if (isTurn) {
      if (pendingHeat.length === 0) pendingHeat = new Array<number>(SLOTS).fill(0)
      pendingHeat[slot(at)] = (pendingHeat[slot(at)] ?? 0) + 1
    }
    // サブエージェントの分は溜めておき、メインのターンの終わりに 1 回書く
    if (isMain) void flush($).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'history' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'usage-history' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const now = await $.clock.now()
    const days = await read($, DAYS)
    const heat = await read($, HEAT)
    const range = await read($, RANGE)
    const metric = await read($, METRIC)
    const { total, top, value, average } = summarize(lastDays(days, now, range), metric)
    const unit = UNIT[metric]
    const peak = busiest(heat)
    const line = `直近 ${range} 日 ${unit} 合計 ${fmtNum(value)} / 1 日平均 ${fmtNum(average)}`
    const topLine = top ? `いちばん多かった日 ${dayLabel(top.key)} ${fmtNum(top.value)} ${unit}` : `直近 ${range} 日はまだ記録がありません`

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {([7, 30] as const).map(n => (
            <Button key={`range-${n}`} dimColor={range !== n} label={`${n} 日`} variant={range === n ? 'primary' : undefined} onPress={() => update($, RANGE, () => n)} />
          ))}
          <Button
            key="metric" dimColor
            label={metric === 'turns' ? '出力トークンで見る' : 'ターン数で見る'}
            onPress={() => update($, METRIC, m => (m === 'turns' ? 'output' : 'turns'))}
          />
        </Box>
        {Svg ? (
          <Box flexDirection="column" gap={1}>
            <Svg key="chart" source={chartSvg(days, now, range, metric)} alt={line} />
            <Svg key="heat" source={heatSvg(heat)} alt={peak ? `いちばん多い時間帯 ${peak.week}曜 ${peak.hour} 時台` : '曜日と時間帯のヒートマップ'} />
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold>{line}</Text>
            <Text dimColor>{`ツール ${fmtNum(total.tools)} 回 / サブエージェント ${fmtNum(total.subTurns)} ターン`}</Text>
            <Text dimColor>{`入力 ${fmtNum(total.inputTokens)} / 出力 ${fmtNum(total.outputTokens)} / キャッシュ読み ${fmtNum(total.cacheRead)}`}</Text>
            <Text>{topLine}</Text>
            {peak && <Text>{`よく使う時間帯 ${peak.week}曜 ${peak.hour} 時台(${peak.turns} ターン)`}</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
