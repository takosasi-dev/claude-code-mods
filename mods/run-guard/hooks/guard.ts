// 窓・音・隔離なしの headless claude の見分けと、記録の形、ペインの SVG と文。どれも純関数
import type { RunAction, RunEntry, RunGroup, RunSaved } from '../types'
import { C, HEADER_H, clean, esc, frame, header, panel, short } from './style'

export const LOG_MAX = 50
export const GROUPS: readonly RunGroup[] = ['window', 'sound', 'headless']
export const GROUP_NAME: Record<RunGroup, string> = { window: '窓', sound: '音', headless: 'claude の headless 実行' }

export type Shell = 'bash' | 'powershell' | 'cmd'
export type Found = { group: RunGroup; what: string; fix: string }

// ── コマンドを語に分ける

/** 1 語。text は引用符を外した中身、bare は引用符の中を Q にした物 (文字列の中の言葉を拾わない) */
export type Word = { text: string; bare: string }

/**
 * コマンドを区切り (; | & { } 改行) ごとの語の並びにする。引用符の中・ヒアドキュメント・here-string は 1 語の中身になり、
 * コメント (語の頭の #、PowerShell の <# #>) は落とす。( ) は語の切れ目だけにする (-ArgumentList @('a') -WindowStyle Hidden を 1 つに保つ)
 */
export function parse(command: string, shell: Shell): Word[][] {
  const segs: Word[][] = []
  let seg: Word[] = []
  let text = ''
  let bare = ''
  let inWord = false
  const heredocs: { tag: string; into: Word[] }[] = []
  const endWord = () => {
    if (inWord) seg.push({ text, bare })
    text = ''
    bare = ''
    inWord = false
  }
  const endSeg = () => {
    endWord()
    if (seg.length > 0) segs.push(seg)
    seg = []
  }
  const add = (t: string, b = t) => {
    text += t
    bare += b
    inWord = true
  }
  const s = command
  let i = 0
  while (i < s.length) {
    const c = s[i] ?? ''
    const next = s[i + 1] ?? ''
    // PowerShell の here-string (@' から行頭の '@ まで)
    if (shell === 'powershell' && c === '@' && (next === "'" || next === '"') && !inWord && /^[ \t]*\r?\n/.test(s.slice(i + 2))) {
      const end = s.indexOf(`\n${next}@`, i + 2)
      const stop = end < 0 ? s.length : end + 3
      add(s.slice(s.indexOf('\n', i) + 1, end < 0 ? s.length : end), 'Q')
      i = stop
      continue
    }
    if (c === "'" && shell !== 'cmd') {
      let j = i + 1
      let body = ''
      for (; j < s.length; j++) {
        if (s[j] === "'") {
          if (shell === 'powershell' && s[j + 1] === "'") {
            body += "'"
            j++
            continue
          }
          break
        }
        body += s[j]
      }
      add(body, 'Q')
      i = j + 1
      continue
    }
    if (c === '"') {
      const esc = shell === 'bash' ? '\\' : shell === 'powershell' ? '`' : ''
      let j = i + 1
      let body = ''
      for (; j < s.length && s[j] !== '"'; j++) {
        if (esc !== '' && s[j] === esc && j + 1 < s.length) {
          const e2 = s[j + 1] ?? ''
          body += shell === 'bash' && !'"\\$`\n'.includes(e2) ? `\\${e2}` : e2
          j++
          continue
        }
        body += s[j]
      }
      add(body, 'Q')
      i = j + 1
      continue
    }
    // ${VAR} は 1 語の中
    if (c === '$' && next === '{') {
      const end = s.indexOf('}', i)
      add(s.slice(i, end < 0 ? s.length : end + 1))
      i = end < 0 ? s.length : end + 1
      continue
    }
    if (c === '#' && !inWord && shell !== 'cmd') {
      const nl = s.indexOf('\n', i)
      i = nl < 0 ? s.length : nl
      continue
    }
    if (shell === 'powershell' && c === '<' && next === '#') {
      const end = s.indexOf('#>', i + 2)
      i = end < 0 ? s.length : end + 2
      continue
    }
    // bash のヒアドキュメント (<<EOF・<<-'EOF')。本文は次の改行の後で読む
    if (shell === 'bash' && c === '<' && next === '<' && s[i + 2] !== '<') {
      const m = /^<<-?\s*(['"]?)([\w.-]+)\1/.exec(s.slice(i))
      if (m) {
        endWord()
        heredocs.push({ tag: m[2] ?? '', into: seg })
        i += m[0].length
        continue
      }
    }
    if (c === '\n') {
      endSeg()
      i++
      for (const h of heredocs.splice(0)) {
        let body = ''
        while (i < s.length) {
          const nl = s.indexOf('\n', i)
          const line = s.slice(i, nl < 0 ? s.length : nl)
          i = nl < 0 ? s.length : nl + 1
          if (line.trim() === h.tag) break
          body += `${line}\n`
        }
        h.into.push({ text: body, bare: 'Q' })
      }
      continue
    }
    if (c === '`') {
      if (shell === 'powershell') {
        if (next === '\n' || next === '\r') endWord()
        else add(next)
        i += 2
        continue
      }
      if (shell === 'bash') {
        endSeg()
        i++
        continue
      }
    }
    if (c === '\\' && shell === 'bash' && ' \n"\'`$\\;&|()'.includes(next) && next !== '') {
      if (next === '\n') endWord()
      else add(next)
      i += 2
      continue
    }
    // $( ... ) は中身を別の区切りとして読み、外の語は 1 語のまま (X=$(mktemp -d) claude -p を切らない)
    if (c === '$' && next === '(') {
      let depth = 1
      let j = i + 2
      for (; j < s.length && depth > 0; j++) {
        if (s[j] === '(') depth++
        else if (s[j] === ')') depth--
      }
      segs.push(...parse(s.slice(i + 2, depth === 0 ? j - 1 : j), shell))
      add(s.slice(i, j), '$Q')
      i = j
      continue
    }
    if (';|&{}\n'.includes(c)) {
      endSeg()
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '(' || c === ')' || c === ',') {
      endWord()
      i++
      continue
    }
    add(c)
    i++
  }
  endSeg()
  return segs
}

// ── 見分け

/** 名前の頭 (パスと .exe などを落として小文字) */
export const baseName = (s: string) =>
  s
    .replace(/^.*[\\/]/, '')
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat|com|ps1)$/, '')

