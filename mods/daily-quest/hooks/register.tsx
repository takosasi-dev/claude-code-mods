import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { QuestCounts, QuestDay, QuestSave } from '../types'
import { addCounts, applyPending, countTool, countTurn, dayOf, EMPTY, fromSaved, isEmpty, jstDate, paneLines, paneSvg, streakOf, subCounts, withUnknown } from './quest'
import { backup, backupDir, backupOf, closeRestore, resetRestore, restoreButton, restoreCard, setBackupDir } from './backup'
import { followTheme, mayWrite, readTheme, rememberVersion } from './style'

const PANE = 'daily-quest'
const TITLE = 'きょうのお題'
const DESCRIPTION = '日替わりのお題 3 つの進みと連続日数を見る'
const STORE_KEY = 'quest'

const TODAY = atom({ plugin: 'daily-quest', key: 'today' } as const, { date: '', quests: [] } as QuestDay)
const STREAK = atom({ plugin: 'daily-quest', key: 'streak' } as const, 0)
const TOTAL = atom({ plugin: 'daily-quest', key: 'totalDone' } as const, 0)
const SAVED = atom({ plugin: 'daily-quest', key: 'saved' } as const, EMPTY as QuestSave)
const PENDING = atom({ plugin: 'daily-quest', key: 'pending' } as const, { date: '', counts: {} } as { date: string; counts: QuestCounts })
const ERRORS = atom({ plugin: 'daily-quest', key: 'turnErrors' } as const, 0)
const NOTE = atom({ plugin: 'daily-quest', key: 'note' } as const, '')

type $ = EngineInterface

const BROKEN = '記録を読めなかったので、進みを残せません(上書きしないよう止めています)'

// ponytail: 主の名前を持てたかはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false

// store に書く物は 1 本ずつ流す。重なると同じ数を 2 回足してしまう
let chain: Promise<unknown> = Promise.resolve()
const serial = (f: () => Promise<unknown>) => (chain = chain.then(f, f))

/** store の値 (と、知らない欄を残して書くための生の値)。キーが無ければ空、読めない時 (例外・形が違う) は undefined */
async function readStore($: $): Promise<{ saved: QuestSave; raw: unknown } | undefined> {
  try {
    const raw = await $.store.get(STORE_KEY)
    if (raw === undefined) return { saved: EMPTY, raw }
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { saved: fromSaved(raw), raw } : undefined
  } catch {
    return undefined
  }
}

/** 保存した数とまだ流していない数から、今日のお題・連続日数・通算を置き直す (他の mod はこれを読む) */
async function refresh($: $) {
  const date = jstDate(await $.clock.now())
  const saved = await read($, SAVED)
  const pending = await read($, PENDING)
  const counts = addCounts(saved.days[date] ?? {}, pending.date === date ? pending.counts : {})
  await update($, TODAY, () => dayOf(date, counts))
  await update($, STREAK, () => streakOf(saved.fullDays, date))
  await update($, TOTAL, () => saved.totalDone)
}

async function load($: $) {
  const got = await readStore($)
  if (got) await update($, SAVED, () => got.saved)
  else await update($, NOTE, () => BROKEN)
  await refresh($)
  // その日はじめてなら、読んだ生の値 (知らない欄ごと) を控える
  if (backupDir) await backup($, STORE_KEY, got?.raw, await $.clock.now())
}

/** day の控えに戻し、メモリの中 (他の mod が読む今日のお題・連続日数・通算) も読み直す。古い版のままなら戻さない */
const restoreDay = ($: $, day: string) =>
  serial(async () => {
    if (!(await mayWrite($, await $.clock.now()))) return
    const value = await backupOf($, STORE_KEY, day)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      $.ui.toast('控えを読めなかったので、戻していません', { timeoutMs: 8000 })
      return
    }
    const isSaved = await $.store.set(STORE_KEY, value).then(
      () => true,
      () => false,
    )
    if (!isSaved) {
      $.ui.toast('控えの記録を書けませんでした', { timeoutMs: 8000 })
      return
    }
    await update($, NOTE, () => '')
    await load($)
    closeRestore($)
    $.ui.toast(`${day} の記録に戻しました`)
  })

/**
 * まだ流していない数を store に足す。書く直前に読み直す (別のセッションの分を消さない)。
 * 新しくこなしたお題はここでトーストを 1 回出す
 */
