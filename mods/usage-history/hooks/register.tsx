import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayRec, Days, HistoryMetric, HistoryRange, HistoryRestore, HistoryWeekDay } from '../types'
import { addDay, asDays, asHeat, busiest, chartSvg, dayKey, dayLabel, EMPTY_DAY, fmtNum, heatSvg, lastDays, mergeDays, mergeHeat, slot, SLOTS, summarize, UNIT, weekOf, withUnknown } from './history'
import { backupDaily, followTheme, jstDay, listBackups, mayWrite, readTheme, rememberVersion } from './style'

type $ = EngineInterface

const PANE = 'usage-history'
const TITLE = '使い方の記録'
const DESCRIPTION = '日ごとのターン数やトークンの記録をグラフで見る'

const CLOSED: HistoryRestore = { days: null, pick: null }

const DAYS = atom({ plugin: 'usage-history', key: 'days' } as const, {} as Days)
const HEAT = atom({ plugin: 'usage-history', key: 'heat' } as const, [] as number[])
const WEEK = atom({ plugin: 'usage-history', key: 'week' } as const, [] as HistoryWeekDay[])
const RANGE = atom({ plugin: 'usage-history', key: 'range' } as const, 7 as HistoryRange)
const METRIC = atom({ plugin: 'usage-history', key: 'metric' } as const, 'turns' as HistoryMetric)
const RESTORE = atom({ plugin: 'usage-history', key: 'restore' } as const, CLOSED)
const NOTE = atom({ plugin: 'usage-history', key: 'note' } as const, '')

const OLD_VERSION = '新しい版が入りました。VS Code を開き直すまで記録は書きません'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// /history を自分で取れたか (取れなければ /usage-history にして、/history は横取りしない)
let ownsMain = false

/** 設定の backupDir (絶対パスでなければ空 = 控えない)。register で入れる */
let backupDir = ''
/** 控えを書いた (書かなくてよいと分かった) JST の日。同じ日は fs を読みに行かない */
let backedDay = ''

// 絶対パス (/x、\x、C:\x、C:/x) だけを受け付ける。相対パスや「C:」は今のフォルダから読まれてしまう
const folderOption = (value: unknown) => {
  const raw = String(value ?? '').trim()
  return /^(?:[\\/]|[A-Za-z]:[\\/])/.test(raw) ? raw : ''
}

/** その日はじめての時だけ、store の生の値 (知らない欄ごと) を days と heat の 2 つの控えに書く */
async function backup($: $, rawDays: unknown, rawHeat: unknown, now: number) {
  if (backupDir === '' || rawDays === undefined || backedDay === jstDay(now)) return
  try {
    await backupDaily($, backupDir, 'days', rawDays, now)
    if (rawHeat !== undefined) await backupDaily($, backupDir, 'heat', rawHeat, now)
    backedDay = jstDay(now)
  } catch {
    // 書けなければ次のターンの終わりにもう一度
  }
}

/** 日ごとの記録と、そこから作る直近 7 日 (他の mod が読む) を一緒に置き換える */
async function putDays($: $, days: Days, now: number) {
  await update($, DAYS, () => days)
  await update($, WEEK, () => weekOf(days, now))
}

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
    const now = await $.clock.now()
    // 古い版のまま動いている時は書かない (新しい版の欄を消さないように。差分は溜めたまま)
    if (!(await mayWrite($, now))) return
    const days = pendingDays
    const heat = pendingHeat
    pendingDays = {}
    pendingHeat = []
    const rawDays = await $.store.get('days').catch(() => undefined)
    const rawHeat = await $.store.get('heat').catch(() => undefined)
    await backup($, rawDays, rawHeat, now)
    const savedDays = asDays(rawDays) ?? (await read($, DAYS))
    const savedHeat = asHeat(rawHeat) ?? (await read($, HEAT))
    const nextDays = mergeDays(savedDays, days)
    const nextHeat = mergeHeat(savedHeat, heat)
    await putDays($, nextDays, now)
    await update($, HEAT, () => nextHeat)
    // この版の知らない欄 (新しい版が足した物) は読んだまま残す
    await $.store.set('days', withUnknown(rawDays, nextDays)).catch(() => {})
    if (heat.length > 0) await $.store.set('heat', nextHeat).catch(() => {})
  })

