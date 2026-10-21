import type { AquaFish, AquaPeriod, AquaSeason, AquaTank, AquaView, FishKind, FishStage, KnownFishKind } from '../types'
import { C, clean, dayPart, esc, frame, header, panel, season } from './style'

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

// ---------------------------------------------------------------- 魚 1 匹ずつ

export const MAX_FISH = 8
/** i 番目 (0 から) の魚が来る累計ターン。fishCount の逆 */
export const arrivalTurn = (i: number) => (i <= 0 ? 0 : 5 + (i - 1) * 10)

/** 種類。後ろほど珍しい (足す時は後ろに。前の記録の魚の種類が変わらないように) */
export const KINDS: readonly KnownFishKind[] = ['maru', 'shima', 'mizutama', 'hirenaga', 'ougi', 'akari', 'hoshi', 'tsuno', 'niji', 'ryugu']
export const KIND_NAME: Record<KnownFishKind, string> = {
  maru: 'まる魚',
  shima: 'しま魚',
  mizutama: '水玉魚',
  hirenaga: 'ひれなが',
  ougi: 'おうぎ尾',
  akari: 'あかり魚',
  hoshi: 'ほし魚',
  tsuno: 'つの魚',
  niji: 'にじ魚',
  ryugu: 'りゅうぐう',
}

/** 来てからのターンで決まる段階 */
export const stageOf = (turnsSeen: number): FishStage => (turnsSeen < 5 ? '稚魚' : turnsSeen < 20 ? '若魚' : turnsSeen < 60 ? '成魚' : '大物')
const STAGE_SCALE: Record<FishStage, number> = { 稚魚: 0.55, 若魚: 0.8, 成魚: 1.1, 大物: 1.5 }

/**
 * i 番目に来る魚の種類。最初はまる魚、以後は節目が進むほど珍しい種類まで出る
 * (2 匹目は先頭の 3 種から、最後の 8 匹目は全種から。後ろほど出やすい)。
 * 水槽の生まれた時刻を種にするので、どのセッションが節目を越えても同じ魚が来る
 */
export const kindFor = (i: number, tankBornAt: number): KnownFishKind => {
  if (i <= 0) return 'maru'
  const pool = KINDS.slice(0, Math.min(KINDS.length, 1 + Math.ceil((i * (KINDS.length - 1)) / (MAX_FISH - 1))))
  const total = pool.reduce((a, _, k) => a + k + 1, 0)
  let x = rng(Math.floor(tankBornAt / 1000) ^ Math.imul(i, 2654435761))() * total
  for (let k = 0; k < pool.length; k++) {
    x -= k + 1
    if (x < 0) return pool[k]!
  }
  return pool[pool.length - 1]!
}

/** 古い記録 (魚の欄が無い) から、今の数だけ魚を作る。来てからのターンは節目から数える */
export const migrateFish = (turns: number, tankBornAt: number): AquaFish[] =>
  Array.from({ length: fishCount(turns) }, (_, i) => ({ id: i, kind: kindFor(i, tankBornAt), bornAt: tankBornAt, turnsSeen: Math.max(0, turns - arrivalTurn(i)) }))

/**
 * 描く・並べる魚。空 (記録を読めなかった・見本の絵) なら turns から作る。
 * 0.2.x の state が残ったまま描かれた時 (リロード直後) は fish が無いので、それも空と同じに扱う
 */
export const fishOf = (t: Pick<AquaTank, 'fish' | 'turns' | 'bornAt'>) => (t.fish && t.fish.length > 0 ? t.fish : migrateFish(t.turns, t.bornAt))

/** 1 ターン終わった: みんな 1 つ育ち、節目を越えた分だけ新しい魚が来る。turns は足した後の累計 */
export const stepFish = (fish: readonly AquaFish[], turns: number, tankBornAt: number, now: number): AquaFish[] => {
  const out = fish.map(f => ({ ...f, turnsSeen: f.turnsSeen + 1 }))
  while (out.length < fishCount(turns)) {
    const id = out.reduce((m, f) => Math.max(m, f.id + 1), 0)
    out.push({ id, kind: kindFor(id, tankBornAt), bornAt: now, turnsSeen: 0 })
  }
  return out
}

