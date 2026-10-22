import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { CueBreak } from '../types'
import { DEFAULT_NOTIFY, DEFAULT_URGENT, advise, bandColor, contextOf, bandText, isAbsolute, isCommit, isTest, isToastLevel, isUnder, paneLines, paneSvg, toastText } from './cue'
import { followTheme, readTheme } from './style'

const PANE = 'compact-cue'
const TITLE = 'compact の合図'
const DESCRIPTION = 'コンテキストの使用量と、今 /compact してよいかをペインで見る'

const CONTEXT = atom({ plugin: 'compact-cue', key: 'context' } as const, null)
const PHASE = atom({ plugin: 'compact-cue', key: 'phase' } as const, 'clean')
const LAST_BREAK = atom({ plugin: 'compact-cue', key: 'lastBreak' } as const, null)
const TOLD = atom({ plugin: 'compact-cue', key: 'told' } as const, '')

type $ = EngineInterface

// 設定は register で userConfig から入れる
const cfg = { notifyAt: DEFAULT_NOTIFY, urgentAt: DEFAULT_URGENT, memoDir: '' }
let ownsMain = false

const EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
const SHELL_TOOLS = ['Bash', 'PowerShell']

/** シェルのコマンドがメモのフォルダを指しているか (D:\x と /d/x の両方の書き方を見る) */
function mentionsMemo(command: string) {
  if (cfg.memoDir === '') return false
  const dir = cfg.memoDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const msys = dir.replace(/^([a-z]):/, (_, d: string) => `/${d}`)
  const c = command.replace(/\\/g, '/').toLowerCase()
  return c.includes(`${dir}/`) || c.includes(`${msys}/`)
}

const drawsSomething = (tree: RenderElement) => tree.type !== 'engine'

async function markBreak($: $, kind: CueBreak['kind']) {
  const at = await $.clock.now()
  await update($, LAST_BREAK, () => ({ kind, at }))
  await update($, PHASE, () => 'clean' as const)
}

const markMid = ($: $) => update($, PHASE, () => 'mid' as const)

/** 今の様子を一度に読む */
async function snapshot($: $) {
  return {
    ctx: await read($, CONTEXT),
    phase: await read($, PHASE),
    lastBreak: await read($, LAST_BREAK),
    notifyAt: cfg.notifyAt,
    urgentAt: cfg.urgentAt,
    memoDir: cfg.memoDir,
  }
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'compact の合図のペインを開きました。' }
}

export const register: Register = (on, options) => {
  const notify = Number(options.notifyPercent)
  const urgent = Number(options.urgentPercent)
  cfg.notifyAt = Number.isFinite(notify) && notify > 0 ? Math.min(100, notify) : DEFAULT_NOTIFY
  cfg.urgentAt = Math.max(cfg.notifyAt, Number.isFinite(urgent) && urgent > 0 ? Math.min(100, urgent) : DEFAULT_URGENT)
  const memo = String(options.memoDir ?? '').trim()
  cfg.memoDir = isAbsolute(memo) ? memo : ''

  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // 途中で読み込まれた時も帯を聞きに来るように (docs/mod-guide.md の 3 節)
    $.ui.invalidate('ui.render')
    const got = await $.command.register({ name: 'cue', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'cue'
    if (!ownsMain) await $.command.register({ name: 'compact-cue', description: DESCRIPTION }).catch(() => {})
    return started
  })

  on('command.run', { command: 'cue' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'compact-cue' }, openPane)

  // 編集すると途中、コミット・テスト通過・メモを書くと区切り (サブエージェントの分も数える)
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    const tool = String(e.tool)
    const isOk = r.isError !== true
    const args = e as unknown as Record<string, unknown>
    if (EDIT_TOOLS.includes(tool) && isOk) {
      const path = String(args.file_path ?? args.notebook_path ?? '')
      if (isUnder(path, cfg.memoDir)) await markBreak($, 'memo')
      else await markMid($)
    } else if (SHELL_TOOLS.includes(tool) && typeof args.command === 'string' && args.run_in_background !== true) {
      const command = args.command
      if (isCommit(command) && isOk) await markBreak($, 'commit')
      else if (isTest(command)) await (isOk ? markBreak($, 'test') : markMid($))
      else if (isOk && mentionsMemo(command)) await markBreak($, 'memo')
    }
    return r
  }).catch(($, e, next) => next(e))

  // メインのターンが終わったら使用量を読み (この呼び出しはただ)、区切りに入った時だけトーストを出す
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    // 内訳は summary (手元の見積もりだけで API は呼ばない)。自動 compact の位置を 100% にするために読む
    const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => $.session.usage().catch(() => undefined))
    if (usage) await update($, CONTEXT, () => contextOf(usage.context))
    const s = await snapshot($)
    const a = advise(s.ctx, s.phase, s.lastBreak, s.notifyAt, s.urgentAt)
    const told = await read($, TOLD)
    if (isToastLevel(a.level) && told !== a.level) {
      $.ui.toast(toastText(s.ctx, a), { timeoutMs: 8000 })
      await update($, TOLD, () => a.level)
    } else if (!isToastLevel(a.level) && told !== '') {
      await update($, TOLD, () => '')
    }
    return done
  }).catch(($, e, next) => next(e))

  // compact が済んだら合図を下ろす。使用量は compact 後の数があればそれ、無ければ次の返事で読む
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || r.skip !== undefined) return r
    const before = await read($, CONTEXT)
    const after = 'tokensAfter' in r ? r.tokensAfter : undefined
    const window = before?.window ?? 0
    const base = { window, ...(before?.isAutoLimit ? { isAutoLimit: true } : {}) }
    await update($, CONTEXT, () =>
      after !== undefined && window > 0 ? { ...base, percent: Math.round((after / window) * 100), tokens: after } : window > 0 ? base : null,
    )
    await update($, PHASE, () => 'clean' as const)
    await update($, TOLD, () => '')
    return r
  }).catch(($, e, next) => next(e))

  // 入力欄の上の帯。合図が無い時は下の mod に任せる
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = await snapshot($)
    const a = advise(s.ctx, s.phase, s.lastBreak, s.notifyAt, s.urgentAt)
    if (a.level === 'ok') return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const cue = (
      <Box key="cue" flexShrink={0}>
        <Text color={bandColor(a.level)} dimColor={a.level === 'wait'} bold={a.level !== 'wait'}>
          {bandText(s.ctx, a)}
        </Text>
      </Box>
    )
    if (!drawsSomething(below)) return cue
    return (
      <Box flexDirection="column">
        {cue}
        <Box key="below">{below}</Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const s = await snapshot($)
    const lines = paneLines(s)
    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={paneSvg(s)} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        <Text dimColor>知らせるだけです。compact は /compact で行ってください。</Text>
      </Box>
    )
  })
}
