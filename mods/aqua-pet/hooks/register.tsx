import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AquaTank } from '../types'
import {
  FEED_AMOUNT,
  FEED_MS,
  INITIAL,
  MAX_MURK,
  UPSET_MS,
  drawTank,
  fishLine,
  fishListSvg,
  fishOf,
  fromSaved,
  fullnessAt,
  sameView,
  stepFish,
  toSaved,
  toStore,
  viewAt,
} from './tank'
import type { Saved } from './tank'
import { C, clean, followTheme, readTheme } from './style'

const PANE = 'aqua-pet'
const TITLE = '水槽'
const STORE_KEY = 'tank'
const tank = atom({ plugin: 'aqua-pet', key: 'tank' } as const, INITIAL)

type $ = EngineInterface

// 同じ store を同時に開いた別のセッション (VS Code とターミナルなど) と分け合う。
// 書く直前に読み直し、その値に今回の操作 (ターン +1・濁り +1・掃除・えさ・名前) だけを当てて書く

/** store の今の育ち具合と生の値。キーが無ければ既定値、読めない・形が違う時は undefined */
const readSaved = async ($: $, now: number): Promise<{ saved: Saved; raw: unknown } | undefined> => {
  try {
    const raw = await $.store.get(STORE_KEY)
    if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) return undefined
    return { saved: fromSaved(raw, now), raw }
  } catch {
    return undefined
  }
}

// 1 セッションの中の書き込み (ターン終わりとボタンが重なる等) は 1 本ずつ流す
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(f: () => Promise<T>): Promise<T> => {
  const p = chain.then(f, f)
  chain = p.catch(() => {})
  return p
}

// 読めない・書けないの知らせはセッションで 1 回 (ターンのたびに出さない)
let isWarned = false
const warn = ($: $, text: string) => {
  if (isWarned) return
  isWarned = true
  $.ui.toast(text, { timeoutMs: 8000 })
}

/** store の今の値に変える → 段を計算し直す → 変わっていれば残す。読めなければ state だけ変える */
const change = ($: $, fn: (t: AquaTank, now: number) => AquaTank) =>
  serial(async () => {
    const now = await $.clock.now()
    const fresh = await readSaved($, now)
    const t = await update($, tank, x => {
      const y = fn(fresh ? { ...x, ...fresh.saved } : x, now)
      return { ...y, view: viewAt(y, now) }
    })
    // 初めて (キーが無い) なら生まれた時刻を残すために書く。
    // 新しい版の mod が足した欄 (この版の知らない欄) は消さずに書き戻す
    if (!fresh) warn($, '水槽の記録を読めなかったので保存していません')
    else {
      const next = toStore(fresh.raw, toSaved(t))
      if (JSON.stringify(next) !== JSON.stringify(fresh.raw)) await $.store.set(STORE_KEY, next).catch(() => warn($, '水槽の記録を保存できませんでした'))
    }
    return t
  })

/** 時間で変わる段 (満腹度・時刻帯・放置・一回限りのアニメ) が変わった時だけ書く */
const refresh = async ($: $) => {
  const now = await $.clock.now()
  const t = await read($, tank)
  if (sameView(t.view, viewAt(t, now))) return
  await update($, tank, x => ({ ...x, view: viewAt(x, now) }))
}