/** 設定の「a, b、c」を名前の並びにする */
export const listOf = (raw: unknown) =>
  String(raw ?? '')
    .split(/[,、\n]/)
    .map(x => baseName(x.trim()))
    .filter(x => x !== '')

// 頭に付いても中身は後ろのコマンド (env X=1 cmd、nohup cmd、then cmd、! cmd、xargs cmd など)
const PREFIX = new Set(['env', 'nohup', 'exec', 'time', 'command', 'sudo', 'nice', 'call', '.', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'xargs'])
// xargs の、値を後ろの語に取るオプション
const XARGS_VALUE = /^-[nILPdEsa]$/
// 文字や検索を出すだけのコマンド (grep Media.SoundPlayer src などを数えない)
const TEXTUAL = new Set(['echo', 'printf', 'write-host', 'write-output', 'write-verbose', 'grep', 'egrep', 'rg', 'select-string', 'sls', 'findstr', 'git', 'gh'])
const INFO = /^(?:--?version|-v|--?help|-h|-\?)$/i
const RUNNERS = new Set(['node', 'npx', 'deno', 'bun', 'bunx', 'tsx', 'python', 'python3', 'py', 'pytest', 'uv'])
const BROWSERS = new Set(['chrome', 'msedge', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'firefox'])
const PLAYERS = new Set(['ffplay', 'afplay', 'aplay', 'paplay', 'say'])
const CODE_INFO = /^--(?:version|list-extensions|install-extension|uninstall-extension|help|status|locate-shell-integration-path)$|^-[vh]$/i

// ── claude -p の隔離 (環境変数の状態)

/** 決めた CLAUDE_CONFIG_DIR・ANTHROPIC_BASE_URL の値 (決めていなければ undefined) と、CLAUDE_CODE_PLUGIN_DIRS を消したか */
export type Env = { configDir?: string; baseUrl?: string; pluginDirsGone: boolean }
export const NO_ENV: Env = { pluginDirsGone: false }

/** 変数を決める (value が undefined なら消す)。見張る 3 つのほかは何もしない */
function setVar(env: Env, name: string, value: string | undefined): Env {
  const v = value === '$null' ? '' : value
  const n = name.toUpperCase()
  if (n === 'CLAUDE_CONFIG_DIR') return { ...env, configDir: v }
  if (n === 'ANTHROPIC_BASE_URL') return { ...env, baseUrl: v }
  if (n === 'CLAUDE_CODE_PLUGIN_DIRS') return { ...env, pluginDirsGone: v === undefined || v === '' }
  return env
}

