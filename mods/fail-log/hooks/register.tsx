import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FailEntry } from '../types'
import { KEEP, RECENT, asCount, asEntries, failLines, failSvg, firstLine, recentHead, summarize, summaryText } from './faillog'
import { followTheme, mayWrite, readTheme, rememberVersion } from './style'

const PANE = 'fail-log'
const TITLE = '失敗の記録'
const DESCRIPTION = 'ツールが失敗した記録と、よく落ちる物を見る'

const ENTRIES = atom({ plugin: 'fail-log', key: 'entries' } as const, [] as FailEntry[])
const TOTAL = atom({ plugin: 'fail-log', key: 'total' } as const, 0)
const CONFIRMING = atom({ plugin: 'fail-log', key: 'confirming' } as const, false)

type $ = EngineInterface

/** $.store から読んで $.state に写す。読めなければ今の値のまま */
async function load($: $) {
  const entries = asEntries(await $.store.get('entries').catch(() => undefined))
  const total = asCount(await $.store.get('total').catch(() => undefined))
  if (entries) await update($, ENTRIES, () => entries.slice(-KEEP))
  if (total !== undefined) await update($, TOTAL, () => total)
}

// ponytail: 同じセッションで並んで落ちた失敗の書き込みを 1 本ずつにする鎖 (モジュール変数)。
// 別のセッションとは、読み直してから書くまでの間に重なった 1 件が消えうる
let chain: Promise<unknown> = Promise.resolve()
const serial = (fn: () => Promise<void>) => {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

/** store のキーを読む。キーが無ければ empty、読めない時 (例外・形が違う) は undefined */
async function readKey<T>($: $, key: string, as: (v: unknown) => T | undefined, empty: T): Promise<T | undefined> {
  try {
    const raw = await $.store.get(key)
    return raw === undefined ? empty : as(raw)
  } catch {
    return undefined
  }
}

// ponytail: 読めなかった知らせはセッションに 1 回だけ (失敗のたびに出すとうるさい)。リロードでもう 1 回出る
let toldBroken = false

/**
 * $.store は他のセッションと共有なので、書く直前に読み直して 1 件だけ足す。
 * 読めない時 (例外・形が違う) と、古い版のまま動いている時は書かずに、このセッションの画面にだけ足す
 */
const record = ($: $, entry: FailEntry) =>
  serial(async () => {
    const saved = await readKey($, 'entries', asEntries, [])
    const total = await readKey($, 'total', asCount, 0)
    const onlyHere = async () => {
      await update($, ENTRIES, list => [...list, entry].slice(-KEEP))
      await update($, TOTAL, n => n + 1)
    }
    if (saved === undefined || total === undefined) {
      if (!toldBroken) $.ui.toast('失敗の記録を読めなかったので、保存していません(上書きしないよう止めています)', { timeoutMs: 8000 })
      toldBroken = true
      return onlyHere()
    }
    if (!(await mayWrite($, entry.at))) return onlyHere()
    const next = [...saved, entry].slice(-KEEP)
    await update($, ENTRIES, () => next)
    await update($, TOTAL, () => total + 1)
    await $.store.set('entries', next).catch(() => {})
    await $.store.set('total', total + 1).catch(() => {})
  })

const clear = ($: $) =>
  serial(async () => {
    if (!(await mayWrite($, await $.clock.now()))) return void (await update($, CONFIRMING, () => false))
    await update($, ENTRIES, () => [])
    await update($, TOTAL, () => 0)
    await update($, CONFIRMING, () => false)
    await $.store.set('entries', []).catch(() => {})
    await $.store.set('total', 0).catch(() => {})
  })

// ponytail: 主の名前を持てたかはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false

const openPane = async ($: $) => {
  // 別のセッションで増えた分も見えるように、開くたびに読み直す
  await load($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '失敗の記録を開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // /errors が拒まれたら /fail-log にする
    const got = await $.command.register({ name: 'errors', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'errors'
    if (!ownsMain) await $.command.register({ name: 'fail-log', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    await update($, CONFIRMING, () => false)
    await rememberVersion($).catch(() => {})
    await load($)
    return started
  })

  // /errors を持てなかった時は、その名前の持ち主に回す
  on('command.run', { command: 'errors' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  // /errors を持てた時は /fail-log を登録していないので、その名前の持ち主に回す
  on('command.run', { command: 'fail-log' }, ($, e, next) => (ownsMain ? next(e) : openPane($))).catch(($, e, next) => next(e))

  // 見るだけ。ツールが失敗した (isError) 物だけ記録する。断られた物は数えない
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.isError === true) {
      const tool = String(e.tool)
      const { input, group } = summarize(tool, e as unknown as Record<string, unknown>)
      const text = typeof r.text === 'string' ? r.text : typeof r.result === 'string' ? r.result : ''
      const at = await $.clock.now()
      await record($, { at, tool, input, group, error: firstLine(text), isSub: e.agentId !== undefined })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const now = await $.clock.now()
    const entries = await read($, ENTRIES)
    const total = await read($, TOTAL)
    const confirming = await read($, CONFIRMING)
    const recent = entries.slice(-RECENT).reverse()

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg key="chart" source={failSvg(entries, total, now)} alt={summaryText(entries, total, now)} />
        ) : (
          <Box key="lines" flexDirection="column">
            {failLines(entries, total, now).map((l, i) => (
              <Text key={`line-${i}`} color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        {recent.length > 0 && (
          <Box key="recent" flexDirection="column">
            <Text key="recent-head" bold>{`最近の失敗 ${recent.length} 件`}</Text>
            {recent.map((x, i) => (
              <Box key={`recent-${i}`} flexDirection="column">
                <Text key="head" color={x.isSub ? 'blue' : 'red'}>
                  {recentHead(x, now)}
                </Text>
                <Text key="error" dimColor>
                  {x.error}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        {(entries.length > 0 || total > 0) &&
          (confirming ? (
            <Box key="confirm" flexDirection="row" gap={1}>
              <Button key="clear" label="もう一度押すと消します" variant="primary" onPress={() => void clear($)} />
              <Button key="cancel" dimColor label="やめる" onPress={() => void update($, CONFIRMING, () => false)} />
            </Box>
          ) : (
            <Button key="clear" label="記録を消す" dimColor onPress={() => void update($, CONFIRMING, () => true)} />
          ))}
      </Box>
    )
  })
}
