// 起動ボタンの一覧とヘッダーの SVG。$ に触らない純関数だけ置く
import type { ModHubCommand, ModHubMod } from '../types'

export const SELF = 'mod-hub'

/** 画面を持つ mod: ペインを開くか、何かを描く */
export const isGui = (events: readonly string[], calls: readonly string[]) => calls.includes('ui.open') || events.includes('ui.render')

export type Launcher = { name: string; version: string; commands: ModHubCommand[] }

const baseName = (plugin: string) => plugin.split('@')[0] ?? plugin

/** 画面を持ち、コマンドで開ける mod だけを名前順に (自分は除く) */
export function launchers(mods: readonly ModHubMod[], commands: readonly ModHubCommand[]): Launcher[] {
  return mods
    .filter(m => m.isGui && m.name !== SELF)
    .map(m => ({ name: m.name, version: m.version, commands: commands.filter(c => baseName(c.plugin) === m.name) }))
    .filter(l => l.commands.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

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
