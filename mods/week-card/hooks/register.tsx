import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WeekSnaps } from '../types'
import type { WeekRaw } from './card'
import { asSnaps, baseOf, cardLines, cardSvg, dayKey, isSameSnap, reportMd, snapOf, summaryText, usageOf, withSnap } from './card'
import { followTheme, mayWrite, readTheme, rememberVersion } from './style'

type $ = EngineInterface

const PANE = 'week-card'
const TITLE = '今週のカード'
const DESCRIPTION = '1 週間の使い方と、お題・ガチャ・冒険の書・水槽の増え方を 1 枚のカードで見る'

const SNAPS = atom({ plugin: 'week-card', key: 'snaps' } as const, {} as WeekSnaps)

// 他の mod の state (読むだけ)。plugin と key はソースに文字で書く (validate が読む)
const USAGE_WEEK = { plugin: 'usage-history', key: 'week' } as const
const RPG_HERO = { plugin: 'dev-rpg', key: 'hero' } as const
const GACHA_SAVE = { plugin: 'turn-gacha', key: 'save' } as const
const GACHA_CARDS = { plugin: 'turn-gacha', key: 'cards' } as const
const AQUA_TANK = { plugin: 'aqua-pet', key: 'tank' } as const
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

/** 他の mod の state を読む。描画の中で呼ぶと、どれかが変わった時に描き直る */
const readRaw = async ($: $): Promise<WeekRaw> => ({
  week: await get(() => $.state.get(USAGE_WEEK)),
  hero: await get(() => $.state.get(RPG_HERO)),
  save: await get(() => $.state.get(GACHA_SAVE)),
  cards: await get(() => $.state.get(GACHA_CARDS)),
  tank: await get(() => $.state.get(AQUA_TANK)),
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

/** 今日の写しを取る。store の今日の分と違う時だけ、書く直前に読み直して今日の分だけ置き換える */
const record = ($: $) =>
  serial(async () => {
    const now = await $.clock.now()
    const day = dayKey(now)
    const snap = snapOf(await readRaw($))
    if (Object.keys(snap).length === 0) return
    const raw = await $.store.get('snaps').catch(() => undefined)
    const saved = asSnaps(raw) ?? (await read($, SNAPS))
    if (isSameSnap(saved[day], { ...saved[day], ...snap })) {
      await update($, SNAPS, () => saved)
      return
    }
    // 古い版のまま動いている時は書かない (新しい版の欄を消さないように)
    if (!(await mayWrite($, now))) return
    // この版の知らない欄 (新しい版が足した物) は読んだまま残す
    const next = withSnap(raw, day, snap)
    await update($, SNAPS, () => asSnaps(next) ?? {})
    await $.store.set('snaps', next).catch(() => {})
  })

/** 週報に貼る文を入力欄に入れる (送信はしない) */
async function paste($: $) {
  const now = await $.clock.now()
  const raw = await readRaw($)
  const text = reportMd(now, usageOf(raw.week, now), snapOf(raw), baseOf(await read($, SNAPS), now))
  const r = await $.prompt.fill({ text, mode: 'insert' }).catch(() => ({ isFilled: false, refusal: undefined }))
  const why = r.refusal === 'dialog' ? '(ダイアログが開いています)' : r.refusal === 'no_composer' ? '(この画面には入力欄がありません)' : ''
  $.ui.toast(r.isFilled ? '週報に貼る文を入力欄に入れました(送信はしていません)' : `入力欄に入れられませんでした${why}`, { timeoutMs: 5000 })
}

// /week を自分で取れたか (取れなければ /week-card にして、/week は横取りしない)
let ownsMain = false

async function openPane($: $) {
  await record($).catch(() => {})
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '今週のカードを開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await rememberVersion($)
    const got = await $.command.register({ name: 'week', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'week'
    if (!ownsMain) await $.command.register({ name: 'week-card', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    const saved = asSnaps(await $.store.get('snaps').catch(() => undefined))
    if (saved) await update($, SNAPS, () => saved)
    await record($).catch(() => {})
    return started
  })

  on('command.run', { command: 'week' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'week-card' }, openPane)

  // メインのターンが答えて終わるたびに写す (他の mod が数を増やした後に拾えるよう、下を先に通す)
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason === 'answer') await record($).catch(() => {})
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const now = await $.clock.now()
    const raw = await readRaw($)
    const usage = usageOf(raw.week, now)
    const snap = snapOf(raw)
    const base = baseOf(await read($, SNAPS), now)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg key="card" source={cardSvg(now, usage, snap, base)} alt={summaryText(now, usage)} />
        ) : (
          <Box key="lines" flexDirection="column">
            {cardLines(now, usage, snap, base).map((l, i) => (
              <Text key={`line-${i}`} color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column">
          <Button key="paste" label="週報に貼る文を入力欄に入れる" variant="primary" onPress={() => void paste($)} />
          <Text dimColor>入力欄に入れるだけで、送信はしません。</Text>
        </Box>
      </Box>
    )
  })
}
