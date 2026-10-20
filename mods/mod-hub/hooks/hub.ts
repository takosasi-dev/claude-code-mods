// 一覧の組み立てとヘッダーの SVG。$ に触らない純関数だけ置く
import type { ModHubCommand, ModHubMod, ModHubSort } from '../types'

export const SELF = 'mod-hub'
export const REFUSE = 'mod-hub でオフにされています'

export type Kind = 'pane' | 'display' | 'tool' | 'prompt' | 'turn' | 'manage' | 'command' | 'other' | 'unknown'

export const KINDS: readonly { kind: Kind; label: string; color: string }[] = [
  { kind: 'pane', label: 'ペイン', color: '#58a6ff' },
  { kind: 'display', label: '帯・枠', color: '#bc8cff' },
  { kind: 'tool', label: 'ツール監視', color: '#f78166' },
  { kind: 'prompt', label: 'プロンプト', color: '#d29922' },
  { kind: 'turn', label: 'ターン監視', color: '#3fb950' },
  { kind: 'manage', label: '管理', color: '#f85149' },
  { kind: 'command', label: 'コマンド', color: '#8b949e' },
  { kind: 'other', label: '裏方', color: '#6e7681' },
  { kind: 'unknown', label: '不明', color: '#484f58' },
]

export const kindInfo = (kind: Kind) => KINDS.find(k => k.kind === kind) ?? KINDS[KINDS.length - 1]!

/** uses から主な種類を 1 つ決める (上にあるほど優先) */
export function kindOf(events: readonly string[], calls: readonly string[]): Kind {
  if (calls.includes('ui.open')) return 'pane'
  if (events.includes('plugin.register')) return 'manage'
  if (events.includes('ui.render')) return 'display'
  if (events.some(e => e.startsWith('tool.'))) return 'tool'
  if (events.some(e => e.startsWith('prompt.'))) return 'prompt'
  if (events.some(e => e.startsWith('turn.') || e === 'session.append')) return 'turn'
  if (calls.includes('command.register')) return 'command'
  return 'other'
}

const EVENT_LABELS: Record<string, string> = {
  'ui.render': '描画',
  'tool.call': 'ツール呼び出し',
  'tool.check': 'ツールの許可',
  'tool.describe': 'ツールの説明',
  'prompt.submit': 'プロンプト送信',
  'prompt.mention': 'メンション',
  'turn.start': 'ターン開始',
  'turn.step': 'モデル呼び出し',
  'turn.complete': 'ターン終わり',
  'session.append': '会話の記録',
  'session.end': '終了時',
  'plugin.register': 'mod の読み込み',
  'config.set': '設定の変更',
  'agent.spawn': 'サブエージェント',
  'skill.prompt': 'スキル',
  '*': '全イベント',
}
// どの mod にもある配管なので要約に出さない
const PLUMBING = new Set(['session.start', 'command.run', 'ui.press', 'ui.input', 'ui.select', 'ui.focus'])
const CALL_LABELS: Record<string, string> = {
  'process.run': '外部コマンド',
  'process.spawn': '外部コマンド',
  'fs.read': 'ファイル読み',
  'fs.list': 'ファイル読み',
  'fs.write': 'ファイル書き込み',
  'http.fetch': '通信',
  'model.complete': 'モデルで要約',
  'model.fork': 'モデルで要約',
}

/** 何をフックしているかの短い言葉 (重複なし) */
export function usesSummary(events: readonly string[], calls: readonly string[]): string[] {
  const out = [
    ...events.filter(e => !PLUMBING.has(e)).map(e => EVENT_LABELS[e] ?? e),
    ...calls.map(c => CALL_LABELS[c]).filter((c): c is string => c !== undefined),
  ]
  return [...new Set(out)]
}

/** provenance の @ の後ろを「どこから」の言葉に */
export function sourceLabel(provenance: string): string {
  const at = provenance.lastIndexOf('@')
  if (at < 0) return '不明'
  const src = provenance.slice(at + 1)
  if (src === 'inline') return 'フォルダ'
  if (src === 'builtin') return '組み込み'
  return `${src} から`
}

