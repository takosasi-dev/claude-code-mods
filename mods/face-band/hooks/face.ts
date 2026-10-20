import type { FaceBandMood, FaceBandNow } from '../types'
import { C } from './style'

// 制御文字を落とす(エンジンは制御文字を含む Text の子や alt を拒み、帯が描かれなくなる)
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
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

/** 顔の Svg。気分だけで決まる (ツール名や一言は別の Text にして、アニメを止めない) */
export const faceSvg = (mood: FaceBandMood) => {
  const c = colorOf(mood)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 72">
<g>
<circle cx="48" cy="40" r="28" fill="${C.face}" stroke="${c}" stroke-width="2.5"/>
${parts[mood](c)}
</g>
</svg>`
}

/** Svg の alt (一言とツール名) */
export const faceAlt = (now: FaceBandNow) => {
  const sub = subLine(now)
  return clean(sub === '' ? `顔: ${now.word}` : `顔: ${now.word} / ${sub}`)
}
