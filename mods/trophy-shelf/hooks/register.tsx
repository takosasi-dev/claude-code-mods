import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShelfFirstAt } from '../types'
import type { ShelfRaw } from './shelf'
import { addFirst, asFirstAt, countText, freshIds, judge, shelfLines, shelfSvg, snapshotOf, withUnknown } from './shelf'
import { followTheme, readTheme } from './style'

type $ = EngineInterface

const PANE = 'trophy-shelf'
const TITLE = '実績帳'
const DESCRIPTION = 'ほかの mod の記録を 1 枚の棚にまとめ、トロフィーを集める'

const FIRST_AT = atom({ plugin: 'trophy-shelf', key: 'firstAt' } as const, {} as ShelfFirstAt)

// 他の mod の state (読むだけ)。plugin と key はソースに文字で書く (validate が読む)
const RPG_HERO = { plugin: 'dev-rpg', key: 'hero' } as const
const GACHA_SAVE = { plugin: 'turn-gacha', key: 'save' } as const
const GACHA_CARDS = { plugin: 'turn-gacha', key: 'cards' } as const
const AQUA_TANK = { plugin: 'aqua-pet', key: 'tank' } as const
const GAMES_STATS = { plugin: 'wait-games', key: 'stats' } as const
const QUEST_STREAK = { plugin: 'daily-quest', key: 'streak' } as const
const QUEST_DONE = { plugin: 'daily-quest', key: 'totalDone' } as const

/** 1 つ読む。その mod が入っていない・読めない時は undefined */
const get = async (f: () => Promise<{ value: unknown }>) => {
  try {
    return (await f()).value
  } catch {
    return undefined
  }
}

/** 5 つの mod の state を読む。描画の中で呼ぶと、どれかが変わった時に描き直る */
const readRaw = async ($: $): Promise<ShelfRaw> => ({
  hero: await get(() => $.state.get(RPG_HERO)),
  save: await get(() => $.state.get(GACHA_SAVE)),
  cards: await get(() => $.state.get(GACHA_CARDS)),
  tank: await get(() => $.state.get(AQUA_TANK)),
  stats: await get(() => $.state.get(GAMES_STATS)),
  streak: await get(() => $.state.get(QUEST_STREAK)),
  totalDone: await get(() => $.state.get(QUEST_DONE)),
})

// store への書き込みは 1 本ずつ
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(f: () => Promise<T>) => {
  const p = chain.then(f, f)
  chain = p.catch(() => {})
  return p
}

/** 今取れているのに時刻の無いトロフィーに、今の時刻を付ける。store は書く直前に読み直して足す */
const record = ($: $) =>
  serial(async () => {
    const fresh = freshIds(judge(snapshotOf(await readRaw($)), await read($, FIRST_AT)))
    if (fresh.length === 0) return
    const now = await $.clock.now()
    const raw = await $.store.get('firstAt').catch(() => undefined)
    const saved = asFirstAt(raw) ?? (await read($, FIRST_AT))
    const next = addFirst(saved, fresh, now)
    await update($, FIRST_AT, () => next)
    // この版の知らない欄 (新しい版が足したトロフィー) は読んだまま残す
    await $.store.set('firstAt', withUnknown(raw, next)).catch(() => {})
  })

// /trophies を自分で取れたか (取れなければ /trophy-shelf にして、/trophies は横取りしない)
let ownsMain = false

const openPane = async ($: $) => {
  await record($).catch(() => {})
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '実績帳を開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const got = await $.command.register({ name: 'trophies', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'trophies'
    if (!ownsMain) await $.command.register({ name: 'trophy-shelf', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    const saved = asFirstAt(await $.store.get('firstAt').catch(() => undefined))
    if (saved) await update($, FIRST_AT, () => saved)
    await record($).catch(() => {})
    return started
  })

  on('command.run', { command: 'trophies' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'trophy-shelf' }, openPane)

  // メインのターンが答えて終わるたびに見る (他の mod が数を増やした後に拾えるよう、下を先に通す)
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason === 'answer') await record($).catch(() => {})
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text } = t
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const firstAt = await read($, FIRST_AT)
    const snap = snapshotOf(await readRaw($))

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg key="shelf" source={shelfSvg(snap, firstAt)} alt={`実績帳 ${countText(judge(snap, firstAt))}`} />
        ) : (
          <Box key="lines" flexDirection="column">
            {shelfLines(snap, firstAt).map((l, i) => (
              <Text key={`line-${i}`} color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
