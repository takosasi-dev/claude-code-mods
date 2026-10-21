// 失敗の要約・まとめ方・SVG と terminal 用の行。どれも純関数(shots.mts が node で直に読む)
import type { FailEntry } from '../types'
import { C, W, clean, countUp, esc, fadeIn, frame, growBar, header, panel, short } from './style'

/** 覚えておく数 ($.store) */
export const KEEP = 200
/** 棒グラフに出す数 */
export const TOP = 6
/** 一覧に出す数 */
export const RECENT = 10

const JST = 9 * 3_600_000
/** JST の YYYY-MM-DD */
export const jstDay = (ms: number) => new Date(ms + JST).toISOString().slice(0, 10)
/** JST の時刻。今日でなければ月日も付ける */
export const when = (ms: number, now: number) => {
  const iso = new Date(ms + JST).toISOString()
  return jstDay(ms) === jstDay(now) ? iso.slice(11, 16) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
}

/** mcp__server__tool は最後の名前だけにする */
export const shortTool = (tool: string) => (tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool)

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

const SHELLS = new Set(['Bash', 'PowerShell'])
const FILE_TOOLS: Record<string, string> = { Read: 'file_path', Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

/**
 * コマンドの頭を正規化する。`cd x &&` などの移動と、頭の `A=1` の環境変数を飛ばし、
 * 実行する物の名前 (パスと .exe を落として小文字) と、それに続くサブコマンド 1 語。
 * 例: `cd app && NODE_ENV=test npx vitest run a.ts` は `npx vitest`
 */
export function commandHead(cmd: string): string {
  // ponytail: 引用符の中の && や | でも切れる。まとめる鍵がずれるだけ
  const segs = cmd
    .split(/&&|\|\||[;|\r\n]/)
    .map(s => clean(s))
    .filter(Boolean)
  const seg = segs.find(s => !/^(?:cd|pushd|popd|set-location|sl)(?:\s|$)/i.test(s)) ?? segs[0] ?? ''
  const words = seg.split(/\s+/).filter(Boolean)
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) words.shift()
  const exe = baseName((words[0] ?? '').replace(/^["'&]+|["']+$/g, ''))
    .replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
    .toLowerCase()
  const sub = words[1] ?? ''
  // サブコマンドらしい語だけ (フラグ・パス・数字・引用符は外す)
  return /^[A-Za-z][\w:-]*$/.test(sub) ? `${exe} ${sub}` : exe
}

/** ツールの入力から、一覧に出す要約とまとめる鍵 */
export function summarize(tool: string, input: Record<string, unknown>): { input: string; group: string } {
  const name = shortTool(tool)
  if (SHELLS.has(tool)) {
    const cmd = str(input.command)
    const head = commandHead(cmd)
    return { input: short(clean(cmd.split(/\r?\n/)[0] ?? ''), 60), group: head ? `${name} ${head}` : name }
  }
  const key = FILE_TOOLS[tool]
  if (key) {
    const file = clean(baseName(str(input[key])))
    return { input: file, group: file ? `${name} ${file}` : name }
  }
  // Grep・Glob は探した形、WebFetch は宛先の名前
  if (tool === 'Grep' || tool === 'Glob') return { input: short(clean(str(input.pattern)), 40), group: name }
  if (tool === 'WebFetch') {
    const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(str(input.url))?.[1] ?? ''
    const h = clean(host)
    return { input: h, group: h ? `${name} ${h}` : name }
  }
  return { input: '', group: name }
}

/**
 * エラーの 1 行目。<tool_use_error> の札は外す。`Exit code 1` だけの行なら次の行も付ける
 */
export function firstLine(text: string): string {
  const lines = text
    .replace(/<\/?tool_use_error>/g, '')
    .split(/\r?\n/)
    .map(l => clean(l))
    .filter(Boolean)
  let s = lines[0] ?? '(エラーの文がありません)'
  if (/^Exit code -?\d+$/i.test(s) && lines[1]) s = `${s}: ${lines[1]}`
  return short(s, 160)
}

/** $.store の値を確かめて読む。形の違う物は捨てる */
export function asEntries(v: unknown): FailEntry[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && typeof x.at === 'number' && typeof x.tool === 'string')
    .map(x => ({
      at: x.at as number,
      tool: clean(x.tool as string),
      input: clean(str(x.input)),
      error: clean(str(x.error)),
      group: clean(str(x.group)) || clean(x.tool as string),
      isSub: x.isSub === true,
    }))
    .slice(-KEEP)
}

export const asCount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined)

export type Group = { group: string; count: number; subs: number; last: number; error: string }

/** まとめた数の多い順。同じなら最近落ちた順 */
export function topGroups(entries: readonly FailEntry[]): Group[] {
  const by = new Map<string, Group>()
  for (const e of entries) {
    const g = by.get(e.group) ?? { group: e.group, count: 0, subs: 0, last: 0, error: '' }
    g.count++
    if (e.isSub) g.subs++
    if (e.at >= g.last) {
      g.last = e.at
      g.error = e.error
    }
    by.set(e.group, g)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.last - a.last)
}

// ponytail: 今日の数は残している 200 件から数える。1 日に 200 回より多く落ちると少なく出る
export const todayCount = (entries: readonly FailEntry[], now: number) => entries.filter(e => jstDay(e.at) === jstDay(now)).length

export const summaryText = (entries: readonly FailEntry[], total: number, now: number) =>
  `今日 ${todayCount(entries, now)} 件 通算 ${total} 件 種類 ${topGroups(entries).length}`

// 12px の文字のおおよその幅: 全角 12、半角 7
const wide = (ch: string) => /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
const widthOf = (s: string) => [...s].reduce((n, ch) => n + (wide(ch) ? 12 : 7), 0)
/** px に収まるように後ろを切る */
export function fit(s: string, px: number) {
  if (widthOf(s) <= px) return s
  let out = ''
  for (const ch of s) {
    if (widthOf(`${out}${ch}…`) > px) break
    out += ch
  }
  return `${out}…`
}

const txt = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra ? ` ${extra}` : ''}>${esc(s)}</text>`

export function failSvg(entries: readonly FailEntry[], total: number, now: number): string {
  const today = todayCount(entries, now)
  const subs = entries.filter(e => e.isSub).length
  const groups = topGroups(entries)
  let body = header('失敗の記録', groups.length ? `${groups.length} 種類` : '', C.red)

  // 今日・通算・サブの 3 枚
  const tiles: [string, number, string][] = [
    ['今日', today, today ? C.red : C.dim],
    ['通算', total, C.text],
    ['うちサブ (直近)', subs, subs ? C.purple : C.dim],
  ]
  tiles.forEach(([label, n, color], i) => {
    const x = 14 + i * 120
    body +=
      panel(x, 54, 112, 60) +
      txt(x + 10, 74, label, 12, C.dim) +
      countUp(n, `x="${x + 10}" y="104" font-size="24" font-weight="bold" fill="${color}"`, String, i * 0.08)
  })

  let y = 140
  if (groups.length === 0) {
    body += txt(16, y, 'まだ失敗はありません', 12, C.green)
    return frame(y + 16, body)
  }
  const shown = groups.slice(0, TOP)
  body += txt(16, y, 'よく落ちる物', 13, C.text, 'font-weight="bold"')
  body += txt(W - 16, y, `上位 ${shown.length} / ${groups.length}`, 12, C.dim, 'text-anchor="end"')
  y += 12
  const max = Math.max(1, ...shown.map(g => g.count))
  const BAR = W - 32
  shown.forEach((g, i) => {
    const w = (BAR * g.count) / max
    const subW = (BAR * g.subs) / max
    let row =
      txt(16, y + 14, fit(g.group, BAR - 60), 12, C.text) +
      txt(W - 16, y + 14, `${g.count}回`, 12, C.text, 'font-weight="bold" text-anchor="end"') +
      `<rect x="16" y="${y + 20}" width="${BAR}" height="8" rx="4" fill="${C.face}"/>` +
      growBar(16, y + 20, Number(w.toFixed(1)), 8, C.red, i * 0.06)
    if (g.subs > 0) row += growBar(16, y + 20, Number(subW.toFixed(1)), 8, C.purple, i * 0.06)
    body += fadeIn(row, i * 0.06)
    y += 34
  })
  // 凡例
  y += 6
  body +=
    `<rect x="16" y="${y}" width="11" height="11" rx="2" fill="${C.red}"/>` +
    txt(32, y + 10, 'メイン', 12, C.dim) +
    `<rect x="84" y="${y}" width="11" height="11" rx="2" fill="${C.purple}"/>` +
    txt(100, y + 10, 'サブエージェント', 12, C.dim) +
    txt(W - 16, y + 10, `直近 ${entries.length} 件から`, 12, C.dim, 'text-anchor="end"')
  return frame(y + 22, body)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** terminal 用: 数と、よく落ちる物 */
export function failLines(entries: readonly FailEntry[], total: number, now: number): Line[] {
  const out: Line[] = [{ text: summaryText(entries, total, now), isBold: true }]
  const groups = topGroups(entries)
  if (groups.length === 0) return [...out, { text: 'まだ失敗はありません', color: 'green' }]
  out.push({ text: 'よく落ちる物', isBold: true })
  for (const g of groups.slice(0, TOP)) out.push({ text: `${String(g.count).padStart(3)}回 ${g.group}${g.subs ? ` (サブ ${g.subs})` : ''}`, color: 'red' })
  return out
}

/** 一覧の 1 件の見出し */
export const recentHead = (e: FailEntry, now: number) =>
  `${when(e.at, now)} ${shortTool(e.tool)}${e.input ? ` ${e.input}` : ''}${e.isSub ? ' (サブ)' : ''}`
