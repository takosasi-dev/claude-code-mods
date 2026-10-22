import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { RuleKind, RuleMiss } from '../types'
import {
  HISTORY_MAX,
  KINDS,
  STICKY,
  bandText,
  endsWithQuestion,
  hasLogLine,
  isAbsolute,
  isClosing,
  isCommit,
  isEnglish,
  isTodayLog,
  isUnder,
  logName,
  mentionsDir,
  paneLines,
  paneSvg,
  questionLine,
  remindText,
} from './rules'
import { followTheme, readTheme, short } from './style'

const PANE = 'rule-watch'
const TITLE = '約束ごとの見張り'
const DESCRIPTION = '英語の返事・文での質問・メモと開発ログの書き忘れの数と記録のペインを開く'

const MISSES = atom({ plugin: 'rule-watch', key: 'misses' } as const, [])
const ZERO: Record<RuleKind, number> = { english: 0, question: 0, memo: 0, log: 0, logLine: 0, closing: 0 }
const COUNTS = atom({ plugin: 'rule-watch', key: 'counts' } as const, ZERO)
const HISTORY = atom({ plugin: 'rule-watch', key: 'history' } as const, [])
const ASKS = atom({ plugin: 'rule-watch', key: 'asks' } as const, 0)
const MEMO = atom({ plugin: 'rule-watch', key: 'memoPending' } as const, null)
const LOG = atom({ plugin: 'rule-watch', key: 'log' } as const, { pending: null, isWritten: false, isClosing: false })

type $ = EngineInterface

// 設定は register で userConfig から入れる
const cfg = { english: true, question: true, memoDir: '', logDir: '', grace: 0 }
let ownsMain = false

const EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
const SHELL_TOOLS = ['Bash', 'PowerShell']

const isOn = (k: RuleKind) => (k === 'english' ? cfg.english : k === 'question' ? cfg.question : k === 'memo' ? cfg.memoDir !== '' : cfg.logDir !== '')
const watching = (): RuleKind[] => KINDS.filter(isOn)

const drawsSomething = (tree: RenderElement) => tree.type !== 'engine'

/** メモを書いた。待ちを下ろし、帯のメモの分も消す */
async function memoWritten($: $) {
  await update($, MEMO, () => null)
  await update($, MISSES, m => (m.some(x => x.rule === 'memo') ? m.filter(x => x.rule !== 'memo') : m))
}

/** 今日の開発ログを書いた。待ちを下ろし、帯のログの分も消す */
async function logWritten($: $) {
  await update($, LOG, l => ({ ...l, pending: null, isWritten: true }))
  await update($, MISSES, m => (m.some(x => x.rule === 'log') ? m.filter(x => x.rule !== 'log') : m))
}

/** メインのターンの終わりに、返事とメモ・開発ログの待ちを見る */
async function judge($: $, answer: string): Promise<RuleMiss[]> {
  const misses: RuleMiss[] = []
  if (cfg.english && isEnglish(answer)) misses.push({ rule: 'english', detail: '' })
  if (cfg.question && (await read($, ASKS)) === 0 && endsWithQuestion(answer)) misses.push({ rule: 'question', detail: short(questionLine(answer), 80) })
  const pending = await read($, MEMO)
  if (cfg.memoDir !== '' && pending) {
    if (pending.turns >= cfg.grace) misses.push({ rule: 'memo', detail: '' })
    else await update($, MEMO, p => (p ? { ...p, turns: p.turns + 1 } : p))
  }
  if (cfg.logDir !== '') {
    const log = await read($, LOG)
    const name = logName(await $.clock.now())
    if (log.pending) {
      if (log.pending.turns >= cfg.grace) misses.push({ rule: 'log', detail: name })
      else await update($, LOG, l => (l.pending ? { ...l, pending: { ...l.pending, turns: l.pending.turns + 1 } } : l))
    }
    if (log.isWritten && !hasLogLine(answer)) misses.push({ rule: 'logLine', detail: name })
    if (log.isClosing && !log.isWritten) misses.push({ rule: 'closing', detail: name })
  }
  return misses
}

async function remember($: $, misses: RuleMiss[]) {
  const before = await read($, MISSES)
  await update($, MISSES, () => misses)
  // メモ・開発ログの外れは、出し続けている間は 1 回だけ数える
  const fresh = misses.filter(m => !(STICKY.includes(m.rule) && before.some(b => b.rule === m.rule)))
  if (fresh.length === 0) return
  const at = await $.clock.now()
  await update($, COUNTS, c => {
    const next = { ...c }
    for (const m of fresh) next[m.rule] = (next[m.rule] ?? 0) + 1
    return next
  })
  await update($, HISTORY, h => [...h, ...fresh.map(m => ({ ...m, at }))].slice(-HISTORY_MAX))
}

