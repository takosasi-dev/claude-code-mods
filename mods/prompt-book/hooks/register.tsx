import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptFilled, Register, Timer } from 'claude-code'

import type { PromptBookDraft, PromptBookItem, PromptBookSort } from '../types'
import { SORTS, arrange, chartSvg, fromSaved, isSort, newId, parseTags, seeds, short, summaryLines, tagCounts, titleOf } from './book'

const PANE = 'prompt-book'
const TITLE = 'プロンプト帳'
const DESCRIPTION = 'よく使う依頼文を保存して、ボタンで入力欄へ入れる'
const STORE_KEY = 'items'
const FLASH_MS = 2400
const EMPTY_DRAFT: PromptBookDraft = { title: '', body: '', tags: '' }

const ITEMS = atom({ plugin: 'prompt-book', key: 'items' } as const, [] as PromptBookItem[])
const DRAFT = atom({ plugin: 'prompt-book', key: 'draft' } as const, EMPTY_DRAFT)
const TAG = atom({ plugin: 'prompt-book', key: 'tag' } as const, '')
const SORT = atom({ plugin: 'prompt-book', key: 'sort' } as const, 'uses' as PromptBookSort)
const ARMED = atom({ plugin: 'prompt-book', key: 'armed' } as const, '')
const NOTICE = atom({ plugin: 'prompt-book', key: 'notice' } as const, '')
const FLASH = atom({ plugin: 'prompt-book', key: 'isFlashing' } as const, false)

type $ = EngineInterface

const say = ($: $, text: string) => update($, NOTICE, () => text)

/** 一覧を変えて store にも残す */
const change = async ($: $, fn: (items: PromptBookItem[], now: number) => PromptBookItem[]) => {
  const now = await $.clock.now()
  const items = await update($, ITEMS, x => fn(x, now))
  await $.store.set(STORE_KEY, items)
}

// ponytail: 光りを消すタイマーはモジュール変数。リロードで消えても光りが残るだけで、次の保存で消える
let flashTimer: Timer | undefined

async function save($: $, draft: PromptBookDraft) {
  const body = draft.body.trim()
  if (body === '') return say($, '本文を入れてください')
  const title = titleOf(draft.title, body)
  await change($, (items, now) => [...items, { id: newId(now), title, body, tags: parseTags(draft.tags), uses: 0, lastUsedAt: 0, createdAt: now }])
  await update($, DRAFT, () => EMPTY_DRAFT)
  await update($, ARMED, () => '')
  await say($, `「${title}」を保存しました`)
  await update($, FLASH, () => true)
  flashTimer?.cancel()
  flashTimer = $.clock.after(FLASH_MS, () => void update($, FLASH, () => false).catch(() => {}))
}

const fillNote = (title: string, r: PromptFilled | undefined) => {
  if (r?.isFilled) return `「${title}」を入力欄に入れました(送信はしていません)`
  if (r?.refusal === 'dialog') return '入力欄に入れられませんでした(ダイアログが開いています)'
  if (r?.refusal === 'no_composer') return '入力欄に入れられませんでした(この画面には入力欄がありません)'
  return '入力欄に入れられませんでした(VS Code では拒まれることがあります)'
}

async function use($: $, p: PromptBookItem) {
  await update($, ARMED, () => '')
  const r = await $.prompt.fill({ text: p.body, mode: 'replace' }).catch(() => undefined)
  // 入った時だけ数える
  if (r?.isFilled) await change($, (items, now) => items.map(x => (x.id === p.id ? { ...x, uses: x.uses + 1, lastUsedAt: now } : x)))
  await say($, fillNote(p.title, r))
}

/** 1 回目は「本当に消す」に変わるだけ。同じボタンをもう一度で消す */
async function remove($: $, p: PromptBookItem) {
  if ((await read($, ARMED)) !== p.id) {
    await update($, ARMED, () => p.id)
    return
  }
  await change($, items => items.filter(x => x.id !== p.id))
  await update($, ARMED, () => '')
  await say($, `「${p.title}」を消しました`)
}

/** 今の入力欄の中身を本文にして保存 (題・タグは追加欄のもの) */
async function saveFromPrompt($: $) {
  const box = await $.prompt.read().catch(() => ({ text: '' }))
  if (box.text.trim() === '') return say($, '入力欄が空か、読めませんでした(VS Code では読めないことがあります)')
  await save($, { ...(await read($, DRAFT)), body: box.text })
}

