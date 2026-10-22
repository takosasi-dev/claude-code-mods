// 全 mod で共通の見た目(色・見出し・動き)と小物。
// 正本は shared/style.ts。各 mod の hooks/style.ts はその写しなので、直すのは正本だけにして
// `node tools/copy_shared.mts` で写す(`--check` で写しのずれを見つける)。
import type { EngineInterface, On } from 'claude-code'

export type Palette = {
  bg: string
  face: string
  line: string
  text: string
  dim: string
  weak: string
  blue: string
  green: string
  yellow: string
  red: string
  purple: string
  orange: string
}

/** GitHub Dark 系(docs/mod-guide.md の 7 節) */
export const DARK: Palette = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  dim: '#8b949e',
  weak: '#8b949e',
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
  orange: '#f78166',
}

/** GitHub Light 系 */
export const LIGHT: Palette = {
  bg: '#ffffff',
  face: '#f6f8fa',
  line: '#d0d7de',
  text: '#1f2328',
  dim: '#656d76',
  weak: '#656d76',
  blue: '#0969da',
  green: '#1a7f37',
  yellow: '#9a6700',
  red: '#cf222e',
  purple: '#8250df',
  orange: '#bc4c00',
}

// ponytail: 今の色はモジュールの変数 1 個(この mod の中だけ)。SVG を作る関数は C.bg などを呼ぶたびに読むので、
// 引数を増やさずにテーマが変わる。描く途中で切り替わることは無い(JS は 1 本で走る)
/** 今の色。setTheme で中身が入れ替わる(同じ物を指し続けるので、import した C のままでよい) */
export const C: Palette = { ...DARK }
let isLightNow = false

export const isLight = () => isLightNow

/** /config の theme の値が明るい系か('light'・'light-daltonized'・'light-ansi' など) */
export const isLightTheme = (value: unknown) => typeof value === 'string' && value.startsWith('light')

export function setTheme(light: boolean) {
  isLightNow = light
  Object.assign(C, light ? LIGHT : DARK)
}

/**
 * 今の /config の theme を読んで色を合わせる。mod 自身の session.start の中で呼ぶ
 * (同じイベントに matcher 無しのフックを 2 つ置くと読み込みを拒まれるので、ここでは on しない)。
 * VS Code の配色は mod から読めないので、Claude Code の theme が light 系の時だけ明るくなる
 */
export async function readTheme($: EngineInterface) {
  const rows = await $.config.list().catch(() => [])
  setTheme(isLightTheme(rows.find(r => r.key === 'theme')?.value))
}

/** /config で theme が変わったら色を替えて描き直す。register の中で 1 回呼ぶ */
export function followTheme(on: On) {
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined) {
      setTheme(isLightTheme(r.value))
      $.ui.invalidate('ui.render')
    }
    return r
  })
}

// ---- 小物 ----

/** 外から来る文字列の制御文字を落とす。エンジンは制御文字を含む Text の子や alt を拒み、ペインが閉じる */
export const clean = (s: string) => s.replace(/[\t\n\r]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim()

/** SVG の文字に入れる前のエスケープ(制御文字も落とす) */
export const esc = (s: string) =>
  clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---- 時間帯と季節 (日本時間 JST = UTC+9 固定。動いている環境のタイムゾーンには頼らない) ----

export type DayPart = '朝' | '昼' | '夕' | '夜'
export type Season = '春' | '夏' | '秋' | '冬'

const jstDate = (now: number) => new Date(now + 9 * 3_600_000)

/** 時間帯。朝 5-10 時 / 昼 10-16 時 / 夕 16-19 時 / 夜 19-5 時 */
export const dayPart = (now: number): DayPart => {
  const h = jstDate(now).getUTCHours()
  return h >= 5 && h < 10 ? '朝' : h >= 10 && h < 16 ? '昼' : h >= 16 && h < 19 ? '夕' : '夜'
}

/** 季節。春 3-5 月 / 夏 6-8 月 / 秋 9-11 月 / 冬 12-2 月 */
export const season = (now: number): Season => {
  const m = jstDate(now).getUTCMonth() + 1
  return m >= 3 && m <= 5 ? '春' : m >= 6 && m <= 8 ? '夏' : m >= 9 && m <= 11 ? '秋' : '冬'
}

/** n 文字を超えたら … で切る */
export const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)

