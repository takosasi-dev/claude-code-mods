// mod ごとの小さなアイコンと、カテゴリーの色の帯。$ に触らない純関数だけ置く
// 色は描く時に C から読む(テーマを切り替えると C の中身が入れ替わるので、文字列を先に作って持たない)
import { categoryOf } from './hub'
import type { Category } from './hub'
import { C, esc, frame, growBar } from './style'

type Group = Category | '固定'

/** カテゴリーの色 [主, 差し色] */
const tones = (g: Group): [string, string] =>
  ({
    開発: [C.blue, C.green],
    状況: [C.green, C.blue],
    道具: [C.yellow, C.blue],
    遊び: [C.purple, C.orange],
    その他: [C.dim, C.blue],
    固定: [C.orange, C.yellow],
  })[g] as [string, string]

/** 見出しの色 (Text の color にも使う) */
export const categoryColor = (g: Group) => tones(g)[0]

const line = (c: string, w = 2) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`

// mod 名 → 絵の中身 (32x32、c = 主の色、a = 差し色)。文字は使わない
const ICONS: Record<string, (c: string, a: string) => string> = {
  // 開発
  'git-pane': (c, a) =>
    `<path d="M11 11.5v9 M21 15.5c0 4-10 2-10 5" ${line(c)}/><circle cx="11" cy="9" r="2.5" ${line(c)}/><circle cx="11" cy="23" r="2.5" ${line(c)}/><circle cx="21" cy="13" r="2.5" fill="${a}"/>`,
  'edit-log': (c, a) => `<path d="M9 6h10l4 4v16H9z M19 6v4h4" ${line(c)}/><path d="M12 15h8 M12 19h8 M12 23h5" ${line(a)}/>`,
  'todo-board': (c, a) =>
    `<rect x="7" y="7" width="7" height="7" rx="1.5" ${line(c)}/><path d="M8.8 10.5l1.6 1.6 2.6-3.2" ${line(a)}/><rect x="7" y="18" width="7" height="7" rx="1.5" ${line(c)}/><path d="M18 10.5h7 M18 21.5h7" ${line(c)}/>`,
  'test-runner': (c, a) => `<path d="M12 6h8 M14 6v8l-5.5 9.5a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L18 14V6" ${line(c)}/><path d="M11 20h10" ${line(a)}/>`,
  'pre-check': (c, a) => `<path d="M16 5l9 3.5v6.5c0 6-4 9.5-9 12c-5-2.5-9-6-9-12V8.5z" ${line(c)}/><path d="M12 16l3 3 5-6" ${line(a)}/>`,
  'ci-pane': (c, a) => `<path d="M23.5 13a8 8 0 0 0-14.5-2.5 M8.5 19a8 8 0 0 0 14.5 2.5" ${line(c)}/><path d="M9 6v4.5h4.5 M23 26v-4.5h-4.5" ${line(a)}/>`,
  'port-watch': (c, a) => `<path d="M12 5v6 M20 5v6" ${line(a)}/><path d="M8.5 11h15v4a7.5 7.5 0 0 1-15 0z M16 22.5V27" ${line(c)}/>`,
  'spec-board': (c, a) =>
    `<rect x="8" y="7" width="16" height="20" rx="2" ${line(c)}/><rect x="12" y="5" width="8" height="4" rx="1" fill="${c}"/><path d="M12 15h8 M12 19h8 M12 23h5" ${line(a)}/>`,
  'project-board': (c, a) =>
    `<rect x="6" y="7" width="5.5" height="18" rx="1.5" fill="${c}"/><rect x="13.25" y="7" width="5.5" height="12" rx="1.5" fill="${c}" opacity="0.65"/><rect x="20.5" y="7" width="5.5" height="7" rx="1.5" fill="${a}"/>`,
  'fail-log': (c, a) => `<path d="M16 5L28 26H4z" ${line(c)}/><path d="M16 12v7" ${line(a, 2.5)}/><circle cx="16" cy="22.5" r="1.6" fill="${a}"/>`,
  'ship-guard': (c, a) => `<path d="M16 26V10 M10 15.5l6-6 6 6" ${line(c, 2.5)}/><path d="M7 26h18" ${line(a, 2.5)}/>`,
  // 状況
  'compact-cue': (c, a) => `<path d="M16 5a11 11 0 1 1-10.4 7.4" ${line(c, 2.5)}/><path d="M12 13l4 4 4-4 M16 17V9" ${line(a)}/>`,
  'cc-dash': (c, a) => `<path d="M6 22a10 10 0 0 1 20 0" ${line(c, 2.5)}/><path d="M16 22l5.5-6.5" ${line(a)}/><circle cx="16" cy="22" r="2.2" fill="${c}"/>`,
  'token-meter': (c, a) => `<path d="M8 10h16 M8 16h11" ${line(c, 3)}/><path d="M8 22h6" ${line(a, 3)}/>`,
  'usage-pane': (c, a) => `<circle cx="16" cy="16" r="9.5" ${line(c)}/><path d="M16 16V6.5a9.5 9.5 0 0 1 9.5 9.5z" fill="${a}"/>`,
  'agent-watch': (c, a) => `<path d="M4.5 16c3.5-7 19.5-7 23 0c-3.5 7-19.5 7-23 0z" ${line(c)}/><circle cx="16" cy="16" r="3.8" fill="${a}"/>`,
  'session-recap': (c, a) => `<path d="M8 16a8.5 8.5 0 1 0 2.5-6" ${line(c)}/><path d="M10 5.5v4.5h4.5" ${line(c)}/><path d="M16.5 12v4.5l3 2" ${line(a)}/>`,
  'devlog-pane': (c, a) => `<path d="M16 10c-3-2-6.5-2-10-1v15c3.5-1 7-1 10 1c3-2 6.5-2 10-1V9c-3.5-1-7-1-10 1z" ${line(c)}/><path d="M16 10v15" ${line(a)}/>`,
  'work-bar': (c, a) => `<rect x="5" y="12" width="22" height="8" rx="4" ${line(c)}/><rect x="8" y="15" width="11" height="2" rx="1" fill="${a}"/>`,
  'session-timeline': (c, a) =>
    `<path d="M5 18h22" ${line(c)}/><circle cx="9" cy="18" r="2.6" fill="${c}"/><circle cx="16" cy="18" r="2.6" fill="${a}"/><circle cx="23" cy="18" r="2.6" fill="${c}"/><path d="M16 8v6" ${line(a)}/>`,
  'file-map': (c, a) =>
    `<rect x="6" y="6" width="10.5" height="20" rx="1.5" fill="${c}"/><rect x="18" y="6" width="8" height="9" rx="1.5" fill="${a}"/><rect x="18" y="16.5" width="8" height="9.5" rx="1.5" fill="${c}" opacity="0.6"/>`,
  'usage-history': (c, a) => `<path d="M6 6v20h20" ${line(c)}/><path d="M10 21l4.5-5.5 4 3.5 6-8" ${line(a)}/>`,
  // 道具
  'focus-timer': (c, a) => `<circle cx="16" cy="18" r="8.5" ${line(c)}/><path d="M13 5h6 M16 5v4.5" ${line(c)}/><path d="M16 18l3.5-3.5" ${line(a)}/>`,
  'prompt-book': (c, a) =>
    `<path d="M9 6h13a2 2 0 0 1 2 2v18H11a2 2 0 0 1-2-2z M9 24a2 2 0 0 1 2-2h13" ${line(c)}/><path d="M15 6v8l2-1.5 2 1.5V6z" fill="${a}"/>`,
  'rule-switch': (c, a) => `<rect x="5" y="10.5" width="22" height="11" rx="5.5" ${line(c)}/><circle cx="21.5" cy="16" r="3.2" fill="${a}"/>`,
  'canvas-pane': (c, a) => `<rect x="5" y="7" width="22" height="18" rx="2" ${line(c)}/><path d="M8 22l5-6 4 4 3-3 4 5" ${line(a)}/><circle cx="20.5" cy="12" r="2" fill="${c}"/>`,
  'done-chime': (c, a) => `<path d="M10 21v-6a6 6 0 0 1 12 0v6l2 2H8z" ${line(c)}/><path d="M14 26.5h4" ${line(a, 2.5)}/>`,
  'toast-inbox': (c, a) => `<path d="M5 17l3.5-10h15L27 17v8H5z M5 17h6.5l1.5 3h6l1.5-3H27" ${line(c)}/><path d="M12.5 11.5h7" ${line(a)}/>`,
  'mod-check': (c, a) =>
    `<rect x="7" y="6" width="18" height="21" rx="2" ${line(c)}/><rect x="12" y="4" width="8" height="4" rx="1" fill="${c}"/><path d="M11.5 17l3.5 3.5 6-7" ${line(a, 2.5)}/>`,
  // 遊び
  'aqua-pet': (c, a) => `<path d="M6 16c3.5-6.5 11.5-6.5 15.5 0c-4 6.5-12 6.5-15.5 0z M21.5 16l5-4.5v9z" ${line(c)}/><circle cx="11" cy="15" r="1.5" fill="${a}"/>`,
  'face-band': (c, a) =>
    `<circle cx="16" cy="16" r="10" ${line(c)}/><circle cx="12.5" cy="13.5" r="1.5" fill="${c}"/><circle cx="19.5" cy="13.5" r="1.5" fill="${c}"/><path d="M11.5 19c2.5 3 6.5 3 9 0" ${line(a)}/>`,
  'turn-haiku': (c, a) => `<rect x="11" y="6" width="10" height="21" rx="1.5" ${line(c)}/><path d="M14 10v13 M18 10v8" ${line(a)}/><path d="M16 3v3" ${line(c)}/>`,
  'live-commentary': (c, a) => `<rect x="12" y="4.5" width="8" height="13" rx="4" ${line(c)}/><path d="M8 14.5a8 8 0 0 0 16 0 M16 22.5v4 M12 27h8" ${line(c)}/><path d="M14.5 9h3" ${line(a)}/>`,
  'turn-gacha': (c, a) =>
    `<circle cx="16" cy="12" r="7.5" ${line(c)}/><path d="M9 19.5h14v7H9z" ${line(c)}/><circle cx="13.5" cy="11" r="2.2" fill="${a}"/><circle cx="18.5" cy="13.5" r="2.2" fill="${c}"/>`,
  'dev-rpg': (c, a) => `<path d="M23 5.5h3.5V9L15 20.5l-3.5-3.5z" ${line(c)}/><path d="M9.5 15l7.5 7.5 M12 20l-5 5" ${line(a)}/>`,
  'code-omikuji': (c, a) => `<path d="M10.5 12.5l5.5-3.5 5.5 3.5V26h-11z" ${line(c)}/><path d="M18 9l3.5-5.5" ${line(a, 2.5)}/><path d="M13.5 17.5h5" ${line(c)}/>`,
  'wait-games': (c, a) =>
    `<path d="M9.5 10.5h13a5.5 5.5 0 0 1 5.5 5.5v2.5a4 4 0 0 1-7 2.5l-1.2-1.5h-7.6L11 21a4 4 0 0 1-7-2.5V16a5.5 5.5 0 0 1 5.5-5.5z" ${line(c)}/><path d="M10 14v5 M7.5 16.5h5" ${line(c)}/><circle cx="21" cy="15" r="1.5" fill="${a}"/><circle cx="23.5" cy="18" r="1.5" fill="${a}"/>`,
  'daily-quest': (c, a) =>
    `<rect x="5" y="8" width="22" height="18" rx="2" ${line(c)}/><path d="M5 13h22 M10 5v5 M22 5v5" ${line(c)}/><circle cx="20.5" cy="20" r="2.8" fill="${a}"/>`,
  'trophy-shelf': (c, a) =>
    `<path d="M10 6h12v6a6 6 0 0 1-12 0z" ${line(c)}/><path d="M10 8H6.5a3.5 3.5 0 0 0 4 6 M22 8h3.5a3.5 3.5 0 0 1-4 6" ${line(c)}/><path d="M16 18v4 M11 26h10 M13 22h6" ${line(a)}/>`,
}

/** 表に無い mod: カテゴリーの色の 4 つの点 */
const generic = (c: string) =>
  `<circle cx="11" cy="11" r="3.2" fill="${c}"/><circle cx="21" cy="11" r="3.2" fill="${c}" opacity="0.55"/>` +
  `<circle cx="11" cy="21" r="3.2" fill="${c}" opacity="0.55"/><circle cx="21" cy="21" r="3.2" fill="${c}"/>`

export const hasIcon = (name: string) => name in ICONS

/** mod のアイコン (32x32)。幅は Svg の width で決める */
export function modIcon(name: string): string {
  const [c, a] = tones(categoryOf(name))
  const body = ICONS[name]?.(c, a) ?? generic(c)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect x="1" y="1" width="30" height="30" rx="7" fill="${C.face}" stroke="${c}" stroke-opacity="0.45"/>${body}</svg>`
  )
}

/** アイコンを 380 幅に 8 個ずつ並べた 1 枚 (README の絵用) */
export function iconStrip(names: readonly string[]): string {
  const size = 36
  const gap = (380 - 16 * 2 - size * 8) / 7
  const rows = Math.max(1, Math.ceil(names.length / 8))
  const cells = names.map((n, i) =>
    modIcon(n).replace('<svg ', `<svg x="${16 + (i % 8) * (size + gap)}" y="${12 + Math.floor(i / 8) * (size + 10)}" width="${size}" height="${size}" `),
  )
  return frame(24 + rows * size + (rows - 1) * 10, cells.join(''))
}

/** カテゴリーの見出しの帯: 色の縦線・名前・本数、下の線が伸びる */
export function bandSvg(label: Group, count: number): string {
  const color = categoryColor(label)
  return frame(
    30,
    `<rect x="0" y="6" width="4" height="18" rx="2" fill="${color}"/>` +
      `<text x="14" y="20" font-size="14" font-weight="bold" fill="${color}">${esc(label)}</text>` +
      `<text x="366" y="20" font-size="12" fill="${C.dim}" text-anchor="end">${count} 本</text>` +
      growBar(14, 26, 352, 2, color, 0, 0.35),
  )
}
