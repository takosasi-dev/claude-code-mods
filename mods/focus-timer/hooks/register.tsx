import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { FocusTimerRun } from '../types'
import { followTheme, readTheme } from './style'
import { mmss, ringSvg, todaySvg } from './svg'
import type { Status } from './svg'

const PANE = 'focus-timer'
const TITLE = '集中'
const STORE_KEY = 'done'

const runA = atom({ plugin: 'focus-timer', key: 'run' } as const, null as FocusTimerRun | null)
const doneA = atom({ plugin: 'focus-timer', key: 'done' } as const, {} as Record<string, number>)

type $ = EngineInterface

/** ローカル日付 YYYY-MM-DD */
const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const minutes = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** store の日付ごとの本数を洗う。数でない値は 0。形が違えば undefined */
const cleanDone = (v: unknown): Record<string, number> | undefined => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(v)) out[k] = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  return out
}

/**
 * store に書く形。日付でないキー (この版が知らない、新しい版が足した欄) は、cleanDone で 0 にせず読んだまま残す。
 * 古い版のまま動いているセッションが、新しい版の記録を消さないように
 */
const withUnknown = (raw: unknown, done: Record<string, number>): Record<string, unknown> => ({
  ...done,
  ...(raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).filter(([k]) => !/^\d{4}-\d{2}-\d{2}$/.test(k))) : {}),
})

/** 日付ごとに大きい方 */
const maxDone = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a }
  for (const [k, n] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, n)
  return out
}

const statusOf = (run: FocusTimerRun | null): Status =>
  run === null ? '待機' : run.endsAt === null ? '一時停止' : run.mode === 'focus' ? '集中中' : '休憩中'

const open = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '集中タイマーを開きました。' }
}

// 長さ (分) は register で userConfig から入れる
const len = { focusMs: 25 * 60_000, breakMs: 5 * 60_000 }

// 終わりを知らせる after。リロードで消えるので session.start で張り直す
let timer: Timer | undefined
let lastDay = ''
// /focus を自分で取れたか (取れなければ組み込みの /focus には触らない)
let ownsFocus = false

const arm = ($: $, run: FocusTimerRun | null, now: number) => {
  timer?.cancel()
  timer = undefined
  const endsAt = run?.endsAt
  if (endsAt == null) return
  timer = $.clock.after(Math.max(1000, endsAt - now), () => void finish($, endsAt))
}

/** 状態を変えて、その結果に合わせてタイマーを張り直す */
const change = async ($: $, fn: (run: FocusTimerRun | null, now: number) => FocusTimerRun | null) => {
  const now = await $.clock.now()
  const box = { run: null as FocusTimerRun | null }
  await update($, runA, r => (box.run = fn(r, now)))
  arm($, box.run, now)
}

const tell = async ($: $, text: string) => {
  $.ui.toast(text, { timeoutMs: 8000 })
  // 端末が無い (VS Code など) や通知を切っている時は送られないだけ。拒まれても落とさない
  try {
    await $.ui.notify(text, { title: TITLE })
  } catch {
    // 何もしない
  }
}

/** endsAt に張った区切りが終わった。その間に一時停止・やめる等で差し替わっていれば何もしない */
const finish = async ($: $, endsAt: number): Promise<void> => {
  const now = await $.clock.now()
  const { breakMs } = len
  const box = { ended: null as FocusTimerRun | null, next: null as FocusTimerRun | null }
  await update($, runA, r => {
    box.ended = null
    if (r === null || r.endsAt !== endsAt) return r
    box.ended = r
    box.next = r.mode === 'focus' ? { mode: 'break', totalMs: breakMs, endsAt: now + breakMs, leftMs: breakMs } : null
    return box.next
  })
  const ended = box.ended
  if (ended === null) return
  arm($, box.next, now)
  if (ended.mode === 'focus') {
    const key = dayKey(now)
    // 同じ store を別のセッションも書くので、書く直前に読み直してその日を +1 する (古い写しで上書きしない)
    const raw = await $.store.get(STORE_KEY).catch(() => null)
    const stored = raw === undefined ? {} : cleanDone(raw)
    if (stored === undefined) {
      await update($, doneA, d => ({ ...d, [key]: (d[key] ?? 0) + 1 }))
      $.ui.toast('集中の本数を保存できませんでした(記録を読めませんでした)', { timeoutMs: 8000 })
    } else {
      // ponytail: 日付ごとの記録は消さずに溜める。1 日 1 キーなので年単位でも小さい
      const all = { ...stored, [key]: (stored[key] ?? 0) + 1 }
      await $.store.set(STORE_KEY, withUnknown(raw, all)).then(
        () => update($, doneA, d => maxDone(d, all)),
        () => {
          $.ui.toast('集中の本数を保存できませんでした', { timeoutMs: 8000 })
          return update($, doneA, d => ({ ...d, [key]: (d[key] ?? 0) + 1 }))
        },
      )
    }
    await tell($, `集中 ${Math.round(ended.totalMs / 60_000)} 分おわり。${Math.round(breakMs / 60_000)} 分休憩しましょう`)
  } else {
    await tell($, '休憩おわり。次の集中をどうぞ')
  }
}

