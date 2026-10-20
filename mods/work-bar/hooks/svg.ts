import type { WorkBarLast } from '../types'
import { C, fadeIn } from './style'

const FONT = 'font-family="sans-serif"'

// 制御文字を落とす(エンジンは制御文字を含む Text の子や alt を拒み、SVG も壊れる)
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

const esc = (s: string) => s.replace(CONTROL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 1:23 / 1:02:03
export const clock = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor(sec / 60) % 60
  const s = String(sec % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// 長い MCP 名などは頭を残して切る
export const clean = (s: string) => s.replace(CONTROL, '')

export const short = (raw: string, max = 26) => {
  const name = clean(raw)
  return name.length > max ? `${name.slice(0, max - 3)}...` : name
}

// 経過で帯の色: 120 秒まで青、300 秒まで黄、超えたら赤
export const flowColor = (sec: number) => (sec > 300 ? C.red : sec > 120 ? C.yellow : C.blue)

type BarArgs = { elapsed: number; tool: string | null; calls: number; lastError: boolean }

// 実行中のバー本体。毎秒描き直すので、点滅は 1 秒周期にして継ぎ目を目立たせない
export const barSvg = ({ elapsed, tool, calls, lastError }: BarArgs) => {
  const dot = lastError
    ? `<circle cx="16" cy="28" r="5" fill="${C.red}"><animate attributeName="opacity" values="1;0.15;1" dur="1s" repeatCount="indefinite"/></circle>`
    : ''
  const x = lastError ? 30 : 16
  const center = tool
    ? `<text x="300" y="34" text-anchor="middle" font-size="17" fill="${C.blue}" ${FONT}>${esc(short(tool))}</text>`
    : `<text x="300" y="34" text-anchor="middle" font-size="16" fill="${C.dim}" ${FONT}>考え中</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 56">
<rect x="0.5" y="0.5" width="599" height="55" rx="8" fill="${C.face}" stroke="${C.line}"/>
${dot}
<text x="${x}" y="38" font-size="26" font-weight="bold" fill="${C.text}" ${FONT}>${clock(elapsed)}</text>
${center}
<text x="584" y="36" text-anchor="end" fill="${C.dim}" font-size="13" ${FONT}>ツール <tspan font-size="20" font-weight="bold" fill="${C.text}">${calls}</tspan> 回</text>
</svg>`
}

// 下端を流れる光の帯。色が変わる時だけ中身が変わるので、アニメは途切れずに流れる
export const flowSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 6">
<defs><linearGradient id="g"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="0.5" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>
<clipPath id="c"><rect x="0" y="1" width="600" height="4" rx="2"/></clipPath></defs>
<rect x="0" y="1" width="600" height="4" rx="2" fill="${C.line}"/>
<rect y="1" width="160" height="4" fill="url(#g)" clip-path="url(#c)"><animate attributeName="x" values="-160;600" dur="1.6s" repeatCount="indefinite"/></rect>
</svg>`

// 前のターンの要約チップ 3 つ。ターンが終わった時だけ変わるので、少しずつずらしてふわっと出す
export const lastSvg = ({ seconds, calls, errors }: WorkBarLast) => {
  const chip = (x: number, label: string, value: string, color: string) =>
    `<rect x="${x}" y="2" width="150" height="26" rx="13" fill="${C.face}" stroke="${C.line}"/>
<text x="${x + 14}" y="20" font-size="12" fill="${C.dim}" ${FONT}>${label}</text>
<text x="${x + 136}" y="20" text-anchor="end" font-size="14" font-weight="bold" fill="${color}" ${FONT}>${value}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 30">
<text x="0" y="20" font-size="12" fill="${C.dim}" ${FONT}>前のターン</text>
${fadeIn(chip(80, '所要', clock(seconds), C.text), 0)}
${fadeIn(chip(240, 'ツール', `${calls} 回`, C.text), 0.08)}
${fadeIn(chip(400, 'エラー', `${errors} 件`, errors > 0 ? C.red : C.green), 0.16)}
</svg>`
}

// "表示名=送る文|..." を読む。= が無ければ表示名と送る文を同じにする
export const parsePresets = (raw: string) =>
  raw
    .split('|')
    .map(part => {
      const i = part.indexOf('=')
      const label = (i < 0 ? part : part.slice(0, i)).trim()
      const text = (i < 0 ? part : part.slice(i + 1)).trim()
      return { label: label || text, text }
    })
    .filter(p => p.text !== '')
