import type { ModelCompleteResult } from 'claude-code'

import type { HaikuPoem, HaikuTurn } from '../types'

/** 残す句の数 */
export const KEEP = 50
/** 句の長さの上限 (字) */
export const MAX_CHARS = 40
/** 答えの頭として渡す長さ */
const ANSWER_HEAD = 300
/** ツールを使わなくても、これ以上かかったターンは詠む */
export const LONG_MS = 20_000

/** 制御文字を落とす (Text の子や SVG に入るとペインが閉じる)。タブと改行は空白に */
export const clean = (s: string) => s.replace(/[\t\n\r]+/g, ' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')

/** ツールの入力から触ったファイルの名前 (パスの最後の部分だけ)。無ければ空 */
export function fileOf(input: Record<string, unknown>): string {
  for (const k of ['file_path', 'notebook_path', 'path']) {
    const v = input[k]
    if (typeof v === 'string' && v.trim() !== '') return clean(v.split(/[\\/]/).filter(Boolean).pop() ?? '').slice(0, 60)
  }
  return ''
}

/** メインのターンが答えて終わり、ツールを 1 回以上使ったか 20 秒以上かかった時だけ詠む */
export const shouldCompose = (e: { reason: string; agentId?: string; durationMs: number }, toolCalls: number) =>
  e.agentId === undefined && e.reason === 'answer' && (toolCalls > 0 || e.durationMs >= LONG_MS)

/** 1 ターンの材料をまとめる (外から来る文字は先に掃除する) */
export function digestOf(turnId: string, tools: Map<string, number>, files: string[], answer: string, durationMs: number): HaikuTurn {
  return {
    turnId,
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => [clean(name).slice(0, 60), n]),
    files: files.slice(0, 10),
    answerHead: clean(answer).slice(0, ANSWER_HEAD),
    durationMs,
  }
}

const SYSTEM =
  'Claude Code の 1 ターンでした作業を、日本語の俳句にします。' +
  '五七五の一句を 1 行だけ書く。季語を 1 つ入れる。絵文字は使わない。説明・前置き・題・かぎかっこは書かない。'

/** model.complete に渡す system と prompt */
export function askFor(t: HaikuTurn, month: number) {
  const tools = t.tools.length ? t.tools.map(([name, n]) => `${name} ${n} 回`).join('、') : 'なし'
  const files = t.files.length ? t.files.join('、') : 'なし'
  const secs = Math.round(t.durationMs / 1000)
  const prompt = [
    `今は ${month} 月。`,
    'このターンの作業:',
    `- 使ったツール: ${tools}`,
    `- 触ったファイル: ${files}`,
    `- かかった時間: ${secs} 秒`,
    `- 最後の答えの頭: ${t.answerHead || 'なし'}`,
    '',
    'この作業を五七五の一句にして、句だけを 1 行で書いてください。',
  ].join('\n')
  return { system: SYSTEM, prompt }
}

// 絵文字と、絵文字をつなぐ字 (異体字セレクタ・ZWJ)
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu
const QUOTES = /^[「『"'“”‘’\s]+|[」』"'“”‘’\s]+$/g

/** 答えを 1 句にする。制御文字と絵文字を落とし、40 字で切る。句が無ければ空 */
export function cleanAnswer(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.replace(EMOJI, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\t]/g, ' ').replace(QUOTES, '').trim())
    .filter(Boolean)
  // 五・七・五 を 3 行で返した時はつなぐ。それ以外は 1 行目だけ (後ろの説明を捨てる)
  const isSplit = lines.length >= 2 && lines.length <= 3 && lines.every(l => [...l].length <= 12)
  const one = (isSplit ? lines.join(' ') : (lines[0] ?? '')).replace(/\s+/g, ' ').trim()
  return [...one].slice(0, MAX_CHARS).join('')
}

/** 詠めなかった理由 (ペインの下に出す) */
export function failText(r: Exclude<ModelCompleteResult, { isAnswered: true }>): string {
  switch (r.reason) {
    case 'api-error':
      return `詠めませんでした (API のエラー ${r.status ?? '応答なし'} ${clean(String(r.error))})`
    case 'empty-reply':
      return '詠めませんでした (答えが空でした)'
    case 'aborted':
      return '詠めませんでした (時間切れか中断)'
    default:
      return '詠めませんでした'
  }
}

