// パスのまとめ方・squarified ツリーマップの配置・SVG と terminal 用の行。どれも純関数(shots.mts が node で直に読む)
import type { FileMapFilter, FileTouch } from '../types'
import { C, HEADER_H, W, clean, esc, fadeIn, frame, header } from './style'

export const ROOT = '直下'
export const OUTSIDE = '外'
/** 一覧に出す数 */
export const TOP = 8
/** 地図に描くファイルの数の上限 (多く触った順)。SVG の source を 131,072 字に収める */
export const MAX_CELLS = 200

const isAbs = (p: string) => /^(?:[A-Za-z]:)?\//.test(p)

/**
 * 作業フォルダからの相対パスと、まとめる先 (上の 2 段のフォルダ)。区切りは \ と / のどちらでもよい。
 * 外のファイルは「外」、相対パスで来た物は作業フォルダからと見る
 */
export function placeOf(cwd: string, file: string): { label: string; group: string } {
  const f = clean(file).replace(/\\/g, '/').replace(/\/+$/, '')
  const c = clean(cwd).replace(/\\/g, '/').replace(/\/+$/, '')
  let rel: string
  // ponytail: 大文字小文字を区別しない比較 (Windows 向け)。Linux で大文字違いのフォルダが並ぶと同じ物に見えるだけ
  if (c !== '' && f.toLowerCase() === c.toLowerCase()) rel = '.'
  else if (c !== '' && f.toLowerCase().startsWith(`${c.toLowerCase()}/`)) rel = f.slice(c.length + 1)
  else if (!isAbs(f)) rel = f.replace(/^(?:\.\/)+/, '') || '.'
  else return { label: f, group: OUTSIDE }
  const dirs = rel.split('/').filter(Boolean).slice(0, -1)
  return { label: rel, group: dirs.length ? dirs.slice(0, 2).join('/') : ROOT }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** ツールの入力から触ったパス。Grep・Glob は path が無ければ空 (数えない) */
export const pathOf = (tool: string, input: Record<string, unknown>) =>
  tool === 'NotebookEdit' ? str(input.notebook_path) : tool === 'Grep' || tool === 'Glob' ? str(input.path) : str(input.file_path)

export const countOf = (f: FileTouch) => f.reads + f.writes
export const pick = (files: readonly FileTouch[], filter: FileMapFilter) => files.filter(f => countOf(f) > 0 && (filter === 'all' || f.writes > 0))

/** 多く触った順。同じなら最近触った順 */
export const ranked = (files: readonly FileTouch[], filter: FileMapFilter) =>
  pick(files, filter).sort((a, b) => countOf(b) - countOf(a) || b.last - a.last)

export const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p

// ---- squarified ツリーマップ ----

export type Rect = { x: number; y: number; w: number; h: number }
export type Cell = Rect & { key: string }

/**
 * Bruls らの squarified の配置。面積は weight に比べ、四角はなるべく正方形に近づける。
 * weight が 0 以下の物は置かない。並びは weight の大きい順
 */
export function squarify(items: readonly { key: string; weight: number }[], rect: Rect): Cell[] {
  const list = items.filter(i => i.weight > 0).sort((a, b) => b.weight - a.weight)
  const total = list.reduce((n, i) => n + i.weight, 0)
  if (list.length === 0 || rect.w <= 0 || rect.h <= 0) return []
  const scale = (rect.w * rect.h) / total
  const areas = list.map(i => ({ key: i.key, a: i.weight * scale }))
  const out: Cell[] = []
  let { x, y, w, h } = rect

  // 並べた時の一番細長い比 (小さいほど正方形に近い)
  const worst = (row: { a: number }[], side: number) => {
    const s = row.reduce((n, r) => n + r.a, 0)
    const max = Math.max(...row.map(r => r.a))
    const min = Math.min(...row.map(r => r.a))
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }
  // 短い辺に沿って 1 列置き、残りの四角を縮める
  const place = (row: { key: string; a: number }[]) => {
    const s = row.reduce((n, r) => n + r.a, 0)
    if (w >= h) {
      const cw = s / h
      let yy = y
      for (const r of row) {
        out.push({ key: r.key, x, y: yy, w: cw, h: r.a / cw })
        yy += r.a / cw
      }
      x += cw
      w -= cw
    } else {
      const rh = s / w
      let xx = x
      for (const r of row) {
        out.push({ key: r.key, x: xx, y, w: r.a / rh, h: rh })
        xx += r.a / rh
      }
      y += rh
      h -= rh
    }
  }

  let row: { key: string; a: number }[] = []
  for (const item of areas) {
    const side = Math.min(w, h)
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
      row.push(item)
    } else {
      place(row)
      row = [item]
    }
  }
  if (row.length) place(row)
  return out
}

