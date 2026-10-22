import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RunAction, RunEntry, RunGroup, RunSaved } from '../types'
import { EMPTY, GROUPS, GROUP_NAME, LOG_MAX, NO, YES, addEntry, askText, classify, denyText, fromRaw, headOf, isWritable, listOf, modeOf, noteText, paneLines, paneSvg, withUnknown } from './guard'
import type { Found, Mode } from './guard'
import { followTheme, mayWrite, readTheme, rememberVersion } from './style'

const PANE = 'run-guard'
const TITLE = '窓と音の見張り'
const DESCRIPTION = '窓・音・隔離なしの claude -p の見張りの数と記録と、組ごとのオン/オフのペインを開く'
const KEY = 'save'

const SAVED = atom({ plugin: 'run-guard', key: 'saved' } as const, EMPTY)

type $ = EngineInterface
type ToolResult = { deny?: string; isError?: boolean; context?: readonly string[] }

let ownsMain = false
// 設定は register で userConfig から入れる
const cfg = { mode: '止める' as Mode, windowApps: [] as string[] }

/** store を読み直して state に置く */
async function load($: $) {
  const s = fromRaw(await $.store.get(KEY).catch(() => undefined))
  await update($, SAVED, () => s)
  return s
}

// ponytail: 書き込みはこのセッションの中で 1 本ずつ (読み直し → 書く の間に別の書き込みを挟まない)。別のセッションとは読み直しで合わせる
let chain: Promise<unknown> = Promise.resolve()

let toldBroken = false

/** 書く直前に読み直し、知らない欄を残して書く。古い版のまま・読めない (reject・形が違う) なら書かない */
function save($: $, change: (s: RunSaved) => RunSaved): Promise<boolean> {
  const run = async () => {
    if (!(await mayWrite($, await $.clock.now()))) return false
    const raw = await $.store.get(KEY)
    if (!isWritable(raw)) {
      if (!toldBroken) {
        toldBroken = true
        $.ui.toast('run-guard: 記録を読めなかったので、記録は書いていません (見張りは続けます)', { timeoutMs: 8000 })
      }
      return false
    }
    const mine = change(fromRaw(raw))
    await $.store.set(KEY, withUnknown(raw, mine))
    await update($, SAVED, () => mine)
    return true
  }
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}

// 書けなかった記録 (読めない・古い版・store が拒んだ)。次に書ける時に一緒に足す
let pending: RunEntry[] = []

async function record($: $, found: Found[], command: string, action: RunAction) {
  const groups = [...new Set(found.map(f => f.group))]
  try {
    const at = await $.clock.now()
    pending = [...pending, { at, groups, command: headOf(command), action }].slice(-LOG_MAX)
    let took: RunEntry[] = []
    const ok = await save($, s => {
      took = pending
      return took.reduce(addEntry, s)
    })
    if (ok) pending = pending.filter(e => !took.includes(e))
  } catch {
    // 記録が書けなくても見張りは続ける
  }
  if (action === 'blocked' || action === 'told') {
    const names = groups.map(g => GROUP_NAME[g]).join('・')
    $.ui.toast(`run-guard: ${names}${action === 'blocked' ? 'を止めました' : 'について Claude に伝えました'}`, { timeoutMs: 6000 })
  }
}

/**
 * シェルのツールの見張り。見つけたら、設定に合わせて止める・聞く・実行の後で伝える。
 * 見張りなので .catch は付けない (見分けで失敗した時だけ通す)
 */
async function guard<R extends ToolResult>($: $, command: string, shell: 'bash' | 'powershell', next: () => Promise<R>): Promise<R | { deny: string }> {
  const s = await load($).catch(() => EMPTY)
  let found: Found[] = []
  try {
    found = classify(command, shell, cfg.windowApps).filter(f => !s.off[f.group])
  } catch {
    found = []
  }
  if (found.length === 0) return next()

  if (cfg.mode === '伝えるだけ') {
    const r = await next()
    if (r.deny !== undefined) return r
    await record($, found, command, 'told')
    return { ...r, context: [...(r.context ?? []), noteText(found)] }
  }
  if (cfg.mode === '聞く') {
    let answer: string | undefined
    try {
      answer = await $.ui.ask(askText(found, command), { options: [YES, NO], header: '窓と音の確認' })
    } catch {
      answer = undefined
    }
    if (answer === YES) {
      await record($, found, command, 'asked-yes')
      return next()
    }
    await record($, found, command, answer === undefined ? 'blocked' : 'asked-no')
    return { deny: denyText(found, answer === undefined ? 'no-ask' : 'asked-no', answer) }
  }
  await record($, found, command, 'blocked')
  return { deny: denyText(found, 'blocked') }
}

const openPane = async ($: $) => {
  await load($).catch(() => undefined)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '窓と音の見張りのペインを開きました。' }
}

const toggle = ($: $, g: RunGroup) => save($, s => ({ ...s, off: { ...s.off, [g]: !s.off[g] } })).catch(() => false)

export const register: Register = (on, options) => {
  cfg.mode = modeOf(options.mode)
  cfg.windowApps = listOf(options.windowApps)

  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    await rememberVersion($)
    await load($).catch(() => undefined)
    // /runguard が拒まれたら /run-guard にする
    const got = await $.command.register({ name: 'runguard', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'runguard'
    if (!ownsMain) await $.command.register({ name: 'run-guard', description: DESCRIPTION }).catch(() => {})
    return started
  })

  on('command.run', { command: 'runguard' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  // /runguard を持てた時は予備名を開かない (同じ名前の別のコマンドを横取りしない)
  on('command.run', { command: 'run-guard' }, ($, e, next) => (ownsMain ? next(e) : openPane($)))

  on('tool.call', { tool: 'Bash' }, ($, e, next) => guard($, e.command, 'bash', () => next(e)))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => guard($, e.command, 'powershell', () => next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const input = { saved: await read($, SAVED), mode: cfg.mode }
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
        <Box key="toggles" flexDirection="column">
          {GROUPS.map(g =>
            input.saved.off[g] ? (
              <Button key={`toggle-${g}`} label={`${GROUP_NAME[g]}の見張りを戻す`} variant="primary" onPress={() => toggle($, g)} />
            ) : (
              <Button key={`toggle-${g}`} dimColor label={`${GROUP_NAME[g]}を見張らない`} onPress={() => toggle($, g)} />
            ),
          )}
        </Box>
        <Text dimColor>見るのは Bash と PowerShell のコマンドです。窓は Start-Process (-WindowStyle Hidden なし)・start・ii・explorer・code・godot や chrome (--headless なし)、音は Beep・SoundPlayer・読み上げ・ffplay など、headless は一時の CLAUDE_CONFIG_DIR・127.0.0.1 の ANTHROPIC_BASE_URL・CLAUDE_CODE_PLUGIN_DIRS を消す、の 3 つをそろえずに走らせる claude -p です。</Text>
      </Box>
    )
  })
}
