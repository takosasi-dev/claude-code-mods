import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HaikuPoem, HaikuTurn } from '../types'
import { askFor, clean, cleanAnswer, digestOf, failText, fileOf, jstMonth, mergePoems, poemsOf, shouldCompose, shownText, stamp, tanzakuSvg } from './haiku'
import { followTheme, mayWrite, readTheme, rememberVersion } from './style'

const PANE = 'turn-haiku'
const TITLE = 'ターンの俳句'
const DESCRIPTION = 'ターンでした事を五七五にした句を短冊で見る'
const POEMS_KEY = 'poems'
const AUTO_KEY = 'auto'

const POEMS = atom({ plugin: 'turn-haiku', key: 'poems' } as const, [] as HaikuPoem[])
const AUTO = atom({ plugin: 'turn-haiku', key: 'isAuto' } as const, true)
const BUSY = atom({ plugin: 'turn-haiku', key: 'isComposing' } as const, false)
const LAST = atom({ plugin: 'turn-haiku', key: 'lastTurn' } as const, null as HaikuTurn | null)
const NOTE = atom({ plugin: 'turn-haiku', key: 'note' } as const, '')

type $ = EngineInterface

// ponytail: 主の名前を持てたか・今のターンの数え途中はモジュール変数。リロードでは session.start で決め直し、数え途中は捨てる
let ownsMain = false
let tools = new Map<string, number>()
let files: string[] = []

// 1 セッションの中の書き込み (ターン終わりとボタンが重なる等) は 1 本ずつ流す
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(f: () => Promise<T>): Promise<T> => {
  const p = chain.then(f, f)
  chain = p.catch(() => {})
  return p
}

const note = ($: $, text: string) => update($, NOTE, () => text)
const STALE = '新しい版が入ったので保存していません。VS Code を開き直してください'
const message = (err: unknown) => clean(err instanceof Error ? err.message : String(err)).slice(0, 200)

/** 句を store に足す (C1: 書く直前に読み直し、id で合成)。読めなければ書かずに画面だけ */
async function save($: $, poem: HaikuPoem) {
  let raw: unknown
  try {
    raw = await $.store.get(POEMS_KEY)
  } catch {
    raw = null
  }
  const merged = raw === null ? undefined : mergePoems(raw, [poem])
  if (!merged) {
    await update($, POEMS, list => mergePoems(list, [poem]) ?? list)
    await note($, '句の記録を読めなかったので保存していません')
    return
  }
  // 新しい版が入ったのに古い版のまま動いている時は書かない (画面には出す)
  if (!(await mayWrite($, await $.clock.now()))) {
    await update($, POEMS, list => mergePoems(list, [poem]) ?? list)
    await note($, STALE)
    return
  }
  await update($, POEMS, () => merged)
  await $.store.set(POEMS_KEY, merged).catch(() => note($, '句を保存できませんでした'))
}

/** 1 ターンを 1 句に詠む */
const compose = ($: $, turn: HaikuTurn) =>
  serial(async () => {
    await update($, BUSY, () => true)
    await note($, '')
    try {
      const now = await $.clock.now()
      const { system, prompt } = askFor(turn, jstMonth(now))
      // 断られた時 (使えないモデルなど) だけ reject する
      const r = await $.model.complete({ model: 'haiku', effort: 'low', timeoutMs: 15_000, maxTokens: 200, system, prompt }).catch((err: unknown) => message(err))
      if (typeof r === 'string') return void (await note($, `詠めませんでした (${r})`))
      if (!r.isAnswered) return void (await note($, failText(r)))
      const text = cleanAnswer(r.text)
      if (text === '') return void (await note($, '詠めませんでした (答えに句がありませんでした)'))
      await save($, { id: turn.turnId, at: now, text })
    } finally {
      await update($, BUSY, () => false)
    }
  })

const toggleAuto = ($: $) =>
  serial(async () => {
    const next = await update($, AUTO, v => !v)
    if (!(await mayWrite($, await $.clock.now()))) return void (await note($, STALE))
    await $.store.set(AUTO_KEY, next).catch(() => note($, '設定を保存できませんでした'))
  })

const recompose = async ($: $) => {
  const last = await read($, LAST)
  if (!last) return note($, 'まだ詠めるターンがありません')
  await compose($, last)
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '俳句のペインを開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    await rememberVersion($).catch(() => {})
    // /haiku が拒まれたら (組み込みや別の mod と被ったら) /turn-haiku にする
    const got = await $.command.register({ name: 'haiku', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'haiku'
    if (!ownsMain) await $.command.register({ name: 'turn-haiku', description: DESCRIPTION }).catch(() => {})
    try {
      const poems = await $.store.get(POEMS_KEY)
      if (poems !== undefined && !Array.isArray(poems)) await note($, '句の記録の形が違うので、保存はしません')
      await update($, POEMS, list => mergePoems(list, poemsOf(poems)) ?? list)
      const auto = await $.store.get(AUTO_KEY)
      await update($, AUTO, () => (typeof auto === 'boolean' ? auto : true))
    } catch {
      await note($, '句の記録を読めませんでした')
    }
    return started
  })

  on('command.run', { command: 'haiku' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  // /haiku を持てた時は /turn-haiku を登録していないので、その名前の持ち主に回す
  on('command.run', { command: 'turn-haiku' }, ($, e, next) => (ownsMain ? next(e) : openPane($))).catch(($, e, next) => next(e))

  // メインのターンだけ数える (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      tools = new Map()
      files = []
    }
    return next(e)
  })

  // 見るだけ。断られた呼び出しは「使った」に数えない
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined) return ran
    const name = String(e.tool)
    tools.set(name, (tools.get(name) ?? 0) + 1)
    const file = fileOf(e as unknown as Record<string, unknown>)
    if (file !== '' && !files.includes(file)) files.push(file)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return r
    const calls = [...tools.values()].reduce((a, b) => a + b, 0)
    const turn = digestOf(e.turnId, tools, files, e.answer, e.durationMs)
    await update($, LAST, () => turn)
    // 詠むのは待たない (15 秒かかることがある。ターンの終わりを止めない)
    if (shouldCompose(e, calls) && (await read($, AUTO))) void compose($, turn).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const poems = await read($, POEMS)
    const isAuto = await read($, AUTO)
    const isBusy = await read($, BUSY)
    const hasTurn = (await read($, LAST)) !== null
    const text = await read($, NOTE)
    const latest = poems[poems.length - 1]
    const past = poems.slice(0, -1).reverse()

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={tanzakuSvg(latest)} alt={latest ? `短冊: ${shownText(latest.text)}` : 'まだ一句も詠んでいません'} />
        ) : (
          <Text bold>{latest ? shownText(latest.text) : 'まだ一句も詠んでいません'}</Text>
        )}
        {latest && <Text dimColor>{`${stamp(latest.at)} に詠みました`}</Text>}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="auto" dimColor label={`自動で詠む: ${isAuto ? 'オン' : 'オフ'}`} onPress={() => void toggleAuto($)} />
          {isBusy ? (
            <Text dimColor>詠んでいます</Text>
          ) : (
            hasTurn && <Button key="recompose" label="今のターンを詠み直す" variant="primary" onPress={() => void recompose($)} />
          )}
        </Box>
        {past.length > 0 && (
          <Box key="past" flexDirection="column">
            <Text bold>過去の句</Text>
            {past.map(p => (
              <Text>{`${stamp(p.at)}  ${shownText(p.text)}`}</Text>
            ))}
          </Box>
        )}
        {text !== '' && <Text dimColor>{text}</Text>}
      </Box>
    )
  })
}
