// テストの出力を読み、ペインの SVG と terminal 用の行を組む。どれも純関数
import type { TestRunnerMark, TestRunnerResult, TestRunnerRun, TestRunnerStatus } from '../types'

const C = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  weak: '#8b949e',
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
}
const W = 380
const MONO = 'ui-monospace, Consolas, monospace'
export const HISTORY = 20
export const TAIL_LINES = 60

export const UNSET_HINT = '未設定。/config で test-runner の testCommand に npm test のように入れてください'

/** 空白で区切って argv にする (シェルは通さない) */
export const splitCommand = (s: string) => s.trim().split(/\s+/).filter(Boolean)

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const clean = (out: string) => out.replace(ANSI, '').replace(/\r(?!\n)/g, '\n').split(/\r?\n/)

/** 出力の末尾 n 行 (色の制御文字と末尾の空行は落とす) */
export function tailOf(out: string, n = TAIL_LINES) {
  const lines = clean(out)
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
  return lines.slice(-n).join('\n')
}

const num = (re: RegExp, s: string) => {
  const m = re.exec(s)
  return m ? Number(m[1]) : undefined
}
const PASSED = /(\d+) (?:passed|passing)\b/
const FAILED = /(\d+) (?:failed|failing)\b/

/**
 * 出力から通過・失敗の数を拾う。拾えなければ空。
 * jest / vitest / pytest / mocha は最後の「N passed」「N failed」の行、cargo は「test result:」の行の合計、
 * node --test は「# pass N」「# fail N」、go test -v は「--- PASS」「--- FAIL」の行の数
 */
