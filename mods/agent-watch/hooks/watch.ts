// 記録を合わせる純関数と、ペインの SVG。描画面は <img> なので SMIL だけで動かす
import type { AgentWatchRecord, AgentWatchStatus } from '../types'
import { C, HEADER_H, W, clean, esc, frame, header } from './style'

/** $.agent.list() の 1 件のうち使う所 */
export type ListedAgent = { id: string; type: string; description: string; status: AgentWatchStatus }
export type Agents = Record<string, AgentWatchRecord>

/** 持っておく記録の数。超えたら終わった物の古い方から捨てる */
export const KEEP = 30

// clean (制御文字を落とす) と esc は style.ts の物。register が ./watch から読むので出し直す
export { clean, esc }

export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 2)}..` : s)

/** 描き直しでアニメが頭に戻って跳ねないよう、時刻から位相を決める (begin を負に) */
const phase = (now: number, periodMs: number) => `-${((now % periodMs) / 1000).toFixed(2)}s`

/** 経過 m:ss / h:mm:ss */
export const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

// ---- 記録 ----

export type Kind = 'run' | 'wait' | 'done' | 'fail' | 'stop'

export const kindOf = (status: AgentWatchStatus): Kind =>
  status === 'running' || status === 'pending'
    ? 'run'
    : status === 'waiting' || status === 'idle'
      ? 'wait'
      : status === 'completed'
        ? 'done'
        : status === 'failed'
          ? 'fail'
          : 'stop'

export const isEnded = (status: AgentWatchStatus) => status === 'completed' || status === 'failed' || status === 'killed'

const STATUSES: readonly AgentWatchStatus[] = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed']

const fresh = (id: string, now: number): AgentWatchRecord => ({
  id,
  type: '',
  description: '',
  status: 'running',
  isListed: false,
  startedAt: now,
  durationMs: 0,
  tools: 0,
  lastTool: '',
  errors: 0,
})

/** 多すぎたら、終わった物の古い方から捨てる */
const prune = (agents: Agents): Agents => {
  const list = Object.values(agents)
  if (list.length <= KEEP) return agents
  const drop = new Set(
    list
      .filter(r => r.endedAt !== undefined)
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, list.length - KEEP)
      .map(r => r.id),
  )
  return Object.fromEntries(Object.entries(agents).filter(([id]) => !drop.has(id)))
}

/** id の記録を change で変える。無ければ今の時刻で作る */
export const touch = (agents: Agents, id: string, now: number, change: (r: AgentWatchRecord) => AgentWatchRecord): Agents => {
  const r = agents[id] ?? fresh(id, now)
  return prune({ ...agents, [id]: change({ ...r, startedAt: Math.min(r.startedAt, now) }) })
}

/** ターンの始まり: 終わっていた物も、もう一度動き出したとみなす */
export const onTurnStart = (agents: Agents, id: string, now: number) =>
  touch(agents, id, now, r => {
    const { endedAt: _, ...rest } = r
    return { ...rest, status: 'running' }
  })

/** ターンの終わり。答えて終わった物だけを「終わり」、中断は止めた、エラー・拒否は失敗にする (C5) */
export const onTurnComplete = (agents: Agents, id: string, now: number, durationMs: number, reason: string) =>
  touch(agents, id, now - Math.max(0, durationMs), r => ({
    ...r,
    endedAt: now,
    durationMs: r.durationMs + Math.max(0, durationMs),
    status: reason === 'answer' ? 'completed' : reason === 'aborted' ? 'killed' : 'failed',
  }))

/** $.agent.list() の結果を合わせる。変わらなければ同じ物を返す */
export const applyList = (agents: Agents, listed: readonly ListedAgent[], now: number): Agents => {
  let next = agents
  const ids = new Set<string>()
  for (const a of listed) {
    if (typeof a?.id !== 'string' || a.id === '') continue
    ids.add(a.id)
    const prev = next[a.id] ?? fresh(a.id, now)
    const listedStatus: AgentWatchStatus = STATUSES.includes(a.status) ? a.status : prev.status
    // 終わりを聞いた後の「実行中」は、一覧がまだ追いついていないだけなので採らない (動き出したら turn.start で戻る)
    const status = prev.endedAt !== undefined && kindOf(listedStatus) === 'run' ? prev.status : listedStatus
    const r: AgentWatchRecord = {
      ...prev,
      type: clean(String(a.type ?? '')),
      description: clean(String(a.description ?? '')),
      status,
      isListed: true,
      ...(isEnded(status) && prev.endedAt === undefined ? { endedAt: now } : {}),
    }
    if (JSON.stringify(r) !== JSON.stringify(next[a.id])) next = { ...next, [a.id]: r }
  }
  // ponytail: 一覧から消えた動いている物は、終わったとみなす (エンジンは終わった task を後で一覧から落とす)
  for (const r of Object.values(next)) {
    if (r.isListed && !ids.has(r.id) && r.endedAt === undefined) {
      next = { ...next, [r.id]: { ...r, status: isEnded(r.status) ? r.status : 'completed', endedAt: now } }
    }
  }
  return next === agents ? agents : prune(next)
}

export type Counts = { live: number; done: number; failed: number; tools: number; errors: number }

export const countsOf = (list: readonly AgentWatchRecord[]): Counts => ({
  live: list.filter(r => r.endedAt === undefined || !isEnded(r.status)).length,
  done: list.filter(r => r.status === 'completed' || r.status === 'killed').length,
  failed: list.filter(r => r.status === 'failed').length,
  tools: list.reduce((n, r) => n + r.tools, 0),
  errors: list.reduce((n, r) => n + r.errors, 0),
})

/** 描く順に並べる (一覧が名前を言った物だけ、新しい順)。hideDone なら終わった物を外す */
export const shownOf = (agents: Agents, hideDone: boolean) => {
  const listed = Object.values(agents).filter(r => r.isListed)
  return {
    all: listed,
    shown: listed.filter(r => !hideDone || !isEnded(r.status)).sort((a, b) => b.startedAt - a.startedAt),
  }
}

/** 右に出す経過時間: 動いていれば今まで、終わっていればターンの合計 (無ければ始まりから終わりまで) */
export const elapsedOf = (r: AgentWatchRecord, now: number) =>
  r.endedAt === undefined ? now - r.startedAt : r.durationMs > 0 ? r.durationMs : r.endedAt - r.startedAt

export const STATUS_WORD: Record<Kind, string> = { run: '実行中', wait: '待ち', done: '終わり', fail: '失敗', stop: '止めた' }
/** 状態の色。テーマに付いていくよう読むたびに C から引く */
export const KIND_COLOR: Record<Kind, string> = {
  get run() { return C.blue },
  get wait() { return C.yellow },
  get done() { return C.green },
  get fail() { return C.red },
  get stop() { return C.dim },
}

/** 名前の行に出す見出し。種類が無ければ (不明) */
export const titleOf = (r: AgentWatchRecord) => r.type || '(種類不明)'

// ---- SVG ----

// ペインは一覧を読むたび・ツールを呼ぶたびに描き直すので、流れる縞と点滅のほかに動きは足さない (mod-guide 2 節)
const X0 = 16
const BW = W - 32
/** 見出しの下から中身を始める y */
const TOP = HEADER_H + 12

const text = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`

