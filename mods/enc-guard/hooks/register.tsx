import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EncEntry, EncRule } from '../types'
import {
  LOG_MAX,
  RULE,
  barePyWrites,
  bytesOf,
  hasBarePsWrite,
  hasBom,
  hasHighByte,
  hasNonAscii,
  isBat,
  isPs1,
  isPy,
  noteText,
  paneLines,
  paneSvg,
  runsPython,
} from './enc'
import { followTheme, readTheme, short } from './style'

const PANE = 'enc-guard'
const TITLE = '文字コードの見張り'
const DESCRIPTION = '文字コード・改行の罠 (Set-Content・.ps1 の BOM・.bat・Python の open) の数と記録のペインを開く'

const LOG = atom({ plugin: 'enc-guard', key: 'log' } as const, [])
const COUNTS = atom({ plugin: 'enc-guard', key: 'counts' } as const, { 'ps-encoding': 0, 'ps1-bom': 0, 'bat-ascii': 0, 'py-open': 0 })

type $ = EngineInterface
type Found = { rule: EncRule; where: string }

// 設定は register で userConfig から入れる
const cfg = { isBlocking: false, isPython: true }
let ownsMain = false

const SHELL_TOOLS = ['Bash', 'PowerShell']
const EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit']

/** ファイルの頭が BOM か。読めなければ (まだ無い) 無し */
async function bomOf($: $, path: string): Promise<boolean | undefined> {
  const got = await $.fs.read(path, { as: 'bytes' }).catch(() => undefined)
  return got === undefined ? undefined : hasBom(bytesOf(got.base64))
}

/** 編集で入る文 (Write は全文、Edit は new_string、MultiEdit は全部の new_string) */
function incomingText(tool: string, args: Record<string, unknown>) {
  if (tool === 'Write') return String(args.content ?? '')
  if (tool === 'Edit') return String(args.new_string ?? '')
  const edits = Array.isArray(args.edits) ? (args.edits as { new_string?: unknown }[]) : []
  return edits.map(x => String(x.new_string ?? '')).join('\n')
}

/** 実行の前に分かる罠 */
async function before($: $, tool: string, args: Record<string, unknown>): Promise<Found[]> {
  const found: Found[] = []
  if (SHELL_TOOLS.includes(tool) && typeof args.command === 'string') {
    const command = args.command
    const where = short(command.trim().split('\n')[0] ?? '', 60)
    if (hasBarePsWrite(command, tool === 'PowerShell')) found.push({ rule: 'ps-encoding', where })
    if (cfg.isPython && runsPython(command) && (await isWindows($)) && barePyWrites(command).length > 0) found.push({ rule: 'py-open', where })
    return found
  }
  if (!EDIT_TOOLS.includes(tool)) return found
  const path = String(args.file_path ?? '')
  const text = incomingText(tool, args)
  if (isBat(path) && hasNonAscii(text)) found.push({ rule: 'bat-ascii', where: path })
  if (isPy(path) && cfg.isPython && (await isWindows($)) && barePyWrites(text).length > 0) found.push({ rule: 'py-open', where: path })
  // .ps1 を Write で書く時は、全文と今のファイルの BOM で前もって分かる (Edit は書いた後に読む)
  if (tool === 'Write' && isPs1(path) && hasNonAscii(text) && !text.startsWith('\uFEFF') && (await bomOf($, path)) !== true) found.push({ rule: 'ps1-bom', where: path })
  return found
}

/** 書いた後に読んで分かる罠 (.ps1 の BOM) */
async function after($: $, tool: string, args: Record<string, unknown>, known: Found[]): Promise<Found[]> {
  if (!EDIT_TOOLS.includes(tool)) return []
  const path = String(args.file_path ?? '')
  if (!isPs1(path) || known.some(f => f.rule === 'ps1-bom')) return []
  const got = await $.fs.read(path, { as: 'bytes' }).catch(() => undefined)
  if (got === undefined) return []
  const bytes = bytesOf(got.base64)
  return hasHighByte(bytes) && !hasBom(bytes) ? [{ rule: 'ps1-bom', where: path }] : []
}

// ponytail: Windows かどうかはセッションの場所の形で決める (C:\ で始まる)。一度読んだら持つ
let windows: boolean | undefined
async function isWindows($: $) {
  windows ??= /^[A-Za-z]:/.test(await $.session.cwd().catch(() => ''))
  return windows
}

async function record($: $, found: Found[], action: EncEntry['action']) {
  const at = await $.clock.now()
  await update($, LOG, log => [...log, ...found.map(f => ({ at, rule: f.rule, where: f.where, action }))].slice(-LOG_MAX))
  await update($, COUNTS, c => {
    const next = { ...c }
    for (const f of found) next[f.rule] += 1
    return next
  })
  const names = [...new Set(found.map(f => RULE[f.rule].name))].join('・')
  $.ui.toast(`enc-guard: ${names}${action === 'blocked' ? '(止めました)' : '(Claude に伝えました)'}`, { timeoutMs: 6000 })
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '文字コードの見張りのペインを開きました。' }
}

export const register: Register = (on, options) => {
  cfg.isBlocking = options.mode === '止める'
  cfg.isPython = options.checkPython !== false

  followTheme(on)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    windows = undefined
    const got = await $.command.register({ name: 'enc', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'enc'
    if (!ownsMain) await $.command.register({ name: 'enc-guard', description: DESCRIPTION }).catch(() => {})
    return started
  })

  on('command.run', { command: 'enc' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'enc-guard' }, openPane)

  // 前に分かる物は、止める設定なら止める。知らせる設定と書いた後に分かる物は、結果の後ろで Claude に伝える
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    const pre = await before($, tool, args)
    if (cfg.isBlocking && pre.length > 0) {
      await record($, pre, 'blocked')
      return { deny: pre.map(f => noteText(f.rule, f.where)).join('\n') }
    }
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true) return r
    const found = [...pre, ...(await after($, tool, args, pre))]
    if (found.length === 0) return r
    await record($, found, 'told')
    return { ...r, context: [...(r.context ?? []), ...found.map(f => noteText(f.rule, f.where))] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const input = { log: await read($, LOG), counts: await read($, COUNTS), isBlocking: cfg.isBlocking }
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
        <Text dimColor>決まりは「UTF-8 (BOM なし)・LF が既定。PowerShell 5.1 の .ps1 だけ BOM 付き、.bat は ASCII だけ」です。</Text>
      </Box>
    )
  })
}