export const isBuiltin = (name: string, provenance: string) => name.startsWith('cc-plugin-') || provenance.endsWith('@builtin')

const baseName = (plugin: string) => plugin.split('@')[0] ?? plugin

export type Status = 'self' | 'early' | 'on' | 'off' | 'off-next' | 'on-next'

export const STATUS: Record<Status, { label: string; color: string }> = {
  self: { label: 'この mod', color: '#58a6ff' },
  early: { label: '先に読み込み済み', color: '#8b949e' },
  on: { label: '動作中', color: '#3fb950' },
  off: { label: 'オフ', color: '#f85149' },
  'off-next': { label: '次の起動からオフ', color: '#d29922' },
  'on-next': { label: '次の起動からオン', color: '#d29922' },
}

export type Row = {
  name: string
  version: string
  /** 先に読み込まれた mod はコマンドの plugin 名 (分かる範囲) */
  provenance: string
  kind: Kind
  uses: string[]
  commands: ModHubCommand[]
  status: Status
  isBuiltin: boolean
}

// mod-hub 自身の uses (自分の plugin.register は見えないので手で書く)
const SELF_EVENTS = ['plugin.register', 'session.start', 'command.run', 'ui.render']
const SELF_CALLS = ['command.list', 'command.register', 'command.run', 'store.get', 'store.set', 'ui.open']

/** plugin.register で見えた物・コマンドだけ見えた物・自分を 1 本の一覧に */
export function buildRows(mods: readonly ModHubMod[], commands: readonly ModHubCommand[], off: readonly string[]): Row[] {
  const byName = new Map(mods.map(m => [m.name, m]))
  const names = new Set([SELF, ...mods.map(m => m.name), ...commands.map(c => baseName(c.plugin))])
  return [...names].map(name => {
    const m = byName.get(name)
    const cmds = commands.filter(c => baseName(c.plugin) === name)
    const isOff = off.includes(name)
    if (name === SELF) {
      return { name, version: m?.version ?? '', provenance: m?.provenance ?? '', kind: kindOf(SELF_EVENTS, SELF_CALLS), uses: usesSummary(SELF_EVENTS, SELF_CALLS), commands: cmds, status: 'self', isBuiltin: false }
    }
    if (!m) {
      const provenance = cmds.find(c => c.plugin.includes('@'))?.plugin ?? ''
      return { name, version: '', provenance, kind: 'unknown', uses: [], commands: cmds, status: 'early', isBuiltin: isBuiltin(name, provenance) }
    }
    const status: Status = m.isRefused ? (isOff ? 'off' : 'on-next') : isOff ? 'off-next' : 'on'
    return { name, version: m.version, provenance: m.provenance, kind: kindOf(m.events, m.calls), uses: usesSummary(m.events, m.calls), commands: cmds, status, isBuiltin: isBuiltin(name, m.provenance) }
  })
}

/** 絞り込みと並び替え */
export function arrange(rows: readonly Row[], sort: ModHubSort, filter: string): Row[] {
  const q = filter.trim().toLowerCase()
  const hit = (r: Row) => q === '' || [r.name, kindInfo(r.kind).label, ...r.uses].some(s => s.toLowerCase().includes(q))
  const order = (k: Kind) => KINDS.findIndex(x => x.kind === k)
  return rows.filter(hit).sort((a, b) => (sort === 'kind' ? order(a.kind) - order(b.kind) : 0) || a.name.localeCompare(b.name))
}

export type Stats = { loaded: number; off: number; commands: number; byKind: { kind: Kind; count: number }[] }

export function stats(rows: readonly Row[]): Stats {
  return {
    loaded: rows.filter(r => r.status !== 'off' && r.status !== 'on-next').length,
    off: rows.filter(r => r.status === 'off' || r.status === 'off-next').length,
    commands: rows.reduce((n, r) => n + r.commands.length, 0),
    byKind: KINDS.map(k => ({ kind: k.kind, count: rows.filter(r => r.kind === k.kind).length })).filter(k => k.count > 0),
  }
}

