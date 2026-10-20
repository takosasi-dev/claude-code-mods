// 実況席の絵。数字が毎秒変わる板と、流れ続けるテロップと、照明の絵は別々の Svg にする
// (source が変わるとアニメが頭からやり直しになるため)
import type { ThemeKey } from 'claude-code'

import type { LiveCommentaryClock, LiveCommentaryKind, LiveCommentaryLine, LiveCommentaryScore } from '../types'
import { duration } from './phrases'
import { C, DARK, HEADER_H, W, countUp, esc, frame, header, panel } from './style'

/** 実況の種類の色 (SVG 用。今のテーマの色を呼ぶたびに読む) */
export const kindColor = (kind: LiveCommentaryKind) => ({ play: C.text, error: C.red, cheer: C.yellow, whistle: C.blue })[kind]

/** 実況の種類の色 (Text 用。テーマの名前なので明るいテーマにも付いていく) */
export const KIND_THEME: Record<LiveCommentaryKind, ThemeKey | undefined> = { play: undefined, error: 'error', cheer: 'warning', whistle: 'suggestion' }

/** 見出しの動きを抜く。何度も描き直す絵で、下線が描き直しのたびに伸び直さないように */
const still = (s: string) => s.replace(/<animate\b[^>]*\/>/g, '')

/** 文字幅のおおよそ (全角 = size、半角 = 0.6 size) */
const textWidth = (s: string, size: number) => [...s].reduce((w, c) => w + ((c.codePointAt(0) ?? 0) > 0xff ? size : size * 0.6), 0)

const svg = (h: number, body: string[]) =>
  [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">`, ...body, '</svg>'].join('')

// 夜のスタジアムは情景なので、テーマによらず暗い色のまま (明るいテーマでも夜空の上の字は明るく)
const LAMP_OFF = '#3a3f47'
const LAMP = '#fff8dc'
const SKY_TOP = '#05070b'
const SKY_ON = '#132238'
const GRASS_ON = '#1a7f37'
const GRASS_OFF = '#1c2a20'
const BOX = '#21262d'

/** 照明塔 1 本 (x は塔の中心)。オンなら光の筋がゆらぐ */
function tower(x: number, dir: 1 | -1, isOn: boolean, delay: number): string {
  const lamps: string[] = []
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++) {
      const lx = x - 15 + c * 10
      const ly = 14 + r * 9
      lamps.push(
        `<circle cx="${lx}" cy="${ly}" r="3.4" fill="${isOn ? LAMP : LAMP_OFF}">${
          isOn ? `<animate attributeName="opacity" values="1;0.75;1" dur="${(1.6 + c * 0.3).toFixed(1)}s" begin="${delay}s" repeatCount="indefinite"/>` : ''
        }</circle>`,
      )
    }
  const beam = isOn
    ? `<polygon points="${x - 18},20 ${x + 18},20 ${x + dir * 150},110 ${x + dir * 30},110" fill="url(#beam)" opacity="0.3"><animate attributeName="opacity" values="0.22;0.4;0.22" dur="3s" begin="${delay}s" repeatCount="indefinite"/></polygon>`
    : ''
  return [
    beam,
    `<rect x="${x - 2}" y="28" width="4" height="62" fill="${DARK.line}"/>`,
    `<rect x="${x - 21}" y="7" width="42" height="24" rx="3" fill="${BOX}" stroke="${DARK.line}"/>`,
    ...lamps,
  ].join('')
}