export type PaneView = {
  shown: readonly AgentWatchRecord[]
  counts: Counts
  /** 隠している数 */
  hidden: number
  now: number
  /** 見ているエージェントの見出し。メインなら無し */
  viewing?: string
}

const tiles = (c: Counts, now: number) => {
  const tw = (BW - 20) / 3
  const tile = (i: number, label: string, n: number, edge: string, isHot: boolean) => {
    const x = X0 + i * (tw + 10)
    const y = TOP
    const pulse =
      isHot && i === 0
        ? `<circle cx="${x + tw - 14}" cy="${y + 18}" r="4" fill="${edge}">` +
          `<animate attributeName="opacity" values="1;0.2;1" dur="1.2s" begin="${phase(now, 1200)}" repeatCount="indefinite"/></circle>`
        : ''
    return (
      `<rect x="${x}" y="${y}" width="${tw}" height="64" rx="8" fill="${C.face}" stroke="${edge}" stroke-width="1.5"/>` +
      `<rect x="${x + 10}" y="${y}" width="${tw - 20}" height="3" fill="${edge}"/>` +
      pulse +
      text(x + 10, y + 22, label, 12, C.dim) +
      text(x + 10, y + 52, String(n), 26, isHot ? edge : C.text, 'font-weight="bold"')
    )
  }
  return tile(0, '動いている', c.live, C.blue, c.live > 0) + tile(1, '終わった', c.done, C.green, c.done > 0) + tile(2, 'エラー', c.failed, C.red, c.failed > 0)
}