export function countResults(out: string): { passed?: number; failed?: number } {
  const lines = clean(out)
  const cargo = lines.filter(l => /^test result: /.test(l))
  if (cargo.length > 0) {
    return {
      passed: cargo.reduce((n, l) => n + (num(PASSED, l) ?? 0), 0),
      failed: cargo.reduce((n, l) => n + (num(FAILED, l) ?? 0), 0),
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i] ?? ''
    let passed = num(PASSED, l)
    let failed = num(FAILED, l)
    if (passed === undefined && failed === undefined) continue
    // mocha は「3 passing」と「1 failing」が別の行。すぐ上の数行から足りない方を探す
    for (const near of lines.slice(Math.max(0, i - 3), i)) {
      passed ??= num(PASSED, near)
      failed ??= num(FAILED, near)
    }
    return { passed: passed ?? 0, failed: failed ?? 0 }
  }
  const tapPass = lines.map(l => num(/^# pass (\d+)/, l)).find(n => n !== undefined)
  const tapFail = lines.map(l => num(/^# fail (\d+)/, l)).find(n => n !== undefined)
  if (tapPass !== undefined || tapFail !== undefined) return { passed: tapPass ?? 0, failed: tapFail ?? 0 }
  const goPass = lines.filter(l => /^\s*--- PASS: /.test(l)).length
  const goFail = lines.filter(l => /^\s*--- FAIL: /.test(l)).length
  if (goPass + goFail > 0) return { passed: goPass, failed: goFail }
  return {}
}

/** 終わり方から状態を決める */
export const statusOf = (exitCode: number | null, stoppedBy: 'user' | 'timeout' | undefined): TestRunnerStatus =>
  stoppedBy === 'user' ? 'stopped' : stoppedBy === 'timeout' ? 'timeout' : exitCode === 0 ? 'pass' : 'fail'

/** 「この失敗を直して」で入力欄に入れる文 */
export function fixPrompt(r: TestRunnerResult) {
  const how = r.status === 'timeout' ? '時間の上限を過ぎて止まりました' : `失敗しました(終了コード ${r.exitCode})`
  return (
    `テストのコマンド \`${r.command}\` が${how}。出力の末尾は次のとおりです。\n\n` +
    '```\n' +
    r.tail +
    '\n```\n\n' +
    '原因を調べて直してください。直したらもう一度テストを走らせて確かめてください。'
  )
}

export const seconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)} 秒` : ms < 120_000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`)

export const clockLabel = (ms: number) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

const LABEL: Record<TestRunnerStatus, string> = { pass: '通過', fail: '失敗', stopped: '止めました', timeout: '時間切れ' }
const COLOR: Record<TestRunnerStatus, string> = { pass: C.green, fail: C.red, stopped: C.weak, timeout: C.red }
const MARK: Record<TestRunnerStatus, string> = { pass: '●', fail: '■', stopped: '○', timeout: '■' }

// 全角は 2、半角は 1 と数えた幅で、頭を残して末尾を … にする
const wide = (ch: string) => /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
export function headFit(s: string, max: number) {
  if ([...s].reduce((n, ch) => n + (wide(ch) ? 2 : 1), 0) <= max) return s
  let out = ''
  let n = 1
  for (const ch of s) {
    n += wide(ch) ? 2 : 1
    if (n > max) break
    out += ch
  }
  return `${out}…`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const svgDoc = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<defs><radialGradient id="shine" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
  `<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter></defs>` +
  `<rect width="${W}" height="${h}" fill="${C.bg}"/>${body}</svg>`

type Lamp = 'red' | 'yellow' | 'green' | 'none'

/** 信号機。点いている灯だけ色とにじみを付け、実行中の黄色は明滅させる */
function signal(lit: Lamp, isBlinking: boolean) {
  let s =
    `<rect x="40" y="200" width="12" height="20" fill="${C.line}"/>` +
    `<rect x="16" y="16" width="60" height="186" rx="14" fill="${C.face}" stroke="${C.line}" stroke-width="2"/>`
  const lamps: [Lamp, string, number][] = [
    ['red', C.red, 50],
    ['yellow', C.yellow, 109],
    ['green', C.green, 168],
  ]
  for (const [name, color, cy] of lamps) {
    s += `<rect x="20" y="${cy - 28}" width="52" height="8" rx="3" fill="${C.bg}" opacity="0.8"/>`
    if (name !== lit) {
      s += `<circle cx="46" cy="${cy}" r="21" fill="${C.bg}" stroke="${C.line}"/><circle cx="46" cy="${cy}" r="21" fill="${color}" opacity="0.12"/>`
      continue
    }
    const blink = isBlinking ? `<animate attributeName="opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite"/>` : ''
    s +=
      `<g>${blink}<circle cx="46" cy="${cy}" r="24" fill="${color}" opacity="0.7" filter="url(#glow)"/>` +
      `<circle cx="46" cy="${cy}" r="21" fill="${color}"/><circle cx="46" cy="${cy}" r="21" fill="url(#shine)"/></g>`
  }
  return s
}

/** 回るスピナー (SMIL) */
const spinner = (cx: number, cy: number) =>
  `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${C.line}" stroke-width="3"/>` +
  `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${C.yellow}" stroke-width="3" stroke-linecap="round" stroke-dasharray="18 46">` +
  `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="0.9s" repeatCount="indefinite"/></circle>`

function tile(x: number, label: string, value: string, color: string) {
  return (
    `<rect x="${x}" y="86" width="128" height="60" rx="6" fill="${C.bg}" stroke="${C.line}"/>` +
    `<rect x="${x}" y="86" width="3" height="60" rx="1.5" fill="${color}"/>` +
    `<text x="${x + 12}" y="104" font-size="12" fill="${C.weak}">${label}</text>` +
    `<text x="${x + 12}" y="136" font-size="${value.length > 5 ? 20 : 26}" font-weight="bold" fill="${color}">${esc(value)}</text>`
  )
}

/** 上の札: 信号・状態・コマンド・数・所要時間 */
function headCard(run: TestRunnerRun, command: string) {
  let s = `<rect x="8" y="8" width="364" height="220" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  const R = 96
  if (run.kind === 'running') {
    s += signal('yellow', true)
    s += `<text x="${R}" y="44" font-size="24" font-weight="bold" fill="${C.yellow}">実行中</text>` + spinner(R + 98, 36)
    s += `<text x="${R}" y="68" font-size="12" font-family="${MONO}" fill="${C.weak}">${esc(headFit(run.command, 40))}</text>`
    s += `<text x="${R}" y="104" font-size="13" fill="${C.text}">開始 ${clockLabel(run.startedAt)}</text>`
    s += `<text x="${R}" y="128" font-size="12" fill="${C.weak}">終わると結果をここに出します</text>`
    s += `<text x="${R}" y="148" font-size="12" fill="${C.weak}">「止める」で途中で止められます</text>`
    return s
  }
  if (run.kind === 'error') {
    s += signal('red', false)
    s += `<text x="${R}" y="44" font-size="20" font-weight="bold" fill="${C.red}">起動できません</text>`
    s += `<text x="${R}" y="68" font-size="12" font-family="${MONO}" fill="${C.weak}">${esc(headFit(run.command, 40))}</text>`
    const words = run.message.match(/.{1,36}/g) ?? []
    words.slice(0, 5).forEach((w, i) => (s += `<text x="${R}" y="${96 + i * 18}" font-size="12" fill="${C.text}">${esc(w)}</text>`))
    s += `<text x="${R}" y="204" font-size="12" fill="${C.weak}">コマンドの綴りを確かめてください</text>`
    return s
  }
  if (run.kind === 'idle') {
    s += signal('none', false)
    const isUnset = command === ''
    s += `<text x="${R}" y="44" font-size="24" font-weight="bold" fill="${C.weak}">${isUnset ? '未設定' : '未実行'}</text>`
    if (isUnset) {
      ;['/config で test-runner の', 'testCommand に', 'npm test のように', '入れてください'].forEach(
        (w, i) => (s += `<text x="${R}" y="${76 + i * 20}" font-size="13" fill="${C.text}">${w}</text>`),
      )
    } else {
      s += `<text x="${R}" y="68" font-size="12" font-family="${MONO}" fill="${C.weak}">${esc(headFit(command, 40))}</text>`
      s += `<text x="${R}" y="104" font-size="13" fill="${C.text}">「テストを走らせる」で始めます</text>`
    }
    return s
  }
  const r = run.result
  const color = COLOR[r.status]
  s += signal(r.status === 'pass' ? 'green' : r.status === 'stopped' ? 'none' : 'red', false)
  s += `<text x="${R}" y="44" font-size="24" font-weight="bold" fill="${color}">${LABEL[r.status]}</text>`
  s += `<text x="${R}" y="68" font-size="12" font-family="${MONO}" fill="${C.weak}">${esc(headFit(r.command, 40))}</text>`
  const has = r.passed !== undefined || r.failed !== undefined
  s += tile(R, '通過', has ? String(r.passed ?? 0) : '─', C.green)
  s += tile(R + 140, '失敗', has ? String(r.failed ?? 0) : '─', r.failed ? C.red : C.weak)
  s += `<text x="${R}" y="174" font-size="13" fill="${C.text}">所要 ${seconds(r.ms)}</text>`
  s += `<text x="${R}" y="196" font-size="12" fill="${C.weak}">終了コード ${r.exitCode ?? '─'} / ${clockLabel(r.finishedAt)}</text>`
  if (!has) s += `<text x="${R}" y="216" font-size="12" fill="${C.weak}">数は出力から拾えませんでした</text>`
  return s
}

/** 下の札: 直近 20 回の信号の丸と所要時間の棒。右が新しい */
function historyCard(history: TestRunnerMark[], y0: number) {
  const pass = history.filter(h => h.status === 'pass').length
  let s = `<rect x="8" y="${y0}" width="364" height="138" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  s += `<text x="20" y="${y0 + 24}" font-size="13" font-weight="bold" fill="${C.text}">直近 ${HISTORY} 回</text>`
  s +=
    `<text x="360" y="${y0 + 24}" font-size="12" text-anchor="end">` +
    `<tspan fill="${C.green}">通過 ${pass}</tspan><tspan dx="8" fill="${C.weak}">/ ${history.length} 回</tspan></text>`
  const step = 340 / HISTORY
  const base = y0 + 88
  const max = Math.max(1, ...history.map(h => h.ms))
  s += `<line x1="20" y1="${base}" x2="360" y2="${base}" stroke="${C.line}"/>`
  const pad = HISTORY - history.length
  for (let i = 0; i < HISTORY; i++) {
    const cx = 20 + step * i + step / 2
    const h = history[i - pad]
    if (!h) {
      s += `<circle cx="${cx}" cy="${base + 18}" r="6" fill="none" stroke="${C.line}" stroke-dasharray="2 2"/>`
      continue
    }
    const color = COLOR[h.status]
    const bh = Math.max(3, (h.ms / max) * 48)
    const isNewest = i === HISTORY - 1
    const grow = isNewest
      ? `<animate attributeName="height" from="0" to="${bh}" dur="0.6s" fill="freeze"/><animate attributeName="y" from="${base}" to="${base - bh}" dur="0.6s" fill="freeze"/>`
      : ''
    s += `<rect x="${cx - 5}" y="${base - bh}" width="10" height="${bh}" rx="2" fill="${color}" opacity="0.55">${grow}</rect>`
    s += h.status === 'stopped'
      ? `<circle cx="${cx}" cy="${base + 18}" r="6" fill="none" stroke="${color}" stroke-width="2"/>`
      : `<circle cx="${cx}" cy="${base + 18}" r="6.5" fill="${color}"/>`
    if (isNewest) s += `<circle cx="${cx}" cy="${base + 18}" r="9.5" fill="none" stroke="${C.text}" stroke-width="1"/>`
  }
  s += `<text x="20" y="${y0 + 128}" font-size="12" fill="${C.weak}">古い</text>`
  s += `<text x="360" y="${y0 + 128}" font-size="12" fill="${C.weak}" text-anchor="end">新しい ─ 棒は所要時間</text>`
  return s
}

/** ペインに出す SVG 1 枚 */
export function paneSvg(run: TestRunnerRun, history: TestRunnerMark[], command: string) {
  return svgDoc(382, headCard(run, command) + historyCard(history, 236))
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(run: TestRunnerRun, history: TestRunnerMark[], command: string): Line[] {
  const lines: Line[] = []
  if (run.kind === 'idle') {
    if (command === '') lines.push({ text: UNSET_HINT, color: 'yellow' })
    else lines.push({ text: '未実行', isBold: true }, { text: command, isDim: true })
  } else if (run.kind === 'running') {
    lines.push({ text: `実行中 (開始 ${clockLabel(run.startedAt)})`, color: 'yellow', isBold: true }, { text: run.command, isDim: true })
  } else if (run.kind === 'error') {
    lines.push({ text: `起動できません: ${run.message}`, color: 'red' }, { text: run.command, isDim: true })
  } else {
    const r = run.result
    const color = r.status === 'pass' ? 'green' : r.status === 'stopped' ? undefined : 'red'
    lines.push({ text: `${LABEL[r.status]} / 所要 ${seconds(r.ms)} / 終了コード ${r.exitCode ?? '─'}`, color, isBold: true })
    if (r.passed !== undefined || r.failed !== undefined) lines.push({ text: `通過 ${r.passed ?? 0} / 失敗 ${r.failed ?? 0}` })
    lines.push({ text: r.command, isDim: true })
  }
  if (history.length > 0) lines.push({ text: `直近 ${history.map(h => MARK[h.status]).join('')} (● 通過 / ■ 失敗 / ○ 中断)`, isDim: true })
  return lines
}