/** スタジアムの絵 (オン/オフと口調でしか変わらない) */
export function stadiumSvg(isOn: boolean, style: string): string {
  const H = 132
  const crowd: string[] = []
  const colors = [DARK.blue, DARK.green, DARK.yellow, DARK.red, DARK.purple, DARK.orange]
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
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKY_TOP}"/><stop offset="1" stop-color="${isOn ? SKY_ON : DARK.bg}"/></linearGradient>`,
    `<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${LAMP}" stop-opacity="0.9"/><stop offset="1" stop-color="${LAMP}" stop-opacity="0"/></linearGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" rx="10" fill="url(#sky)"/>`,
    tower(46, 1, isOn, 0),
    tower(W - 46, -1, isOn, 1.2),
    `<rect x="0" y="106" width="${W}" height="26" fill="${isOn ? GRASS_ON : GRASS_OFF}"/>`,
    `<line x1="${W / 2}" y1="106" x2="${W / 2}" y2="132" stroke="#e6f6ff" stroke-opacity="0.4"/>`,
    ...crowd,
    `<text x="${W / 2}" y="46" font-size="22" font-weight="bold" fill="${DARK.text}" text-anchor="middle">実況席</text>`,
    // 札は地の部品なので今のテーマの色
    `<rect x="${W / 2 - 46}" y="56" width="92" height="22" rx="11" fill="${C.face}" stroke="${isOn ? C.red : C.line}"/>`,
    isOn
      ? `<circle cx="${W / 2 - 32}" cy="67" r="4" fill="${C.red}"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></circle>`
      : '',
    `<text x="${W / 2 + 6}" y="72" font-size="12" fill="${isOn ? C.text : C.dim}" text-anchor="middle">${isOn ? `${esc(style)} 実況中` : '実況オフ'}</text>`,
  ])
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 時計の文: 試合中なら経過、終わっていれば前の試合の長さ */
export const clockLabel = (c: LiveCommentaryClock) =>
  c.startedAt > 0 ? `試合時間 ${mmss(c.now - c.startedAt)}` : c.lastMs > 0 ? `前の試合 ${duration(c.lastMs)}` : '試合前'

/**
 * スコアボード。試合中は時計で毎秒描き直すので動きは無し。
 * 試合の外 (試合前・前の試合) は描き直さないので、数字が 0 から増える
 */
export function boardSvg(score: LiveCommentaryScore, clock: LiveCommentaryClock): string {
  const isLive = clock.startedAt > 0
  const top = HEADER_H + 10
  const H = top + 56 + 12
  const cells: [string, number, string][] = [
    ['成功', score.ok, C.green],
    ['エラー', score.err, C.red],
    ['連続', score.streak, C.yellow],
  ]
  const cw = (W - 32) / 3
  const body = cells.flatMap(([label, n, color], i) => {
    const cx = 16 + cw * i + cw / 2
    const attrs = `x="${cx}" y="${top + 46}" font-size="24" font-weight="bold" fill="${color}" text-anchor="middle" font-family="monospace"`
    return [
      panel(16 + cw * i + 4, top, cw - 8, 56),
      `<text x="${cx}" y="${top + 18}" font-size="12" fill="${C.dim}" text-anchor="middle">${label}</text>`,
      isLive ? `<text ${attrs}>${n}</text>` : countUp(n, attrs, String, 0.2 + i * 0.1),
    ]
  })
  return frame(H, still(header('スコア', clockLabel(clock), isLive ? C.yellow : C.dim)) + body.join(''))
}

/** 最新の実況を大きく、テロップのように右から左へ流す */
export function tickerSvg(line: LiveCommentaryLine | null, isOn: boolean): string {
  const band = HEADER_H + 8
  const H = band + 42 + 8
  const text = !isOn ? '実況はお休み中です' : line?.text ?? 'まもなく試合開始です'
  const color = !isOn ? C.dim : kindColor(line?.kind ?? 'play')
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
  return frame(
    H,
    [
      `<defs><clipPath id="band"><rect x="0" y="${band}" width="${W}" height="42"/></clipPath></defs>`,
      // 実況のたびに描き直すので、見出しは動かさない
      still(header('最新の実況', isOn ? 'LIVE' : 'お休み中', isOn ? C.red : C.dim)),
      `<rect x="0" y="${band}" width="${W}" height="42" fill="${C.face}"/>`,
      `<rect x="0" y="${band}" width="${W}" height="2" fill="${color}" opacity="0.6"/>`,
      `<g clip-path="url(#band)"><text x="0" y="${band + 28}" font-size="${size}" font-weight="bold" fill="${color}" transform="translate(${x0} 0)">${esc(text)}`,
      `<animateTransform attributeName="transform" type="translate" values="${x0} 0;${x0} 0;${-tw} 0;${W} 0;${x0} 0" keyTimes="0;${k1};${k2};${k3};1" dur="${total.toFixed(1)}s" repeatCount="indefinite"/>`,
      `</text></g>`,
    ].join(''),
  )
}
