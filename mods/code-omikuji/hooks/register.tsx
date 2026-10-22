import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { addDay, fillText, fortune, isResult, jstDate, objOf, paneLines, paneSvg, toDays } from './omikuji'
import { followTheme, mayWrite, readTheme, rememberVersion } from './style'

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

// 主の名前 (/omikuji) を持てたか。session.start で決まる (リロードでも来る)
let ownsMain = false

/** 今日の本番を決めて store と state に置く。同じ日なら store の分をそのまま使う (形が合わなければ作り直す) */
async function drawToday($: EngineInterface) {
  const now = await $.clock.now()
  const date = jstDate(now)
  // 読めない時 (例外・形が違う) は引いて見せるだけで、store には書かない (上書きしない)
  const BROKEN = Symbol('broken')
  const saved: unknown = await $.store.get('today').catch(() => BROKEN)
  const kept: unknown = await $.store.get('history').catch(() => BROKEN)
  // 引き直す時も、知らない欄 (新しい版が足した欄) は残して書く
  const today = isResult(saved) && saved.date === date ? saved : { ...objOf(saved), ...fortune(date) }
  const history = addDay(toDays(kept), { date, rank: today.rank })
  const isPlain = typeof saved === 'object' && saved !== null && !Array.isArray(saved)
  const canWrite = saved !== BROKEN && kept !== BROKEN && (saved === undefined || isPlain) && (kept === undefined || Array.isArray(kept))
  // 新しい版が入ったのに古い版のまま動いている時も書かない
  if (canWrite && (await mayWrite($, now))) {
    if (today !== saved) await $.store.set('today', today).catch(() => {})
    await $.store.set('history', history).catch(() => {})
  }
  await update($, TODAY, () => today)
  await update($, HISTORY, () => history)
  return today
}

/** state の本番が今日の分ならそれ、日付が変わっていたら引き直す */
async function currentToday($: EngineInterface) {
  const today = await read($, TODAY)
  return today && today.date === jstDate(await $.clock.now()) ? today : drawToday($)
}

/** store の分を state に写すだけ (開くまでは store に書かない) */
async function loadSaved($: EngineInterface) {
  const date = jstDate(await $.clock.now())
  const saved = await $.store.get('today')
  const kept = await $.store.get('history')
  if (isResult(saved) && saved.date === date) await update($, TODAY, () => saved)
  await update($, HISTORY, () => toDays(kept))
}

/**
 * 日付が変わったら入れ替える (描画では書けないので 1 分ごとに見る)。
 * ペインが開いていれば今日の分を引き、閉じていれば昨日の分を下ろすだけ (開くまでは store に書かない)
 */
async function rollover($: EngineInterface) {
  const today = await read($, TODAY)
  if (!today || today.date === jstDate(await $.clock.now())) return
  await update($, PLAY, () => null)
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await drawToday($)
    await update($, MODE, () => 'paper')
    await update($, NOTE, () => '')
  } else await update($, TODAY, () => null)
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
  const today = await currentToday($)
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
  const today = await currentToday($)
  // replace は入力欄の下書きを消すので、カーソルの位置に入れる
  const r = await $.prompt.fill({ text: fillText(today), mode: 'insert' }).catch(() => ({ isFilled: false, refusal: undefined }))
  const why = r.refusal === 'dialog' ? '(ダイアログが開いています)' : r.refusal === 'no_composer' ? '(この画面には入力欄がありません)' : ''
  await update($, NOTE, () => (r.isFilled ? '入力欄に入れました(送信はしていません)' : `入力欄に入れられませんでした${why}`))
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    await rememberVersion($).catch(() => {})
    // /omikuji が拒まれたら (組み込みと被ったら) /code-omikuji にする
    const got = await $.command.register({ name: 'omikuji', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'omikuji'
    if (!ownsMain) await $.command.register({ name: 'code-omikuji', description: DESCRIPTION }).catch(() => {})
    await loadSaved($).catch(() => {})
    $.clock.every(60_000, () => void rollover($).catch(() => {}))
    return started
  })

  // /omikuji を持てなかった時は、元の /omikuji に回す
  on('command.run', { command: 'omikuji' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  // /omikuji を持てた時は /code-omikuji を登録していないので、その名前の持ち主に回す
  on('command.run', { command: 'code-omikuji' }, ($, e, next) => (ownsMain ? next(e) : openPane($))).catch(($, e, next) => next(e))

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

    // 日付が変わった後の 1 分足らずも、昨日の分を「今日の運勢」として出さない
    if (!today || today.date !== jstDate(await $.clock.now())) return <Text dimColor>/omikuji で今日の運勢を引きます</Text>
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
          {play !== null && <Button key="back" dimColor label="本番の結果に戻す" onPress={() => void backToToday($)} />}
          <Button key="fill" dimColor label="今日の運勢を入力欄へ" onPress={() => void fill($)} />
        </Box>
        {note !== '' && <Text dimColor>{note}</Text>}
      </Box>
    )
  })
}
