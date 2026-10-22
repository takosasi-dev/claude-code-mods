import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GachaSave } from '../types'
import {
  addDraw,
  bookLines,
  bookSvg,
  cardLines,
  cardSvg,
  claimedFrom,
  EMPTY,
  fromSaved,
  goalsMet,
  KEEP_CLAIMED,
  manualLeft,
  PUBLIC_CARDS,
  pull,
  questRewards,
  statsLines,
  statsSvg,
  withUnknown,
} from './gacha'
import { backup, backupDir, backupOf, closeRestore, isBackedToday, isRestoring, resetRestore, restoreButton, restoreCard, setBackupDir } from './backup'
import { followTheme, mayWrite, readTheme, rememberVersion } from './style'

const PANE = 'turn-gacha'
const TITLE = 'ガチャ'
const DESCRIPTION = 'ターンが終わるたびに引いた開発ネタのカードと図鑑を見る'
const STORE_KEY = 'save'

const SAVE = atom({ plugin: 'turn-gacha', key: 'save' } as const, EMPTY as GachaSave)
const VIEW = atom({ plugin: 'turn-gacha', key: 'view' } as const, 'card' as 'card' | 'book')
const NOTE = atom({ plugin: 'turn-gacha', key: 'note' } as const, '')
const ERRORS = atom({ plugin: 'turn-gacha', key: 'turnErrors' } as const, 0)
/** 他の mod (dev-rpg) が読むカードの表 */
const CARDS_REF = { plugin: 'turn-gacha', key: 'cards' } as const
/** daily-quest の今日のお題 (読むだけ。daily-quest が無ければ undefined のまま) */
const QUEST_TODAY = { plugin: 'daily-quest', key: 'today' } as const
const CLAIM_KEY = 'questClaimed'

type $ = EngineInterface

const BROKEN = '記録を読めなかったので、引いた分を残せません(上書きしないよう止めています)'

let ownsMain = false

// store に書く物は 1 本ずつ流す。ボタンの連打やターン終わりと重なると、同じ値を読んで 1 枚消える
let chain: Promise<unknown> = Promise.resolve()
const serial = (f: () => Promise<unknown>) => (chain = chain.then(f, f))

/** store の値 (と、知らない欄を残して書くための生の値)。キーが無ければ空、読めない時 (例外・形が違う) は undefined */
async function readStore($: $): Promise<{ saved: GachaSave; raw: unknown } | undefined> {
  try {
    const raw = await $.store.get(STORE_KEY)
    if (raw === undefined) return { saved: EMPTY, raw }
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { saved: fromSaved(raw), raw } : undefined
  } catch {
    return undefined
  }
}

/** store を state に写す。読めなければ知らせるだけ。その日はじめてなら、読んだ生の値を控える */
async function load($: $) {
  const got = await readStore($)
  if (got) await update($, SAVE, () => got.saved)
  else await update($, NOTE, () => BROKEN)
  await backupAll($, got?.raw)
}

/** 図鑑 (save) と受け取り済みのお題 (questClaimed) を、その日はじめての時だけ控える。save の生の値は読んだ物があれば渡す */
async function backupAll($: $, raw?: unknown) {
  if (!backupDir) return
  const now = await $.clock.now()
  if (!isBackedToday(STORE_KEY, now)) await backup($, STORE_KEY, raw ?? (await $.store.get(STORE_KEY).catch(() => undefined)), now)
  if (!isBackedToday(CLAIM_KEY, now)) await backup($, CLAIM_KEY, await $.store.get(CLAIM_KEY).catch(() => undefined), now)
}

/**
 * day の控えに戻す。図鑑はその日の値で置き換え、受け取り済みのお題は今の物と合わせる
 * (古い日に戻しても、今日もう受け取ったごほうびをもう一度引かないように)。古い版のままなら戻さない
 */
const restoreDay = ($: $, day: string) =>
  serial(async () => {
    if (!(await mayWrite($, await $.clock.now()))) return
    const value = await backupOf($, STORE_KEY, day)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      $.ui.toast('控えを読めなかったので、戻していません', { timeoutMs: 8000 })
      return
    }
    try {
      await $.store.set(STORE_KEY, value)
      const old = claimedFrom(await backupOf($, CLAIM_KEY, day))
      if (old.length > 0) {
        const now = claimedFrom(await $.store.get(CLAIM_KEY))
        await $.store.set(CLAIM_KEY, [...new Set([...now, ...old])].slice(-KEEP_CLAIMED))
      }
    } catch {
      $.ui.toast('控えの記録を書けませんでした', { timeoutMs: 8000 })
      return
    }
    await load($)
    await update($, NOTE, () => '')
    closeRestore($)
    $.ui.toast(`${day} の記録に戻しました`)
  })

/**
 * 1 枚引いて store と state に書く。SR 以上だけトースト。
 * 書く直前に store を読み直し、1 枚分だけ足す (別のセッションの分を消さない)
 */