/** 本物の ~/.claude を指さない、空でない CLAUDE_CONFIG_DIR か */
const isOwnConfigDir = (v: string | undefined) => v !== undefined && v.trim() !== '' && !/(?:^|[\\/])\.claude[\\/]?$/i.test(v.trim())
/** モデルを呼ばない (この PC の中を指す) ANTHROPIC_BASE_URL か */
const isLocalUrl = (v: string | undefined) => v !== undefined && /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(v.trim())

/** claude -p を隔離して走らせる環境か。一時の CLAUDE_CONFIG_DIR・この PC の中の ANTHROPIC_BASE_URL・CLAUDE_CODE_PLUGIN_DIRS を消す、の 3 つ */
export const isIsolated = (env: Env) => isOwnConfigDir(env.configDir) && isLocalUrl(env.baseUrl) && env.pluginDirsGone

/**
 * 頭の VAR=値・前置き (env・nohup・then・xargs・timeout など)・PowerShell の $x = を飛ばした、コマンドの名前の位置。
 * local はこの区切りだけに効く環境 (VAR=値 cmd・env -u)、persist は後ろの区切りにも残る環境 ($env:X = ...)
 */
function headAt(words: Word[], shell: Shell, env: Env) {
  let local = env
  let persist = env
  let k = 0
  while (k < words.length) {
    const w = words[k]?.bare ?? ''
    const name = baseName(w)
    const ps = shell === 'powershell' ? /^\$(\w+(?::\w+)?)(?:=(.*))?$/s.exec(words[k]?.text ?? '') : null
    if (ps && (ps[2] !== undefined || words[k + 1]?.bare === '=')) {
      // $env:X = 値 は後ろにも残る。$p = New-Object ... は代入の後ろがコマンド
      const v = ps[2] ?? words[k + 2]?.text ?? ''
      const envName = /^env:(\w+)$/i.exec(ps[1] ?? '')?.[1]
      if (envName !== undefined) {
        local = setVar(local, envName, v)
        persist = setVar(persist, envName, v)
      }
      k += ps[2] !== undefined ? 1 : 2
    } else if (/^[A-Za-z_]\w*=/.test(w)) {
      const t = words[k]?.text ?? ''
      local = setVar(local, t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1))
      k++
    } else if (PREFIX.has(name)) {
      k++
      while (/^-/.test(words[k]?.bare ?? '')) {
        const o = words[k]?.text ?? ''
        if (name === 'env') {
          // env -u NAME・-uNAME・--unset=NAME・-i (全部消す)
          const m = /^(?:-u|--unset=?)(.*)$/.exec(o)
          if (m) {
            const target = m[1] === '' ? words[k + 1]?.text : m[1]
            local = setVar(local, target ?? '', undefined)
            k += m[1] === '' ? 2 : 1
            continue
          }
          if (o === '-i' || o === '-' || o === '--ignore-environment') local = { pluginDirsGone: true }
          k++
        } else if (name === 'xargs') k += XARGS_VALUE.test(o) ? 2 : 1
        else k += o === '-u' ? 2 : 1
      }
    } else if (name === 'timeout' && words.length > k + 1) {
      // timeout -s KILL -k 5 --preserve-status 10 cmd
      k++
      while (/^-/.test(words[k]?.text ?? '')) k += /^(?:-s|-k|--signal|--kill-after)$/.test(words[k]?.text ?? '') ? 2 : 1
      if (/^\d/.test(words[k]?.text ?? '')) k++
    } else break
  }
  return { at: k, local, persist }
}

/** その区切りが後ろに残す環境 (export X=…・unset X・Remove-Item Env:X) */
function persistOf(name: string, args: Word[], env: Env): Env {
  let out = env
  if (name === 'export') {
    for (const w of args) {
      if (!/^[A-Za-z_]\w*=/.test(w.bare)) continue
      out = setVar(out, w.text.slice(0, w.text.indexOf('=')), w.text.slice(w.text.indexOf('=') + 1))
    }
  } else if (name === 'unset') {
    for (const w of args) if (!/^-/.test(w.text)) out = setVar(out, w.text, undefined)
  } else if (['remove-item', 'ri', 'rm', 'del', 'erase'].includes(name)) {
    for (const w of args) {
      const m = /^env:[\\/]?(\w+)$/i.exec(w.text)
      if (m) out = setVar(out, m[1] ?? '', undefined)
    }
  }
  return out
}