/** 帯 1 本。実行中は太い破線の dashoffset を流して縞にする。位相を時刻から決め、描き直しで縞が跳ねないようにする */
const band = (x: number, y: number, w: number, kind: Kind, now: number) => {
  const color = KIND_COLOR[kind]
  if (kind === 'run') {
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="10" rx="3" fill="${color}" opacity="0.35"/>` +
      `<line x1="${x}" y1="${y + 5}" x2="${x + w}" y2="${y + 5}" stroke="${color}" stroke-width="10" stroke-dasharray="6 6">` +
      `<animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.6s" begin="${phase(now, 600)}" repeatCount="indefinite"/></line>`
    )
  }
  const blink = kind === 'wait' ? `<animate attributeName="opacity" values="1;0.45;1" dur="1.6s" begin="${phase(now, 1600)}" repeatCount="indefinite"/>` : ''
  return `<rect x="${x}" y="${y}" width="${w}" height="10" rx="3" fill="${color}">${blink}</rect>`
}

const ROW = 74

export const paneSvg = (v: PaneView) => {
  const head =
    header('サブエージェント', v.viewing ? `表示中: ${cut(v.viewing, 20)}` : '表示中: メイン', v.viewing ? C.purple : C.blue) +
    tiles(v.counts, v.now) +
    text(X0, TOP + 84, `ツールの呼び出し 計 ${v.counts.tools}  /  ツールのエラー 計 ${v.counts.errors}`, 12, C.dim)

  const rows = v.shown.slice(0, KEEP)
  if (rows.length === 0) {
    const empty = v.hidden > 0 ? `終わった物を隠しています (${v.hidden} 体)` : 'サブエージェントはまだいません'
    return frame(TOP + 152, head + text(W / 2, TOP + 126, empty, 13, C.dim, 'text-anchor="middle"'))
  }

  const t0 = Math.min(...rows.map(r => r.startedAt))
  const isLive = rows.some(r => r.endedAt === undefined)
  const t1 = isLive ? v.now : Math.max(...rows.map(r => r.endedAt ?? v.now))
  const span = Math.max(1000, t1 - t0)
  const xOf = (t: number) => X0 + (Math.min(Math.max(t, t0), t1) - t0) / span * BW

  const body = rows
    .map((r, i) => {
      const y = TOP + 102 + i * ROW
      const kind = kindOf(r.status)
      const color = KIND_COLOR[kind]
      const x = xOf(r.startedAt)
      const w = Math.max(4, xOf(r.endedAt ?? v.now) - x)
      return (
        text(X0, y + 14, cut(titleOf(r), 18), 13, color, 'font-weight="bold"') +
        text(W - 16, y + 14, `${dur(elapsedOf(r, v.now))}  ツール ${r.tools}`, 12, C.text, 'text-anchor="end"') +
        text(X0, y + 31, cut(r.description || '(説明なし)', 27), 12, C.dim) +
        `<rect x="${X0}" y="${y + 39}" width="${BW}" height="10" rx="3" fill="${C.face}"/>` +
        band(x, y + 39, w, kind, v.now) +
        `<text x="${X0}" y="${y + 64}" font-size="12" fill="${C.dim}"><tspan fill="${color}">${STATUS_WORD[kind]}</tspan>` +
        `  最後 ${esc(cut(r.lastTool || 'なし', 16))}  ` +
        `<tspan fill="${r.errors > 0 ? C.red : C.dim}">エラー ${r.errors}</tspan></text>`
      )
    })
    .join('')

  const axisY = TOP + 102 + rows.length * ROW + 4
  const axis =
    `<line x1="${X0}" y1="${axisY}" x2="${X0 + BW}" y2="${axisY}" stroke="${C.line}"/>` +
    text(X0, axisY + 18, '始まり', 12, C.dim) +
    text(W / 2, axisY + 18, `全体 ${dur(span)}`, 12, C.dim, 'text-anchor="middle"') +
    text(W - 16, axisY + 18, isLive ? '今' : '最後', 12, C.dim, 'text-anchor="end"') +
    (v.hidden > 0 ? text(X0, axisY + 38, `終わった物を ${v.hidden} 体隠しています`, 12, C.dim) : '')

  return frame(axisY + (v.hidden > 0 ? 50 : 30), head + body + axis)
}
