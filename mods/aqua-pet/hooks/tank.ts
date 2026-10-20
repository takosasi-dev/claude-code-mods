import type { AquaPeriod, AquaTank, AquaView } from '../types'

export const HOUR = 3_600_000
const DAY = 24 * HOUR
export const IDLE_MS = 10 * 60_000
export const UPSET_MS = 8_000
export const FEED_MS = 6_000
/** 1 時間で減る満腹度 (20 時間で空になる) */
const HUNGER_PER_HOUR = 5
export const FEED_AMOUNT = 25
export const MAX_MURK = 10
const HUNGRY = 30

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** 0〜4 ターンで 1 匹、以後 10 ターンごとに 1 匹、最大 8 匹 */
export const fishCount = (turns: number) => (turns < 5 ? 1 : Math.min(8, 2 + Math.floor((turns - 5) / 10)))

export const fullnessAt = (t: AquaTank, now: number) =>
  clamp(t.fullness - (Math.max(0, now - t.fedAt) / HOUR) * HUNGER_PER_HOUR, 0, 100)

/** JST の時刻帯 (Date のタイムゾーンに頼らない) */
export const periodAt = (now: number): AquaPeriod => {
  const h = Math.floor(now / HOUR + 9) % 24
  return h >= 5 && h < 10 ? '朝' : h >= 10 && h < 16 ? '昼' : h >= 16 && h < 19 ? '夕' : '夜'
}

export const viewAt = (t: AquaTank, now: number): AquaView => ({
  period: periodAt(now),
  fullness: Math.round(fullnessAt(t, now) / 5) * 5,
  isIdle: !t.isRunning && t.lastActiveAt > 0 && now - t.lastActiveAt > IDLE_MS,
  isUpset: now < t.upsetUntil,
  isFeeding: now < t.feedUntil,
  days: t.bornAt > 0 ? Math.floor(Math.max(0, now - t.bornAt) / DAY) + 1 : 1,
})

export const sameView = (a: AquaView, b: AquaView) =>
  a.period === b.period &&
  a.fullness === b.fullness &&
  a.isIdle === b.isIdle &&
  a.isUpset === b.isUpset &&
  a.isFeeding === b.isFeeding &&
  a.days === b.days

export const INITIAL: AquaTank = {
  turns: 0,
  bornAt: 0,
  fullness: 70,
  fedAt: 0,
  murk: 0,
  name: '',
  isRunning: false,
  lastActiveAt: 0,
  upsetUntil: 0,
  feedUntil: 0,
  isNaming: false,
  view: { period: '昼', fullness: 70, isIdle: false, isUpset: false, isFeeding: false, days: 1 },
}

/** $.store に残す分 */
export type Saved = Pick<AquaTank, 'turns' | 'bornAt' | 'fullness' | 'fedAt' | 'murk' | 'name'>
export const toSaved = (t: AquaTank): Saved => ({
  turns: t.turns,
  bornAt: t.bornAt,
  fullness: t.fullness,
  fedAt: t.fedAt,
  murk: t.murk,
  name: t.name,
})

/** store の中身は信用しない: 数と文字だけ拾う */
export const fromSaved = (raw: unknown, now: number): Saved => {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const num = (k: string, d: number) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : d)
  return {
    turns: Math.max(0, Math.floor(num('turns', 0))),
    bornAt: num('bornAt', now) || now,
    fullness: clamp(num('fullness', 70), 0, 100),
    fedAt: num('fedAt', now) || now,
    murk: clamp(Math.floor(num('murk', 0)), 0, MAX_MURK),
    name: typeof o.name === 'string' ? o.name.slice(0, 12) : '',
  }
}

// ---------------------------------------------------------------- SVG

/** 番号から決まる擬似乱数 (mulberry32)。描き直しで魚の見た目が変わらない */
const rng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [hex(a), hex(b)]
  return '#' + x.map((v, i) => Math.round(v + ((y[i] ?? 0) - v) * t).toString(16).padStart(2, '0')).join('')
}
const f1 = (n: number) => Math.round(n * 10) / 10