/** store の魚の欄。配列でない・中身が全部壊れていれば turns から作り直す */
const fishFrom = (raw: unknown, turns: number, tankBornAt: number): AquaFish[] => {
  // ponytail: 0.2.x と 0.3.0 のセッションが同時に開いていると、0.2.x 側の書き込みで fish 欄が落ちる。
  // その時はここで turns から作り直す (来た日が水槽の生まれた日に戻る)。0.2.x 側は直せないので、全部のセッションが 0.3.0 になれば起きない
  if (!Array.isArray(raw)) return migrateFish(turns, tankBornAt)
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const out = raw.flatMap((x): AquaFish[] => {
    const o = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {}
    // 知らない種類 (新しい版の魚) も落とさない。描く時はまる魚の形、名前は「なぞの魚」
    if (!ok(o.id) || typeof o.kind !== 'string' || o.kind === '') return []
    const name = typeof o.name === 'string' ? clean(o.name).slice(0, 12) : ''
    // 知らない欄 (新しい版が足した物) はそのまま持ち回る。欄の並びも元のまま (変わっていなければ書かない比べのため)
    const f: Record<string, unknown> = {
      ...o,
      id: Math.max(0, Math.floor(o.id)),
      kind: o.kind as FishKind,
      bornAt: ok(o.bornAt) ? o.bornAt : tankBornAt,
      turnsSeen: ok(o.turnsSeen) ? Math.max(0, Math.floor(o.turnsSeen)) : 0,
    }
    if (name) f.name = name
    else delete f.name
    return [f as AquaFish]
  })
  return out.length > 0 ? out.slice(0, MAX_FISH) : migrateFish(turns, tankBornAt)
}

export const fullnessAt = (t: AquaTank, now: number) =>
  clamp(t.fullness - (Math.max(0, now - t.fedAt) / HOUR) * HUNGER_PER_HOUR, 0, 100)

/** 日本時間 (JST) の時刻帯。決まりは共通の style.ts の dayPart */
export const periodAt = (now: number): AquaPeriod => dayPart(now)

/** 日本時間 (JST) の月で決まる季節。決まりは共通の style.ts の season */
export const seasonAt = (now: number): AquaSeason => season(now)

/** 日本時間の 15 分刻みの番号 0-95 (0 は 0:00〜0:15) */
export const slotAt = (now: number) => Math.floor((((Math.floor(now / 60_000) + 540) % 1440) + 1440) % 1440 / 15)

export const viewAt = (t: AquaTank, now: number): AquaView => ({
  period: periodAt(now),
  season: seasonAt(now),
  slot: slotAt(now),
  fullness: Math.round(fullnessAt(t, now) / 5) * 5,
  isIdle: !t.isRunning && t.lastActiveAt > 0 && now - t.lastActiveAt > IDLE_MS,
  isUpset: now < t.upsetUntil,
  isFeeding: now < t.feedUntil,
  days: t.bornAt > 0 ? Math.floor(Math.max(0, now - t.bornAt) / DAY) + 1 : 1,
})

export const sameView = (a: AquaView, b: AquaView) =>
  a.period === b.period &&
  a.season === b.season &&
  a.slot === b.slot &&
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
  fish: [],
  isNaming: false,
  isListing: false,
  view: { period: '昼', season: '春', slot: 48, fullness: 70, isIdle: false, isUpset: false, isFeeding: false, days: 1 },
}

/** $.store に残す分 */
export type Saved = Pick<AquaTank, 'turns' | 'bornAt' | 'fullness' | 'fedAt' | 'murk' | 'name' | 'fish'>
export const toSaved = (t: AquaTank): Saved => ({
  turns: t.turns,
  bornAt: t.bornAt,
  fullness: t.fullness,
  fedAt: t.fedAt,
  murk: t.murk,
  name: t.name,
  fish: t.fish,
})

/**
 * store に書く物。書く直前に読み直した生の値 raw のうち、この版の知らない欄
 * (新しい版の mod が足した欄) はそのまま残し、知っている欄だけ s で上書きする。
 * 魚の中の知らない欄は fromSaved が持ち回っている
 */
export const toStore = (raw: unknown, s: Saved): Saved => ({ ...(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}), ...s })

