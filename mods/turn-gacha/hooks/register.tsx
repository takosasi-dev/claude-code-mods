import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GachaSave } from '../types'
import { addDraw, bookLines, bookSvg, cardLines, cardSvg, EMPTY, fromSaved, manualLeft, pull, statsLines, statsSvg } from './gacha'

const PANE = 'turn-gacha'
const TITLE = 'ガチャ'
const DESCRIPTION = 'ターンが終わるたびに引いた開発ネタのカードと図鑑を見る'
const STORE_KEY = 'save'

const SAVE = atom({ plugin: 'turn-gacha', key: 'save' } as const, EMPTY as GachaSave)
const VIEW = atom({ plugin: 'turn-gacha', key: 'view' } as const, 'card' as 'card' | 'book')
const NOTE = atom({ plugin: 'turn-gacha', key: 'note' } as const, '')
const ERRORS = atom({ plugin: 'turn-gacha', key: 'turnErrors' } as const, 0)

type $ = EngineInterface

/**
 * 1 枚引いて store と state に書く。SR 以上だけトースト。
 * store を毎回読み直すので、state が空のまま (session.start 前) でも数が戻らない
 */
async function draw($: $, flags: { isClean: boolean; isManual: boolean }) {
  const now = await $.clock.now()
  const saved = fromSaved(await $.store.get(STORE_KEY))
  if (flags.isManual && manualLeft(saved, now) <= 0) {
    await update($, SAVE, () => saved)
    await update($, NOTE, () => '今日の手動はおしまいです(また明日。ターンが終わるたびには引けます)')
    return
  }
  const card = pull(Math.random(), Math.random(), flags.isClean)
  const next = addDraw(saved, card, now, flags)
  await $.store.set(STORE_KEY, next)
  await update($, SAVE, () => next)
  await update($, VIEW, () => 'card')
  await update($, NOTE, () => '')
  if (card.rarity === 'SR' || card.rarity === 'SSR') $.ui.toast(`${card.rarity}!${card.name}`)
}

const openPane = async ($: $) => {
  const saved = fromSaved(await $.store.get(STORE_KEY))
  await update($, SAVE, () => saved)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'ガチャを開きました。' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // /gacha が拒まれたら (組み込みと被ったら) /turn-gacha にする
    const got = await $.command.register({ name: 'gacha', description: DESCRIPTION }).catch(() => undefined)
    if (got?.command !== 'gacha') await $.command.register({ name: 'turn-gacha', description: DESCRIPTION }).catch(() => {})
    const saved = fromSaved(await $.store.get(STORE_KEY))
    await update($, SAVE, () => saved)
    return started
  })

  on('command.run', { command: 'gacha' }, openPane)
  on('command.run', { command: 'turn-gacha' }, openPane)

  // メインのターンだけ数える (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, ERRORS, () => 0)
    return next(e)
  })

  // 中断したターンは引かない
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !e.isAborted) {
      const isClean = (await read($, ERRORS)) === 0
      await draw($, { isClean, isManual: false })
    }
    return done
  }).catch(($, e, next) => next(e))

  // 見るだけ。メインのターンで失敗したツールを数える
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && (ran.deny !== undefined || ran.isError === true)) await update($, ERRORS, n => n + 1)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const save = await read($, SAVE)
    const view = await read($, VIEW)
    const note = await read($, NOTE)
    const left = manualLeft(save, await $.clock.now())
    const latest = save.history[0]

    const textBox = (key: string, lines: ReturnType<typeof cardLines>) => (
      <Box key={key} flexDirection="column">
        {lines.map(l => (
          <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
            {l.text}
          </Text>
        ))}
      </Box>
    )
    const alt = (lines: ReturnType<typeof cardLines>) => lines.map(l => l.text).join('\n')

    let body
    if (view === 'book') {
      const lines = bookLines(save)
      body = Svg ? <Svg key="book-svg" source={bookSvg(save)} alt={alt(lines)} /> : textBox('book-lines', lines)
    } else {
      const card = cardLines(latest)
      const stats = statsLines(save, left)
      // カードのアニメは引いた時だけ頭から。数の変わる物は別の Svg にする
      body = Svg ? (
        <Box key="card-view" flexDirection="column" gap={1}>
          <Svg key="card-svg" source={cardSvg(latest)} alt={alt(card)} />
          <Svg key="stats-svg" source={statsSvg(save, left)} alt={alt(stats)} />
        </Box>
      ) : (
        <Box key="card-view" flexDirection="column" gap={1}>
          {textBox('card-lines', card)}
          {textBox('stats-lines', stats)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {body}
        <Box key="actions" flexDirection="column">
          <Button
            key="pull"
            label={left > 0 ? `もう一回引く(今日あと ${left} 回)` : '今日の手動はおしまい'}
            variant={left > 0 ? 'primary' : 'secondary'}
            onPress={() => void draw($, { isClean: false, isManual: true })}
          />
          <Button
            key="book"
            label={view === 'book' ? 'カードに戻る' : '図鑑'}
            onPress={() => void update($, VIEW, v => (v === 'book' ? 'card' : 'book'))}
          />
        </Box>
        {note !== '' && <Text color="#d29922">{note}</Text>}
      </Box>
    )
  })
}