const W = 360
const H = 300
const TOP = 30 // 水面
const FLOOR = 262 // 砂の上端

const WATER: Record<AquaPeriod, { top: string; mid: string; bottom: string; ray: string; rayOp: number; tint: string; tintOp: number }> = {
  朝: { top: '#4a86a8', mid: '#1f557a', bottom: '#0c2a42', ray: '#ffe9b8', rayOp: 0.2, tint: '#ffd9a0', tintOp: 0.05 },
  昼: { top: '#3aa0d8', mid: '#1767a3', bottom: '#0a345c', ray: '#e8f7ff', rayOp: 0.24, tint: '#ffffff', tintOp: 0 },
  夕: { top: '#a8607e', mid: '#493f78', bottom: '#151f42', ray: '#ffc28a', rayOp: 0.18, tint: '#ff8a50', tintOp: 0.07 },
  夜: { top: '#163256', mid: '#0b1c36', bottom: '#040a16', ray: '#a8c0ff', rayOp: 0.07, tint: '#000814', tintOp: 0.28 },
}

const FISH_COLORS = ['#f78166', '#58a6ff', '#d29922', '#bc8cff', '#3fb950', '#ff7b72', '#79c0ff', '#e3b341']

const sand = (r: () => number) => {
  let s = `<path d="M0 ${FLOOR} C60 ${FLOOR - 8} 110 ${FLOOR + 6} 180 ${FLOOR - 2} S300 ${FLOOR - 10} 360 ${FLOOR - 2} V${H} H0 Z" fill="url(#sand)"/>`
  for (let i = 0; i < 14; i++) {
    const x = f1(r() * W)
    const y = f1(FLOOR + 8 + r() * 28)
    const c = ['#6e7681', '#8b949e', '#a5865a', '#5a4a33'][i % 4]
    s += `<ellipse cx="${x}" cy="${y}" rx="${f1(2 + r() * 4)}" ry="${f1(1.5 + r() * 2)}" fill="${c}" opacity=".8"/>`
  }
  // 岩
  s += `<path d="M232 ${FLOOR + 4} C236 ${FLOOR - 26} 270 ${FLOOR - 34} 286 ${FLOOR - 10} C292 ${FLOOR} 280 ${FLOOR + 8} 232 ${FLOOR + 4} Z" fill="#484f58"/>`
  s += `<path d="M244 ${FLOOR - 14} C252 ${FLOOR - 26} 266 ${FLOOR - 28} 274 ${FLOOR - 18}" stroke="#6e7681" stroke-width="2" fill="none" opacity=".6"/>`
  return s
}

const plants = () => {
  const list = [
    { x: 34, h: 150, c: '#238636', w: 6, d: 4.2 },
    { x: 52, h: 110, c: '#3fb950', w: 5, d: 3.4 },
    { x: 70, h: 80, c: '#2ea043', w: 4, d: 2.9 },
    { x: 300, h: 130, c: '#2ea043', w: 6, d: 3.8 },
    { x: 318, h: 170, c: '#238636', w: 5, d: 4.6 },
    { x: 160, h: 60, c: '#3fb950', w: 4, d: 3.1 },
  ]
  return list
    .map(p => {
      const b = FLOOR + 4
      const a = `M${p.x} ${b} C${p.x - 10} ${b - p.h * 0.35} ${p.x + 10} ${b - p.h * 0.7} ${p.x} ${b - p.h}`
      const z = `M${p.x} ${b} C${p.x - 4} ${b - p.h * 0.35} ${p.x + 18} ${b - p.h * 0.65} ${p.x + 12} ${b - p.h * 0.96}`
      const y = `M${p.x} ${b} C${p.x - 16} ${b - p.h * 0.35} ${p.x + 2} ${b - p.h * 0.7} ${p.x - 10} ${b - p.h * 0.97}`
      return `<path d="${a}" stroke="${p.c}" stroke-width="${p.w}" stroke-linecap="round" fill="none"><animate attributeName="d" values="${a};${z};${a};${y};${a}" dur="${p.d}s" repeatCount="indefinite"/></path>`
    })
    .join('')
}