const WINDOW_FIX = '開くと窓が出ます。開くのは依頼者に任せ、パスを伝えてください (中身を確かめるなら読むだけにする)'
const SOUND_FIX = '音を出さずに確かめてください (鳴らす処理は呼ばず、その手前の値や終了コードを見る)'
export const CLAUDE_FIX =
  '次の 3 つを同じコマンドで決めてから走らせてください。一時の CLAUDE_CONFIG_DIR (mktemp -d などの空のフォルダ。本物の ~/.claude に書かせない)、' +
  'CLAUDE_CODE_PLUGIN_DIRS を消す (bash は env -u CLAUDE_CODE_PLUGIN_DIRS、PowerShell は Remove-Item Env:CLAUDE_CODE_PLUGIN_DIRS)、' +
  'ANTHROPIC_BASE_URL=http://127.0.0.1:9 (モデルを呼ばない)'

const hasHidden = (args: Word[]) =>
  args.some((w, k) => {
    const m = /^-wi\w*(?::(.+))?$/i.exec(w.text)
    return m !== null && (m[1] ?? args[k + 1]?.text ?? '').toLowerCase() === 'hidden'
  })
const hasFlag = (args: Word[], re: RegExp) => args.some(w => re.test(w.text))
const hasDummyAudio = (args: Word[]) => args.some((w, k) => /^--audio-driver(?:=dummy)?$/i.test(w.text) && (/=dummy$/i.test(w.text) || (args[k + 1]?.text ?? '').toLowerCase() === 'dummy'))

/** -EncodedCommand の中身 (base64 の UTF-16LE)。ほどけなければ空 */
export function decodeEncoded(b64: string) {
  try {
    const bin = atob(b64)
    let s = ''
    for (let i = 0; i + 1 < bin.length; i += 2) s += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8))
    return s
  } catch {
    return ''
  }
}

/** powershell の -e・-ec・-en…(-EncodedCommand の頭) か (-ex は -ExecutionPolicy なので違う) */
const isEncodedFlag = (t: string) => {
  const m = /^[-/](\w+)$/.exec(t)
  const s = m?.[1]?.toLowerCase() ?? ''
  return s === 'e' || s === 'ec' || (s.length >= 2 && 'encodedcommand'.startsWith(s))
}

/** 入れ子のシェル (powershell -Command "...", -EncodedCommand ..., iex "...", cmd /c ..., bash -c "...") の中身と、そのシェル */
function innerOf(name: string, args: Word[]): { command: string; shell: Shell } | undefined {
  const after = (re: RegExp) => {
    const k = args.findIndex(w => re.test(w.text))
    return k < 0 ? undefined : args.slice(k + 1).map(w => w.text).join(' ')
  }
  if (name === 'powershell' || name === 'pwsh') {
    const enc = args.findIndex(w => isEncodedFlag(w.text))
    if (enc >= 0) return { command: decodeEncoded(args[enc + 1]?.text ?? ''), shell: 'powershell' }
    const command = after(/^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?:?$/i)
    return command === undefined ? undefined : { command, shell: 'powershell' }
  }
  if (name === 'iex' || name === 'invoke-expression') {
    return { command: args.filter(w => !/^-c(?:ommand)?:?$/i.test(w.text)).map(w => w.text).join(' '), shell: 'powershell' }
  }
  if (name === 'cmd') {
    const command = after(/^\/[ck]$/i)
    return command === undefined ? undefined : { command, shell: 'cmd' }
  }
  if (name === 'bash' || name === 'sh' || name === 'zsh') {
    const command = after(/^-\w*c$/)
    return command === undefined ? undefined : { command, shell: 'bash' }
  }
  return undefined
}

/** 1 つの区切りの中で見つけた物と、後ろの区切りに残す環境 */
function inSegment(words: Word[], shell: Shell, windowApps: readonly string[], env: Env, depth: number): { found: Found[]; env: Env } {
  const { at, local, persist } = headAt(words, shell, env)
  const head = words[at]
  if (head === undefined) return { found: [], env: persist }
  const name = baseName(head.text)
  const args = words.slice(at + 1)
  const after = persistOf(name, args, persist)
  return { found: findIn(head, name, args, shell, windowApps, local, depth), env: after }
}

const WINDOW_APPS = new Set(['notepad', 'mshta', 'xdg-open'])
const PYTHONS = /^(?:python[\d.]*w?|py|pythonw)$/
// playwright のうち窓を開くコマンド (codegen・open と、その別名 cr・ff・wk、記録や報告の表示)
const PLAYWRIGHT_WINDOW = /^(?:codegen|open|cr|ff|wk|show-trace|show-report)$/i
const CLAUDE_PKG = /^@anthropic-ai\/claude-code(?:@\S*)?$/i
const CLAUDE_SUB = new Set(['plugin', 'mcp'])
const PRINT = /^-[A-Za-z]*p|^--print(?:=|$)/