// ---- 描く ----

const MAP_X = 12
const MAP_Y = HEADER_H + 10
const MAP_W = W - 24
const MAP_H = 250
/** フォルダの名前の帯の高さ */
const LABEL_H = 16

// 12px の文字のおおよその幅: 全角 12、半角 7
const wide = (ch: string) => /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
const widthOf = (s: string) => [...s].reduce((n, ch) => n + (wide(ch) ? 12 : 7), 0)

/** px に収まるように後ろを切る。3 字も入らなければ空 */
export function fit(s: string, px: number) {
  if (widthOf(s) <= px) return s
  const chars = [...s]
  let out = ''
  for (const ch of chars) {
    if (widthOf(`${out}${ch}…`) > px) break
    out += ch
  }
  return [...out].length >= 3 ? `${out}…` : ''
}

const txt = (x: number, y: number, s: string, size: number, fill: string, extra = '') =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${fill}"${extra ? ` ${extra}` : ''}>${esc(s)}</text>`

/** 濃さ: 書いた物は 0.5〜1、読んだだけは 0.25〜0.65 */
export const shade = (f: FileTouch, max: number) => {
  const r = max > 0 ? countOf(f) / max : 0
  return f.writes > 0 ? 0.5 + 0.5 * r : 0.25 + 0.4 * r
}

export type Layout = { groups: (Cell & { files: number; count: number; hasLabel: boolean })[]; cells: (Cell & { file: FileTouch })[] }

/** フォルダをツリーマップで置き、その中にファイルを置く */
export function layout(files: readonly FileTouch[], filter: FileMapFilter, rect: Rect = { x: MAP_X, y: MAP_Y, w: MAP_W, h: MAP_H }): Layout {
  const shown = ranked(files, filter).slice(0, MAX_CELLS)
  const byGroup = new Map<string, FileTouch[]>()
  for (const f of shown) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f])
  const weights = [...byGroup].map(([key, fs]) => ({ key, weight: fs.reduce((n, f) => n + countOf(f), 0) }))
  const out: Layout = { groups: [], cells: [] }
  for (const g of squarify(weights, rect)) {
    const fs = byGroup.get(g.key) ?? []
    const hasLabel = g.h >= LABEL_H + 18 && g.w >= 40
    const inner = hasLabel ? { x: g.x + 1, y: g.y + LABEL_H, w: g.w - 2, h: g.h - LABEL_H - 1 } : { x: g.x + 1, y: g.y + 1, w: g.w - 2, h: g.h - 2 }
    out.groups.push({ ...g, files: fs.length, count: fs.reduce((n, f) => n + countOf(f), 0), hasLabel })
    const byKey = new Map(fs.map(f => [f.label, f]))
    for (const c of squarify(
      fs.map(f => ({ key: f.label, weight: countOf(f) })),
      inner,
    )) {
      const file = byKey.get(c.key)
      if (file) out.cells.push({ ...c, file })
    }
  }
  return out
}

export const summaryText = (files: readonly FileTouch[], filter: FileMapFilter) => {
  const shown = pick(files, filter)
  const groups = new Set(shown.map(f => f.group)).size
  const touches = shown.reduce((n, f) => n + countOf(f), 0)
  const written = shown.filter(f => f.writes > 0).length
  return `${filter === 'written' ? '書いた物 ' : ''}ファイル ${shown.length} 件 フォルダ ${groups} 書いた ${written} 件 ${touches} 回`
}

