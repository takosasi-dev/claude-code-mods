import type { FaceBandMood, FaceBandNow } from '../types'
import { C } from './style'
import type { DayPart, Season } from './style'

// 制御文字を落とす(エンジンは制御文字を含む Text の子や alt を拒み、帯が描かれなくなる)
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g
export const clean = (s: string) => s.replace(CONTROL, '').replace(/\s+/g, ' ').trim()

/** 長い MCP 名などは頭を残して切る */
export const short = (raw: string, max = 24) => {
  const name = clean(raw)
  return name.length > max ? `${name.slice(0, max - 3)}...` : name
}

export const IDLE: FaceBandNow = { mood: 'idle', word: '待っています', tool: '', active: 0, seq: 0 }

/** ターンの終わり方の一言 */
export const endWord = (reason: string) =>
  reason === 'answer' ? 'できました' : reason === 'aborted' ? '中断しました' : reason === 'refusal' ? '答えられませんでした' : 'エラーで止まりました'

/** terminal で顔の代わりに出す文字 */
export const FACE_TEXT: Record<FaceBandMood, string> = {
  idle: '(・_・)',
  think: '(・_・)...',
  tool: '(;・_・)',
  happy: '(^_^)',
  sad: '(T_T)',
}

// 気分ごとの色。テーマに付いていくよう、呼ぶたびに C から読む
const colorOf = (mood: FaceBandMood) =>
  ({ idle: C.dim, think: C.purple, tool: C.blue, happy: C.green, sad: C.yellow })[mood]

/** 顔の横の 2 行目: ツール名 */
export const subLine = (now: FaceBandNow) =>
  now.tool === '' ? '' : now.mood === 'tool' ? `${short(now.tool)} を実行中` : `最後のツール: ${short(now.tool)}`

// 目と口。顔ごとに SMIL で動かす。source は顔が変わる時だけ変わるので、アニメは途切れない
const parts: Record<FaceBandMood, (c: string) => string> = {
  // まばたき: 4 秒に 1 回、目が細くなる
  idle: c => `
<ellipse cx="38" cy="36" rx="3.5" ry="4.5" fill="${c}"><animate attributeName="ry" values="4.5;4.5;0.6;4.5" keyTimes="0;0.9;0.95;1" dur="4s" repeatCount="indefinite"/></ellipse>
<ellipse cx="58" cy="36" rx="3.5" ry="4.5" fill="${c}"><animate attributeName="ry" values="4.5;4.5;0.6;4.5" keyTimes="0;0.9;0.95;1" dur="4s" repeatCount="indefinite"/></ellipse>
<path d="M41 52 h14" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`,
  // 考え中: 目が右上を見て、点が右上へ流れる
  think: c => `
<circle cx="38" cy="36" r="5" fill="none" stroke="${c}" stroke-width="2"/><circle cx="58" cy="36" r="5" fill="none" stroke="${c}" stroke-width="2"/>
<circle cx="40" cy="33" r="2.2" fill="${c}"/><circle cx="60" cy="33" r="2.2" fill="${c}"/>
<path d="M42 53 q6 -3 12 0" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>
${[0, 1, 2]
  .map(
    i => `<circle cx="${78 + i * 6}" cy="${20 - i * 6}" r="${2 + i * 0.6}" fill="${c}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="1.5s" begin="${(i * 0.3).toFixed(1)}s" repeatCount="indefinite"/></circle>`,
  )
  .join('\n')}`,
  // ツール実行中: 汗が流れ、手が動く
  tool: c => `
<path d="M33 36 h10 M53 36 h10" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="48" cy="52" rx="5" ry="3.5" fill="none" stroke="${c}" stroke-width="2.5"/>
<path d="M70 14 q-4 7 0 9 q4 -2 0 -9 z" fill="${C.blue}"><animateTransform attributeName="transform" type="translate" values="0 0;0 14" dur="1.2s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;0" dur="1.2s" repeatCount="indefinite"/></path>
<g><animateTransform attributeName="transform" type="rotate" values="-18 82 66;18 82 66;-18 82 66" dur="0.6s" repeatCount="indefinite"/>
<rect x="78" y="48" width="8" height="18" rx="4" fill="${C.face}" stroke="${c}" stroke-width="2"/></g>`,
  // 答え終わり: にっこり
  happy: c => `
