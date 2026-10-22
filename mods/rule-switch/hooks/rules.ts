import type { RuleSwitchCustom, RuleSwitchSave } from '../types'
import { C, HEADER_H, countUp, esc, fadeIn, frame, header } from './style'

/** 決まったルール。id は store に残るので変えない */
export const BUILTIN: readonly { id: string; text: string }[] = [
  { id: 'ja', text: '日本語で答える' },
  { id: 'plan', text: '変更の前に計画を見せて、確認を取ってから進める' },
  { id: 'test', text: 'コードを変えたら、その変更を確かめるテストを書く' },
  { id: 'nogit', text: 'git commit と git push をしない' },
  { id: 'nodep', text: '新しい依存(パッケージ・ライブラリ)を足さない' },
  { id: 'short', text: '答えは短く、要点だけにする' },
  { id: 'nodelete', text: 'ファイルを消さない' },
  { id: 'visual', text: '説明には図や表を使う' },
]

/** 自分のルールの数と 1 つの長さの上限 (システムプロンプトに入るので青天井にしない) */
export const MAX_CUSTOM = 20
export const MAX_TEXT = 200

export const SECTION_ID = 'rule-switch:rules'

export const EMPTY: RuleSwitchSave = { on: {}, custom: [] }

export type Rule = { id: string; text: string; isOn: boolean; isCustom: boolean }

const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g

/** 外から来た文字列を 1 行にする: 制御文字を落とし、改行とタブは空白、前後の空白を取り、上限で切る */
export const clean = (s: string) =>
  s
    .replace(/[\t\r\n]+/g, ' ')
    .replace(CTRL, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** store の値を確かめて直す。キーが無い (undefined) なら空、形が違えば undefined (読めない) */
export function fromSaved(raw: unknown): RuleSwitchSave | undefined {
  if (raw === undefined) return { on: {}, custom: [] }
  if (!isPlain(raw)) return undefined
  if (raw.on !== undefined && !isPlain(raw.on)) return undefined
  if (raw.custom !== undefined && !Array.isArray(raw.custom)) return undefined
  const on: Record<string, true> = {}
  for (const [id, v] of Object.entries(raw.on ?? {})) if (v === true) on[id] = true
  const custom: RuleSwitchCustom[] = []
  const seen = new Set(BUILTIN.map(b => b.id))
  for (const c of (raw.custom ?? []) as unknown[]) {
    if (!isPlain(c) || typeof c.id !== 'string' || typeof c.text !== 'string') continue
    const text = clean(c.text)
    if (c.id === '' || text === '' || seen.has(c.id)) continue
    seen.add(c.id)
    // 知らない欄 (新しい版が足した欄) は残す。数の上限は足す時と、画面・プロンプトに出す時 (rulesOf) だけ
    custom.push({ ...c, id: c.id, text })
  }
  return { on, custom }
}

/**
 * store に書く形。書く直前に読んだ raw のうち、この版の知らない欄 (新しい版が足した物) を残して mine を重ねる。
 * on の中の true でない値 (この版が知らない値) も残す。古い版のまま動いているセッションが、新しい版の記録を消さないように
 */
export function withUnknown(raw: unknown, mine: RuleSwitchSave): Record<string, unknown> {
  const known = Object.keys(EMPTY)
  const o = isPlain(raw) ? raw : {}
  const on = { ...(isPlain(o.on) ? Object.fromEntries(Object.entries(o.on).filter(([, v]) => v !== true)) : {}), ...mine.on }
  return { ...Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k))), ...mine, on }
}

/** 画面に並べる順: 決まったルール、自分のルール (MAX_CUSTOM 個まで。システムプロンプトにもこの分だけ入る) */
export const rulesOf = (save: RuleSwitchSave): Rule[] => [
  ...BUILTIN.map(b => ({ ...b, isOn: save.on[b.id] === true, isCustom: false })),
  ...save.custom.slice(0, MAX_CUSTOM).map(c => ({ id: c.id, text: c.text, isOn: save.on[c.id] === true, isCustom: true })),
]

export const isKnown = (save: RuleSwitchSave, id: string) => BUILTIN.some(b => b.id === id) || save.custom.some(c => c.id === id)

/** その 1 件のオン/オフだけを変える */
export function withToggle(save: RuleSwitchSave, id: string, isOn: boolean): RuleSwitchSave {
  const on = { ...save.on }
  if (isOn) on[id] = true
  else delete on[id]
  return { ...save, on }
}

/** 自分のルールを 1 件足す (足したらオン) */
export const withAdded = (save: RuleSwitchSave, rule: RuleSwitchCustom): RuleSwitchSave => ({
  on: { ...save.on, [rule.id]: true },
  custom: [...save.custom, rule],
})

