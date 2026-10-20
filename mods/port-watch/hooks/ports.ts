// 待ち受けているポートの一覧を読み、ペインの SVG と行を組む。どれも純関数
import type { PortWatchRow } from '../types'
import { C, HEADER_H, countUp, frame, header } from './style'

/** 制御文字を落とす。エンジンは制御文字を含む Text・alt を描かない */
export const plain = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
export const cut = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s)

/** cwd が `X:\` か `\\server\` の形なら Windows */
export const isWindowsCwd = (cwd: string) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(cwd)

export const rowKey = (r: { port: number; pid: number }) => `${r.port}/${r.pid}`

// 数字だけ。0 は無い PID、桁あふれも受けない
const toPid = (s: string | undefined) => (s !== undefined && /^\d{1,10}$/.test(s) && Number(s) > 0 ? Number(s) : undefined)
const portOf = (addr: string) => {
  const m = /:(\d{1,5})$/.exec(addr)
  const n = m ? Number(m[1]) : NaN
  return n > 0 && n < 65536 ? n : undefined
}

/**
 * `netstat -ano` の TCP の LISTENING の行。見出しは言語で変わる (日本語は化ける) ので、行頭が TCP の行だけ読む。
 * v6 の行も同じ TCP で出る
 */
export function parseNetstat(out: string): { port: number; pid: number }[] {
  const rows: { port: number; pid: number }[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+)\s+\S+\s+LISTEN\w*\s+(\d+)\s*$/i.exec(line)
    if (!m) continue
    const port = portOf(m[1] ?? '')
    const pid = toPid(m[2])
    if (port !== undefined && pid !== undefined) rows.push({ port, pid })
  }
  return rows
}

/** `tasklist /FO CSV /NH` から PID → 名前。メモリの欄に , が入るので " で区切る */
export function parseTasklist(out: string) {
  const names = new Map<number, string>()
  for (const line of out.split(/\r?\n/)) {
    const f = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => (m[1] ?? '').replace(/""/g, '"'))
    const pid = toPid(f[1])
    if (f[0] && pid !== undefined) names.set(pid, f[0])
  }
  return names
}

/** `lsof -nP -iTCP -sTCP:LISTEN` の行。名前は COMMAND 欄 (lsof は空白を \x20 にする) */
export function parseLsof(out: string): PortWatchRow[] {
  const rows: PortWatchRow[] = []
  for (const line of out.split(/\r?\n/).slice(1)) {
    const f = line.trim().split(/\s+/)
    if (f[f.length - 1] !== '(LISTEN)') continue
    const port = portOf(f[f.length - 2] ?? '')
    const pid = toPid(f[1])
    if (port !== undefined && pid !== undefined) rows.push({ port, pid, name: (f[0] ?? '').replace(/\\x20/g, ' ') })
  }
  return rows
}

/** 同じポートと PID をまとめ、ポートの順に。名前は制御文字を落として 40 字まで */
export function mergeRows(rows: PortWatchRow[]): PortWatchRow[] {
  const map = new Map<string, PortWatchRow>()
  for (const r of rows) if (!map.has(rowKey(r))) map.set(rowKey(r), { ...r, name: cut(plain(r.name), 40) || '?' })
  return [...map.values()].sort((a, b) => a.port - b.port || a.pid - b.pid)
}

/** 開発用の実行環境。拡張子 .exe と末尾の版 (python3.11 など) は外して比べる */
const DEV = new Set([
  'node', 'nodejs', 'python', 'py', 'pythonw', 'deno', 'bun', 'ruby', 'java', 'dotnet', 'php', 'go',
  'uvicorn', 'gunicorn', 'hypercorn', 'rails', 'puma', 'npm', 'pnpm', 'yarn',
])
export const baseName = (name: string) => name.toLowerCase().replace(/\.exe$/, '').replace(/[\d.]+$/, '')

/** 「止める」を付けてよい行: 開発用の実行環境で、ポートが 1024 以上 */
export const canStop = (r: PortWatchRow) => r.port >= 1024 && DEV.has(baseName(r.name))

/** 止めるコマンド。PID が数字でなければ undefined */
export function stopArgv(isWindows: boolean, pid: number): string[] | undefined {
  const s = String(pid)
  if (!/^\d{1,10}$/.test(s) || pid <= 0) return undefined
  return isWindows ? ['taskkill', '/PID', s, '/T', '/F'] : ['kill', s]
}

export type Counts = { all: number; added: number; dev: number }

export const countsOf = (rows: PortWatchRow[], baseline: string[] | null): Counts => ({
  all: rows.length,
  added: baseline ? rows.filter(r => !baseline.includes(rowKey(r))).length : 0,
  dev: rows.filter(canStop).length,
})

const TILE_Y = HEADER_H + 8

function tile(x: number, label: string, value: number, color: string, delay: number) {
  const y = TILE_Y
  return (
    `<rect x="${x}" y="${y}" width="116" height="66" rx="6" fill="${C.face}" stroke="${C.line}"/>` +
    `<rect x="${x}" y="${y}" width="3" height="66" rx="1.5" fill="${color}"/>` +
    `<text x="${x + 12}" y="${y + 20}" font-size="12" fill="${C.dim}">${label}</text>` +
    countUp(value, `x="${x + 12}" y="${y + 54}" font-size="28" font-weight="bold" fill="${value > 0 ? color : C.dim}"`, String, delay)
  )
}

/**
 * 上のタイル。見張りの印はゆっくり脈打つ。時刻を含めないので、数が変わらなければ source も変わらず、
 * 数が増える動きも数が変わった時だけ走る
 */
export function tilesSvg(c: Counts, isError: boolean) {
  // 見出しの右の「5 秒ごと」の左に置く
  const cx = 296
  const pulse = isError
    ? `<circle cx="${cx}" cy="23" r="5" fill="${C.orange}"/>`
    : `<circle cx="${cx}" cy="23" r="5" fill="${C.green}"/>` +
      `<circle cx="${cx}" cy="23" r="5" fill="none" stroke="${C.green}" stroke-width="2">` +
      `<animate attributeName="r" values="5;12" dur="2.5s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0.8;0" dur="2.5s" repeatCount="indefinite"/></circle>`
  return frame(
    TILE_Y + 66 + 10,
    header(isError ? '一覧を読めません' : '待ち受けているポート', '5 秒ごと', isError ? C.orange : C.green) +
      pulse +
      tile(12, '待ち受け', c.all, C.blue, 0.1) +
      tile(132, '今回増えた', c.added, C.yellow, 0.2) +
      tile(252, '開発用', c.dev, C.green, 0.3),
  )
}

export const summaryOf = (c: Counts) => `待ち受け ${c.all} / 増えた ${c.added} / 開発用 ${c.dev}`
