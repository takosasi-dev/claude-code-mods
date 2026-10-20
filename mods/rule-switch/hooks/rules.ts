import type { RuleSwitchCustom, RuleSwitchSave } from '../types'

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

const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

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
    custom.push({ id: c.id, text })
  }
  return { on, custom: custom.slice(0, MAX_CUSTOM) }
}

/** 画面に並べる順: 決まったルール、自分のルール */
export const rulesOf = (save: RuleSwitchSave): Rule[] => [
  ...BUILTIN.map(b => ({ ...b, isOn: save.on[b.id] === true, isCustom: false })),
  ...save.custom.map(c => ({ ...c, isOn: save.on[c.id] === true, isCustom: true })),
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

const C = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  weak: '#8b949e',
  green: '#3fb950',
  purple: '#bc8cff',
}

const esc = (s: string) => s.replace(CTRL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 文字数で切る (全文はボタンに出る) */
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** SVG に描く行の上限 */
const MAX_ROWS = 28
const ROW = 26
const TOP = 96

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
  const h = TOP + shown.length * ROW + (rest > 0 ? 24 : 0) + 16

  let rows = ''
  shown.forEach((r, i) => {
    const y = TOP + i * ROW
    const cy = y + 9
    // ランプ: オンは緑に灯り、光の輪がゆっくり脈打つ
    rows += r.isOn
      ? `<circle cx="30" cy="${cy}" r="11" fill="${C.green}" opacity="0.25"><animate attributeName="opacity" values="0.12;0.45;0.12" dur="2.4s" begin="${(i % 6) * 0.3}s" repeatCount="indefinite"/></circle>` +
        `<circle cx="30" cy="${cy}" r="6" fill="${C.green}"/>`
      : `<circle cx="30" cy="${cy}" r="6" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>`
    // スイッチ: オンはつまみが右
    rows +=
      `<rect x="48" y="${y}" width="34" height="18" rx="9" fill="${r.isOn ? C.green : C.line}"/>` +
      `<circle cx="${r.isOn ? 73 : 57}" cy="${cy}" r="7" fill="${r.isOn ? C.text : C.weak}"/>`
    rows += `<text x="92" y="${y + 14}" font-size="13" fill="${r.isOn ? C.text : C.weak}">${esc(cut(r.text, r.isCustom ? 17 : 20))}</text>`
    if (r.isCustom) rows += `<text x="366" y="${y + 14}" font-size="12" fill="${C.purple}" text-anchor="end">自作</text>`
  })
  if (rest > 0) rows += `<text x="30" y="${TOP + shown.length * ROW + 14}" font-size="12" fill="${C.weak}">ほか ${rest} 個</text>`

  // 上の計器: 全体のうち灯った数を小さなランプの列で
  const dots = Math.min(all, 20)
  let strip = ''
  for (let i = 0; i < dots; i++) {
    const isLit = i < on
    strip += `<circle cx="${174 + i * 10}" cy="60" r="3.5" fill="${isLit ? C.green : C.line}"/>`
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 ${h}" font-family="sans-serif">` +
    `<rect width="380" height="${h}" rx="12" fill="${C.bg}"/>` +
    `<rect x="8" y="8" width="364" height="${h - 16}" rx="10" fill="${C.face}" stroke="${C.line}"/>` +
    `<text x="22" y="34" font-size="12" fill="${C.weak}">ルールスイッチ</text>` +
    `<text x="22" y="68" font-size="28" font-weight="bold" fill="${on > 0 ? C.green : C.weak}">オン ${on} 個</text>` +
    `<text x="174" y="42" font-size="12" fill="${C.weak}">全 ${all} 個</text>` +
    strip +
    `<line x1="20" y1="82" x2="360" y2="82" stroke="${C.line}"/>` +
    rows +
    `</svg>`
  )
}

/** Svg の alt と terminal で出す行 */
export const boardLines = (save: RuleSwitchSave) => {
  const { on, all } = summary(save)
  return [`オン ${on} 個 / 全 ${all} 個`, ...rulesOf(save).map(r => `${r.isOn ? '●' : '○'} ${r.text}`)]
}