function findIn(head: Word, name: string, args: Word[], shell: Shell, windowApps: readonly string[], env: Env, depth: number): Found[] {
  const found: Found[] = []
  const win = (what: string, fix: string) => found.push({ group: 'window', what, fix })
  const snd = (what: string, fix: string) => found.push({ group: 'sound', what, fix })

  const inner = innerOf(name, args)
  if (inner && depth < 3) return classifyIn(inner.command, inner.shell, windowApps, env, depth + 1)

  if (windowApps.includes(name)) win(`${name} は窓のアプリ (設定 windowApps)`, '窓のアプリは自分で起動しないでください。確かめは自動テストか窓の出ないやり方にして、実画面は依頼者に頼んでください')
  const isInfo = hasFlag(args, INFO)

  if (name === 'start-process' || name === 'saps' || (name === 'start' && shell === 'powershell')) {
    if (!hasHidden(args)) win('Start-Process に -WindowStyle Hidden が無い', '-WindowStyle Hidden を付けてください (結果は -RedirectStandardOutput のファイルや -PassThru の終了コードで読む)')
  } else if (name === 'start') {
    win('start で新しい窓を開く', 'start / cmd /c start は新しい窓を開きます。start を付けずにそのまま走らせて結果を読むか、PowerShell の Start-Process -WindowStyle Hidden にしてください')
  }
  if (name === 'invoke-item' || (name === 'ii' && shell === 'powershell')) win('Invoke-Item でファイルを開く', WINDOW_FIX)
  if (name === 'explorer') win('explorer で窓を開く', WINDOW_FIX)
  if ((name === 'code' || name === 'code-insiders') && !hasFlag(args, CODE_INFO)) win('code で VS Code の窓を開く', WINDOW_FIX)
  if (BROWSERS.has(name) && !isInfo && !hasFlag(args, /^--?headless\b/i)) win(`${name} に --headless が無い`, '--headless=new を付けてください (firefox は --headless)')
  if (/^godot/.test(name) && !isInfo && !hasFlag(args, /^--headless$/i)) {
    win('godot に --headless が無い', '--headless を付けてください (窓も音も出ません)')
    if (!hasDummyAudio(args)) snd('godot に --audio-driver Dummy も --headless も無い', '--headless か --audio-driver Dummy を付けてください')
  }
  if (WINDOW_APPS.has(name)) win(`${name} で窓を開く`, WINDOW_FIX)
  if (name === 'rundll32') {
    if (hasFlag(args, /messagebeep/i)) snd('rundll32 の MessageBeep で音を鳴らす', SOUND_FIX)
    if (hasFlag(args, /^(?:FileProtocolHandler|OpenURL|ShellExec_RunDLL)$/i)) win('rundll32 でファイルや URL を開く', WINDOW_FIX)
  }
  const all = [head, ...args]
  const pw = all.findIndex(w => /(?:^|[\\/@])playwright(?:@\S*)?$/i.test(w.text))
  if (pw >= 0 || all.some(w => /playwright/i.test(w.text))) {
    if (hasFlag(all, /^--headed$/)) win('playwright を --headed で動かす', '--headed を外してください (headless で動かす)')
    if (hasFlag(all, /^--ui$/)) win('playwright を --ui で動かす', '--ui を外してください (headless で動かし、結果はレポートのファイルで読む)')
    if (pw >= 0 && PLAYWRIGHT_WINDOW.test(all[pw + 1]?.text ?? '')) win(`playwright ${all[pw + 1]?.text} で窓を開く`, WINDOW_FIX)
  }
  if (RUNNERS.has(name) && all.some(w => /\bheadless\s*[:=]\s*false\b/i.test(w.text))) win('ブラウザを headless: false で動かす', 'headless: true (Python は headless=True) にしてください')
  if ((PYTHONS.test(name) || name === 'uv') && all.some(w => /\bwinsound\b/.test(w.text))) snd('python の winsound で音を鳴らす', SOUND_FIX)

  if (PLAYERS.has(name) && !isInfo && !(name === 'aplay' && hasFlag(args, /^-[lL]$/))) {
    snd(`${name} で音を鳴らす`, name === 'say' ? SOUND_FIX : `${name} で鳴らさず、ffprobe か ffmpeg -i <file> -f null - で中身を確かめてください`)
  }
  if ((name === 'mpv' || name === 'vlc' || name === 'cvlc') && !isInfo && !hasFlag(args, /^(?:--no-audio|--ao=null|--aout=dummy)$/i)) snd(`${name} に --no-audio が無い`, '--no-audio を付けてください')
  if (!TEXTUAL.has(name)) {
    // .NET の型の名前は New-Object の引数なら引用符の中も見る
    const seen = all.map(w => (name === 'new-object' || name === 'add-type' ? w.text : w.bare)).join(' ')
    if (/\[(?:system\.)?console\]::beep\b/i.test(seen)) snd('[console]::Beep で音を鳴らす', SOUND_FIX)
    if (/\bmedia\.(?:soundplayer|systemsounds)\b/i.test(seen)) snd('SoundPlayer / SystemSounds で音を鳴らす', SOUND_FIX)
    if (/speechsynthesizer|\bsapi\.spvoice\b/i.test(seen)) snd('読み上げ (SpeechSynthesizer / SAPI) で声を出す', SOUND_FIX)
    if (/::playsound\b/i.test(seen)) snd('PlaySound で音を鳴らす', SOUND_FIX)
    if (/\[(?:system\.)?diagnostics\.process\]::start\b/i.test(seen)) win('[Diagnostics.Process]::Start で起動する', WINDOW_FIX)
  }

  // npx @anthropic-ai/claude-code -p も claude と同じ
  const pkg = (name === 'npx' || name === 'bunx' || name === 'pnpx') && args.find(w => !/^-/.test(w.text))
  const claudeArgs = name === 'claude' ? args : pkg && CLAUDE_PKG.test(pkg.text) ? args.slice(args.indexOf(pkg) + 1) : undefined
  if (claudeArgs && !hasFlag(claudeArgs, INFO) && !CLAUDE_SUB.has(claudeArgs[0]?.text ?? '') && hasFlag(claudeArgs, PRINT) && !isIsolated(env)) {
    found.push({ group: 'headless', what: 'claude -p を隔離なしで走らせる', fix: CLAUDE_FIX })
  }
  return found
}

