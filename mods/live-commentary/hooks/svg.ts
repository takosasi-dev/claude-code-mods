// 実況席の絵。数字が毎秒変わる板と、流れ続けるテロップと、照明の絵は別々の Svg にする
// (source が変わるとアニメが頭からやり直しになるため)
import type { LiveCommentaryClock, LiveCommentaryKind, LiveCommentaryLine, LiveCommentaryScore } from '../types'
import { clean, duration } from './phrases'

const W = 380
const BG = '#0d1117'
const FACE = '#161b22'
const LINE = '#30363d'
const FG = '#c9d1d9'
const DIM = '#8b949e'
const BLUE = '#58a6ff'
const GREEN = '#3fb950'
const YELLOW = '#d29922'
const RED = '#f85149'
const PURPLE = '#bc8cff'
const ORANGE = '#f78166'

export const KIND_COLOR: Record<LiveCommentaryKind, string> = { play: FG, error: RED, cheer: YELLOW, whistle: BLUE }

const esc = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 文字幅のおおよそ (全角 = size、半角 = 0.6 size) */
const textWidth = (s: string, size: number) => [...s].reduce((w, c) => w + ((c.codePointAt(0) ?? 0) > 0xff ? size : size * 0.6), 0)

const svg = (h: number, body: string[]) =>
  [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">`, ...body, '</svg>'].join('')

/** 照明塔 1 本 (x は塔の中心)。オンなら光の筋がゆらぐ */
function tower(x: number, dir: 1 | -1, isOn: boolean, delay: number): string {
  const lamps: string[] = []
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++) {
      const lx = x - 15 + c * 10
      const ly = 14 + r * 9
      lamps.push(
        `<circle cx="${lx}" cy="${ly}" r="3.4" fill="${isOn ? '#fff8dc' : '#3a3f47'}">${
          isOn ? `<animate attributeName="opacity" values="1;0.75;1" dur="${(1.6 + c * 0.3).toFixed(1)}s" begin="${delay}s" repeatCount="indefinite"/>` : ''
        }</circle>`,
      )
    }
  const beam = isOn
    ? `<polygon points="${x - 18},20 ${x + 18},20 ${x + dir * 150},110 ${x + dir * 30},110" fill="url(#beam)" opacity="0.3"><animate attributeName="opacity" values="0.22;0.4;0.22" dur="3s" begin="${delay}s" repeatCount="indefinite"/></polygon>`
    : ''
  return [
    beam,
    `<rect x="${x - 2}" y="28" width="4" height="62" fill="${LINE}"/>`,
    `<rect x="${x - 21}" y="7" width="42" height="24" rx="3" fill="#21262d" stroke="${LINE}"/>`,
    ...lamps,
  ].join('')
}

