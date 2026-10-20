import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RpgHero } from '../types'
import {
  INITIAL,
  INITIAL_SAVED,
  achievementLines,
  achievementsSvg,
  fromSaved,
  grant,
  hpPctAt,
  levelInfo,
  levelUpText,
  onTool,
  onTurnEnd,
  onTurnStart,
  startSession,
  statusLines,
  statusSvg,
  toSaved,
} from './rpg'
import type { Achievement } from './rpg'

const PANE = 'dev-rpg'
const TITLE = '冒険の書'
const DESCRIPTION = '作業が経験値になる RPG のステータス窓を開く'
const STORE_KEY = 'hero'

const HERO = atom({ plugin: 'dev-rpg', key: 'hero' } as const, INITIAL)
const TAB = atom({ plugin: 'dev-rpg', key: 'tab' } as const, 'status')
const CONFIRM = atom({ plugin: 'dev-rpg', key: 'isConfirmingReset' } as const, false)
const NEWS = atom({ plugin: 'dev-rpg', key: 'news' } as const, '')

type $ = EngineInterface

let ownsMain = false

/** 変える → 実績を見る → 残す。レベルが上がった時だけトーストを出す */
async function change($: $, fn: (h: RpgHero, now: number) => RpgHero, isTurnEnd = false) {
  const now = await $.clock.now()
  let before = 1
  let gained: Achievement[] = []
  const hero = await update($, HERO, x => {
    before = levelInfo(x.xp).level
    const r = grant(fn(x, now), now, isTurnEnd)
    gained = r.gained
    return r.hero
  })
  await $.store.set(STORE_KEY, toSaved(hero))
  const after = levelInfo(hero.xp).level
  const news: string[] = []
  if (after > before) {
    $.ui.toast(levelUpText(after))
    news.push(levelUpText(after))
  }
  if (gained.length > 0) news.push(`実績「${gained.map(a => a.name).join('」「')}」を手に入れた`)
  if (news.length > 0) await update($, NEWS, () => news.join(' / '))
}

/** HP は時間で減る。整数が変わった時だけ書く (経験値のアニメは動かさない) */
async function refresh($: $) {
  const now = await $.clock.now()
  const hero = await read($, HERO)
  if (hpPctAt(hero, now) === hero.hpPct) return
  await update($, HERO, x => ({ ...x, hpPct: hpPctAt(x, now), xpFrom: levelInfo(x.xp).frac }))
}

async function reset($: $) {
  const now = await $.clock.now()
  const hero = startSession(INITIAL_SAVED, now)
  await update($, HERO, () => hero)
  await $.store.set(STORE_KEY, toSaved(hero))
  await update($, CONFIRM, () => false)
  await update($, TAB, () => 'status' as const)
  await update($, NEWS, () => '冒険をやり直しました。Lv 1 から')
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '冒険の書を開きました。' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // /rpg が拒まれたら (組み込みと被ったら) /dev-rpg にする
    const got = await $.command.register({ name: 'rpg', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'rpg'
    if (!ownsMain) await $.command.register({ name: 'dev-rpg', description: DESCRIPTION }).catch(() => {})
    // リロードなら state の方が新しいのでそのまま。新しいセッションなら store から読み戻して冒険の回数を足す
    if ((await read($, HERO)).s.startedAt === 0) {
      const saved = fromSaved(await $.store.get(STORE_KEY).catch(() => undefined))
      await change($, (_h, now) => startSession(saved, now))
    }
    $.clock.every(60_000, () => void refresh($).catch(() => {}))
    return started
  })

  on('command.run', { command: 'rpg' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'dev-rpg' }, openPane)

  // 主ループのターンだけ数える (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await change($, onTurnStart)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && !e.isAborted) await change($, onTurnEnd, true)
    return next(e)
  })

  // 見るだけ。断られた呼び出し (deny) は数えない
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && !('deny' in ran && ran.deny !== undefined)) {
      const tool = String(e.tool)
      const isError = 'isError' in ran && ran.isError === true
      await change($, (h, now) => onTool(h, tool, isError, now))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const hero = await read($, HERO)
    const tab = await read($, TAB)
    const isConfirming = await read($, CONFIRM)
    const news = await read($, NEWS)
    const lines = tab === 'status' ? statusLines(hero) : achievementLines(hero)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={tab === 'status' ? statusSvg(hero) : achievementsSvg(hero)} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        {news !== '' && <Text color="yellow">{news}</Text>}
        <Box flexDirection="column">
          <Button
            key="tab"
            label={tab === 'status' ? '実績を見る' : 'ステータスに戻る'}
            variant="primary"
            onPress={() =>
              void (async () => {
                await update($, CONFIRM, () => false)
                await update($, TAB, x => (x === 'status' ? 'achievements' : 'status'))
              })()
            }
          />
          <Button
            key="reset"
            label={isConfirming ? '本当にやり直す(すべて消えます)' : '冒険をやり直す'}
            onPress={() => void (isConfirming ? reset($) : update($, CONFIRM, () => true))}
          />
          {isConfirming && <Button key="reset-cancel" label="やめる" onPress={() => void update($, CONFIRM, () => false)} />}
        </Box>
      </Box>
    )
  })
}