/** 区切りを頭から順に見る。export X=… や $env:X = … は後ろの区切りにも効く */
function classifyIn(command: string, shell: Shell, windowApps: readonly string[], outer: Env, depth: number): Found[] {
  let env = outer
  const found: Found[] = []
  for (const ws of parse(command, shell)) {
    const r = inSegment(ws, shell, windowApps, env, depth)
    env = r.env
    found.push(...r.found)
  }
  return found
}

/**
 * コマンドの中の、窓を出す・音を鳴らす・隔離なしで claude -p を走らせる所の一覧 (同じ物は 1 つ)。
 * 文字列・コメント・ヒアドキュメントの中は数えない。windowApps は いつも窓とみなす名前
 */
export function classify(command: string, shell: 'bash' | 'powershell', windowApps: readonly string[] = []): Found[] {
  const found = classifyIn(command, shell, windowApps, NO_ENV, 0)
  return found.filter((f, k) => found.findIndex(x => x.what === f.what) === k)
}

// ── 記録の形 (store の 1 キー。知らない欄を残して書く)

export const EMPTY: RunSaved = { off: { window: false, sound: false, headless: false }, counts: { window: 0, sound: 0, headless: 0 }, log: [] }
const ACTIONS: readonly RunAction[] = ['blocked', 'asked-yes', 'asked-no', 'told']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/** この版が描ける記録の 1 件か (知らない action・group の行は描かないが、store には残す) */
export const isEntry = (v: unknown): v is RunEntry =>
  isObj(v) &&
  typeof v.at === 'number' &&
  typeof v.command === 'string' &&
  ACTIONS.includes(v.action as RunAction) &&
  Array.isArray(v.groups) &&
  v.groups.length > 0 &&
  v.groups.every(g => GROUPS.includes(g as RunGroup))

/** 表に出す記録。この版が描ける行だけ、新しい LOG_MAX 件 */
export const shownLog = (s: RunSaved) => s.log.filter(isEntry).slice(-LOG_MAX)

/**
 * store の生の値を読む。読めない所は既定にする。記録の行は物ならそのまま持つ
 * (知らない欄・知らない action の行も書き戻す。描く時に shownLog で濾す)
 */
export function fromRaw(raw: unknown): RunSaved {
  const o = isObj(raw) ? raw : {}
  const off = isObj(o.off) ? o.off : {}
  const counts = isObj(o.counts) ? o.counts : {}
  return {
    off: { window: off.window === true, sound: off.sound === true, headless: off.headless === true },
    counts: { window: num(counts.window), sound: num(counts.sound), headless: num(counts.headless) },
    log: Array.isArray(o.log) ? (o.log.filter(isObj) as RunEntry[]) : [],
  }
}

