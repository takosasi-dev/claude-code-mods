// 起動ボタンの一覧とヘッダーの SVG。$ に触らない純関数だけ置く
import type { ModHubCommand, ModHubMod, ModHubRecent } from '../types'
import { C, clean, frame, header } from './style'
import type { Season } from './style'

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
  'ci-pane': '開発', 'port-watch': '開発', 'spec-board': '開発', 'project-board': '開発', 'fail-log': '開発',
  'ship-guard': '開発', 'rule-watch': '開発', 'enc-guard': '開発', 'release-draft': '開発',
  'cc-dash': '状況', 'token-meter': '状況', 'usage-pane': '状況', 'agent-watch': '状況', 'session-recap': '状況',
  'devlog-pane': '状況', 'work-bar': '状況', 'session-timeline': '状況', 'file-map': '状況', 'usage-history': '状況',
  'compact-cue': '状況',
  'focus-timer': '道具', 'prompt-book': '道具', 'rule-switch': '道具', 'canvas-pane': '道具', 'done-chime': '道具',
  'toast-inbox': '道具', 'mod-check': '道具',
  'aqua-pet': '遊び', 'face-band': '遊び', 'turn-haiku': '遊び', 'live-commentary': '遊び', 'turn-gacha': '遊び',
  'dev-rpg': '遊び', 'code-omikuji': '遊び', 'wait-games': '遊び', 'daily-quest': '遊び', 'trophy-shelf': '遊び',
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

/** 見出しの右下に置く季節の小さな飾り (中心 346,66・大きさ 30 ほど) */
// 色は C から読むので、描くたびに作る (テーマに付いていく)
const seasonDeco = (): Record<Season, string> => ({
  // 桜の花がゆっくり回り、花びらが 1 枚落ちる
  春:
    `<g id="deco-spring"><g transform="translate(346 64)"><animateTransform attributeName="transform" type="rotate" values="0;72" additive="sum" dur="8s" repeatCount="indefinite"/>` +
    [0, 72, 144, 216, 288].map(a => `<ellipse cx="0" cy="-6.5" rx="4.6" ry="6.5" fill="#f9a8c0" transform="rotate(${a})"/>`).join('') +
    `<circle r="2.6" fill="#f2cc60"/></g>` +
    `<ellipse cx="326" cy="60" rx="2.6" ry="1.6" fill="#f9a8c0"><animate attributeName="cy" values="56;84" dur="4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="4s" repeatCount="indefinite"/></ellipse></g>`,
  // 日の光がゆっくり回る
  夏:
    `<g id="deco-summer"><g><animateTransform attributeName="transform" type="rotate" values="0 346 66;45 346 66" dur="6s" repeatCount="indefinite"/>` +
    [0, 45, 90, 135, 180, 225, 270, 315].map(a => `<path d="M346 52 V47" stroke="#f2cc60" stroke-width="2.4" stroke-linecap="round" transform="rotate(${a} 346 66)"/>`).join('') +
    `</g><circle cx="346" cy="66" r="9" fill="#f2cc60"/></g>`,
  // もみじが揺れる
  秋:
    `<g id="deco-autumn"><g><animateTransform attributeName="transform" type="rotate" values="-12 346 74;12 346 74;-12 346 74" dur="3s" repeatCount="indefinite"/>` +
    `<path d="M346 50 L349 58 L356 54 L354 62 L362 63 L355 68 L358 73 L349 71 L347 78 L345 78 L343 71 L334 73 L337 68 L330 63 L338 62 L336 54 L343 58 Z" fill="#d9822b"/>` +
    `<path d="M346 58 V82" stroke="#a0522d" stroke-width="1.4" stroke-linecap="round"/></g></g>`,
  // 雪の結晶が回り、雪が降る
  冬:
    `<g id="deco-winter"><g><animateTransform attributeName="transform" type="rotate" values="0 346 66;60 346 66" dur="6s" repeatCount="indefinite"/>` +
    [0, 60, 120].map(a => `<path d="M346 54 V78 M342 57 L346 60 L350 57 M342 75 L346 72 L350 75" stroke="${C.blue}" stroke-width="1.8" fill="none" stroke-linecap="round" transform="rotate(${a} 346 66)"/>`).join('') +
    `</g>` +
    [[318, 0], [370, 1.3], [330, 2.4]].map(([x, d]) => `<circle cx="${x}" cy="52" r="1.6" fill="${C.blue}"><animate attributeName="cy" values="50;84" dur="3.6s" begin="${d}s" repeatCount="indefinite"/></circle>`).join('') +
    `</g>`,
})

/**
 * ヘッダー: 見出しと本数、mod ごとの色の点が順に灯る。
 * season を渡すと右下に季節の飾り (描く側が JST の今から決めて渡す。渡さなければ飾り無し)
 */
export function headerSvg(count: number, season?: Season): string {
  const pad = 16
  const colors = [C.blue, C.green, C.yellow, C.purple, C.orange, C.red]
  const dots = Array.from({ length: Math.min(count, 12) }, (_, i) => {
    const color = colors[i % colors.length]
    return `<circle cx="${pad + 6 + i * 22}" cy="66" r="6" fill="${color}" opacity="0.25"><animate attributeName="opacity" values="0.25;1;0.25" dur="2.4s" begin="${(i * 0.2).toFixed(1)}s" repeatCount="indefinite"/></circle>`
  }).join('')
  return frame(
    88,
    header('mod ハブ', `画面のある mod ${count} 本`) +
      (count > 0 ? dots : `<text x="${pad}" y="70" font-size="12" fill="${C.dim}">まだ見つかっていません</text>`) +
      (season ? seasonDeco()[season] : ''),
  )
}