export const register: Register = (on, options) => {
  len.focusMs = minutes(options.focusMinutes, 25) * 60_000
  len.breakMs = minutes(options.breakMinutes, 5) * 60_000
  const { focusMs } = len
  followTheme(on)

  on('session.start', async ($, e, next) => {
    await readTheme($)
    // /focus は組み込みにあると拒まれる。その時は /focus-timer にし、/focus は組み込みに任せる
    ownsFocus = await $.command
      .register({ name: 'focus', description: 'ポモドーロの集中タイマーをペインに表示' })
      .then(() => true)
      .catch(() => false)
    if (!ownsFocus) {
      await $.command.register({ name: 'focus-timer', description: 'ポモドーロの集中タイマーをペインに表示' }).catch(() => {})
    }

    // 前のセッションまでの完了本数を読み戻す (リロードなら state の方が新しいのでそのまま)
    // 前のセッションまでの完了本数を読み戻す。リロードで state にある分とは日付ごとに大きい方
    const stored = cleanDone(await $.store.get(STORE_KEY).catch(() => undefined))
    if (stored) await update($, doneA, d => maxDone(d, stored))

    const now = await $.clock.now()
    lastDay = dayKey(now)
    const run = await read($, runA)
    // リロード中に終わっていた区切りは今終える。まだなら張り直す
    if (run?.endsAt != null && run.endsAt <= now) await finish($, run.endsAt)
    else arm($, run, now)

    // 1 分ごと: 走っている間と日付が変わった時だけ描き直す。after を取りこぼしていたらここで終える
    $.clock.every(60_000, () => {
      void (async () => {
        const t = await $.clock.now()
        const r = await read($, runA)
        if (r?.endsAt != null && r.endsAt <= t) return finish($, r.endsAt)
        const day = dayKey(t)
        if (r?.endsAt != null || day !== lastDay) $.ui.invalidate('ui.render')
        lastDay = day
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'focus' }, ($, e, next) => (ownsFocus ? open($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'focus-timer' }, open)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const run = await read($, runA)
    const done = await read($, doneA)
    const now = await $.clock.now()
    const today = done[dayKey(now)] ?? 0
    const status = statusOf(run)
    const totalMs = run?.totalMs ?? focusMs
    const leftMs = run === null ? focusMs : run.endsAt === null ? run.leftMs : Math.max(0, run.endsAt - now)

    const start = () =>
      change($, (r, n) => r ?? { mode: 'focus', totalMs: focusMs, endsAt: n + focusMs, leftMs: focusMs })
    const pause = () =>
      change($, (r, n) => (r !== null && r.endsAt !== null ? { ...r, endsAt: null, leftMs: Math.max(0, r.endsAt - n) } : r))
    const resume = () => change($, (r, n) => (r !== null && r.endsAt === null ? { ...r, endsAt: n + r.leftMs } : r))
    const stop = () => change($, () => null)
    const skip = () => change($, r => (r?.mode === 'break' ? null : r))

    const buttons = (
      <Box key="buttons" flexDirection="row" gap={1}>
        {run === null && <Button key="start" label="開始" variant="primary" onPress={start} />}
        {run !== null && run.endsAt !== null && <Button key="pause" label="一時停止" onPress={pause} />}
        {run !== null && run.endsAt === null && <Button key="resume" label="再開" variant="primary" onPress={resume} />}
        {run?.mode === 'break' && <Button key="skip" dimColor label="休憩をとばす" onPress={skip} />}
        {run !== null && <Button key="stop" dimColor label="やめる" onPress={stop} />}
      </Box>
    )

    // terminal の部品表にも Svg の名前はあるので、画面の種類でも分ける
    if (e.surface === 'terminal' || !('Svg' in t)) {
      return (
        <Box flexDirection="column">
          <Text key="status" color={run?.mode === 'break' ? 'green' : run !== null ? 'red' : undefined}>
            {/* 描き直しは 1 分ごとなので、秒は出さない */}
            {`${status}  残り約 ${Math.ceil(leftMs / 60_000)} 分`}
          </Text>
          <Text key="today" dimColor>{`今日 ${today} 本 ${'●'.repeat(Math.min(today, 20))}`}</Text>
          {buttons}
        </Box>
      )
    }

    const { Svg } = t
    return (
      <Box flexDirection="column" gap={1}>
        <Svg
          key="ring"
          source={ringSvg({ status, mode: run?.mode ?? 'focus', leftMs, totalMs, isRunning: run !== null && run.endsAt !== null })}
          alt={`${status} 残り ${mmss(leftMs)}`}
        />
        {buttons}
        <Svg key="today" source={todaySvg(today)} alt={`今日の完了 ${today} 本`} />
      </Box>
    )
  })
}
