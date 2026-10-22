import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GuardEntry, GuardOutcome } from '../types'
import { LOG_FORMAT, LOG_MAX, NO, YES, approvedIn, askText, denyText, isValid, listOf, outwardOf, paneLines, paneSvg, rangeOf, repoDirOf, resolveDir, scanPush } from './guard'
import { followTheme, readTheme } from './style'

const PANE = 'ship-guard'
const TITLE = '外に出す操作の見張り'
const DESCRIPTION = 'git push・gh release・npm publish の見張りの記録と、オン/オフのペインを開く'

const OFF = atom({ plugin: 'ship-guard', key: 'isOff' } as const, false)
const LOG = atom({ plugin: 'ship-guard', key: 'log' } as const, [])
const PERMIT = atom({ plugin: 'ship-guard', key: 'permit' } as const, null)
const TURN = atom({ plugin: 'ship-guard', key: 'turn' } as const, 0)

type $ = EngineInterface

let ownsMain = false
// 設定は register で userConfig から入れる
const cfg = { isChecking: true, allowed: [] as string[], words: [] as string[] }

async function record($: $, label: string, command: string, outcome: GuardOutcome, findings: string[] = []) {
  const at = await $.clock.now()
  const entry: GuardEntry = { at, label, command: command.trim().slice(0, 200), outcome, ...(findings.length > 0 ? { findings } : {}) }
  await update($, LOG, log => [...log, entry].slice(-LOG_MAX))
}

/**
 * git push の前に、送るコミット (どのリモートにもまだ無い物、最大 200) の作者と足した行を読む。
 * git は読むだけ。リポジトリの設定が指すコマンド (fsmonitor・textconv・外部 diff) は走らせない
 */
async function preflight($: $, command: string): Promise<string[]> {
  if (!cfg.isChecking) return []
  const dir = resolveDir(repoDirOf(command), await $.session.cwd())
  const argv = ['git', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', 'log', '-p', '-U0', '--no-color', '--no-renames', '--no-textconv', '--no-ext-diff', LOG_FORMAT, '-n', '200', ...rangeOf(command)]
  try {
    const r = await $.process.run(argv, { cwd: dir, env: { GIT_OPTIONAL_LOCKS: '0' }, timeoutMs: 20_000 })
    if (r.exitCode !== 0) return [`送るコミットを読めませんでした (${dir}: ${(r.stderr.trim().split('\n')[0] ?? '').slice(0, 80) || `終了コード ${r.exitCode}`})`]
    const found = scanPush(r.stdout, { allowed: cfg.allowed, words: cfg.words })
    return r.isStdoutTruncated ? [...found, '差分が長いので途中までしか見ていません'] : found
  } catch (err) {
    return [`送るコミットを読めませんでした (${(err instanceof Error ? err.message : String(err)).slice(0, 80)})`]
  }
}

async function grant($: $, about: string) {
  const at = await $.clock.now()
  const turn = await read($, TURN)
  await update($, PERMIT, () => ({ turn, at, about }))
}

/**
 * シェルのツールの見張り。外に出す操作で、直前 (このターンか前のターン) に確認が無ければ、その場で聞く。
 * git push は先に公開前のチェックをして、気になる所があれば確認済みでも聞き直す (公開の許可は、漏れの許可ではない)。
 * 聞けない・断られた時は止める。見張りなので .catch は付けない (失敗したら通さない)
 */
async function guard<R>($: $, command: string, next: () => Promise<R>): Promise<R | { deny: string }> {
  const label = outwardOf(command)
  if (label === undefined || (await read($, OFF))) return next()
  const findings = label === 'git push' ? await preflight($, command) : []
  if (findings.length === 0 && isValid(await read($, PERMIT), await read($, TURN))) {
    await record($, label, command, 'confirmed')
    return next()
  }
  let answer: string | undefined
  try {
    answer = await $.ui.ask(askText(label, command, findings), { options: [YES, NO], header: '公開の確認' })
  } catch {
    answer = undefined
  }
  if (answer === YES) {
    await grant($, `その場で ${label} を許可`)
    await record($, label, command, 'asked-yes', findings)
    return next()
  }
  const outcome: GuardOutcome = answer === undefined ? 'no-ask' : 'asked-no'
  await record($, label, command, outcome, findings)
  return { deny: denyText(label, outcome, answer, findings) }
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '外に出す操作の見張りのペインを開きました。' }
}

export const register: Register = (on, options) => {
  cfg.isChecking = options.checkBeforePush !== false
  cfg.allowed = listOf(options.allowedEmails)
  cfg.words = listOf(options.privateWords)

  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    const got = await $.command.register({ name: 'guard', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'guard'
    if (!ownsMain) await $.command.register({ name: 'ship-guard', description: DESCRIPTION }).catch(() => {})
    return started
  })

  on('command.run', { command: 'guard' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'ship-guard' }, openPane)

  // 確認の効き目はターンで数える (メインのターンだけ)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, TURN, n => n + 1)
    return next(e)
  }).catch(($, e, next) => next(e))

  // AskUserQuestion で公開してよいと答えたら、このターンと次のターンは聞き直さない
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.isError !== true && typeof r.text === 'string') {
      const about = approvedIn(r.text)
      if (about !== undefined) await grant($, about)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, ($, e, next) => guard($, e.command, () => next(e)))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => guard($, e.command, () => next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const input = { isOff: await read($, OFF), log: await read($, LOG), permit: await read($, PERMIT), turn: await read($, TURN) }
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
        {input.isOff ? (
          <Button key="on" label="見張りを戻す" variant="primary" onPress={() => void update($, OFF, () => false)} />
        ) : (
          <Button key="off" dimColor label="このセッションは見張らない" onPress={() => void update($, OFF, () => true)} />
        )}
        <Text dimColor>見るのは git push・gh release (create/upload/edit/delete)・gh repo create・npm/pnpm/yarn publish です。</Text>
        {cfg.isChecking ? <Text dimColor>git push の前は、送るコミットの作者のメールと、足した行の個人のメール・ユーザー名入りのパスも確かめます。</Text> : null}
      </Box>
    )
  })
}