/** store の中身は信用しない: 数と文字だけ拾う */
export const fromSaved = (raw: unknown, now: number): Saved => {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const num = (k: string, d: number) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : d)
  const turns = Math.max(0, Math.floor(num('turns', 0)))
  const bornAt = num('bornAt', now) || now
  return {
    turns,
    bornAt,
    fullness: clamp(num('fullness', 70), 0, 100),
    fedAt: num('fedAt', now) || now,
    murk: clamp(Math.floor(num('murk', 0)), 0, MAX_MURK),
    name: typeof o.name === 'string' ? o.name.slice(0, 12) : '',
    fish: fishFrom(o.fish, turns, bornAt),
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

type Water = { top: string; mid: string; bottom: string }

/** 水の色の節目 (日本時間の 0 時からの分)。間は 15 分刻みで混ぜる */
const WATER_KEYS: (Water & { at: number })[] = [
  { at: 0, top: '#10294a', mid: '#08172e', bottom: '#030814' },
  { at: 300, top: '#2f4f78', mid: '#16304f', bottom: '#08172b' }, // 5:00 夜明け
  { at: 450, top: '#4a86a8', mid: '#1f557a', bottom: '#0c2a42' }, // 7:30 朝
  { at: 780, top: '#3aa0d8', mid: '#1767a3', bottom: '#0a345c' }, // 13:00 昼
  { at: 1050, top: '#d9803e', mid: '#7a4a52', bottom: '#1c1c3c' }, // 17:30 夕焼け (橙)
  { at: 1170, top: '#163256', mid: '#0b1c36', bottom: '#040a16' }, // 19:30 夜
  { at: 1440, top: '#10294a', mid: '#08172e', bottom: '#030814' },
]

/** 季節ごとの水の色味と、それをどれだけ混ぜるか */
const SEASON_TINT: Record<AquaSeason, { color: string; amount: number }> = {
  春: { color: '#ffb7c5', amount: 0.1 },
  夏: { color: '#22d3ee', amount: 0.12 },
  秋: { color: '#d9822b', amount: 0.12 },
  冬: { color: '#c8d6e5', amount: 0.16 },
}

/** 15 分刻みの番号と季節から水の 3 色を決める */
export const waterAt = (slot: number, season: AquaSeason): Water => {
  // 0.1.x の state が残ったまま描かれた時 (リロード直後) も描けるように
  const at = Number.isFinite(slot) ? (((slot % 96) + 96) % 96) * 15 : 720
  const i = Math.max(0, WATER_KEYS.findIndex(k => k.at > at) - 1)
  const a = WATER_KEYS[i]!
  const b = WATER_KEYS[i + 1] ?? a
  const t = b.at === a.at ? 0 : (at - a.at) / (b.at - a.at)
  const s = SEASON_TINT[season] ?? SEASON_TINT.春
  const pick = (k: keyof Water) => mix(mix(a[k], b[k], t), s.color, s.amount)
  return { top: pick('top'), mid: pick('mid'), bottom: pick('bottom') }
}

/** 時刻帯ごとの光。昼は筋が強く多い、夜は月明かりの筋が 1 本 */
const LIGHT: Record<AquaPeriod, { sky: string; ray: string; rayOp: number; tint: string; tintOp: number; rays: { x: number; w: number; d: number }[] }> = {
  朝: { sky: '#1c2533', ray: '#ffe9b8', rayOp: 0.2, tint: '#ffd9a0', tintOp: 0.05, rays: [{ x: 70, w: 34, d: 7 }, { x: 170, w: 22, d: 9 }, { x: 250, w: 40, d: 11 }] },
  昼: {
    sky: '#1a2531',
    ray: '#f2fbff',
    rayOp: 0.32,
    tint: '#ffffff',
    tintOp: 0,
    rays: [{ x: 50, w: 36, d: 6 }, { x: 130, w: 26, d: 8 }, { x: 200, w: 30, d: 7.5 }, { x: 280, w: 42, d: 10 }],
  },
  夕: { sky: '#3a2216', ray: '#ffb36b', rayOp: 0.22, tint: '#ff8a3c', tintOp: 0.08, rays: [{ x: 90, w: 30, d: 8 }, { x: 230, w: 36, d: 11 }] },
  夜: { sky: '#0f141c', ray: '#c8d8ff', rayOp: 0.12, tint: '#000814', tintOp: 0.24, rays: [{ x: 214, w: 16, d: 12 }] },
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

const rays = (c: (typeof LIGHT)[AquaPeriod]) =>
  c.rays
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

// ---- 時刻と季節の飾り (animateMotion と fill="freeze" は使わない: 魚とえさの目印なので)

// 空の物は HUD の文字の間 (x 180〜230 あたり) に、HUD の後に描く (前に描くと HUD の地で隠れる)

/** 夜: 三日月と小さな星、水面に映る光 */
const moon = () =>
  `<g id="moon"><path d="M206 7 A8 8 0 1 0 206 23 A4 8 0 1 1 206 7 Z" fill="#f2f0d0"/>` +
  [[186, 10], [228, 18], [176, 20]].map(([x, y], k) => `<circle cx="${x}" cy="${y}" r=".9" fill="#f2f0d0" opacity=".3"><animate attributeName="opacity" values=".2;.9;.2" dur="${2 + k * 0.7}s" repeatCount="indefinite"/></circle>`).join('') +
  `<ellipse cx="214" cy="${TOP + 3}" rx="18" ry="2" fill="#f2f0d0" opacity=".3"><animate attributeName="rx" values="18;24;18" dur="5s" repeatCount="indefinite"/></ellipse></g>`

/** 夕: 沈みかけの橙の日と、水面に映る光 */
const sunset = () =>
  `<g id="sunset"><path d="M196 26 A11 11 0 0 1 218 26 Z" fill="#ffa552"/><path d="M190 26 H224" stroke="#ffcf8a" stroke-width="1" opacity=".7"/>` +
  `<ellipse cx="207" cy="${TOP + 3}" rx="26" ry="2.6" fill="#ffb36b" opacity=".45"><animate attributeName="rx" values="22;30;22" dur="4s" repeatCount="indefinite"/></ellipse></g>`

/** 春: 花びらが水面から舞い落ちる */
const petals = () => {
  const r = rng(3101)
  let s = '<g id="petals">'
  for (let i = 0; i < 10; i++) {
    const x = f1(20 + r() * 320)
    const dur = f1(9 + r() * 6)
    const begin = f1(-r() * dur)
    const end = f1(FLOOR - 6 - r() * 20)
    const sway = f1(12 + r() * 16)
    s +=
      `<g><animateTransform attributeName="transform" type="translate" values="${x} ${TOP - 4};${f1(x + sway)} ${f1((TOP + end) / 2)};${f1(x - sway / 2)} ${end}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `<ellipse rx="3.6" ry="2" fill="${i % 3 === 0 ? '#ffd6e0' : '#f9a8c0'}" opacity=".9"><animateTransform attributeName="transform" type="rotate" values="0;180;360" dur="${f1(dur / 3)}s" repeatCount="indefinite"/></ellipse></g>`
  }
  // 水面に浮かぶ花びら
  for (const x of [96, 182, 268]) s += `<ellipse cx="${x}" cy="${TOP + 1}" rx="4" ry="1.6" fill="#ffd6e0" opacity=".85"><animate attributeName="cy" values="${TOP + 1};${TOP + 3};${TOP + 1}" dur="3s" repeatCount="indefinite"/></ellipse>`
  return s + '</g>'
}

/** 夏: 水面のきらめき (泡は bubbles を増やす) */
const glints = () => {
  const r = rng(6203)
  let s = '<g id="glints">'
  for (let i = 0; i < 6; i++) {
    const x = f1(30 + r() * 300)
    const y = f1(TOP + 4 + r() * 16)
    const d = f1(1.6 + r() * 1.6)
    s += `<path d="M${x} ${f1(y - 3)} L${f1(x + 1)} ${y} L${x} ${f1(y + 3)} L${f1(x - 1)} ${y} Z" fill="#fffbe0" opacity="0"><animate attributeName="opacity" values="0;.9;0" dur="${d}s" begin="${f1(r() * d)}s" repeatCount="indefinite"/></path>`
  }
  return s + '</g>'
}

/** 秋: 落ち葉がゆっくり沈み、いくつかは砂の上に */
const leaves = () => {
  const r = rng(9307)
  const colors = ['#d9822b', '#c2412d', '#e3b341', '#a0522d']
  const leaf = (c: string) => `<path d="M-6 0 Q0 -5 6 0 Q0 5 -6 0 Z M-6 0 L-8 1" fill="${c}" stroke="${mix(c, '#0d1117', 0.4)}" stroke-width=".6"/>`
  let s = '<g id="leaves">'
  for (let i = 0; i < 7; i++) {
    const x = f1(30 + r() * 300)
    const dur = f1(14 + r() * 8)
    const begin = f1(-r() * dur)
    const end = f1(FLOOR - 4 - r() * 8)
    s +=
      `<g><animateTransform attributeName="transform" type="translate" values="${x} ${TOP};${f1(x + 14)} ${f1(TOP + (end - TOP) * 0.35)};${f1(x - 10)} ${f1(TOP + (end - TOP) * 0.7)};${x} ${end}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `<g><animateTransform attributeName="transform" type="rotate" values="-30;30;-30" dur="${f1(3 + r() * 2)}s" repeatCount="indefinite"/>${leaf(colors[i % colors.length] ?? '#d9822b')}</g></g>`
  }
  for (const [x, a] of [[118, 20], [196, -15], [214, 40]] as const) s += `<g transform="translate(${x} ${FLOOR + 2}) rotate(${a})">${leaf('#a0522d')}</g>`
  return s + '</g>'
}

/** 冬: 空から雪が降り、水に溶けていく。水面の近くは少し白む */
const snow = () => {
  const r = rng(1201)
  let s = `<g id="snow"><rect x="0" y="${TOP}" width="${W}" height="24" fill="url(#frost)"/>`
  for (let i = 0; i < 18; i++) {
    const x = f1(10 + r() * 340)
    const dur = f1(6 + r() * 6)
    const begin = f1(-r() * dur)
    const end = f1(TOP + 30 + r() * 150)
    s +=
      `<circle cx="${x}" cy="-4" r="${f1(1.1 + r() * 1.3)}" fill="#f0f6fc" opacity=".9">` +
      `<animate attributeName="cy" values="-4;${end}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `<animate attributeName="cx" values="${x};${f1(x + 7)};${f1(x - 5)};${x}" dur="${f1(dur / 2)}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values=".9;.8;0" keyTimes="0;.7;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`
  }
  return s + '</g>'
}

type Mood = { isRunning: boolean; isUpset: boolean; isIdle: boolean; isHungry: boolean; isNight: boolean }

/** 種類ごとの尾びれ・背びれ・模様 (左上 0,0 で右を向いた形) */
const SHAPE: Record<KnownFishKind, { tail: string; dorsal: string; extra: (body: string) => string }> = {
  maru: { tail: 'M-10 0 L-21 -8 Q-17 0 -21 8 Z', dorsal: 'M3 -8 Q-3 -15 -8 -7 Z', extra: () => '' },
  shima: {
    tail: 'M-10 0 L-21 -8 Q-17 0 -21 8 Z',
    dorsal: 'M5 -8 Q-1 -16 -8 -7 Z',
    extra: b => ['M8 -8 Q6 0 8 8', 'M2 -10 Q0 0 2 10', 'M-4 -9 Q-6 0 -4 9'].map(d => `<path d="${d}" stroke="${mix(b, '#0d1117', 0.55)}" stroke-width="2.4" fill="none" opacity=".7"/>`).join(''),
  },
  mizutama: {
    tail: 'M-10 0 L-20 -9 Q-15 0 -20 9 Z',
    dorsal: 'M3 -8 Q-3 -14 -8 -7 Z',
    extra: () => [[3, -5], [-3, 2], [7, 3], [-1, 7], [-7, -3], [-6, 5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.5" fill="#ffffff" opacity=".75"/>`).join(''),
  },
  hirenaga: {
    tail: 'M-10 0 C-20 -6 -28 -16 -34 -14 Q-26 0 -34 14 C-28 16 -20 6 -10 0 Z',
    dorsal: 'M8 -8 Q-2 -24 -12 -6 Z',
    extra: b => `<path d="M2 7 Q-4 18 -10 16 L-6 6 Z" fill="${mix(b, '#ffffff', 0.2)}" opacity=".8"/>`,
  },
  ougi: {
    tail: 'M-10 0 C-20 -18 -30 -14 -30 0 C-30 14 -20 18 -10 0 Z',
    dorsal: 'M4 -8 Q-2 -17 -9 -7 Z',
    extra: b => ['M-12 0 L-28 -10', 'M-12 0 L-30 0', 'M-12 0 L-28 10'].map(d => `<path d="${d}" stroke="${mix(b, '#ffffff', 0.4)}" stroke-width=".8" opacity=".7"/>`).join(''),
  },
  akari: {
    tail: 'M-10 0 L-20 -7 Q-16 0 -20 7 Z',
    dorsal: 'M2 -8 Q-3 -13 -8 -7 Z',
    extra: () =>
      `<path d="M11 -8 Q16 -20 24 -17" stroke="#8b949e" stroke-width="1.2" fill="none"/>` +
      `<circle class="lure" cx="24" cy="-17" r="5" fill="#fff3a0" opacity=".35"><animate attributeName="opacity" values=".15;.55;.15" dur="2.2s" repeatCount="indefinite"/></circle>` +
      `<circle cx="24" cy="-17" r="2.4" fill="#fff8c4"/>`,
  },
  // 体に小さな星が瞬く
  hoshi: {
    tail: 'M-10 0 L-22 -10 L-17 0 L-22 10 Z',
    dorsal: 'M4 -8 L0 -16 L-3 -9 L-8 -13 L-8 -6 Z',
    extra: () =>
      ([[4, -3, 0], [-4, 3, 0.6], [8, 4, 1.2]] as const)
        .map(
          ([x, y, d]) =>
            `<path d="M${x} ${y - 3} L${x + 0.9} ${y - 0.9} L${x + 3} ${y} L${x + 0.9} ${y + 0.9} L${x} ${y + 3} L${x - 0.9} ${y + 0.9} L${x - 3} ${y} L${x - 0.9} ${y - 0.9} Z" fill="#fffbe0">` +
            `<animate attributeName="opacity" values=".35;1;.35" dur="1.8s" begin="${d}s" repeatCount="indefinite"/></path>`,
        )
        .join(''),
  },
  // 額の角と、とげの背びれ
  tsuno: {
    tail: 'M-10 0 L-20 -11 L-16 0 L-20 11 Z',
    dorsal: 'M8 -8 L5 -15 L2 -9 L-1 -16 L-4 -9 L-7 -14 L-9 -6 Z',
    extra: b => `<path d="M12 -6 L25 -13 L15 -2 Z" fill="${mix(b, '#ffffff', 0.55)}" stroke="${mix(b, '#0d1117', 0.3)}" stroke-width=".6"/>`,
  },
  // 赤・黄・青の筋が横に流れる
  niji: {
    tail: 'M-10 0 C-16 -10 -24 -12 -26 -10 Q-20 0 -26 10 C-24 12 -16 10 -10 0 Z',
    dorsal: 'M5 -8 Q-2 -17 -9 -7 Z',
    extra: () =>
      [['#ff7b72', -4], ['#e3b341', 0], ['#79c0ff', 4]].map(([c, y]) => `<path d="M-10 ${y} Q2 ${Number(y) - 3} 14 ${y}" stroke="${c}" stroke-width="2" fill="none" opacity=".85"/>`).join(''),
  },
  // 一番珍しい: 長い赤いたてがみが揺れ、尾が細く長い
  ryugu: {
    tail: 'M-10 0 C-22 -3 -30 -2 -40 -6 C-32 0 -32 0 -40 6 C-30 2 -22 3 -10 0 Z',
    dorsal: 'M10 -8 Q8 -12 4 -10 Z',
    extra: () => {
      const a = 'M10 -9 Q4 -24 -2 -12 Q-8 -22 -14 -9 Q-22 -18 -30 -5'
      const z = 'M10 -9 Q2 -20 -2 -11 Q-10 -24 -14 -8 Q-20 -14 -30 -3'
      return `<path d="${a}" stroke="#f85149" stroke-width="2.4" fill="none" stroke-linecap="round"><animate attributeName="d" values="${a};${z};${a}" dur="1.6s" repeatCount="indefinite"/></path>`
    },
  },
}

/** 魚の形 1 匹分。body は胴の色、fill は胴の塗り (グラデーションの url か色) */
const fishShape = (f: AquaFish, body: string, fill: string, tailAnim: string, eye: string) => {
  const s = (SHAPE as Partial<Record<FishKind, (typeof SHAPE)['maru']>>)[f.kind] ?? SHAPE.maru
  return (
    `<path d="${s.tail}" fill="${mix(body, '#0d1117', 0.25)}">${tailAnim}</path>` +
    `<path d="M16 0 C10 -11 -6 -11 -12 0 C-6 11 10 11 16 0 Z" fill="${fill}"/>` +
    s.extra(body) +
    `<path d="${s.dorsal}" fill="${mix(body, '#0d1117', 0.2)}"/>` +
    `<path d="M1 3 Q-3 9 -6 4 Z" fill="${mix(body, '#ffffff', 0.25)}" opacity=".8"/>` +
    `<path d="M4 -7 Q1 0 4 7" stroke="#ffffff" stroke-width="1" fill="none" opacity=".3"/>` +
    eye
  )
}

const colorOf = (f: AquaFish) => FISH_COLORS[f.id % FISH_COLORS.length] ?? '#f78166'

/** f は魚、i は並びの番号 (泳ぐ高さと速さの種、グラデーションの id) */
const fish = (f: AquaFish, i: number, m: Mood) => {
  const r = rng(i * 7919 + 13)
  r() // 0.2.x で大きさに使っていた 1 個を読み飛ばし、泳ぐ高さを前と同じにする
  const color = colorOf(f)
  const scale = STAGE_SCALE[stageOf(f.turnsSeen)]
  const y = f1(TOP + 40 + r() * 150)
  const x1 = f1(28 + r() * 40)
  const x2 = f1(W - 28 - r() * 40)
  const speed = m.isRunning ? 0.55 : m.isHungry ? 1.6 : 1
  const dur = f1((16 + r() * 12) * speed)
  const begin = f1(-r() * dur)
  const tail = f1((m.isRunning ? 0.28 : m.isHungry ? 0.9 : 0.5) * (0.9 + r() * 0.3))
  const body = m.isUpset ? '#f85149' : color
  const id = `g${i}`

  const drawing = fishShape(
    f,
    body,
    `url(#${id})`,
    `<animateTransform attributeName="transform" type="rotate" values="-16 -10 0;16 -10 0;-16 -10 0" dur="${m.isIdle ? 2.6 : tail}s" repeatCount="indefinite"/>`,
    // 夜は目がほんのり光る
    m.isNight
      ? `<circle class="eye-glow" cx="9" cy="-2" r="5" fill="#fff3a0" opacity=".3"><animate attributeName="opacity" values=".15;.45;.15" dur="${f1(2.4 + (i % 3) * 0.5)}s" repeatCount="indefinite"/></circle>` +
          `<circle cx="9" cy="-2" r="2.4" fill="#fff8c4"/><circle cx="9.7" cy="-2" r="1.2" fill="#0d1117"/>`
      : `<circle cx="9" cy="-2" r="2.4" fill="#f0f6fc"/><circle cx="9.7" cy="-2" r="1.2" fill="#0d1117"/>`,
  )

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
  const barColor = v.fullness < HUNGRY ? C.red : v.fullness < 60 ? C.yellow : C.green
  const status = v.isUpset ? 'びっくり' : t.isRunning ? '作業中' : v.isIdle ? 'おやすみ' : '待機'
  const statusColor = v.isUpset ? C.red : t.isRunning ? C.green : C.dim
  return (
    // 文字の地 (空の帯の上に、テーマの面の色で敷く)
    `<rect x="6" y="5" width="${W - 12}" height="21" rx="8" fill="${C.face}" opacity=".88"/>` +
    `<text x="14" y="20" font-size="12" fill="${C.dim}" font-family="sans-serif">満腹</text>` +
    `<rect x="44" y="11" width="${bar}" height="10" rx="5" fill="${C.line}"/>` +
    `<rect x="44" y="11" width="${fill}" height="10" rx="5" fill="${barColor}"/>` +
    `<text x="${44 + bar + 6}" y="20" font-size="12" fill="${C.text}" font-family="sans-serif">${v.fullness}%</text>` +
    `<text x="${W - 14}" y="20" font-size="12" fill="${statusColor}" font-family="sans-serif" text-anchor="end">${status} / ${v.season}の${v.period}</text>`
  )
}

export const drawTank = (t: AquaTank): string => {
  const v = t.view
  const c = LIGHT[v.period]
  const w = waterAt(v.slot, v.season)
  const isNight = v.period === '夜'
  const mood: Mood = {
    isRunning: t.isRunning,
    isUpset: v.isUpset,
    isIdle: v.isIdle && !v.isUpset,
    isHungry: v.fullness < HUNGRY,
    isNight,
  }
  // 季節の飾り: 春は花びら、夏は泡を増やしてきらめき、秋は落ち葉、冬は雪
  const deco = v.season === '春' ? petals() : v.season === '夏' ? glints() : v.season === '秋' ? leaves() : snow()
  const extraBubbles = v.season === '夏' ? 8 : 0
  // 育った魚を手前に (後に描く)
  const fishes = fishOf(t)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.turnsSeen - b.f.turnsSeen)
    .map(({ f, i }) => fish(f, i, mood))
  const surface0 = `M0 ${TOP} Q45 ${TOP - 3} 90 ${TOP} T180 ${TOP} T270 ${TOP} T360 ${TOP}`
  const surface1 = `M0 ${TOP} Q45 ${TOP + 3} 90 ${TOP} T180 ${TOP} T270 ${TOP} T360 ${TOP}`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">` +
    `<defs>` +
    `<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${w.top}"/><stop offset=".55" stop-color="${w.mid}"/><stop offset="1" stop-color="${w.bottom}"/></linearGradient>` +
    (v.season === '冬' ? `<linearGradient id="frost" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6f0fa" stop-opacity=".22"/><stop offset="1" stop-color="#e6f0fa" stop-opacity="0"/></linearGradient>` : '') +
    `<linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.ray}" stop-opacity=".9"/><stop offset="1" stop-color="${c.ray}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a86a"/><stop offset="1" stop-color="#6b5330"/></linearGradient>` +
    `<filter id="dull"><feColorMatrix type="saturate" values=".3"/></filter>` +
    `<clipPath id="glass"><rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="12"/></clipPath>` +
    fishes.map(f => f.grad).join('') +
    `</defs>` +
    `<rect width="${W}" height="${H}" rx="14" fill="${C.bg}"/>` +
    `<g clip-path="url(#glass)">` +
    `<rect x="0" y="0" width="${W}" height="${TOP}" fill="${c.sky}"/>` +
    `<rect x="0" y="${TOP}" width="${W}" height="${H - TOP}" fill="url(#water)"/>` +
    rays(c) +
    sand(rng(31)) +
    plants() +
    bubbles((t.isRunning ? 11 : 5) + extraBubbles, t.isRunning) +
    deco +
    (v.isFeeding ? pellets() : '') +
    `<g${mood.isHungry && !mood.isUpset ? ' filter="url(#dull)" opacity=".85"' : ''}>${fishes.map(f => f.body).join('')}</g>` +
    (mood.isIdle ? zzz() : '') +
    murk(t.murk) +
    `<rect x="0" y="${TOP}" width="${W}" height="${H - TOP}" fill="${c.tint}" opacity="${c.tintOp}"/>` +
    `<path d="${surface0}" stroke="#e6f6ff" stroke-width="1.5" fill="none" opacity=".35"><animate attributeName="d" values="${surface0};${surface1};${surface0}" dur="3s" repeatCount="indefinite"/></path>` +
    `<path d="M20 ${TOP + 14} L44 ${TOP + 14} L14 ${H - 20} L-10 ${H - 20} Z" fill="#ffffff" opacity=".04"/>` +
    hud(t, v) +
    (isNight ? moon() : v.period === '夕' ? sunset() : '') +
    `</g>` +
    `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="13" fill="none" stroke="${C.line}" stroke-width="3"/>` +
    `</svg>`
  )
}