/** 書き戻してよい形か (無い・この形の物)。違えば書かない (書くと記録を消してしまう) */
export const isWritable = (raw: unknown) =>
  raw === undefined ||
  (isObj(raw) && (raw.off === undefined || isObj(raw.off)) && (raw.counts === undefined || isObj(raw.counts)) && (raw.log === undefined || Array.isArray(raw.log)))

/** raw のうち known に無い欄 (この版が知らない、新しい版が書いた物)。物でなければ空 */
export function unknownOf(raw: unknown, known: Iterable<string>): Record<string, unknown> {
  if (!isObj(raw)) return {}
  const k = new Set(known)
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !k.has(key)))
}

/** store に書く形。書く直前に読んだ raw の、この版の知らない欄 (入れ子の off・counts の中も) を残して mine を重ねる */
export function withUnknown(raw: unknown, mine: RunSaved): Record<string, unknown> {
  const o = isObj(raw) ? raw : {}
  return {
    ...unknownOf(o, Object.keys(EMPTY)),
    ...mine,
    off: { ...unknownOf(o.off, GROUPS), ...mine.off },
    counts: { ...unknownOf(o.counts, GROUPS), ...mine.counts },
  }
}

/** 記録に 1 件足す (数も足す) */
export function addEntry(s: RunSaved, entry: RunEntry): RunSaved {
  const counts = { ...s.counts }
  for (const g of entry.groups) counts[g] += 1
  return { ...s, counts, log: [...s.log, entry].slice(-LOG_MAX) }
}

/** コマンドの頭 (記録とペイン用。制御文字を落とす) */
export const headOf = (command: string) => short(clean(command.trim().split('\n')[0] ?? ''), 80)

// ── Claude と依頼者への文

export const YES = '実行する'
export const NO = 'やめる'

const bullets = (found: readonly Found[]) => found.map(f => `・${f.what}: ${f.fix}`).join('\n')
const groupsWord = (found: readonly Found[]) => [...new Set(found.map(f => GROUP_NAME[f.group]))].join('・')

/** その場で聞く文 */
export const askText = (found: readonly Found[], command: string) =>
  `確かめのための実行で、${groupsWord(found)}が出そうです。\n${found.map(f => `・${f.what}`).join('\n')}\n\n実行しますか？\n\n${short(command.trim(), 300)}`

/** 止めた時に Claude へ返す文 */
export function denyText(found: readonly Found[], outcome: 'blocked' | 'no-ask' | 'asked-no', answer = '') {
  const why =
    outcome === 'asked-no'
      ? `依頼者が実行しないと答えたので止めました${answer !== '' && answer !== NO ? ` (依頼者の返事:「${short(answer, 200)}」)` : ''}`
      : outcome === 'no-ask'
        ? '依頼者に聞けなかったので止めました'
        : '実行の前に止めました'
  return (
    `run-guard: ${why} (実行していません)。依頼者は同じ PC でゲームをしていることがあり、窓と音を出さない・claude を隔離なしで走らせない約束です。\n` +
    `${bullets(found)}\n` +
    '直したやり方で、もう一度実行してください。窓や音がどうしても要る時は依頼者に聞き、/runguard でそのグループを切ってもらってください。'
  )
}

/** 伝えるだけの時に、実行の結果の後ろに足す文 */
export const noteText = (found: readonly Found[]) =>
  `run-guard: 今の実行で${groupsWord(found)}が出たかもしれません。依頼者は同じ PC でゲームをしていることがあります。次からは次のやり方にしてください。\n${bullets(found)}`

// ── ペイン

export type Mode = '止める' | '聞く' | '伝えるだけ'
export const MODES: readonly Mode[] = ['止める', '聞く', '伝えるだけ']
export const modeOf = (raw: unknown): Mode => (MODES.includes(raw as Mode) ? (raw as Mode) : '止める')

const MODE_WORD: Record<Mode, string> = { 止める: '見つけたら実行の前に止めます', 聞く: '見つけたら実行してよいか聞きます', 伝えるだけ: '見つけたら実行の後で Claude に伝えます' }
const GROUP_COLOR = (g: RunGroup) => ({ window: C.blue, sound: C.yellow, headless: C.purple })[g]
const GROUP_TERM = (g: RunGroup) => ({ window: 'suggestion', sound: 'warning', headless: 'claude' })[g]
const ACTION: Record<RunAction, { word: string; color: () => string }> = {
  blocked: { word: '止めた', color: () => C.green },
  'asked-yes': { word: '聞いて通した', color: () => C.blue },
  'asked-no': { word: '聞いて止めた', color: () => C.green },
  told: { word: '伝えた', color: () => C.yellow },
}