/** store の中身は信用しない: 形の合う句だけ拾い、文字は掃除する */
export function poemsOf(raw: unknown): HaikuPoem[] {
  if (!Array.isArray(raw)) return []
  const out: HaikuPoem[] = []
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) continue
    const o = p as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.text !== 'string' || typeof o.at !== 'number' || !Number.isFinite(o.at)) continue
    const text = [...clean(o.text)].slice(0, MAX_CHARS).join('')
    if (text.trim() === '') continue
    out.push({ id: clean(o.id).slice(0, 200), at: o.at, text })
  }
  return out
}

/**
 * store の今の値に句を足す (C1)。同じ id は新しい方 (at が大きい方)、古い順に並べ、最後の 50 句。
 * store の値が配列でない時 (壊れている・別の形) は undefined: 上書きしない
 */
export function mergePoems(stored: unknown, add: HaikuPoem[]): HaikuPoem[] | undefined {
  if (stored !== undefined && !Array.isArray(stored)) return undefined
  const byId = new Map<string, HaikuPoem>()
  for (const p of [...poemsOf(stored), ...add]) {
    const had = byId.get(p.id)
    if (!had || p.at >= had.at) byId.set(p.id, p)
  }
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-KEEP)
}

/** 10/20 14:05 (動いている環境の時刻) */
export function stamp(at: number): string {
  const d = new Date(at)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------------------------------------------------------------- SVG

const esc = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f1 = (n: number) => Math.round(n * 10) / 10

/** 1 列の字数の上限 */
const COL = 13
/** 縦書きで横向きに倒す字 */
const ROTATE = new Set(['ー', '―', '－', '-', '〜', '～', '…', '‥', '(', ')', '（', '）', '「', '」', '『', '』'])
/** 縦書きで右上に寄せる字 */
const CORNER = new Set(['、', '。', '，', '．', ',', '.'])

/** 句を縦の列に分ける: 空白で区切り、長い区切りは 13 字ごとに折る。右の列から */
export function columnsOf(text: string): string[][] {
  const cols: string[][] = []
  for (const part of text.split(/[\s　]+/).filter(Boolean)) {
    const chars = [...part]
    for (let i = 0; i < chars.length; i += COL) cols.push(chars.slice(i, i + COL))
  }
  return cols
}

/** 番号から決まる擬似乱数 (金箔の位置を句ごとに固定する) */
const rng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
const seedOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + (c.codePointAt(0) ?? 0)) | 0, 7)

const W = 380
const H = 440
const STEP = 25 // 1 字の高さ
const GAP = 34 // 列の間