<path d="M33 38 q5 -8 10 0 M53 38 q5 -8 10 0" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
<path d="M37 47 q11 12 22 0" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
<circle cx="29" cy="46" r="3.5" fill="${C.orange}" opacity="0.5"/><circle cx="67" cy="46" r="3.5" fill="${C.orange}" opacity="0.5"/>
<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="0.8s" repeatCount="3"/>`,
  // エラー/中断: しょんぼり
  sad: c => `
<path d="M33 34 l10 4 M63 34 l-10 4" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>
<circle cx="38" cy="40" r="2.5" fill="${c}"/><circle cx="58" cy="40" r="2.5" fill="${c}"/>
<path d="M39 56 q9 -8 18 0" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="34" cy="48" rx="1.8" ry="3" fill="${C.blue}"><animate attributeName="cy" values="45;56" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.4s" repeatCount="indefinite"/></ellipse>`,
}

// ---- 時間帯と季節の小物 (色は固定。顔の色だけテーマに付いていく)

/** 夜の待ち: 目を閉じて眠そう、z が上る */
const sleepy = (c: string) => `
<path d="M33 37 q5 4 10 0 M53 37 q5 4 10 0" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>
<ellipse cx="48" cy="53" rx="3" ry="2.2" fill="none" stroke="${c}" stroke-width="2"><animate attributeName="ry" values="2.2;3.2;2.2" dur="3s" repeatCount="indefinite"/></ellipse>
${[0, 1, 2]
  .map(
    i => `<text x="${76 + i * 5}" y="26" font-size="${8 + i * 2}" font-family="sans-serif" font-weight="bold" fill="${c}" opacity="0">z<animate attributeName="y" values="26;8" dur="3s" begin="${i}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="3s" begin="${i}s" repeatCount="indefinite"/></text>`,
  )
  .join('\n')}`

/** 左上の空: 朝は日、夕は沈む日、夜は月 (昼は何も無い) */
const SKY: Record<DayPart, string> = {
  朝: `<g id="sky-morning"><circle cx="11" cy="12" r="4.5" fill="#f2cc60"/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<path d="M11 4.5 V2" stroke="#f2cc60" stroke-width="1.4" stroke-linecap="round" transform="rotate(${a} 11 12)"/>`).join('')}</g>`,
  昼: '',
  夕: `<g id="sky-evening"><path d="M3 17 A8 8 0 0 1 19 17 Z" fill="#f0883e"/><path d="M1 17 H21" stroke="#f0883e" stroke-width="1.2" opacity=".6"/></g>`,
  夜: `<g id="sky-night"><path d="M12 4 A7 7 0 1 0 12 18 A3.5 7 0 1 1 12 4 Z" fill="#e3c35a"/><circle cx="20" cy="6" r=".9" fill="#e3c35a"><animate attributeName="opacity" values=".2;1;.2" dur="2.2s" repeatCount="indefinite"/></circle></g>`,
}

/** 左下を舞い落ちる物 (花びら・葉・雪・蛍) */
const falling = (id: string, piece: (k: number) => string, n: number, dur: number) =>
  `<g id="${id}">${Array.from({ length: n }, (_, k) => {
    const x = 6 + k * 6
    return `<g opacity="0"><animateTransform attributeName="transform" type="translate" values="${x} 28;${x + 5} 48;${x - 2} 70" dur="${dur}s" begin="${(k * dur) / n}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.8;1" dur="${dur}s" begin="${(k * dur) / n}s" repeatCount="indefinite"/>${piece(k)}</g>`
  }).join('')}</g>`