// ---------------------------------------------------------------- 魚の一覧

/** 日本時間の「10月20日」 */
export const dayOf = (ms: number) => {
  const d = new Date(ms + 9 * HOUR)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

const stageColor = (s: FishStage) => (s === '稚魚' ? C.dim : s === '若魚' ? C.blue : s === '成魚' ? C.green : C.yellow)

/** 魚の一覧の 1 行ぶんの言葉 (terminal と SVG で同じ物を使う) */
export const fishLine = (f: AquaFish) => ({
  title: `${(KIND_NAME as Partial<Record<FishKind, string>>)[f.kind] ?? 'なぞの魚'}${f.name ? ` ${f.name}` : ''}`,
  stage: stageOf(f.turnsSeen),
  came: `${dayOf(f.bornAt)}に来た / ${f.turnsSeen}ターン`,
})

/** 魚の一覧。種類・段階・来た日を、小さな絵と並べる */
export const fishListSvg = (fish: readonly AquaFish[]): string => {
  const ROW = 50
  const top = 52
  const h = top + fish.length * ROW + 8
  const rows = fish
    .map((f, k) => {
      const y = top + k * ROW
      const l = fishLine(f)
      const s = Math.min(1, STAGE_SCALE[l.stage])
      const color = colorOf(f)
      const eye = `<circle cx="9" cy="-2" r="2.4" fill="#f0f6fc"/><circle cx="9.7" cy="-2" r="1.2" fill="#0d1117"/>`
      return (
        panel(10, y, 360, ROW - 6) +
        `<g transform="translate(46 ${y + 24}) scale(${s})">${fishShape(f, color, color, '', eye)}</g>` +
        `<text x="84" y="${y + 19}" font-size="14" font-weight="bold" fill="${C.text}">${esc(l.title)}</text>` +
        `<text x="358" y="${y + 19}" font-size="13" font-weight="bold" fill="${stageColor(l.stage)}" text-anchor="end">${l.stage}</text>` +
        `<text x="84" y="${y + 36}" font-size="12" fill="${C.dim}">${esc(l.came)}</text>`
      )
    })
    .join('')
  return frame(h, header('魚の一覧', `${fish.length} 匹`, C.blue) + rows)
}