/** 先に読み込まれた mod をオフにする手順 */
export function disableCommand(row: Row): string {
  return `claude plugin disable ${row.provenance || row.name}`
}

const BG = '#0d1117'
const FACE = '#161b22'
const LINE = '#30363d'
const FG = '#c9d1d9'
const DIM = '#8b949e'

/** ヘッダー: 数字のタイル 3 枚と、種類の積み上げ帯 (伸びる) と凡例 */
export function headerSvg(s: Stats): string {
  const W = 380
  const pad = 16
  const gap = 8
  const tw = (W - pad * 2 - gap * 2) / 3
  const tiles = [
    { label: '読み込み中', value: s.loaded, unit: '本', color: '#3fb950' },
    { label: 'オフ', value: s.off, unit: '本', color: '#f85149' },
    { label: 'コマンド', value: s.commands, unit: '個', color: '#58a6ff' },
  ]
  const tileSvg = tiles
    .map((t, i) => {
      const x = pad + i * (tw + gap)
      return [
        `<rect x="${x}" y="44" width="${tw}" height="74" rx="8" fill="${FACE}" stroke="${LINE}"/>`,
        `<rect x="${x + 10}" y="44" width="${tw - 20}" height="3" rx="1.5" fill="${t.color}"/>`,
        `<text x="${x + 12}" y="68" font-size="12" fill="${DIM}">${t.label}</text>`,
        `<text x="${x + 12}" y="106" font-size="32" font-weight="bold" fill="${t.color}">${t.value}<tspan font-size="13" font-weight="normal" fill="${DIM}" dx="4">${t.unit}</tspan></text>`,
      ].join('')
    })
    .join('')

  const bw = W - pad * 2
  const total = s.byKind.reduce((n, k) => n + k.count, 0)
  let x = pad
  const segs = s.byKind
    .map(k => {
      const w = total > 0 ? (bw * k.count) / total : 0
      const seg = `<rect x="${x}" y="152" width="${w}" height="16" fill="${kindInfo(k.kind).color}"/>`
      x += w
      return seg
    })
    .join('')
  const bar = total
    ? `<g clip-path="url(#grow)">${segs}</g>`
    : `<text x="${pad}" y="165" font-size="12" fill="${DIM}">まだ何も見えていません</text>`

  const legend = s.byKind
    .map((k, i) => {
      const lx = pad + (i % 2) * (bw / 2)
      const ly = 192 + Math.floor(i / 2) * 22
      const info = kindInfo(k.kind)
      return `<rect x="${lx}" y="${ly - 10}" width="11" height="11" rx="2" fill="${info.color}"/><text x="${lx + 18}" y="${ly}" font-size="13" fill="${FG}">${info.label}<tspan fill="${DIM}" dx="6">${k.count}</tspan></text>`
    })
    .join('')
  const H = 192 + Math.ceil(Math.max(s.byKind.length, 1) / 2) * 22 + 2

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`,
    `<defs><clipPath id="grow"><rect x="${pad}" y="152" width="0" height="16" rx="8"><animate attributeName="width" from="0" to="${bw}" dur="0.9s" begin="0s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1"/></rect></clipPath></defs>`,
    `<rect width="${W}" height="${H}" rx="10" fill="${BG}"/>`,
    `<circle cx="${pad + 5}" cy="23" r="5" fill="#3fb950"><animate attributeName="opacity" values="1;0.35;1" dur="2.4s" repeatCount="indefinite"/></circle>`,
    `<text x="${pad + 18}" y="28" font-size="16" font-weight="bold" fill="${FG}">mod ハブ</text>`,
    `<text x="${W - pad}" y="28" font-size="12" fill="${DIM}" text-anchor="end">このセッション</text>`,
    tileSvg,
    `<text x="${pad}" y="142" font-size="12" fill="${DIM}">種類の内訳</text>`,
    `<rect x="${pad}" y="152" width="${bw}" height="16" rx="8" fill="${FACE}" stroke="${LINE}"/>`,
    bar,
    legend,
    '</svg>',
  ].join('')
}
