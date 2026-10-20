// 起動ボタンの一覧とヘッダーの SVG。$ に触らない純関数だけ置く
import type { ModHubCommand, ModHubMod } from '../types'

export const SELF = 'mod-hub'

/** 外から来る文字列(説明・版)の制御文字を落とす。エンジンは制御文字を含む Text の子や alt を拒み、ペインが閉じる */
export const clean = (s: string) => s.replace(/[\t\n\r]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim()

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
  'devlog-pane': '状況', 'work-bar': '状況',
  'focus-timer': '道具', 'prompt-book': '道具', 'rule-switch': '道具', 'canvas-pane': '道具', 'done-chime': '道具',
  'aqua-pet': '遊び', 'face-band': '遊び', 'turn-haiku': '遊び', 'live-commentary': '遊び', 'turn-gacha': '遊び',
  'dev-rpg': '遊び', 'code-omikuji': '遊び', 'wait-games': '遊び',
}
export const categoryOf = (name: string): Category => CATEGORY[name] ?? 'その他'

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

const BG = '#0d1117'
const FG = '#c9d1d9'
const DIM = '#8b949e'
const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f78166', '#f85149']

/** ヘッダー: 見出しと本数、mod ごとの色の点が順に灯る */
export function headerSvg(count: number): string {
  const W = 380
  const pad = 16
  const dots = Array.from({ length: Math.min(count, 12) }, (_, i) => {
    const color = COLORS[i % COLORS.length]
    return `<circle cx="${pad + 6 + i * 22}" cy="62" r="6" fill="${color}" opacity="0.25"><animate attributeName="opacity" values="0.25;1;0.25" dur="2.4s" begin="${(i * 0.2).toFixed(1)}s" repeatCount="indefinite"/></circle>`
  }).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 84" font-family="sans-serif">`,
    `<rect width="${W}" height="84" rx="10" fill="${BG}"/>`,
    `<text x="${pad}" y="32" font-size="18" font-weight="bold" fill="${FG}">mod ハブ</text>`,
    `<text x="${W - pad}" y="32" font-size="13" fill="${DIM}" text-anchor="end">画面のある mod ${count} 本</text>`,
    count > 0 ? dots : `<text x="${pad}" y="66" font-size="12" fill="${DIM}">まだ見つかっていません</text>`,
    '</svg>',
  ].join('')
}
