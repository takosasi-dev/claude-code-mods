import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OmikujiDay, OmikujiResult } from '../types'
import { addDay, fillText, fortune, jstDate, paneLines, paneSvg } from './omikuji'

const PANE = 'code-omikuji'
const TITLE = 'おみくじ'
const DESCRIPTION = '今日のコード運勢を引く (1 日 1 回の本番は同じ日なら同じ結果)'
/** 振るアニメの長さ (紙が開き切るまで) */
const SHAKE_MS = 3600

const TODAY = atom({ plugin: 'code-omikuji', key: 'today' } as const, null)
const PLAY = atom({ plugin: 'code-omikuji', key: 'play' } as const, null)
const PLAYS = atom({ plugin: 'code-omikuji', key: 'plays' } as const, 0)
const HISTORY = atom({ plugin: 'code-omikuji', key: 'history' } as const, [])
const MODE = atom({ plugin: 'code-omikuji', key: 'mode' } as const, 'shake')
const IS_OPENED = atom({ plugin: 'code-omikuji', key: 'isOpened' } as const, false)
const NOTE = atom({ plugin: 'code-omikuji', key: 'note' } as const, '')

const isResult = (v: unknown): v is OmikujiResult => typeof v === 'object' && v !== null && typeof (v as OmikujiResult).date === 'string'
const isDays = (v: unknown): v is OmikujiDay[] => Array.isArray(v) && v.every(d => typeof d?.date === 'string' && typeof d?.rank === 'string')

/** 今日の本番を決めて store と state に置く。同じ日なら store の分をそのまま使う */
async function drawToday($: EngineInterface) {
  const date = jstDate(await $.clock.now())
  const saved = await $.store.get('today')
  const today = isResult(saved) && saved.date === date ? saved : fortune(date)
  const kept = await $.store.get('history')
  const history = addDay(isDays(kept) ? kept : [], { date, rank: today.rank })
  if (today !== saved) await $.store.set('today', today)
  await $.store.set('history', history)
  await update($, TODAY, () => today)
  await update($, HISTORY, () => history)
  return today
}

/** store の分を state に写すだけ (開くまでは store に書かない) */
async function loadSaved($: EngineInterface) {
  const date = jstDate(await $.clock.now())
  const saved = await $.store.get('today')
  const kept = await $.store.get('history')
  if (isResult(saved) && saved.date === date) await update($, TODAY, () => saved)
  await update($, HISTORY, () => (isDays(kept) ? kept : []))
}

// 振るアニメが終わったら紙だけの絵に替える (描き直しのたびにアニメが流れないように)
async function settle($: EngineInterface) {
  const n = await read($, PLAYS)
  $.clock.after(SHAKE_MS, () => {
    void (async () => {
      // その間にもう一度振っていたら、そちらの分に任せる
      if ((await read($, PLAYS)) === n) await update($, MODE, () => 'paper')
    })().catch(() => {})
  })
}

async function openPane($: EngineInterface) {
  await drawToday($)
  const wasOpened = await read($, IS_OPENED)
  await update($, PLAY, () => null)
  await update($, NOTE, () => '')
  await update($, MODE, () => (wasOpened ? 'paper' : 'shake'))
  await update($, IS_OPENED, () => true)
  if (!wasOpened) await settle($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'おみくじを開きました。' }
}

/** 遊びの一回。本番 (store) には触らない */
async function shakeAgain($: EngineInterface) {
  const today = (await read($, TODAY)) ?? (await drawToday($))
  const n = await update($, PLAYS, x => x + 1)
  await update($, PLAY, () => fortune(today.date, n))
  await update($, MODE, () => 'shake')
  await update($, NOTE, () => '遊びの一回です。本番の運勢は変わりません')
  await settle($)
}

async function backToToday($: EngineInterface) {
  await update($, PLAY, () => null)
  await update($, MODE, () => 'paper')
  await update($, NOTE, () => '')
}

async function fill($: EngineInterface) {
  const today = (await read($, TODAY)) ?? (await drawToday($))
  const r = await $.prompt.fill({ text: fillText(today), mode: 'replace' }).catch(() => ({ isFilled: false, refusal: undefined }))
  const why = r.refusal === 'dialog' ? '(ダイアログが開いています)' : r.refusal === 'no_composer' ? '(この画面には入力欄がありません)' : ''
  await update($, NOTE, () => (r.isFilled ? '入力欄に入れました(送信はしていません)' : `入力欄に入れられませんでした${why}`))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // /omikuji が拒まれたら (組み込みと被ったら) /code-omikuji にする
    const got = await $.command.register({ name: 'omikuji', description: DESCRIPTION }).catch(() => undefined)
    if (got?.command !== 'omikuji') await $.command.register({ name: 'code-omikuji', description: DESCRIPTION }).catch(() => {})
    await loadSaved($).catch(() => {})
    return started
  })

  on('command.run', { command: 'omikuji' }, async $ => openPane($))
  on('command.run', { command: 'code-omikuji' }, async $ => openPane($))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const today = await read($, TODAY)
    const play = await read($, PLAY)
    const history = await read($, HISTORY)
    const mode = await read($, MODE)
    const note = await read($, NOTE)

    if (!today) return <Text dimColor>/omikuji で今日の運勢を引きます</Text>
    const shown = play ?? today
    const lines = paneLines(shown, today, history, play !== null)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg
            source={paneSvg(shown, today.date, history, { isShake: mode === 'shake', isPlay: play !== null })}
            alt={lines.map(l => l.text).join('\n')}
          />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column">
          <Button key="shake" label="もう一度振る" variant="primary" onPress={() => void shakeAgain($)} />
          {play !== null && <Button key="back" label="本番の結果に戻す" onPress={() => void backToToday($)} />}
          <Button key="fill" label="今日の運勢を入力欄へ" onPress={() => void fill($)} />
        </Box>
        {note !== '' && <Text dimColor>{note}</Text>}
      </Box>
    )
  })
}
