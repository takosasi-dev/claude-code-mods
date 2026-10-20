import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RuleSwitchSave } from '../types'
import { followTheme, readTheme } from './style'
import { boardLines, boardSvg, clean, fromSaved, isKnown, MAX_CUSTOM, rulesOf, SECTION_ID, sectionText, summary, withAdded, withRemoved, withToggle } from './rules'

const PANE = 'rule-switch'
const TITLE = 'ルールスイッチ'
const DESCRIPTION = '約束ごとをボタンでオン/オフするペインを開く (オンの物はシステムプロンプトに入る)'
const STORE_KEY = 'save'

const SAVE = atom({ plugin: 'rule-switch', key: 'save' } as const, null as RuleSwitchSave | null)
const ARMED = atom({ plugin: 'rule-switch', key: 'armed' } as const, '')
const NOTE = atom({ plugin: 'rule-switch', key: 'note' } as const, '')

type $ = EngineInterface

const BROKEN = '記録を読めなかったので、切り替えを残せません(上書きしないよう止めています)'
const HINT = '切り替えは次の依頼から効きます。切り替えるとプロンプトのキャッシュが作り直されます'

let ownsMain = false

// store に書く物は 1 本ずつ流す。連打や 2 つの操作が重なっても、同じ値を読んで片方が消えないように
let chain: Promise<unknown> = Promise.resolve()
const serial = (f: () => Promise<unknown>) => (chain = chain.then(f, f))

/** store の値。キーが無ければ空、読めない時 (例外・形が違う) は undefined */
async function readStore($: $): Promise<RuleSwitchSave | undefined> {
  try {
    return fromSaved(await $.store.get(STORE_KEY))
  } catch {
    return undefined
  }
}

/** store を state に写す。読めなければ知らせるだけ */
async function load($: $) {
  const saved = await readStore($)
  if (saved) await update($, SAVE, () => saved)
  else await update($, NOTE, () => BROKEN)
  return saved
}

/** state の写し。まだ読んでいなければ (/clear の後など) store から読む */
async function current($: $) {
  return (await read($, SAVE)) ?? (await load($))
}

/**
 * 書く直前に store を読み直し、その 1 件だけ変えて書く (別のセッションの切り替えを消さない)。
 * change が文字列を返したら書かずにその一言を出す
 */
const write = ($: $, change: (fresh: RuleSwitchSave) => RuleSwitchSave | string) =>
  serial(async () => {
    const fresh = await readStore($)
    if (!fresh) {
      await update($, NOTE, () => BROKEN)
      return
    }
    const next = change(fresh)
    if (typeof next === 'string') {
      await update($, SAVE, () => fresh)
      await update($, NOTE, () => next)
      return
    }
    const isSaved = await $.store.set(STORE_KEY, next).then(
      () => true,
      () => false,
    )
    // 書けなかった時は state も前のまま (store と食い違わせない)
    await update($, SAVE, () => (isSaved ? next : fresh))
    await update($, NOTE, () => (isSaved ? '' : '保存できませんでした'))
  })

const toggle = async ($: $, id: string, isOn: boolean) => {
  await update($, ARMED, () => '')
  await write($, fresh => (isOn && !isKnown(fresh, id) ? 'そのルールは別の画面で消されました' : withToggle(fresh, id, isOn)))
}

const add = async ($: $, value: string) => {
  await update($, ARMED, () => '')
  const text = clean(value)
  if (text === '') return
  const id = `c${(await $.clock.now()).toString(36)}${Math.random().toString(36).slice(2, 6)}`
  await write($, fresh => {
    if (fresh.custom.length >= MAX_CUSTOM) return `自分のルールは ${MAX_CUSTOM} 個までです`
    if (rulesOf(fresh).some(r => r.text === text)) return '同じルールがもうあります'
    return withAdded(fresh, { id, text })
  })
}

/** 1 回目は印を付けるだけ、同じルールでもう一度押すと消す */
const remove = async ($: $, id: string) => {
  if ((await read($, ARMED)) !== id) {
    await update($, ARMED, () => id)
    return
  }
  await update($, ARMED, () => '')
  await write($, fresh => withRemoved(fresh, id))
}

const openPane = async ($: $) => {
  await load($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'ルールスイッチを開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // /rules が拒まれたら (組み込みと被ったら) /rule-switch にする
    const got = await $.command.register({ name: 'rules', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'rules'
    if (!ownsMain) await $.command.register({ name: 'rule-switch', description: DESCRIPTION }).catch(() => {})
    await load($)
    return started
  })

  // /rules を持てなかった時は、元の /rules に回す
  on('command.run', { command: 'rules' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'rule-switch' }, openPane)

  // 別のセッションで切り替えた物も、次のターンから同じにする (メインのターンだけ)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await load($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // オンのルールを 1 つの節にして最後に足す。他の節には触らない。オンが 0 なら何も足さない
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const save = await current($)
    const text = save ? sectionText(save) : null
    if (text === null) return composed
    return { sections: [...composed.sections, { id: SECTION_ID, text, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // mobile には Input が無い。そこでは切り替えだけ
    const Input = 'Input' in t ? t.Input : undefined
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const save = (await read($, SAVE)) ?? { on: {}, custom: [] }
    const armed = await read($, ARMED)
    const note = await read($, NOTE)
    const rules = rulesOf(save)
    const { on: onCount, all } = summary(save)

    const ruleButton = (r: (typeof rules)[number]) => (
      <Button
        key={`rule-${r.id}`}
        label={`${r.isOn ? '●' : '○'} ${r.text}`}
        variant={r.isOn ? 'primary' : 'secondary'}
        onPress={() => void toggle($, r.id, !r.isOn)}
      />
    )

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg key="board" source={boardSvg(save)} alt={boardLines(save).join('\n')} />
        ) : (
          <Text key="count" bold color={onCount > 0 ? 'green' : undefined}>{`オン ${onCount} 個 / 全 ${all} 個`}</Text>
        )}
        <Box key="builtin" flexDirection="column">
          {rules.filter(r => !r.isCustom).map(ruleButton)}
        </Box>
        <Box key="custom" flexDirection="column">
          <Text dimColor>自分のルール</Text>
          {rules
            .filter(r => r.isCustom)
            .map(r => (
              <Box key={`row-${r.id}`} flexDirection="column">
                {ruleButton(r)}
                <Button
                  key={`del-${r.id}`}
                  label={armed === r.id ? '本当に消す(もう一度押す)' : '消す'}
                  onPress={() => void remove($, r.id)}
                />
              </Box>
            ))}
          {Input && <Input key="new" label="足す" placeholder="例: 関数には日本語のコメントを書く" value="" submitLabel="足す" onSubmit={value => void add($, value)} />}
        </Box>
        {note !== '' && <Text color="warning">{note}</Text>}
        <Text dimColor>{HINT}</Text>
      </Box>
    )
  })
}