const flush = ($: $) =>
  serial(async () => {
    const p = await read($, PENDING)
    if (p.date === '' || isEmpty(p.counts)) return
    const got = await readStore($)
    if (!got) {
      await update($, NOTE, () => BROKEN)
      return
    }
    const store = got.saved
    const now = await $.clock.now()
    // 日をまたいで動き続けるセッションも、その日はじめて書く前に控える
    if (backupDir) await backup($, STORE_KEY, got.raw, now)
    // 新しい版が入ったのに古い版のまま動いている時は書かない。進みは流さずに残す (トーストで開き直しを頼む)
    if (!(await mayWrite($, now))) return
    const r = applyPending(store, p.date, p.counts)
    // この版の知らない欄 (新しい版が足した物) は読んだまま残す
    const isSaved = await $.store.set(STORE_KEY, withUnknown(got.raw, r.next)).then(
      () => true,
      () => false,
    )
    if (!isSaved) {
      // 流せなかった数は残して、次のターンの終わりにもう一度
      await update($, SAVED, () => store)
      await update($, NOTE, () => '進みを保存できませんでした。次のターンの終わりにもう一度書きます')
      await refresh($)
      return
    }
    // 書いた分だけ引く (その間に増えた分は残す)
    await update($, PENDING, cur => (cur.date === p.date ? { date: cur.date, counts: subCounts(cur.counts, p.counts) } : cur))
    await update($, SAVED, () => r.next)
    await update($, NOTE, () => '')
    await refresh($)
    for (const q of r.newly) $.ui.toast(`お題「${q.title}」をこなした`)
    if (r.isFull) $.ui.toast(`きょうのお題を全部こなした。連続 ${await read($, STREAK)} 日`)
  })

/** 数を足す。日付が変わっていたら、前の日の分を先に流す */
async function bump($: $, counts: QuestCounts) {
  if (isEmpty(counts)) return
  const date = jstDate(await $.clock.now())
  const p = await read($, PENDING)
  if (p.date !== date && p.date !== '' && !isEmpty(p.counts)) await flush($)
  await update($, PENDING, cur => (cur.date === date ? { date, counts: addCounts(cur.counts, counts) } : { date, counts }))
  await refresh($)
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

const openPane = async ($: $) => {
  await refresh($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'きょうのお題を開きました。' }
}

export const register: Register = (on, options) => {
  setBackupDir(options)
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    await rememberVersion($).catch(() => {})
    resetRestore()
    // /quest が拒まれたら /daily-quest にする
    const got = await $.command.register({ name: 'quest', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'quest'
    if (!ownsMain) await $.command.register({ name: 'daily-quest', description: DESCRIPTION }).catch(() => {})
    await load($)
    // 日付が変わったら、お題を置き直す
    $.clock.every(60_000, async () => {
      if ((await read($, TODAY)).date !== jstDate(await $.clock.now())) await refresh($)
    })
    return started
  })

  // /quest を持てなかった時は、その名前の持ち主に回す
  on('command.run', { command: 'quest' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'daily-quest' }, openPane)

  on('session.end', async ($, e, next) => {
    await flush($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // メインのターンだけ数える (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, ERRORS, () => 0)
    return next(e)
  }).catch(($, e, next) => next(e))

  // 見るだけ。断られた呼び出し (deny) は数えない。Write は前にファイルが無かった時だけ「新しいファイル」
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const path = str(input.file_path)
    // 確かめられない時はあった扱い (こなしていないお題を達成にしない)
    const isNew = tool === 'Write' && path !== '' ? !(await $.fs.exists(path).catch(() => true)) : false
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const isError = ran.isError === true
    if (isError) await update($, ERRORS, n => n + 1)
    await bump($, countTool(tool, str(input.command), isError, isNew))
    return ran
  }).catch(($, e, next) => next(e))

  // 進みは next の前に store へ流す (dev-rpg と turn-gacha は next の後にごほうびを見るので、同じターンで届く)
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      if (e.reason === 'answer') await bump($, countTurn(await read($, ERRORS)))
      await flush($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const day = await read($, TODAY)
    const streak = await read($, STREAK)
    const total = await read($, TOTAL)
    const { fullDays } = await read($, SAVED)
    const note = await read($, NOTE)
    const lines = paneLines(day, streak, total, fullDays)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg key="quest" source={paneSvg(day, streak, total, fullDays)} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map((l, i) => (
              <Text key={`line-${i}`} color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        {note !== '' && <Text color="yellow">{note}</Text>}
        <Box key="actions" flexDirection="row" flexWrap="wrap" gap={1}>
          {restoreButton($, t, STORE_KEY)}
        </Box>
        {restoreCard($, t, day => void restoreDay($, day))}
      </Box>
    )
  })
}