/** 最新の句を短冊に縦書きで。墨は 1 字ずつにじみながら出る (句が変わった時だけ動く) */
export function tanzakuSvg(poem: HaikuPoem | undefined): string {
  const text = poem?.text ?? 'まだ一句も詠んでいません'
  const isEmpty = !poem
  const cols = columnsOf(text)
  const n = Math.max(1, cols.length)
  const pw = Math.max(104, n * GAP + 44) // 短冊の幅
  const px = f1((W - pw) / 2)
  const top = 34
  const ph = H - top - 14
  const r = rng(seedOf(poem ? `${poem.id}${poem.at}` : 'empty'))
  const ink = isEmpty ? '#8b7d62' : '#1c1a17'

  let flecks = ''
  for (let i = 0; i < 14; i++) {
    const x = f1(px + 6 + r() * (pw - 12))
    const y = f1(top + 6 + r() * (ph - 12))
    flecks += `<rect x="${x}" y="${y}" width="${f1(1.5 + r() * 3)}" height="${f1(1.5 + r() * 3)}" fill="#c9a43e" opacity="${f1(0.25 + r() * 0.35)}" transform="rotate(${Math.round(r() * 90)} ${x} ${y})"/>`
  }

  // 字を置く。右の列から、2 列目・3 列目は少しずつ下げて始める (短冊の書き方)
  let chars = ''
  let k = 0
  const y0 = top + 56
  const bottom = top + ph - 40
  cols.forEach((col, ci) => {
    const x = f1(W / 2 + ((n - 1) / 2 - ci) * GAP)
    const drop = Math.min(ci * 28, Math.max(0, bottom - y0 - col.length * STEP))
    col.forEach((ch, i) => {
      const cy = y0 + drop + i * STEP
      const begin = f1(0.3 + k * 0.16)
      k++
      const anim = isEmpty
        ? ''
        : `<animate attributeName="opacity" values="0;1" dur=".7s" begin="${begin}s" fill="freeze"/>`
      const bloom = isEmpty
        ? ''
        : `<circle cx="${x}" cy="${f1(cy - 8)}" r="0" fill="${ink}" opacity="0"><animate attributeName="r" values="2;13" dur="1.4s" begin="${begin}s" fill="freeze"/><animate attributeName="opacity" values="0;.22;.06" dur="1.4s" begin="${begin}s" fill="freeze"/></circle>`
      const at = CORNER.has(ch)
        ? `x="${f1(x + 9)}" y="${f1(cy - 12)}"`
        : ROTATE.has(ch)
          ? `x="${x}" y="${cy}" transform="rotate(90 ${x} ${f1(cy - 8)})"`
          : `x="${x}" y="${cy}"`
      chars += `${bloom}<text ${at} text-anchor="middle" font-size="${isEmpty ? 18 : 22}"${isEmpty ? '' : ' opacity="0"'}>${esc(ch)}${anim}</text>`
    })
  })
  const total = f1(0.3 + k * 0.16 + 1.2)

  // 落款 (句がある時だけ)
  const seal = isEmpty
    ? ''
    : `<g opacity="0"><animate attributeName="opacity" values="0;.9" dur=".5s" begin="${total}s" fill="freeze"/>` +
      `<rect x="${f1(px + 12)}" y="${f1(top + ph - 36)}" width="22" height="22" rx="3" fill="#b8322a"/>` +
      `<text x="${f1(px + 23)}" y="${f1(top + ph - 20)}" text-anchor="middle" font-size="14" fill="#f6e9e4">句</text></g>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">` +
    `<defs>` +
    `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#161b22"/><stop offset="1" stop-color="#0d1117"/></linearGradient>` +
    `<linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6eedb"/><stop offset="1" stop-color="#e6d6b2"/></linearGradient>` +
    `<filter id="ink" x="-20%" y="-5%" width="140%" height="110%"><feGaussianBlur stdDeviation="${isEmpty ? 0 : 2.4}">` +
    (isEmpty ? '' : `<animate attributeName="stdDeviation" values="2.4;.7;.3" dur="${total}s" fill="freeze"/>`) +
    `</feGaussianBlur></filter>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" rx="14" fill="url(#wall)"/>` +
    // 紐
    `<path d="M${W / 2} 6 L${W / 2} ${top + 14}" stroke="#d29922" stroke-width="2"/>` +
    `<circle cx="${W / 2}" cy="6" r="3" fill="#d29922"/>` +
    // 短冊 (影と紙)
    `<rect x="${f1(px + 4)}" y="${top + 5}" width="${pw}" height="${ph}" rx="4" fill="#000000" opacity=".35"/>` +
    `<rect x="${px}" y="${top}" width="${pw}" height="${ph}" rx="4" fill="url(#paper)" stroke="#c9b48a" stroke-width="1"/>` +
    `<rect x="${f1(px + 5)}" y="${top + 5}" width="${pw - 10}" height="${ph - 10}" rx="2" fill="none" stroke="#c9a43e" stroke-width=".8" opacity=".5"/>` +
    flecks +
    `<circle cx="${W / 2}" cy="${top + 14}" r="3.5" fill="#0d1117" opacity=".7"/>` +
    `<g font-family="serif" fill="${ink}" filter="url(#ink)">${chars}</g>` +
    seal +
    `</svg>`
  )
}