const setDraft = ($: $, field: keyof PromptBookDraft, value: string) => update($, DRAFT, d => ({ ...d, [field]: value }))

async function load($: $) {
  const now = await $.clock.now()
  const saved = fromSaved(await $.store.get(STORE_KEY))
  const items = saved ?? seeds(now)
  await update($, ITEMS, () => items)
  if (saved === undefined) await $.store.set(STORE_KEY, items)
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'プロンプト帳を開きました。' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // /prompts が拒まれたら (組み込みと被ったら) /prompt-book にする
    const got = await $.command.register({ name: 'prompts', description: DESCRIPTION }).catch(() => undefined)
    if (got?.command !== 'prompts') await $.command.register({ name: 'prompt-book', description: DESCRIPTION }).catch(() => {})
    await load($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'prompts' }, openPane)
  on('command.run', { command: 'prompt-book' }, openPane)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    if (!('Select' in t)) return <Text dimColor>この画面ではプロンプト帳を出せません</Text>
    const { Select, Input } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined

    const items = await read($, ITEMS)
    const draft = await read($, DRAFT)
    const sort = await read($, SORT)
    const armed = await read($, ARMED)
    const notice = await read($, NOTICE)
    const isFlashing = await read($, FLASH)
    const tags = tagCounts(items)
    // 消して無くなったタグで絞ったままにしない
    const tagRaw = await read($, TAG)
    const tag = tags.some(x => x.tag === tagRaw) ? tagRaw : ''
    const shown = arrange(items, sort, tag)
    const lines = summaryLines(items)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={chartSvg(items, tag, isFlashing)} alt={lines.join('\n')} />
        ) : (
          <Box key="summary" flexDirection="column">
            {lines.map((l, i) => (
              <Text bold={i === 0}>{l}</Text>
            ))}
            {isFlashing && <Text color="#3fb950">保存しました</Text>}
          </Box>
        )}
        {notice !== '' && (
          <Box key="notice">
            <Text color="#d29922">{notice}</Text>
          </Box>
        )}
        <Box flexDirection="column">
          <Select
            key="tag"
            label="タグ"
            options={[{ value: '', label: 'すべて' }, ...tags.map(x => ({ value: x.tag, label: `${x.tag} (${x.count})` }))]}
            value={tag}
            onSelect={v => void update($, TAG, () => v)}
          />
          <Select key="sort" label="並び" options={SORTS} value={sort} onSelect={v => void (isSort(v) && update($, SORT, () => v))} />
        </Box>
        <Box flexDirection="column">
          {shown.length === 0 && <Text dimColor>該当する依頼文がありません</Text>}
          {shown.map(p => (
            <Box key={`row:${p.id}`} flexDirection="row" flexWrap="wrap" gap={1}>
              <Button key={`use:${p.id}`} plain onPress={() => void use($, p)}>
                {short(p.title, 14)} <Text dimColor>{`${p.uses}回${p.tags.length > 0 ? ` ${p.tags.join(',')}` : ''}`}</Text>
              </Button>
              <Button key={`del:${p.id}`} label={armed === p.id ? '本当に消す' : '消す'} onPress={() => void remove($, p)} />
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text bold>追加</Text>
          <Input
            key="title"
            label="題"
            placeholder="空なら本文の頭"
            value={draft.title}
            onInput={v => void setDraft($, 'title', v)}
            onSubmit={v => void setDraft($, 'title', v)}
          />
          <Input
            key="body"
            label="本文"
            placeholder="入力欄へ入れる文"
            value={draft.body}
            onInput={v => void setDraft($, 'body', v)}
            onSubmit={v => void setDraft($, 'body', v)}
          />
          <Input
            key="tags"
            label="タグ"
            placeholder="カンマ区切りで 3 つまで"
            value={draft.tags}
            onInput={v => void setDraft($, 'tags', v)}
            onSubmit={v => void setDraft($, 'tags', v)}
          />
          <Button key="save" label="保存" variant="primary" onPress={() => void (async () => save($, await read($, DRAFT)))()} />
          <Button key="from-prompt" label="今の入力欄を保存" onPress={() => void saveFromPrompt($)} />
        </Box>
      </Box>
    )
  })
}