export function fileMapSvg(files: readonly FileTouch[], filter: FileMapFilter): string {
  const shown = pick(files, filter)
  const max = Math.max(0, ...shown.map(countOf))
  const sub = `${filter === 'written' ? '書いた物だけ ' : ''}${shown.length} 件${shown.length > MAX_CELLS ? `(上位 ${MAX_CELLS} を描く)` : ''}`
  let body = header('ファイルの地図', sub, C.orange)
  if (shown.length === 0) {
    body += txt(16, MAP_Y + 20, filter === 'written' ? 'まだ書いたファイルがありません' : 'まだファイルに触っていません', 12, C.dim)
    return frame(MAP_Y + 36, body)
  }
  const map = layout(files, filter)
  map.groups.forEach((g, i) => {
    let s = `<rect x="${g.x.toFixed(1)}" y="${g.y.toFixed(1)}" width="${g.w.toFixed(1)}" height="${g.h.toFixed(1)}" fill="${C.face}" stroke="${C.bg}" stroke-width="2"/>`
    if (g.hasLabel) {
      const name = fit(g.key, g.w - 8)
      if (name) s += txt(g.x + 5, g.y + 12, name, 12, C.dim, 'font-weight="bold"')
    }
    for (const c of map.cells.filter(c => c.file.group === g.key)) {
      const f = c.file
      const op = shade(f, max)
      s += `<rect x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" width="${c.w.toFixed(1)}" height="${c.h.toFixed(1)}" fill="${f.writes > 0 ? C.orange : C.blue}" fill-opacity="${op.toFixed(2)}" stroke="${C.bg}" stroke-width="1"/>`
      if (c.h >= 18) {
        const name = fit(baseName(f.label), c.w - 8)
        if (name) s += txt(c.x + 4, c.y + 14, name, 12, op > 0.6 ? C.bg : C.text)
      }
      if (f.subs > 0 && c.w >= 10 && c.h >= 10) s += `<circle cx="${(c.x + c.w - 5).toFixed(1)}" cy="${(c.y + 5).toFixed(1)}" r="2.5" fill="${C.green}"/>`
    }
    body += fadeIn(s, Number((i * 0.06).toFixed(2)))
  })
  // 凡例
  const ly = MAP_Y + MAP_H + 12
  const item = (x: number, swatch: string, label: string) => `<g transform="translate(${x} ${ly})">${swatch}${txt(16, 11, label, 12, C.dim)}</g>`
  body +=
    item(16, `<rect x="0" y="1" width="11" height="11" rx="2" fill="${C.orange}"/>`, '書いた') +
    item(84, `<rect x="0" y="1" width="11" height="11" rx="2" fill="${C.blue}" fill-opacity="0.5"/>`, '読んだだけ') +
    item(188, `<circle cx="5.5" cy="6.5" r="3" fill="${C.green}"/>`, 'サブも触った') +
    txt(W - 16, ly + 11, '濃いほど多い', 12, C.dim, 'text-anchor="end"')
  return frame(ly + 24, body)
}

/** 後ろを残して前を … にする (パスはファイル名の側が大事) */
export const tail = (s: string, n: number) => {
  const a = [...s]
  return a.length > n ? `…${a.slice(-(n - 1)).join('')}` : s
}

export const topText = (f: FileTouch) =>
  `${countOf(f)}回 ${f.writes > 0 ? `書${f.writes} ` : ''}${f.reads > 0 ? `読${f.reads} ` : ''}${tail(f.label, 40)}`

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** terminal 用: 合計とフォルダごとの回数 (多い順) */
export function groupLines(files: readonly FileTouch[], filter: FileMapFilter): Line[] {
  const shown = pick(files, filter)
  const out: Line[] = [{ text: summaryText(files, filter), isBold: true }]
  if (shown.length === 0) return [...out, { text: filter === 'written' ? 'まだ書いたファイルがありません' : 'まだファイルに触っていません', isDim: true }]
  const groups = new Map<string, { n: number; files: number; writes: number }>()
  for (const f of shown) {
    const g = groups.get(f.group) ?? { n: 0, files: 0, writes: 0 }
    groups.set(f.group, { n: g.n + countOf(f), files: g.files + 1, writes: g.writes + (f.writes > 0 ? 1 : 0) })
  }
  for (const [name, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
    out.push({ text: `${tail(name, 24)} ${g.n}回 ${g.files}件${g.writes ? ` 書いた${g.writes}` : ''}`, color: g.writes ? 'yellow' : undefined })
  }
  return out
}