const feed = async ($: $) => {
  await change($, (t, now) => ({
    ...t,
    fullness: Math.min(100, fullnessAt(t, now) + FEED_AMOUNT),
    fedAt: now,
    feedUntil: now + FEED_MS,
  }))
  $.clock.after(FEED_MS + 50, () => refresh($))
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'aquarium', description: '水槽のペインを開く' }).catch(() => {})
    await readTheme($)
    isWarned = false
    // リロード時は実行中などの一時的な値を残し、育ち具合だけ store から戻す
    await change($, t => t)
    // 段は毎分計算するが、書くのは変わった時だけ (背景の時刻は 15 分刻みなので描き直しは 15 分ごと)
    $.clock.every(60_000, () => refresh($))

    return next(e)
  })

  on('command.run', { command: 'aquarium' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '水槽を開きました。' }
  })

  // 主ループのターンだけ数える (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await change($, (t, now) => ({ ...t, isRunning: true, lastActiveAt: now }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // 中断したターンは育ちに数えない。数えたターンでは魚が 1 つ育ち、節目なら新しい魚が来る
    // (t は書く直前に読み直した store の値なので、別のセッションが足した魚も消さない)
    if (!e.agentId)
      await change($, (t, now) => {
        const done = { ...t, isRunning: false, lastActiveAt: now }
        if (e.isAborted) return done
        const turns = t.turns + 1
        return { ...done, turns, fish: stepFish(fishOf(t), turns, t.bornAt, now) }
      })
    return next(e)
  })

  // 見るだけ。エラーの時だけ書く (成功では描き直さない)
  on('tool.call', async ($, e, next) => {
    // サブエージェントの分は数えない
    if (e.agentId !== undefined) return next(e)
    const ran = await next(e)
    if ('isError' in ran && ran.isError) {
      await change($, (t, now) => ({ ...t, upsetUntil: now + UPSET_MS, murk: Math.min(MAX_MURK, t.murk + 1) }))
      $.clock.after(UPSET_MS + 50, () => refresh($))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = await read($, tank)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const v = t.view
    const fish = fishOf(t)
    const n = fish.length

    const buttons = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        <Button key="feed" label="えさをやる" variant="primary" onPress={() => void feed($)} />
        <Button key="rename" label="名前" onPress={() => void update($, tank, x => ({ ...x, isNaming: !x.isNaming }))} />
        <Button key="clean" label="掃除" onPress={() => void change($, x => ({ ...x, murk: 0 }))} />
        <Button key="list" label={t.isListing ? '水槽' : '一覧'} onPress={() => void update($, tank, x => ({ ...x, isListing: !x.isListing }))} />
      </Box>
    )
    const naming =
      t.isNaming && 'Input' in ui ? (
        <ui.Input
          key="name"
          label="名前"
          placeholder="一番大きい魚の名前"
          value={t.name}
          submitLabel="決める"
          onSubmit={value => void change($, x => ({ ...x, name: value.trim().slice(0, 12), isNaming: false }))}
        />
      ) : null
    const info = (
      <Text dimColor>
        {`${t.name ? `${t.name} / ` : ''}育てた日数 ${v.days}日 / 累計 ${t.turns}ターン${t.murk > 0 ? ` / 濁り ${t.murk}` : ''} / ${v.season}の${v.period}`}
      </Text>
    )

    // 一覧の行 (terminal)
    const listRows = t.isListing ? (
      <Box key="fish-list" flexDirection="column">
        {fish.map(f => {
          const l = fishLine(f)
          return (
            <Box key={`f${f.id}`} flexDirection="column">
              <Text>
                {clean(l.title)} <Text color={l.stage === '大物' ? C.yellow : l.stage === '成魚' ? C.green : undefined}>{l.stage}</Text>
              </Text>
              <Text dimColor>{`  ${l.came}`}</Text>
            </Box>
          )
        })}
      </Box>
    ) : null

    // terminal の部品表にも Svg の名前があるので surface でも分ける
    if (e.surface === 'terminal' || !('Svg' in ui)) {
      const mood = v.isUpset ? ' / びっくり' : t.isRunning ? ' / 作業中' : v.isIdle ? ' / おやすみ' : ''
      return (
        <Box flexDirection="column">
          <Text>{`魚 ${n} 匹 / 満腹度 ${v.fullness}%${mood}`}</Text>
          {info}
          {listRows}
          {buttons}
          {naming}
        </Box>
      )
    }
    const { Svg } = ui

    return (
      <Box flexDirection="column" gap={1}>
        {t.isListing ? (
          <Svg key="list-svg" source={fishListSvg(fish)} alt={`魚の一覧: ${n} 匹`} />
        ) : (
          <Svg key="tank-svg" source={drawTank(t)} alt={`水槽: 魚 ${n} 匹、満腹度 ${v.fullness}%`} />
        )}
        {info}
        {buttons}
        {naming}
      </Box>
    )
  })
}
