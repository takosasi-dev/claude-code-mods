// 通知の受け箱の純関数(記録の形・まとめ方・時刻・SVG)
import type { InboxItem } from '../types'
import { C, HEADER_H, W, clean, esc, frame, growBar, header, short } from './style'

export const SELF = 'toast-inbox'
/** 残す件数 */
export const KEEP = 100
/** 本文の長さの上限 */
const MAX_TEXT = 300

/** mod の名前。マーケットプレイスから入れた物の `@<market>` は落とす */
export const modName = (plugin: string) => clean(plugin.split('@')[0] ?? '') || '不明'

/** 画面に出す名前。本体の通知は「本体」 */
export const modLabel = (name: string) => (name === 'engine' ? '本体' : name)

/** 拾った通知を記録 1 件にする。自分の物と空の文は記録しない */
export function toItem(plugin: string, text: string | undefined, at: number, kind: InboxItem['kind']): InboxItem | undefined {
  const name = modName(plugin)
  const body = short(clean(text ?? ''), MAX_TEXT)
  if (name === SELF || body === '') return undefined
  return { plugin: name, text: body, at, kind }
}

/** store から読んだ値を確かめる(形の合わない物は捨てる)。配列でなければ undefined */
export function asItems(v: unknown): InboxItem[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v
    .filter(
      (i): i is InboxItem =>
        typeof i === 'object' &&
        i !== null &&
        typeof i.plugin === 'string' &&
        typeof i.text === 'string' &&
        typeof i.at === 'number' &&
        (i.kind === 'toast' || i.kind === 'status'),
    )
    // 知らない欄 (新しい版が足した欄) は残す。件数で切るのは足す時 (merge) と画面に出す時だけ
    .map(i => ({ ...i, plugin: modName(i.plugin), text: clean(i.text), at: i.at, kind: i.kind }))
}

export const asReadAt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** 保存済みの物に、このセッションで溜めた分を足す(古い順、最新 KEEP 件) */
export const merge = (saved: readonly InboxItem[], pending: readonly InboxItem[]) => [...saved, ...pending].slice(-KEEP)

/**
 * mod ごとに、行を押した時に開くコマンドを決める($.command.list() の plugin 欄で引く)。
 * 1 つの mod に複数あれば、mod と同じ名前の物(予備の名前。どの mod でもペインを開く)、無ければ一覧で先に出る物。
 * 本体と自分は入れない
 */
export function commandsByMod(list: readonly { name: string; source: string; plugin?: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of list) {
    if (c.source !== 'plugin' || c.plugin === undefined) continue
    const mod = modName(c.plugin)
    if (mod === SELF || mod === 'engine') continue
    const name = clean(c.name)
    if (name !== '' && (out[mod] === undefined || name === mod)) out[mod] = name
  }
  return out
}

export const unreadCount =(items: readonly InboxItem[], readAt: number) => items.filter(i => i.at > readAt).length

/** mod ごとの件数(多い順、同じなら名前順) */
export function countByMod(items: readonly InboxItem[]) {
  const m = new Map<string, number>()
  for (const i of items) m.set(i.plugin, (m.get(i.plugin) ?? 0) + 1)
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

const jst = (ms: number) => new Date(ms + 9 * 3600_000)
const pad = (n: number) => String(n).padStart(2, '0')

/** 日本時間の HH:MM。今日でなければ M/D を前に付ける */
export function when(at: number, now: number) {
  const d = jst(at)
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  return d.toISOString().slice(0, 10) === jst(now).toISOString().slice(0, 10) ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`
}

const ROW = 24
const MAX_ROWS = 8

/** 見出し(未読の数)と mod ごとの件数の小さな横棒 */
export function inboxSvg(items: readonly InboxItem[], readAt: number) {
  const unread = unreadCount(items, readAt)
  const mods = countByMod(items).slice(0, MAX_ROWS)
  const max = Math.max(1, ...mods.map(m => m.count))
  const top = HEADER_H + 12
  const barX = 130
  const barW = W - barX - 50
  const rows = mods.map((m, k) => {
    const y = top + k * ROW
    const fresh = unreadCount(
      items.filter(i => i.plugin === m.name),
      readAt,
    )
    return [
      `<text x="14" y="${y + 13}" font-size="12" fill="${C.text}">${esc(short(modLabel(m.name), 16))}</text>`,
      `<rect x="${barX}" y="${y + 3}" width="${barW}" height="12" rx="3" fill="${C.face}"/>`,
      growBar(barX, y + 3, (barW * m.count) / max, 12, C.blue, k * 0.05),
      fresh > 0 ? growBar(barX, y + 3, (barW * fresh) / max, 12, C.yellow, 0.3 + k * 0.05) : '',
      `<text x="${W - 14}" y="${y + 13}" font-size="12" fill="${C.dim}" text-anchor="end">${m.count}</text>`,
    ].join('')
  })
  const body =
    mods.length === 0
      ? `<text x="14" y="${top + 14}" font-size="12" fill="${C.dim}">まだ通知はありません</text>`
      : rows.join('') +
        `<text x="14" y="${top + mods.length * ROW + 12}" font-size="12" fill="${C.dim}">黄色は未読、青は既読も含めた件数</text>`
  const h = top + Math.max(1, mods.length) * ROW + (mods.length === 0 ? 8 : 22)
  return frame(h, header('通知の受け箱', `未読 ${unread} 件 / 全 ${items.length} 件`, C.yellow) + body)
}
