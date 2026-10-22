import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GuardEntry, GuardOutcome } from '../types'
import { LOG_MAX, NO, YES, approvedIn, askText, denyText, isValid, outwardOf, paneLines, paneSvg } from './guard'
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

async function record($: $, label: string, command: string, outcome: GuardOutcome) {
  const at = await $.clock.now()
  const entry: GuardEntry = { at, label, command: command.trim().slice(0, 200), outcome }
  await update($, LOG, log => [...log, entry].slice(-LOG_MAX))
}

async function grant($: $, about: string) {
  const at = await $.clock.now()
  const turn = await read($, TURN)
  await update($, PERMIT, () => ({ turn, at, about }))
}

/**
 * シェルのツールの見張り。外に出す操作で、直前 (このターンか前のターン) に確認が無ければ、その場で聞く。
 * 聞けない・断られた時は止める。見張りなので .catch は付けない (失敗したら通さない)
 */
async function guard<R>($: $, command: string, next: () => Promise<R>): Promise<R | { deny: string }> {
  const label = outwardOf(command)
  if (label === undefined || (await read($, OFF))) return next()
  if (isValid(await read($, PERMIT), await read($, TURN))) {
    await record($, label, command, 'confirmed')
    return next()
  }
  let answer: string | undefined
  try {
    answer = await $.ui.ask(askText(label, command), { options: [YES, NO], header: '公開の確認' })
  } catch {
    answer = undefined
  }
  if (answer === YES) {
    await grant($, `その場で ${label} を許可`)
    await record($, label, command, 'asked-yes')
    return next()
  }
  const outcome: GuardOutcome = answer === undefined ? 'no-ask' : 'asked-no'
  await record($, label, command, outcome)
  return { deny: denyText(label, outcome, answer) }
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '外に出す操作の見張りのペインを開きました。' }
}

export const register: Register = on => {
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
          <Button key="off" label="このセッションは見張らない" onPress={() => void update($, OFF, () => true)} />
        )}
        <Text dimColor>見るのは git push・gh release (create/upload/edit/delete)・gh repo create・npm/pnpm/yarn publish です。</Text>
      </Box>
    )
  })
}