/** 日本時間 (JST) の時:分 */
export const clock = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000)
  return [d.getUTCHours(), d.getUTCMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}
const groupsOf = (e: RunEntry) => e.groups.map(g => GROUP_NAME[g]).join('・')

export type PaneInput = { saved: RunSaved; mode: Mode }

/** ペインの SVG 1 枚。記録は新しい順に全部 (最大 50) */
export function paneSvg(i: PaneInput) {
  const { off, counts } = i.saved
  const log = shownLog(i.saved)
  const total = GROUPS.reduce((a, g) => a + counts[g], 0)
  const allOff = GROUPS.every(g => off[g])
  const accent = allOff ? C.dim : C.green
  let s = panel(8, 8, 364, 52)
  s += `<text x="20" y="32" font-size="15" font-weight="bold" fill="${accent}">${allOff ? '見張っていません' : '見張り中'}</text>`
  s += `<text x="20" y="50" font-size="12" fill="${C.dim}">${MODE_WORD[i.mode]}</text>`
  const y0 = 68
  s += panel(8, y0, 364, GROUPS.length * 30 + 12)
  GROUPS.forEach((g, n) => {
    const y = y0 + 10 + n * 30
    s += `<rect x="20" y="${y + 2}" width="4" height="18" rx="2" fill="${off[g] ? C.line : GROUP_COLOR(g)}"/>`
    s += `<text x="32" y="${y + 16}" font-size="13" font-weight="bold" fill="${off[g] ? C.dim : C.text}">${esc(GROUP_NAME[g])}</text>`
    s += `<text x="312" y="${y + 16}" font-size="12" text-anchor="end" fill="${off[g] ? C.dim : C.green}">${off[g] ? '切っています' : '見張り中'}</text>`
    s += `<text x="360" y="${y + 16}" font-size="13" font-weight="bold" text-anchor="end" fill="${C.text}">${counts[g]} 回</text>`
  })
  const rows = [...log].reverse()
  const y1 = y0 + GROUPS.length * 30 + 20
  const h = Math.max(1, rows.length) * 36 + 36
  s += panel(8, y1, 364, h)
  s += `<text x="20" y="${y1 + 22}" font-size="13" font-weight="bold" fill="${C.text}">最近の記録</text>`
  if (rows.length === 0) s += `<text x="20" y="${y1 + 50}" font-size="12" fill="${C.dim}">まだありません</text>`
  rows.forEach((e, n) => {
    const y = y1 + 36 + n * 36
    const a = ACTION[e.action]
    s += `<rect x="20" y="${y}" width="4" height="28" rx="2" fill="${GROUP_COLOR(e.groups[0] ?? 'window')}"/>`
    s += `<text x="32" y="${y + 12}" font-size="12" font-weight="bold" fill="${C.text}">${esc(short(groupsOf(e), 16))}</text>`
    s += `<text x="360" y="${y + 12}" font-size="11" text-anchor="end" fill="${a.color()}">${clock(e.at)} ${a.word}</text>`
    s += `<text x="32" y="${y + 26}" font-size="11" fill="${C.dim}">${esc(short(e.command, 44))}</text>`
  })
  return frame(HEADER_H + y1 + h + 8, header('窓と音の見張り', `${total} 回`, accent) + `<g transform="translate(0 ${HEADER_H})">${s}</g>`)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(i: PaneInput): Line[] {
  const { off, counts } = i.saved
  const log = shownLog(i.saved)
  const allOff = GROUPS.every(g => off[g])
  const lines: Line[] = [
    { text: allOff ? '見張っていません' : '見張り中', isBold: true, color: allOff ? undefined : 'success' },
    { text: MODE_WORD[i.mode], isDim: true },
  ]
  for (const g of GROUPS) lines.push({ text: `${GROUP_NAME[g]}: ${off[g] ? '切っています' : '見張り中'} ─ ${counts[g]} 回`, isDim: off[g] })
  lines.push({ text: '最近の記録', isBold: true })
  if (log.length === 0) lines.push({ text: 'まだありません', isDim: true })
  for (const e of [...log].reverse()) lines.push({ text: `${clock(e.at)} ${groupsOf(e)} ${ACTION[e.action].word} ─ ${clean(e.command)}`, color: GROUP_TERM(e.groups[0] ?? 'window') })
  return lines
}
