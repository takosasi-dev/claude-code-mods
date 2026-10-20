// 起動ボタンの一覧とヘッダーの SVG。$ に触らない純関数だけ置く
import type { ModHubCommand, ModHubMod, ModHubRecent } from '../types'
import { C, clean, frame, header } from './style'

export { clean }

export const SELF = 'mod-hub'

/** 画面を持つ mod: ペインを開くか、何かを描く */
export const isGui = (events: readonly string[], calls: readonly string[]) => calls.includes('ui.open') || events.includes('ui.render')

/** plugin.register の next(e) の結果が allow の時だけ記録する物を返す(後ろの mod に拒まれた mod は並べない) */
export function noteMod(
  e: { name: string; version?: string; uses: { events: readonly string[]; calls: readonly string[] } },
  result: { allow?: true; refuse?: string },
): ModHubMod | undefined {
  if (result.allow !== true) return undefined
  return { name: e.name, version: clean(e.version ?? ''), isGui: isGui(e.uses.events, e.uses.calls) }
}

/** 並べるカテゴリーの順。表に無い mod (よそで作られた物) は最後の「その他」 */
export const CATEGORIES = ['開発', '状況', '道具', '遊び', 'その他'] as const
export type Category = (typeof CATEGORIES)[number]

// ponytail: このリポジトリの mod だけを名前で引く。よその mod にも分けたくなったら plugin.json から読む
const CATEGORY: Record<string, Category> = {
  'git-pane': '開発', 'edit-log': '開発', 'todo-board': '開発', 'test-runner': '開発', 'pre-check': '開発',
  'ci-pane': '開発', 'port-watch': '開発', 'spec-board': '開発', 'project-board': '開発',
  'cc-dash': '状況', 'token-meter': '状況', 'usage-pane': '状況', 'agent-watch': '状況', 'session-recap': '状況',
  'devlog-pane': '状況', 'work-bar': '状況', 'session-timeline': '状況', 'file-map': '状況', 'usage-history': '状況',
  'focus-timer': '道具', 'prompt-book': '道具', 'rule-switch': '道具', 'canvas-pane': '道具', 'done-chime': '道具',
  'toast-inbox': '道具',
  'aqua-pet': '遊び', 'face-band': '遊び', 'turn-haiku': '遊び', 'live-commentary': '遊び', 'turn-gacha': '遊び',
  'dev-rpg': '遊び', 'code-omikuji': '遊び', 'wait-games': '遊び',
}
export const categoryOf = (name: string): Category => CATEGORY[name] ?? 'その他'
/** 表に載っている mod の名前 (アイコンが揃っているかの試験で回す) */
export const KNOWN_MODS = Object.keys(CATEGORY)

export type Launcher = { name: string; version: string; category: Category; commands: ModHubCommand[] }

const baseName = (plugin: string) => plugin.split('@')[0] ?? plugin

/** 画面を持ち、コマンドで開ける mod だけを名前順に (自分は除く) */
export function launchers(mods: readonly ModHubMod[], commands: readonly ModHubCommand[]): Launcher[] {
  return mods
    .filter(m => m.isGui && m.name !== SELF)
    .map(m => ({
      name: m.name,
      version: m.version,
      category: categoryOf(m.name),
      commands: commands.filter(c => baseName(c.plugin) === m.name),
    }))
    .filter(l => l.commands.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** カテゴリーの順に分ける (中は名前順のまま)。空のカテゴリーは出さない */
export const byCategory = (list: readonly Launcher[]) =>
  CATEGORIES.map(category => ({ category, items: list.filter(l => l.category === category) })).filter(g => g.items.length > 0)

/** 名前・コマンド名・説明の部分一致で絞る (大文字小文字は見ない)。空なら全部 */
export function applyFilter(list: readonly Launcher[], query: string): Launcher[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...list]
  const hit = (s: string) => s.toLowerCase().includes(q)
  return list.filter(l => hit(l.name) || l.commands.some(c => hit(c.name) || hit(c.description)))
}

/** 最近開いた順。開いたことの無い mod は後ろに名前順 (list は名前順で来る) */
export function sortRecent(list: readonly Launcher[], recent: readonly ModHubRecent[]): Launcher[] {
  const at = new Map(recent.map(r => [r.name, r.at]))
  return [...list].sort((a, b) => (at.get(b.name) ?? -Infinity) - (at.get(a.name) ?? -Infinity) || a.name.localeCompare(b.name))
}

/** 固定した物と残りに分ける (並びは list のまま) */
export const splitPins = (list: readonly Launcher[], pins: readonly string[]) => ({
  pinned: list.filter(l => pins.includes(l.name)),
  rest: list.filter(l => !pins.includes(l.name)),
})

export const RECENT_MAX = 20

/** 開いた記録を先頭に足す (同じ名前の古い記録は抜く) */
export const pushRecent = (recent: readonly ModHubRecent[], name: string, at: number): ModHubRecent[] =>
  [{ name, at }, ...recent.filter(r => r.name !== name)].slice(0, RECENT_MAX)

/** $.store から読んだ物の形を確かめる。違えば undefined */
export const asPins = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]) : undefined

export const asRecent = (v: unknown): ModHubRecent[] | undefined =>
  Array.isArray(v) && v.every(x => typeof x?.name === 'string' && typeof x?.at === 'number')
    ? (v as ModHubRecent[]).slice(0, RECENT_MAX)
    : undefined

/** ヘッダー: 見出しと本数、mod ごとの色の点が順に灯る */
export function headerSvg(count: number): string {
  const pad = 16
  const colors = [C.blue, C.green, C.yellow, C.purple, C.orange, C.red]
  const dots = Array.from({ length: Math.min(count, 12) }, (_, i) => {
    const color = colors[i % colors.length]
    return `<circle cx="${pad + 6 + i * 22}" cy="66" r="6" fill="${color}" opacity="0.25"><animate attributeName="opacity" values="0.25;1;0.25" dur="2.4s" begin="${(i * 0.2).toFixed(1)}s" repeatCount="indefinite"/></circle>`
  }).join('')
  return frame(
    88,
    header('mod ハブ', `画面のある mod ${count} 本`) +
      (count > 0 ? dots : `<text x="${pad}" y="70" font-size="12" fill="${C.dim}">まだ見つかっていません</text>`),
  )
}
