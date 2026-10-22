import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AquaTank, DecoId } from '../types'
import {
  DECOS,
  DECO_SLOTS,
  FEED_AMOUNT,
  FEED_MS,
  INITIAL,
  MAX_MURK,
  UPSET_MS,
  decoHint,
  decoName,
  drawTank,
  fishLine,
  fishListSvg,
  fishOf,
  fromSaved,
  fullnessAt,
  gachaCounts,
  placeDeco,
  sameView,
  stepFish,
  toSaved,
  toStore,
  unlockedDecos,
  viewAt,
} from './tank'
import type { Saved } from './tank'
import { C, backupDaily, clean, followTheme, jstDay, listBackups, mayWrite, readTheme, rememberVersion } from './style'

const PANE = 'aqua-pet'
const TITLE = '水槽'
const STORE_KEY = 'tank'
const tank = atom({ plugin: 'aqua-pet', key: 'tank' } as const, INITIAL)
// turn-gacha の state (読むだけ。turn-gacha が無ければ undefined のまま。読み方は dev-rpg と同じ)
const GACHA_SAVE = { plugin: 'turn-gacha', key: 'save' } as const
const GACHA_CARDS = { plugin: 'turn-gacha', key: 'cards' } as const

type $ = EngineInterface

/** 記録の控えのフォルダ (設定 backupDir)。絶対パスだけ。空なら控えない */
let backupDir = ''
const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p)
/** 今日もう控えを確かめた日 (1 日 1 回だけファイルを読みに行く) */
let backedDay = ''

/** その日はじめての時だけ、store の生の値 (知らない欄ごと) を控える */
const backup = async ($: $, raw: unknown, now: number) => {
  if (!backupDir || raw === undefined || backedDay === jstDay(now)) return
  backedDay = jstDay(now)
  // 書けない時も、その日はもう試さない (ターンのたびに読み書きしない)
  await backupDaily($, backupDir, STORE_KEY, raw, now).catch(() => {})
}

/** ガチャで持っているカードの種類の数。turn-gacha が無い・読めない時は undefined。描画の中で呼ぶと、ガチャが変わった時に描き直る */
const readCounts = async ($: $) => {
  try {
    return gachaCounts((await $.state.get(GACHA_SAVE)).value, (await $.state.get(GACHA_CARDS)).value)
  } catch {
    return undefined
  }
}

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

/** store の今の値に変える → 段を計算し直す → 変わっていれば残す。読めなければ state だけ変える (serial の中で呼ぶ) */
const changeNow = async ($: $, fn: (t: AquaTank, now: number) => AquaTank) => {
  const now = await $.clock.now()
  const fresh = await readSaved($, now)
  await backup($, fresh?.raw, now)
  const t = await update($, tank, x => {
    const y = fn(fresh ? { ...x, ...fresh.saved } : x, now)
    return { ...y, view: viewAt(y, now) }
  })
  // 初めて (キーが無い) なら生まれた時刻を残すために書く。
  // 新しい版の mod が足した欄 (この版の知らない欄) は消さずに書き戻す。
  // 新しい版が入ったのに古い版のまま動いている時は書かない (mayWrite がトーストで開き直しを頼む)
  if (!fresh) warn($, '水槽の記録を読めなかったので保存していません')
  else {
    const next = toStore(fresh.raw, toSaved(t))
    if (JSON.stringify(next) !== JSON.stringify(fresh.raw) && (await mayWrite($, now)))
      await $.store.set(STORE_KEY, next).catch(() => warn($, '水槽の記録を保存できませんでした'))
  }
  return t
}
const change = ($: $, fn: (t: AquaTank, now: number) => AquaTank) => serial(() => changeNow($, fn))

/** 控えから戻す欄を開く (控えのある日を並べる) */
const openRestore = async ($: $) => {
  const days = (await listBackups($, backupDir, STORE_KEY).catch(() => [])).map(b => b.day)
  await update($, tank, x => ({ ...x, restore: { days, pick: '' } }))
}