/** スタジアムの絵 (オン/オフと口調でしか変わらない) */
export function stadiumSvg(isOn: boolean, style: string): string {
  const H = 132
  const crowd: string[] = []
  const colors = [BLUE, GREEN, YELLOW, RED, PURPLE, ORANGE]
  for (let i = 0; i < 30; i++) {
    const cx = 10 + i * 12.4
    const cy = 98 + (i % 2) * 6
    const color = colors[(i * 7) % colors.length]
    const wave = isOn
      ? `<animate attributeName="cy" values="${cy};${cy - 5};${cy}" dur="1.8s" begin="${((i * 0.06) % 1.8).toFixed(2)}s" repeatCount="indefinite"/>`
      : ''
    crowd.push(`<circle cx="${cx.toFixed(1)}" cy="${cy}" r="4.2" fill="${color}" opacity="${isOn ? 0.85 : 0.35}">${wave}</circle>`)
  }
  return svg(H, [
    `<defs>`,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070b"/><stop offset="1" stop-color="${isOn ? '#132238' : BG}"/></linearGradient>`,
    `<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8dc" stop-opacity="0.9"/><stop offset="1" stop-color="#fff8dc" stop-opacity="0"/></linearGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" rx="10" fill="url(#sky)"/>`,
    tower(46, 1, isOn, 0),
    tower(W - 46, -1, isOn, 1.2),
    `<rect x="0" y="106" width="${W}" height="26" fill="${isOn ? '#1a7f37' : '#1c2a20'}"/>`,
    `<line x1="${W / 2}" y1="106" x2="${W / 2}" y2="132" stroke="#e6f6ff" stroke-opacity="0.4"/>`,
    ...crowd,
    `<text x="${W / 2}" y="46" font-size="22" font-weight="bold" fill="${FG}" text-anchor="middle">実況席</text>`,
    `<rect x="${W / 2 - 46}" y="56" width="92" height="22" rx="11" fill="${FACE}" stroke="${isOn ? RED : LINE}"/>`,
    isOn
      ? `<circle cx="${W / 2 - 32}" cy="67" r="4" fill="${RED}"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></circle>`
      : '',
    `<text x="${W / 2 + 6}" y="72" font-size="12" fill="${isOn ? FG : DIM}" text-anchor="middle">${isOn ? `${esc(style)} 実況中` : '実況オフ'}</text>`,
  ])
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 時計の文: 試合中なら経過、終わっていれば前の試合の長さ */
export const clockLabel = (c: LiveCommentaryClock) =>
  c.startedAt > 0 ? `試合時間 ${mmss(c.now - c.startedAt)}` : c.lastMs > 0 ? `前の試合 ${duration(c.lastMs)}` : '試合前'

/** スコアボード (アニメ無し。数と時計が変わるたびに描き直す) */
export function boardSvg(score: LiveCommentaryScore, clock: LiveCommentaryClock): string {
  const H = 104
  const cells: [string, number, string][] = [
    ['成功', score.ok, GREEN],
    ['エラー', score.err, RED],
    ['連続', score.streak, YELLOW],
  ]
  const cw = (W - 32) / 3
  const body = cells.flatMap(([label, n, color], i) => {
    const cx = 16 + cw * i + cw / 2
    return [
      `<rect x="${16 + cw * i + 4}" y="12" width="${cw - 8}" height="56" rx="6" fill="${BG}" stroke="${LINE}"/>`,
      `<text x="${cx}" y="30" font-size="12" fill="${DIM}" text-anchor="middle">${label}</text>`,
      `<text x="${cx}" y="58" font-size="24" font-weight="bold" fill="${color}" text-anchor="middle" font-family="monospace">${n}</text>`,
    ]
  })
  const isLive = clock.startedAt > 0
  return svg(H, [
    `<rect width="${W}" height="${H}" rx="10" fill="${FACE}" stroke="${LINE}"/>`,
    ...body,
    `<text x="${W / 2}" y="92" font-size="14" fill="${isLive ? YELLOW : DIM}" text-anchor="middle" font-family="monospace">${esc(clockLabel(clock))}</text>`,
  ])
}

/** 最新の実況を大きく、テロップのように右から左へ流す */
export function tickerSvg(line: LiveCommentaryLine | null, isOn: boolean): string {
  const H = 80
  const text = !isOn ? '実況はお休み中です' : line?.text ?? 'まもなく試合開始です'
  const color = !isOn ? DIM : KIND_COLOR[line?.kind ?? 'play']
  const size = 20
  const tw = Math.ceil(textWidth(text, size))
  // 左端で少し止めて読ませ、左へ流れて消え、右から戻ってくる
  const x0 = 16
  const speed = 70
  const hold = 1.6
  const out = (x0 + tw) / speed
  const back = (W - x0) / speed
  const total = hold + out + back
  const k1 = (hold / total).toFixed(3)
  const k2 = ((hold + out) / total).toFixed(3)
  // keyTimes に同じ値を並べるとアニメごと無視されるので、右端へは 0.001 の間で跳ぶ
  const k3 = ((hold + out) / total + 0.001).toFixed(3)
  return svg(H, [
    `<defs><clipPath id="band"><rect x="0" y="30" width="${W}" height="42"/></clipPath></defs>`,
    `<rect width="${W}" height="${H}" rx="10" fill="${BG}" stroke="${LINE}"/>`,
    `<rect x="12" y="8" width="46" height="18" rx="4" fill="${isOn ? RED : LINE}"/>`,
    `<text x="35" y="21" font-size="12" font-weight="bold" fill="${isOn ? '#ffffff' : DIM}" text-anchor="middle">LIVE</text>`,
    `<text x="68" y="21" font-size="12" fill="${DIM}">最新の実況</text>`,
    `<rect x="0" y="30" width="${W}" height="42" fill="${FACE}"/>`,
    `<rect x="0" y="30" width="${W}" height="2" fill="${color}" opacity="0.6"/>`,
    `<g clip-path="url(#band)"><text x="0" y="58" font-size="${size}" font-weight="bold" fill="${color}" transform="translate(${x0} 0)">${esc(text)}`,
    `<animateTransform attributeName="transform" type="translate" values="${x0} 0;${x0} 0;${-tw} 0;${W} 0;${x0} 0" keyTimes="0;${k1};${k2};${k3};1" dur="${total.toFixed(1)}s" repeatCount="indefinite"/>`,
    `</text></g>`,
  ])
}