const draw = ($: $, flags: { isClean: boolean; isManual: boolean }) =>
  serial(async () => {
    const now = await $.clock.now()
    const got = await readStore($)
    if (!got) {
      await update($, NOTE, () => BROKEN)
      return
    }
    const saved = got.saved
    if (flags.isManual && manualLeft(saved, now) <= 0) {
      await update($, SAVE, () => saved)
      await update($, NOTE, () => '今日の手動はおしまいです(また明日。ターンが終わるたびには引けます)')
      return
    }
    // 日をまたいで動き続けるセッションも、その日はじめて書く前に控える
    await backupAll($, got.raw)
    // 新しい版が入ったのに古い版のまま動いている時は、引かない (書くと新しい版の欄を消す。トーストで開き直しを頼む)
    if (!(await mayWrite($, now))) return
    const card = pull(Math.random(), Math.random(), flags.isClean)
    const next = addDraw(saved, card, now, flags)
    // この版の知らない欄 (新しい版が足した物) は読んだまま残す
    const isSaved = await $.store.set(STORE_KEY, withUnknown(got.raw, next)).then(
      () => true,
      () => false,
    )
    await update($, SAVE, () => next)
    await update($, VIEW, () => 'card')
    // 図鑑の実績はその場で数える (保存はしない)
    const before = new Set(goalsMet(saved).map(g => g.id))
    const gained = goalsMet(next).filter(g => !before.has(g.id))
    const note = gained.length > 0 ? `図鑑の実績「${gained.map(g => g.name).join('」「')}」を達成` : ''
    await update($, NOTE, () => (isSaved ? note : '引いたカードを保存できませんでした'))
    if (card.rarity === 'SR' || card.rarity === 'SSR') $.ui.toast(`${card.rarity}!${card.name}`)
  })

/**
 * daily-quest でこなしたお題のごほうびを 1 回だけ受け取り、その回数だけその場で引く。
 * 受け取った印は store の questClaimed (書く直前に読み直す)。daily-quest が無ければ何もしない
 */
async function claim($: $) {
  let today: unknown
  try {
    today = (await $.state.get(QUEST_TODAY)).value
  } catch {
    return
  }
  if (questRewards(today, []).length === 0) return
  let got: ReturnType<typeof questRewards> = []
  await serial(async () => {
    const claimed = await $.store.get(CLAIM_KEY).then(claimedFrom, () => undefined)
    if (!claimed) return
    const fresh = questRewards(today, claimed)
    if (fresh.length === 0 || !(await mayWrite($, await $.clock.now()))) return
    // ponytail: 読んでから書くまでの間に別のセッションが受け取ると 2 度引ける。間は数ミリ秒なので見送り
    const isSaved = await $.store.set(CLAIM_KEY, [...claimed, ...fresh.map(g => g.key)].slice(-KEEP_CLAIMED)).then(
      () => true,
      () => false,
    )
    if (isSaved) got = fresh
  })
  const pulls = got.reduce((n, g) => n + g.pulls, 0)
  for (let i = 0; i < pulls; i++) await draw($, { isClean: false, isManual: false })
  if (got.length > 0) {
    const msg = `お題「${got.map(g => g.title).join('」「')}」のごほうびで ${pulls} 回引いた`
    await update($, NOTE, n => (n === '' ? msg : `${msg} / ${n}`))
  }
}

const openPane = async ($: $) => {
  await load($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'ガチャを開きました。' }
}

export const register: Register = (on, options) => {
  setBackupDir(options)
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    await rememberVersion($).catch(() => {})
    resetRestore()
    await $.state.set(CARDS_REF, PUBLIC_CARDS).catch(() => {})
    // /gacha が拒まれたら (組み込みと被ったら) /turn-gacha にする
    const got = await $.command.register({ name: 'gacha', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'gacha'
    if (!ownsMain) await $.command.register({ name: 'turn-gacha', description: DESCRIPTION }).catch(() => {})
    await load($)
    // 別のセッションでこなしたお題の分もここで拾う
    await claim($).catch(() => {})
    return started
  })

  // /gacha を持てなかった時は、元の /gacha に回す
  on('command.run', { command: 'gacha' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'turn-gacha' }, openPane)

  // メインのターンだけ数える (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, ERRORS, () => 0)
    return next(e)
  })

  // 答えて終わったターンだけ引く (中断・エラー・拒否では引かない)。
  // お題のごほうびは next の後に見る (daily-quest は next の前に進みを書くので、読み込みの順によらず同じターンで届く)
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason === 'answer') {
      const isClean = (await read($, ERRORS)) === 0
      await draw($, { isClean, isManual: false })
    }
    if (e.agentId === undefined) await claim($).catch(() => {})
    return done
  }).catch(($, e, next) => next(e))

  // 見るだけ。メインのターンで失敗したツールを数える。断られた呼び出し (deny) は数えない
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && !('deny' in ran && ran.deny !== undefined) && ran.isError === true) await update($, ERRORS, n => n + 1)
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

    // 戻す欄を開いている間は、その欄の「戻す」を主にする (主のボタンは 1 つ)
    const isOpen = isRestoring()
    return (
      <Box flexDirection="column" gap={1}>
        {body}
        <Box key="actions" flexDirection="column">
          <Button
            key="pull" dimColor={left <= 0 || isOpen}
            label={left > 0 ? `もう一回引く(今日あと ${left} 回)` : '今日の手動はおしまい'}
            variant={left > 0 && !isOpen ? 'primary' : 'secondary'}
            onPress={() => void draw($, { isClean: false, isManual: true })}
          />
          <Button
            key="book" dimColor
            label={view === 'book' ? 'カードに戻る' : '図鑑'}
            onPress={() => void update($, VIEW, v => (v === 'book' ? 'card' : 'book'))}
          />
          {restoreButton($, t, STORE_KEY)}
        </Box>
        {restoreCard($, t, day => void restoreDay($, day))}
        {note !== '' && <Text color="#d29922">{note}</Text>}
      </Box>
    )
  })
}