const rays = (c: (typeof WATER)[AquaPeriod]) =>
  [
    { x: 70, w: 34, d: 7 },
    { x: 170, w: 22, d: 9 },
    { x: 250, w: 40, d: 11 },
  ]
    .map(
      r =>
        `<polygon points="${r.x},${TOP} ${r.x + r.w},${TOP} ${r.x + r.w - 60},${FLOOR} ${r.x - 90},${FLOOR}" fill="url(#ray)" opacity="${c.rayOp}">` +
        `<animate attributeName="opacity" values="${f1(c.rayOp * 0.3)};${c.rayOp};${f1(c.rayOp * 0.3)}" dur="${r.d}s" repeatCount="indefinite"/>` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;14 0;0 0" dur="${r.d * 1.3}s" repeatCount="indefinite"/></polygon>`,
    )
    .join('')

const bubbles = (n: number, fast: boolean) => {
  const r = rng(777)
  let s = ''
  for (let i = 0; i < n; i++) {
    const x = f1(20 + r() * 320)
    const size = f1(1.8 + r() * 3.2)
    const dur = f1((fast ? 2.6 : 5) + r() * (fast ? 2 : 4))
    const begin = f1(-r() * dur)
    s +=
      `<circle cx="${x}" cy="${FLOOR}" r="${size}" fill="none" stroke="#e6f6ff" stroke-width="1" opacity=".7">` +
      `<animate attributeName="cy" values="${FLOOR};${TOP + 2}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `<animate attributeName="cx" values="${x};${f1(x + 6)};${f1(x - 5)};${x}" dur="${f1(dur / 2)}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values=".8;.7;0" keyTimes="0;.85;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`
  }
  return s
}

const pellets = () => {
  const r = rng(4242)
  let s = ''
  for (let i = 0; i < 9; i++) {
    const x = f1(110 + r() * 150)
    const begin = f1(r() * 1.2)
    const dur = f1(3.4 + r() * 1.4)
    const end = f1(FLOOR - 4 - r() * 10)
    s +=
      `<circle cx="${x}" cy="${TOP + 2}" r="2.6" fill="#d29922" stroke="#9e6a03" stroke-width=".8">` +
      `<animate attributeName="cy" values="${TOP + 2};${end}" dur="${dur}s" begin="${begin}s" fill="freeze"/>` +
      `<animate attributeName="cx" values="${x};${f1(x + 5)};${f1(x - 4)};${x}" dur="${dur}s" begin="${begin}s" fill="freeze"/>` +
      `<animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="${dur}s" begin="${begin}s" fill="freeze"/></circle>`
  }
  return s
}

type Mood = { isRunning: boolean; isUpset: boolean; isIdle: boolean; isHungry: boolean }

const fish = (i: number, m: Mood) => {
  const r = rng(i * 7919 + 13)
  const color = FISH_COLORS[i % FISH_COLORS.length] ?? '#f78166'
  const scale = f1(i === 0 ? 1.55 : 0.75 + r() * 0.5)
  const y = f1(TOP + 40 + r() * 150)
  const x1 = f1(28 + r() * 40)
  const x2 = f1(W - 28 - r() * 40)
  const speed = m.isRunning ? 0.55 : m.isHungry ? 1.6 : 1
  const dur = f1((16 + r() * 12) * speed)
  const begin = f1(-r() * dur)
  const tail = f1((m.isRunning ? 0.28 : m.isHungry ? 0.9 : 0.5) * (0.9 + r() * 0.3))
  const body = m.isUpset ? '#f85149' : color
  const id = `g${i}`

  const drawing =
    `<path d="M-10 0 L-21 -8 Q-17 0 -21 8 Z" fill="${mix(body, '#0d1117', 0.25)}">` +
    `<animateTransform attributeName="transform" type="rotate" values="-16 -10 0;16 -10 0;-16 -10 0" dur="${m.isIdle ? 2.6 : tail}s" repeatCount="indefinite"/></path>` +
    `<path d="M16 0 C10 -11 -6 -11 -12 0 C-6 11 10 11 16 0 Z" fill="url(#${id})"/>` +
    `<path d="M3 -8 Q-3 -15 -8 -7 Z" fill="${mix(body, '#0d1117', 0.2)}"/>` +
    `<path d="M1 3 Q-3 9 -6 4 Z" fill="${mix(body, '#ffffff', 0.25)}" opacity=".8"/>` +
    `<path d="M4 -7 Q1 0 4 7" stroke="#ffffff" stroke-width="1" fill="none" opacity=".3"/>` +
    `<circle cx="9" cy="-2" r="2.4" fill="#f0f6fc"/><circle cx="9.7" cy="-2" r="1.2" fill="#0d1117"/>`

  const grad = `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(body, '#ffffff', 0.3)}"/><stop offset=".6" stop-color="${body}"/><stop offset="1" stop-color="${mix(body, '#0d1117', 0.35)}"/></linearGradient>`

  const shake = m.isUpset
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;-1.6 1;1.6 -1;-1 -1;0 0" dur=".22s" repeatCount="indefinite"/>`
    : ''

  if (m.isIdle) {
    // 底でじっとする: ゆっくり上下するだけ
    const x = f1(40 + ((i * 41 + r() * 30) % 280))
    const yb = f1(FLOOR - 12 - r() * 10)
    const face = i % 2 === 0 ? 1 : -1
    return {
      grad,
      body:
        `<g transform="translate(${x} ${yb})"><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${f1(4 + r() * 2)}s" begin="${begin}s" repeatCount="indefinite"/>` +
        `<g transform="scale(${f1(scale * face)} ${scale})">${drawing}</g></g></g>`,
    }
  }

  const path = `M${x1} ${y} C${f1(x1 + 60)} ${f1(y - 14)} ${f1(x2 - 60)} ${f1(y + 14)} ${x2} ${y} C${f1(x2 - 60)} ${f1(y - 12)} ${f1(x1 + 60)} ${f1(y + 12)} ${x1} ${y}`
  return {
    grad,
    body:
      `<g><animateMotion path="${path}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0.5;1" keyTimes="0;0.5;1"/>` +
      `<g>${shake}<g transform="scale(${scale})"><g><animateTransform attributeName="transform" type="scale" values="1 1;-1 1" keyTimes="0;0.5" calcMode="discrete" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `${drawing}</g></g></g></g>`,
  }
}

const zzz = () =>
  [0, 1, 2]
    .map(
      k =>
        `<text x="${120 + k * 8}" y="${FLOOR - 30}" font-size="${12 + k * 2}" fill="#8b949e" font-family="sans-serif" opacity="0">z` +
        `<animate attributeName="y" values="${FLOOR - 30};${FLOOR - 70}" dur="4s" begin="${k * 1.3}s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="0;.8;0" dur="4s" begin="${k * 1.3}s" repeatCount="indefinite"/></text>`,
    )
    .join('')

const murk = (level: number) => {
  if (level <= 0) return ''
  const r = rng(99)
  let s = `<rect x="0" y="${TOP}" width="${W}" height="${H - TOP}" fill="#5b6a2e" opacity="${Math.min(0.5, level * 0.05).toFixed(2)}"/>`
  for (let i = 0; i < level * 3; i++) {
    const x = f1(r() * W)
    const y = f1(TOP + 10 + r() * (FLOOR - TOP - 10))
    const d = f1(6 + r() * 6)
    s += `<circle cx="${x}" cy="${y}" r="${f1(0.8 + r() * 1.4)}" fill="#a3b18a" opacity=".45"><animate attributeName="cy" values="${y};${f1(y + 8)};${y}" dur="${d}s" repeatCount="indefinite"/></circle>`
  }
  return s
}

const hud = (t: AquaTank, v: AquaView) => {
  const bar = 70
  const fill = f1((bar * v.fullness) / 100)
  const barColor = v.fullness < HUNGRY ? '#f85149' : v.fullness < 60 ? '#d29922' : '#3fb950'
  const status = v.isUpset ? 'びっくり' : t.isRunning ? '作業中' : v.isIdle ? 'おやすみ' : '待機'
  const statusColor = v.isUpset ? '#f85149' : t.isRunning ? '#3fb950' : '#8b949e'
  return (
    `<text x="14" y="20" font-size="12" fill="#8b949e" font-family="sans-serif">満腹</text>` +
    `<rect x="44" y="11" width="${bar}" height="10" rx="5" fill="#30363d"/>` +
    `<rect x="44" y="11" width="${fill}" height="10" rx="5" fill="${barColor}"/>` +
    `<text x="${44 + bar + 6}" y="20" font-size="12" fill="#c9d1d9" font-family="sans-serif">${v.fullness}%</text>` +
    `<text x="${W - 14}" y="20" font-size="12" fill="${statusColor}" font-family="sans-serif" text-anchor="end">${status} / ${v.period}</text>`
  )
}

export const drawTank = (t: AquaTank): string => {
  const v = t.view
  const c = WATER[v.period]
  const mood: Mood = {
    isRunning: t.isRunning,
    isUpset: v.isUpset,
    isIdle: v.isIdle && !v.isUpset,
    isHungry: v.fullness < HUNGRY,
  }
  const fishes = Array.from({ length: fishCount(t.turns) }, (_, i) => fish(i, mood)).reverse() // 大きい魚を手前に
  const surface0 = `M0 ${TOP} Q45 ${TOP - 3} 90 ${TOP} T180 ${TOP} T270 ${TOP} T360 ${TOP}`
  const surface1 = `M0 ${TOP} Q45 ${TOP + 3} 90 ${TOP} T180 ${TOP} T270 ${TOP} T360 ${TOP}`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">` +
    `<defs>` +
    `<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.top}"/><stop offset=".55" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.bottom}"/></linearGradient>` +
    `<linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.ray}" stop-opacity=".9"/><stop offset="1" stop-color="${c.ray}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a86a"/><stop offset="1" stop-color="#6b5330"/></linearGradient>` +
    `<filter id="dull"><feColorMatrix type="saturate" values=".3"/></filter>` +
    `<clipPath id="glass"><rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="12"/></clipPath>` +
    fishes.map(f => f.grad).join('') +
    `</defs>` +
    `<rect width="${W}" height="${H}" rx="14" fill="#0d1117"/>` +
    `<g clip-path="url(#glass)">` +
    `<rect x="0" y="0" width="${W}" height="${TOP}" fill="#161b22"/>` +
    `<rect x="0" y="${TOP}" width="${W}" height="${H - TOP}" fill="url(#water)"/>` +
    rays(c) +
    sand(rng(31)) +
    plants() +
    bubbles(t.isRunning ? 11 : 5, t.isRunning) +
    (v.isFeeding ? pellets() : '') +
    `<g${mood.isHungry && !mood.isUpset ? ' filter="url(#dull)" opacity=".85"' : ''}>${fishes.map(f => f.body).join('')}</g>` +
    (mood.isIdle ? zzz() : '') +
    murk(t.murk) +
    `<rect x="0" y="${TOP}" width="${W}" height="${H - TOP}" fill="${c.tint}" opacity="${c.tintOp}"/>` +
    `<path d="${surface0}" stroke="#e6f6ff" stroke-width="1.5" fill="none" opacity=".35"><animate attributeName="d" values="${surface0};${surface1};${surface0}" dur="3s" repeatCount="indefinite"/></path>` +
    `<path d="M20 ${TOP + 14} L44 ${TOP + 14} L14 ${H - 20} L-10 ${H - 20} Z" fill="#ffffff" opacity=".04"/>` +
    hud(t, v) +
    `</g>` +
    `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="13" fill="none" stroke="#30363d" stroke-width="3"/>` +
    `</svg>`
  )
}