/** day の控えの値を store に書き、メモリの中も読み直す。古い版のままなら戻さない */
const restoreDay = ($: $, day: string) =>
  serial(async () => {
    const now = await $.clock.now()
    if (!(await mayWrite($, now))) return
    const b = (await listBackups($, backupDir, STORE_KEY).catch(() => [])).find(x => x.day === day)
    if (!b || typeof b.value !== 'object' || b.value === null || Array.isArray(b.value)) {
      $.ui.toast('控えを読めなかったので、戻していません', { timeoutMs: 8000 })
      return
    }
    try {
      await $.store.set(STORE_KEY, b.value)
    } catch {
      $.ui.toast('控えの記録を書けませんでした', { timeoutMs: 8000 })
      return
    }
    await changeNow($, x => ({ ...x, restore: null }))
    $.ui.toast(`${day} の記録に戻しました`)
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

export const register: Register = (on, options) => {
  const dir = String(options.backupDir ?? '').trim()
  backupDir = isAbsolute(dir) ? dir : ''
  followTheme(on)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'aquarium', description: '水槽のペインを開く' }).catch(() => {})
    await readTheme($)
    await rememberVersion($).catch(() => {})
    isWarned = false
    backedDay = ''
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
    // 0.4.x の state が残ったまま描かれた時 (リロード直後) も描けるように
    const deco = t.deco ?? INITIAL.deco
    const restore = t.restore ?? null
    // かざり・控えの欄を開いている間は、その欄の操作を主にする (主のボタンは 1 つ)
    const isOpen = t.isDecorating || restore !== null

    const buttons = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        <Button key="feed" label="えさをやる" dimColor={isOpen} variant={isOpen ? undefined : 'primary'} onPress={() => void feed($)} />
        <Button key="rename" dimColor label="名前" onPress={() => void update($, tank, x => ({ ...x, isNaming: !x.isNaming }))} />
        <Button key="clean" dimColor label="掃除" onPress={() => void change($, x => ({ ...x, murk: 0 }))} />
        <Button key="list" dimColor label={t.isListing ? '水槽' : '一覧'} onPress={() => void update($, tank, x => ({ ...x, isListing: !x.isListing }))} />
        <Button
          key="deco"
          dimColor
          label={t.isDecorating ? 'かざりを閉じる' : 'かざり'}
          onPress={() => void update($, tank, x => ({ ...x, isDecorating: !x.isDecorating, isListing: false, restore: null }))}
        />
        <Button
          key="restore"
          dimColor
          label={restore ? '戻すのをやめる' : '控えから戻す'}
          onPress={() => void (restore ? update($, tank, x => ({ ...x, restore: null })) : openRestore($).then(() => update($, tank, x => ({ ...x, isDecorating: false }))))}
        />
      </Box>
    )

    // かざりの欄: 置き場を選んで、手に入っているかざりを置く・外す (ほかの置き場の物を選ぶと入れ替える)
    let decoCard = null
    if (t.isDecorating) {
      const counts = await readCounts($)
      const have = new Set<string>(unlockedDecos(counts))
      const slot = Math.min(DECO_SLOTS - 1, Math.max(0, t.pickSlot))
      const put = (id: DecoId) => void change($, x => ({ ...x, deco: placeDeco(x.deco, slot, id) }))
      decoCard = (
        <Box key="deco-card" flexDirection="column" borderStyle="round" borderColor={C.blue} paddingX={1} paddingY={1} gap={1}>
          <Text bold color={C.blue}>
            かざり
          </Text>
          <Text dimColor>置き場を選んで、置くかざりを押す</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {deco.slice(0, DECO_SLOTS).map((id, i) => (
              <Button key={`slot-${i}`} dimColor={i !== slot} label={`${i + 1} ${decoName(id)}`} onPress={() => void update($, tank, x => ({ ...x, pickSlot: i }))} />
            ))}
          </Box>
          {counts === undefined ? (
            <Text dimColor>turn-gacha を入れると、持っているカードでかざりが手に入ります</Text>
          ) : (
            <Box flexDirection="column" gap={1}>
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                {DECOS.filter(d => have.has(d.id)).map(d => (
                  <Button key={`put-${d.id}`} dimColor={deco[slot] !== d.id} variant={deco[slot] === d.id ? 'primary' : undefined} label={d.name} onPress={() => put(d.id)} />
                ))}
                {deco[slot] ? <Button key="take" dimColor label="外す" onPress={() => put('')} /> : null}
              </Box>
              {have.size === 0 ? <Text dimColor>ガチャでカードを集めると、かざりが手に入ります</Text> : null}
              {DECOS.filter(d => !have.has(d.id)).map(d => (
                <Text key={`need-${d.id}`} dimColor>
                  {decoHint(d)}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    // 控えから戻す欄: 日を選ぶ → 確かめる → 戻す
    let restoreCard = null
    if (restore) {
      restoreCard = (
        <Box key="restore-card" flexDirection="column" borderStyle="round" borderColor={C.yellow} paddingX={1} paddingY={1} gap={1}>
          <Text bold color={C.yellow}>
            控えから戻す
          </Text>
          {!backupDir ? (
            <Text dimColor>設定の backupDir を入れると控えが取れます</Text>
          ) : restore.days.length === 0 ? (
            <Text dimColor>まだ控えがありません (1 日 1 回取ります)</Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {restore.days.map(day => (
                <Button
                  key={`day-${day}`}
                  dimColor={restore.pick !== day}
                  label={day}
                  onPress={() => void update($, tank, x => ({ ...x, restore: x.restore ? { ...x.restore, pick: day } : null }))}
                />
              ))}
            </Box>
          )}
          {restore.pick ? (
            <Box flexDirection="column" gap={1}>
              <Text>{`${restore.pick}: この日の記録に戻しますか。今の記録は上書きされます`}</Text>
              <Box flexDirection="row" gap={1}>
                <Button key="restore-ok" variant="primary" label="戻す" onPress={() => void restoreDay($, restore.pick)} />
                <Button key="restore-no" dimColor label="やめる" onPress={() => void update($, tank, x => ({ ...x, restore: x.restore ? { ...x.restore, pick: '' } : null }))} />
              </Box>
            </Box>
          ) : null}
        </Box>
      )
    }
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

    const placed = deco
      .slice(0, DECO_SLOTS)
      .filter(id => id !== '')
      .map(id => clean(decoName(id)))
      .join('・')

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
          {placed ? <Text dimColor>{`かざり ${placed}`}</Text> : null}
          {listRows}
          {buttons}
          {naming}
          {decoCard}
          {restoreCard}
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
        {decoCard}
        {restoreCard}
      </Box>
    )
  })
}