async function remind($: $) {
  const misses = await read($, MISSES)
  if (misses.length === 0) return
  const r = await $.prompt.fill({ text: remindText(misses), mode: 'insert' }).catch(() => ({ isFilled: false, refusal: undefined }))
  const why = r.refusal === 'dialog' ? '(ダイアログが開いています)' : r.refusal === 'no_composer' ? '(この画面には入力欄がありません)' : ''
  $.ui.toast(r.isFilled ? '入力欄に入れました(送信はしていません)' : `入力欄に入れられませんでした${why}`, { timeoutMs: 5000 })
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '約束ごとの見張りのペインを開きました。' }
}

/** 絶対パスだけを受け付ける。ほかは未設定 */
const dirOption = (v: unknown) => {
  const s = String(v ?? '').trim()
  return isAbsolute(s) ? s : ''
}

export const register: Register = (on, options) => {
  cfg.english = options.checkEnglish !== false
  cfg.question = options.checkQuestion !== false
  cfg.memoDir = dirOption(options.memoDir)
  cfg.logDir = dirOption(options.logDir)
  const grace = Number(options.memoGraceTurns)
  cfg.grace = Number.isFinite(grace) && grace > 0 ? Math.floor(grace) : 0

  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // 途中で読み込まれた時も帯を聞きに来るように (docs/mod-guide.md の 3 節)
    $.ui.invalidate('ui.render')
    const got = await $.command.register({ name: 'rulewatch', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'rulewatch'
    if (!ownsMain) await $.command.register({ name: 'rule-watch', description: DESCRIPTION }).catch(() => {})
    return started
  })

  on('command.run', { command: 'rulewatch' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'rule-watch' }, openPane)

  // メインのターンの頭で、問いの数とログの印を 0 に戻し、返事についての帯を下ろす (メモ・ログの分は書くまで残す)。
  // 依頼者の入力に締めの言葉があったかだけを覚える (文そのものは残さない)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, ASKS, () => 0)
      await update($, LOG, l => ({ ...l, isWritten: false, isClosing: isClosing(e.text) }))
      await update($, MISSES, m => (m.some(x => !STICKY.includes(x.rule)) ? m.filter(x => STICKY.includes(x.rule)) : m))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // AskUserQuestion を数え、コミットでメモ・ログ待ちを始め、書いたら下ろす (サブエージェントの分も見る)
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true) return r
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    if (tool === 'AskUserQuestion') {
      if (e.agentId === undefined) await update($, ASKS, n => n + 1)
      return r
    }
    if (cfg.memoDir === '' && cfg.logDir === '') return r
    const now = await $.clock.now()
    if (EDIT_TOOLS.includes(tool)) {
      const path = String(args.file_path ?? args.notebook_path ?? '')
      if (isUnder(path, cfg.memoDir)) await memoWritten($)
      if (isTodayLog(path, cfg.logDir, now)) await logWritten($)
    } else if (SHELL_TOOLS.includes(tool) && typeof args.command === 'string') {
      const command = args.command
      const memo = mentionsDir(command, cfg.memoDir)
      const log = mentionsDir(command, cfg.logDir, logName(now))
      if (memo) await memoWritten($)
      if (log) await logWritten($)
      if (!memo && !log && isCommit(command)) {
        if (cfg.memoDir !== '') await update($, MEMO, p => p ?? { since: now, turns: 0 })
        // このターンにもうログを書いていれば待たない (ログを書いてからコミットした)
        if (cfg.logDir !== '') await update($, LOG, l => (l.pending || l.isWritten ? l : { ...l, pending: { since: now, turns: 0 } }))
      }
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || e.answer.trim() === '') return done
    await remember($, await judge($, e.answer))
    return done
  }).catch(($, e, next) => next(e))

  // 入力欄の上の帯。外れが無い時は下の mod に任せる
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const misses = await read($, MISSES)
    if (misses.length === 0) return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const band = (
      <Box key="rules" flexShrink={0}>
        <Text color="warning">{bandText(misses)}</Text>
      </Box>
    )
    if (!drawsSomething(below)) return band
    return (
      <Box flexDirection="column">
        {band}
        <Box key="below">{below}</Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const input = {
      misses: await read($, MISSES),
      // 古い版で数えた分 (log などの欄が無い) も 0 で埋める
      counts: { ...ZERO, ...(await read($, COUNTS)) },
      history: await read($, HISTORY),
      isMemoPending: (await read($, MEMO)) !== null,
      isLogPending: (await read($, LOG)).pending !== null,
      watching: watching(),
    }
    const lines = paneLines(input)
    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={paneSvg(input)} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        {input.misses.length > 0 ? <Button key="remind" label="Claude に伝える" variant="primary" onPress={() => void remind($)} /> : null}
        {cfg.memoDir === '' ? <Text dimColor>メモの見張りは、設定の memoDir に引き継ぎメモのフォルダを入れると始まります。</Text> : null}
        {cfg.logDir === '' ? <Text dimColor>開発ログの見張りは、設定の logDir に開発ログのフォルダを入れると始まります。</Text> : null}
        <Text dimColor>知らせるだけです。「Claude に伝える」は入力欄に入れるだけで、送信はしません。</Text>
      </Box>
    )
  })
}