// ---- SVG の部品 ----

export const W = 380
export const HEADER_H = 44

/** SVG 全体の枠。地を塗って body を入れる。幅は W にそろえる */
export const frame = (h: number, body: string, w = W) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="sans-serif">` +
  `<rect width="${w}" height="${h}" rx="10" fill="${C.bg}"/>${body}</svg>`

/** 面(カード)。角丸 8、線 1 */
export const panel = (x: number, y: number, w: number, h: number, fill = C.face) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${C.line}"/>`

/**
 * 共通の見出し帯(高さ HEADER_H)。左に色の縦線、左に題、右に添え書き。
 * 下の細い線が左から伸びる
 */
export function header(title: string, sub = '', accent = C.blue, y = 0, w = W) {
  const pad = 14
  return [
    `<rect x="0" y="${y}" width="${w}" height="${HEADER_H}" rx="10" fill="${C.face}"/>`,
    `<rect x="0" y="${y + 8}" width="4" height="${HEADER_H - 16}" rx="2" fill="${accent}"/>`,
    `<text x="${pad}" y="${y + 28}" font-size="16" font-weight="bold" fill="${C.text}">${esc(title)}</text>`,
    sub === '' ? '' : `<text x="${w - pad}" y="${y + 28}" font-size="12" fill="${C.dim}" text-anchor="end">${esc(sub)}</text>`,
    growBar(pad, y + HEADER_H - 3, w - pad * 2, 2, accent, 0, 0.35),
  ].join('')
}

/** 横に伸びる棒。幅 0 から w まで伸びて止まる(shots.mts は終わりの値で撮る) */
export const growBar = (x: number, y: number, w: number, h: number, fill: string, delay = 0, opacity = 1) =>
  `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${h}" rx="${Math.min(3, h / 2)}" fill="${fill}"${opacity === 1 ? '' : ` opacity="${opacity}"`}>` +
  `<animate attributeName="width" from="0" to="${Math.max(0, w)}" begin="${delay}s" dur="0.6s" fill="freeze"/></rect>`

/** 下から伸びる縦の棒(下端 bottom・高さ h) */
export const growColumn = (x: number, bottom: number, w: number, h: number, fill: string, delay = 0) =>
  `<rect x="${x}" y="${bottom - h}" width="${w}" height="${Math.max(0, h)}" rx="${Math.min(3, w / 2)}" fill="${fill}">` +
  `<animate attributeName="y" from="${bottom}" to="${bottom - h}" begin="${delay}s" dur="0.6s" fill="freeze"/>` +
  `<animate attributeName="height" from="0" to="${Math.max(0, h)}" begin="${delay}s" dur="0.6s" fill="freeze"/></rect>`

/** ふわっと出る。中身は SVG の断片 */
export const fadeIn = (body: string, delay = 0) =>
  `<g opacity="1"><animate attributeName="opacity" from="0" to="1" begin="${delay}s" dur="0.4s" fill="freeze"/>${body}</g>`

/**
 * 0 から value まで数字が増えて止まる。コマ送りの文字を重ね、最後のコマだけが残る。
 * attrs は <text> に付ける属性(x・y・font-size・fill など)。format で桁区切りや単位を付ける
 */
export function countUp(value: number, attrs: string, format: (n: number) => string = n => String(n), delay = 0) {
  const STEPS = 8
  const d = 0.08
  const last = `<text ${attrs} opacity="0">${esc(format(value))}<animate attributeName="opacity" from="0" to="1" begin="${(delay + (STEPS - 1) * d).toFixed(2)}s" dur="0.01s" fill="freeze"/></text>`
  if (!Number.isFinite(value) || value === 0) return `<text ${attrs}>${esc(format(value))}</text>`
  const frames = Array.from({ length: STEPS - 1 }, (_, k) => {
    const n = Number.isInteger(value) ? Math.round((value * k) / (STEPS - 1)) : (value * k) / (STEPS - 1)
    return `<text ${attrs} opacity="0">${esc(format(n))}<animate attributeName="opacity" values="1;1" begin="${(delay + k * d).toFixed(2)}s" dur="${d}s"/></text>`
  })
  return frames.join('') + last
}
