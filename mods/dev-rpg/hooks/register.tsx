import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RpgHero, RpgSaved } from '../types'
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
  mergeSaved,
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

const BROKEN = '記録を読めなかったので、今の冒険は保存していません'

let ownsMain = false

// store に書く物 (保存・やり直し) は 1 本ずつ流す。重なると同じ差分を 2 回足してしまう
let chain: Promise<unknown> = Promise.resolve()
const serial = (f: () => Promise<unknown>) => (chain = chain.then(f, f))

/** store の値。キーが無ければ最初から、読めない時 (例外・形が違う) は undefined */
async function readStore($: $): Promise<RpgSaved | undefined> {
  try {
    const raw = await $.store.get(STORE_KEY)
    if (raw === undefined) return INITIAL_SAVED
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? fromSaved(raw) : undefined
  } catch {
    return undefined
  }
}

/** state が空なら (新しいセッション・/clear の後) store から読み戻して冒険の回数を足す。リロードなら state の方が新しいのでそのまま */
async function ensureLoaded($: $) {
  if ((await read($, HERO)).s.startedAt !== 0) return
  const saved = await readStore($)
  if (!saved) await update($, NEWS, () => BROKEN)
  const now = await $.clock.now()
  await update($, HERO, x => (x.s.startedAt === 0 ? startSession(saved ?? INITIAL_SAVED, now) : x))
}

/** 今の store を読み直し、前に合わせた時から増えた分だけを足して書く。画面も store に合わせる */
const save = ($: $) =>
  serial(async () => {
    const store = await readStore($)
    if (!store) {
      await update($, NEWS, () => BROKEN)
      return
    }
    // $.state.get は 1 つの dispatch の中では同じ時点を読むので、差分は update の中 (最新の値) で取る
    let written: RpgSaved | undefined
    await update($, HERO, x => {
      if (x.s.startedAt === 0) return x
      written = mergeSaved(store, x.synced, toSaved(x))
      return { ...x, ...written, synced: written }
    })
    if (!written) return
    await $.store.set(STORE_KEY, written).catch(async () => {
      // 書けなかった分は、読んだ store からの差分として次に足す
      await update($, HERO, x => ({ ...x, synced: store }))
      await update($, NEWS, () => '記録を保存できませんでした。次のターンの終わりにもう一度書きます')
    })
  })

/** 変える → 実績を見る。レベルが上がった時だけトーストを出す (store に書くのは save) */
async function change($: $, fn: (h: RpgHero, now: number) => RpgHero, isTurnEnd = false) {
  await ensureLoaded($)
  const now = await $.clock.now()
  let before = 1
  let gained: Achievement[] = []
  const hero = await update($, HERO, x => {
    before = levelInfo(x.xp).level
    const r = grant(fn(x, now), now, isTurnEnd)
    gained = r.gained
    return r.hero
  })
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

/** やり直しは消す操作なので、store を丸ごと書き替える */
const reset = ($: $) =>
  serial(async () => {
    const now = await $.clock.now()
    const fresh = startSession(INITIAL_SAVED, now)
    const hero = { ...fresh, synced: toSaved(fresh) }
    await $.store.set(STORE_KEY, hero.synced)
    await update($, HERO, () => hero)
    await update($, CONFIRM, () => false)
    await update($, TAB, () => 'status' as const)
    await update($, NEWS, () => '冒険をやり直しました。Lv 1 から')
  })

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
    // 読み戻して (冒険の回数を足して) 実績を見て、残す
    await change($, h => h)
    await save($)
    $.clock.every(60_000, () => void refresh($).catch(() => {}))
    return started
  })

  on('session.end', async ($, e, next) => {
    await save($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'rpg' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'dev-rpg' }, openPane)

  // 主ループのターンだけ数える (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await change($, onTurnStart)
    return next(e)
  })

  // 答えて終わったターンだけ数える (中断・エラー・拒否は数えない)。保存はどのターンの終わりでも
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      if (e.reason === 'answer') await change($, onTurnEnd, true)
      await save($)
    }
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