const petal = () => `<ellipse rx="3.6" ry="2.1" fill="#f9a8c0"><animateTransform attributeName="transform" type="rotate" values="0;360" dur="2s" repeatCount="indefinite"/></ellipse>`
const leaf = (k: number) =>
  `<path d="M-5.5 0 Q0 -4.5 5.5 0 Q0 4.5 -5.5 0 Z" fill="${['#d9822b', '#c2412d'][k % 2]}"><animateTransform attributeName="transform" type="rotate" values="-35;35;-35" dur="2.4s" repeatCount="indefinite"/></path>`
const flake = () => `<circle r="2" fill="#9fbbd8"/>`

/** 夏の夜: 蛍がふわっと光る */
const fireflies = () =>
  `<g id="fireflies">${[
    [8, 50, 0],
    [16, 62, 0.9],
    [5, 36, 1.7],
  ]
    .map(([x, y, d]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#b7d335" opacity=".2"><animate attributeName="opacity" values=".1;1;.1" dur="2.6s" begin="${d}s" repeatCount="indefinite"/><animate attributeName="cy" values="${y};${(y ?? 0) - 4};${y}" dur="3.4s" repeatCount="indefinite"/></circle>`)
    .join('')}</g>`

/** 頭の物: 夜はナイトキャップ、夏の昼間は麦わら帽子 */
const nightcap = () =>
  `<g id="nightcap"><path d="M22 27 C24 12 46 4 64 11 C74 15 81 23 85 31 L81 33 C76 27 70 23 64 23 C50 17 34 19 22 27 Z" fill="#5b6bd6"/>` +
  `<path d="M22 27 C34 19 50 17 64 23" fill="none" stroke="#d0d9e3" stroke-width="3" stroke-linecap="round"/><circle cx="84" cy="34" r="3.6" fill="#d0d9e3"/></g>`
const strawHat = () =>
  `<g id="straw-hat"><ellipse cx="48" cy="16" rx="27" ry="4.5" fill="#e3c16f"/><path d="M34 15 Q35 3 48 3 Q61 3 62 15 Z" fill="#e8c977"/><path d="M34.6 12 H61.4" stroke="#c2412d" stroke-width="3"/></g>`
/** 冬: マフラー */
const scarf = () => `<g id="scarf"><path d="M25 57 Q48 69 71 57 L73 63 Q48 76 23 63 Z" fill="#d1453b"/><path d="M60 65 L63 72 L69 71 L65 62 Z" fill="#b8372e"/></g>`

/**
 * 顔の Svg。気分と、時間帯・季節で決まる (ツール名や一言は別の Text にして、アニメを止めない)。
 * part と season を渡さなければ小物の無い顔 (時刻は描く側が JST から決めて渡す)
 */
export const faceSvg = (mood: FaceBandMood, part?: DayPart, season?: Season) => {
  const c = colorOf(mood)
  const isNight = part === '夜'
  const deco = (where: 'back' | 'front') => {
    if (where === 'back')
      return [
        part ? SKY[part] : '',
        season === '春' ? falling('petals', petal, 3, 4) : '',
        season === '秋' ? falling('leaves', leaf, 2, 5) : '',
        season === '冬' ? falling('snow', flake, 3, 4) : '',
        season === '夏' && isNight ? fireflies() : '',
      ].join('')
    return [season === '冬' ? scarf() : '', isNight ? nightcap() : season === '夏' && part ? strawHat() : ''].join('')
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 72">
${deco('back')}
<g>
<circle cx="48" cy="40" r="28" fill="${C.face}" stroke="${c}" stroke-width="2.5"/>
${mood === 'idle' && isNight ? sleepy(c) : parts[mood](c)}
</g>
${deco('front')}
</svg>`
}

/** terminal の顔の文字。夜の待ちは眠そう */
export const faceText = (mood: FaceBandMood, part?: DayPart) => (mood === 'idle' && part === '夜' ? '(-_-)zzz' : FACE_TEXT[mood])

/** Svg の alt (一言とツール名) */
export const faceAlt = (now: FaceBandNow) => {
  const sub = subLine(now)
  return clean(sub === '' ? `顔: ${now.word}` : `顔: ${now.word} / ${sub}`)
}