/** 自分のルールを 1 件消す (オンの印も) */
export function withRemoved(save: RuleSwitchSave, id: string): RuleSwitchSave {
  const on = { ...save.on }
  delete on[id]
  return { on, custom: save.custom.filter(c => c.id !== id) }
}

/** システムプロンプトに入る節の文。オンが 0 なら null */
export function sectionText(save: RuleSwitchSave): string | null {
  const texts = rulesOf(save)
    .filter(r => r.isOn)
    .map(r => r.text)
  if (texts.length === 0) return null
  return ['# ユーザーが決めた約束ごと', 'ユーザーがルールスイッチでオンにした約束ごとです。この会話では次を守ってください。', ...texts.map(t => `- ${t}`)].join('\n')
}

// ── 画面

/** 文字数で切る (全文はボタンに出る) */
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** SVG に描く行の上限 */
const MAX_ROWS = 28
const ROW = 26
/** ルールの行の始まり (見出し・灯った数・区切り線の下) */
const TOP = HEADER_H + 64

export function summary(save: RuleSwitchSave) {
  const rules = rulesOf(save)
  return { on: rules.filter(r => r.isOn).length, all: rules.length }
}

/** スイッチ盤の絵: 上に「オン N 個」と灯ったランプの数、下にルールごとのランプとスイッチ */
export function boardSvg(save: RuleSwitchSave): string {
  const rules = rulesOf(save)
  const { on, all } = summary(save)
  const shown = rules.slice(0, MAX_ROWS)
  const rest = rules.length - shown.length
  const h = TOP + shown.length * ROW + (rest > 0 ? 24 : 0) + 12

  // 描き直すのは押した時だけなので、行は上から順にふわっと出す
  let rows = ''
  shown.forEach((r, i) => {
    const y = TOP + i * ROW
    const cy = y + 9
    // ランプ: オンは緑に灯り、光の輪がゆっくり脈打つ
    const lamp = r.isOn
      ? `<circle cx="30" cy="${cy}" r="11" fill="${C.green}" opacity="0.25"><animate attributeName="opacity" values="0.12;0.45;0.12" dur="2.4s" begin="${(i % 6) * 0.3}s" repeatCount="indefinite"/></circle>` +
        `<circle cx="30" cy="${cy}" r="6" fill="${C.green}"/>`
      : `<circle cx="30" cy="${cy}" r="6" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>`
    // スイッチ: オンはつまみが右
    const knob =
      `<rect x="48" y="${y}" width="34" height="18" rx="9" fill="${r.isOn ? C.green : C.line}"/>` +
      `<circle cx="${r.isOn ? 73 : 57}" cy="${cy}" r="7" fill="${r.isOn ? C.text : C.dim}"/>`
    const label =
      `<text x="92" y="${y + 14}" font-size="13" fill="${r.isOn ? C.text : C.dim}">${esc(cut(r.text, r.isCustom ? 17 : 20))}</text>` +
      (r.isCustom ? `<text x="${380 - 16}" y="${y + 14}" font-size="12" fill="${C.purple}" text-anchor="end">自作</text>` : '')
    rows += fadeIn(lamp + knob + label, Math.min(i, 12) * 0.03)
  })
  if (rest > 0) rows += `<text x="30" y="${TOP + shown.length * ROW + 14}" font-size="12" fill="${C.dim}">ほか ${rest} 個</text>`

  // 上の計器: 全体のうち灯った数を小さなランプの列で
  const dots = Math.min(all, 20)
  let strip = ''
  for (let i = 0; i < dots; i++) {
    const isLit = i < on
    strip += `<circle cx="${178 + i * 10}" cy="${HEADER_H + 30}" r="3.5" fill="${isLit ? C.green : C.line}"/>`
  }

  return frame(
    h,
    header('ルールスイッチ', `全 ${all} 個`, on > 0 ? C.green : C.dim) +
      countUp(on, `x="16" y="${HEADER_H + 40}" font-size="28" font-weight="bold" fill="${on > 0 ? C.green : C.dim}"`, n => `オン ${n} 個`) +
      strip +
      `<line x1="16" y1="${TOP - 14}" x2="${380 - 16}" y2="${TOP - 14}" stroke="${C.line}"/>` +
      rows,
  )
}

/** Svg の alt と terminal で出す行 */
export const boardLines = (save: RuleSwitchSave) => {
  const { on, all } = summary(save)
  return [`オン ${on} 個 / 全 ${all} 個`, ...rulesOf(save).map(r => `${r.isOn ? '●' : '○'} ${r.text}`)]
}