// ---------------------------------------------------------------- 控えから戻す

async function openRestore($: $) {
  // 日付はファイルから来るので、形の合う物だけ (画面の文字に制御文字を入れない)
  const days = (await listBackups($, backupDir, 'days').catch(() => [])).map(b => b.day).filter(d => DATE_RE.test(d))
  await update($, RESTORE, () => ({ days, pick: null }))
}

/** 控えの日の記録に戻す。store の days と heat を控えの値にして、画面の記録も読み直す */
const restore = ($: $, day: string) =>
  serial(async () => {
    const now = await $.clock.now()
    if (!(await mayWrite($, now))) {
      await update($, NOTE, () => OLD_VERSION)
      return
    }
    const b = (await listBackups($, backupDir, 'days').catch(() => [])).find(x => x.day === day)
    const days = asDays(b?.value)
    if (!b || !days) {
      await update($, NOTE, () => 'この控えは読めない形でした')
      return
    }
    const h = (await listBackups($, backupDir, 'heat').catch(() => [])).find(x => x.day === day)
    const heat = asHeat(h?.value)
    const isSaved = await (async () => {
      await $.store.set('days', b.value)
      if (heat) await $.store.set('heat', heat)
    })().then(
      () => true,
      () => false,
    )
    if (!isSaved) {
      await update($, NOTE, () => '記録を書けませんでした')
      return
    }
    await putDays($, days, now)
    if (heat) await update($, HEAT, () => heat)
    await update($, RESTORE, () => CLOSED)
    await update($, NOTE, () => `${day} の記録に戻しました`)
  })

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '使い方の記録を開きました。' }
}

export const register: Register = (on, options) => {
  backupDir = folderOption(options.backupDir)
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await rememberVersion($)
    const got = await $.command.register({ name: 'history', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'history'
    if (!ownsMain) await $.command.register({ name: 'usage-history', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    const now = await $.clock.now()
    const rawDays = await $.store.get('days').catch(() => undefined)
    const rawHeat = await $.store.get('heat').catch(() => undefined)
    await backup($, rawDays, rawHeat, now)
    await putDays($, asDays(rawDays) ?? (await read($, DAYS)), now)
    const heat = asHeat(rawHeat)
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
    const restoring = await read($, RESTORE)
    const note = await read($, NOTE)
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
        {restoring.days !== null && (
          <Box key="restore-box" flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} paddingY={1}>
            <Text color="yellow" bold>
              控えから戻す
            </Text>
            {backupDir === '' ? (
              <Text dimColor>設定の backupDir を入れると控えが取れます</Text>
            ) : restoring.days.length === 0 ? (
              <Text dimColor>まだ控えがありません (毎日はじめて記録を書く時に取ります)</Text>
            ) : restoring.pick === null ? (
              restoring.days.map(d => (
                <Button key={`restore:${d}`} label={`${d} の記録`} dimColor onPress={() => void update($, RESTORE, r => ({ ...r, pick: d }))} />
              ))
            ) : (
              <Box key="restore-ask" flexDirection="column">
                <Text>{`${restoring.pick} の記録に戻しますか。今の記録は上書きされます`}</Text>
                <Button key="restore:yes" label="戻す" variant="primary" onPress={() => void restore($, restoring.pick ?? '')} />
                <Button key="restore:no" label="やめる" dimColor onPress={() => void update($, RESTORE, r => ({ ...r, pick: null }))} />
              </Box>
            )}
            <Button key="restore:close" label="閉じる" dimColor onPress={() => void update($, RESTORE, () => CLOSED)} />
          </Box>
        )}
        {note !== '' && <Text color="yellow">{note}</Text>}
        <Button key="restore" label="控えから戻す" dimColor onPress={() => void (restoring.days === null ? openRestore($) : update($, RESTORE, () => CLOSED))} />
      </Box>
    )
  })
}
