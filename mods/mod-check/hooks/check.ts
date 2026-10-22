// mod の表と、見つかった物から判定を作る純関数・SVG。$ に触らない
import type { CheckEnv, CheckKind, CheckReport, CheckRow, CheckSeen, ModUpdate } from '../types'
import { C, clean, countUp, esc, fadeIn, frame, growBar, header, HEADER_H, panel, short } from './style'

export const SELF = 'mod-check'

/** 並べるカテゴリーの順(mod-hub と同じ) */
export const CATEGORIES = ['開発', '状況', '道具', '遊び', 'その他'] as const
export type Category = (typeof CATEGORIES)[number]

export type ModEntry = {
  name: string
  category: Category
  /** 本来のコマンド(スラッシュ無し)。持たない mod は無し */
  main?: string
  /** 本来の名前が取られた時の予備の名前 */
  spare?: string
  /** 外に見せる $.state を持つか(hooks/probe.ts に読みが並ぶ) */
  hasState: boolean
}

// この mod 集の全 mod(todo-scan は todo-board にまとめたので入れない)。
// 各 mod の .claude-plugin/plugin.json の name と、hooks/register.tsx の $.command.register から作った。
// カテゴリーは mod-hub の hub.ts の表に合わせ、表に無い物はここで決めた。mod を足したらここにも足す
export const MODS: readonly ModEntry[] = [
  { name: 'agent-watch', category: '状況', main: 'agents', spare: 'agent-watch', hasState: true },
  { name: 'aqua-pet', category: '遊び', main: 'aquarium', hasState: true },
  { name: 'canvas-pane', category: '道具', main: 'canvas', spare: 'canvas-pane', hasState: true },
  { name: 'cc-dash', category: '状況', main: 'dash', hasState: true },
  { name: 'ci-pane', category: '開発', main: 'ci', spare: 'ci-pane', hasState: true },
  { name: 'code-omikuji', category: '遊び', main: 'omikuji', spare: 'code-omikuji', hasState: true },
  { name: 'compact-cue', category: '状況', main: 'cue', spare: 'compact-cue', hasState: true },
  { name: 'daily-quest', category: '遊び', main: 'quest', spare: 'daily-quest', hasState: true },
  { name: 'danger-frame', category: '開発', hasState: false },
  { name: 'dev-rpg', category: '遊び', main: 'rpg', spare: 'dev-rpg', hasState: true },
  { name: 'devlog-pane', category: '状況', main: 'devlog', hasState: true },
  { name: 'done-chime', category: '道具', main: 'chime', spare: 'done-chime', hasState: true },
  { name: 'edit-log', category: '開発', main: 'edits', spare: 'edit-log', hasState: true },
  { name: 'enc-guard', category: '開発', main: 'enc', spare: 'enc-guard', hasState: true },
  { name: 'face-band', category: '遊び', main: 'face', spare: 'face-band', hasState: true },
  { name: 'fail-log', category: '開発', main: 'errors', spare: 'fail-log', hasState: true },
  { name: 'file-map', category: '状況', main: 'filemap', spare: 'file-map', hasState: true },
  { name: 'focus-timer', category: '道具', main: 'focus', spare: 'focus-timer', hasState: true },
  { name: 'git-pane', category: '開発', main: 'git', spare: 'gitpane', hasState: true },
  { name: 'live-commentary', category: '遊び', main: 'jikkyo', spare: 'live-commentary', hasState: true },
  { name: 'long-turn-toast', category: '状況', hasState: false },
  { name: 'mod-check', category: '道具', main: 'mod-check', spare: 'modcheck', hasState: true },
  { name: 'mod-hub', category: '道具', main: 'mod', spare: 'mod-hub', hasState: true },
  { name: 'port-watch', category: '開発', main: 'ports', spare: 'port-watch', hasState: true },
  { name: 'pre-check', category: '開発', main: 'precheck', spare: 'pre-check', hasState: true },
  { name: 'project-board', category: '開発', main: 'projects', hasState: true },
  { name: 'prompt-book', category: '道具', main: 'prompts', spare: 'prompt-book', hasState: true },
  { name: 'release-draft', category: '開発', main: 'release', spare: 'release-draft', hasState: true },
  { name: 'reply-frame', category: '道具', hasState: false },
  { name: 'rule-switch', category: '道具', main: 'rules', spare: 'rule-switch', hasState: true },
  { name: 'rule-watch', category: '開発', main: 'rulewatch', spare: 'rule-watch', hasState: true },
  { name: 'run-guard', category: '開発', main: 'runguard', spare: 'run-guard', hasState: true },
  { name: 'session-recap', category: '状況', main: 'recap', spare: 'session-recap', hasState: true },
  { name: 'session-timeline', category: '状況', main: 'timeline', spare: 'session-timeline', hasState: true },
  { name: 'ship-guard', category: '開発', main: 'guard', spare: 'ship-guard', hasState: true },
  { name: 'spec-board', category: '開発', main: 'specs', spare: 'spec-board', hasState: true },
  { name: 'test-runner', category: '開発', main: 'testrun', spare: 'test-runner', hasState: true },
  { name: 'toast-inbox', category: '道具', main: 'inbox', spare: 'toast-inbox', hasState: true },
  { name: 'todo-board', category: '開発', main: 'todos', spare: 'todo-board', hasState: true },
  { name: 'token-meter', category: '状況', main: 'tokens', spare: 'token-meter', hasState: true },
  { name: 'trophy-shelf', category: '遊び', main: 'trophies', spare: 'trophy-shelf', hasState: true },
  { name: 'turn-gacha', category: '遊び', main: 'gacha', spare: 'turn-gacha', hasState: true },
  { name: 'turn-haiku', category: '遊び', main: 'haiku', spare: 'turn-haiku', hasState: true },
  { name: 'usage-history', category: '状況', main: 'history', spare: 'usage-history', hasState: true },
  { name: 'usage-pane', category: '状況', main: 'usage-pane', hasState: true },
  { name: 'wait-games', category: '遊び', main: 'games', spare: 'wait-games', hasState: true },
  { name: 'week-card', category: '遊び', main: 'week', spare: 'week-card', hasState: true },
  { name: 'work-bar', category: '状況', main: 'work-bar', hasState: true },
]

/** $.command.list() の 1 行のうち、見る所だけ */
export type CommandLike = { name: string; source: string; plugin?: string }

/** 'name@market' の name */
export const baseName = (plugin: string) => plugin.split('@')[0] ?? plugin

/** 本来の名前を別の誰かが持っている時の添え書き */
const takenBy = (name: string, c: CommandLike) =>
  c.source !== 'plugin'
    ? `/${name} は組み込みのコマンド`
    : `/${name} は ${c.plugin === undefined ? '別の plugin' : clean(baseName(c.plugin))} が使っている`

/**
 * mod 1 本の判定。
 * - コマンドは plugin 欄で持ち主を見る。plugin 欄の無い plugin のコマンドは、その mod の物とみなして添え書きを付ける
 * - state の version 0 は「入っていない」とは言えない(開いた時にしか書かない mod もある)ので、書かれていた時だけ根拠にする
 * - plugin.register は mod-check より後に読み込まれた mod しか見えないので、見えた時だけ添える
 */
export function classify(mod: ModEntry, commands: readonly CommandLike[], stateSeen: boolean, seen?: CheckSeen): CheckRow {
  const row = (kind: CheckKind, command = '', note = ''): CheckRow => ({
    name: mod.name,
    category: mod.category,
    kind,
    command,
    hasState: mod.hasState,
    stateSeen: mod.hasState && stateSeen,
    version: seen ? clean(seen.version) : '',
    note,
  })
  if (seen && seen.refused !== '') return row('refused', '', short(`読み込みを拒まれた: ${clean(seen.refused)}`, 60))

  const find = (name?: string) => (name === undefined ? undefined : commands.find(c => c.name === name))
  const isMine = (c?: CommandLike) => c !== undefined && c.source === 'plugin' && (c.plugin === undefined || baseName(c.plugin) === mod.name)
  const unsure = (c: CommandLike) => (c.plugin === undefined ? '持ち主が分からない' : '')
  const main = find(mod.main)
  const spare = find(mod.spare)
  // 本来の名前を別の誰かが持っている時の添え書き
  const taken = main && !isMine(main) ? takenBy(main.name, main) : ''

  if (main && isMine(main)) return row('ok', main.name, unsure(main))
  if (spare && isMine(spare)) return row('spare', spare.name, [taken || `/${mod.main} は登録できなかった`, unsure(spare)].filter(s => s !== '').join(' '))
  const alive = (mod.hasState && stateSeen) || seen !== undefined
  if (mod.main === undefined) return alive ? row('ok') : row('unknown', '', 'コマンドも state も無い')
  if (alive) return row('nocmd', '', taken || 'コマンドが登録されていない')
  return row('missing', '', taken)
}

export const KIND_LABEL: Record<CheckKind, string> = {
  ok: '入っている',
  spare: '予備名',
  nocmd: 'コマンドなし',
  refused: '拒まれた',
  missing: '見つからない',
  unknown: '確かめられない',
}

/** 問題のある物を先に */
const KIND_ORDER: CheckKind[] = ['refused', 'missing', 'nocmd', 'spare', 'unknown', 'ok']

export const sortRows = (rows: readonly CheckRow[]) =>
  [...rows].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      CATEGORIES.indexOf(a.category as Category) - CATEGORIES.indexOf(b.category as Category) ||
      a.name.localeCompare(b.name),
  )

/** 見つかった物から全 mod の判定を作る(問題のある物が先) */
export function buildRows(commands: readonly CommandLike[], stateSeen: Readonly<Record<string, boolean>>, seen: readonly CheckSeen[]): CheckRow[] {
  return sortRows(MODS.map(m => classify(m, commands, stateSeen[m.name] === true, seen.find(s => s.name === m.name))))
}

export type Counts = { total: number; installed: number; withCommand: number; spare: number; missing: number; unknown: number }

export function countRows(rows: readonly CheckRow[]): Counts {
  const n = (f: (r: CheckRow) => boolean) => rows.filter(f).length
  return {
    total: rows.length,
    installed: n(r => r.kind === 'ok' || r.kind === 'spare' || r.kind === 'nocmd'),
    withCommand: n(r => r.command !== ''),
    spare: n(r => r.kind === 'spare'),
    missing: n(r => r.kind === 'missing' || r.kind === 'refused'),
    unknown: n(r => r.kind === 'unknown'),
  }
}

/** JST の YYYY-MM-DD HH:MM */
export const jstStamp = (at: number) => new Date(at + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')

export const themeLabel = (theme: string) => (theme === '' ? '分からない' : `${theme.startsWith('light') ? '明るい' : '暗い'} (${clean(theme)})`)

/** 見つからない・拒まれた行では state が無いのは当たり前なので書かない */
const stateWord = (r: CheckRow) =>
  !r.hasState || r.kind === 'missing' || r.kind === 'refused' ? '' : r.stateSeen ? 'state あり' : 'state まだ'

/** 1 行 1 mod の短い表(貼ってもらう文) */
export function rowLine(r: CheckRow): string {
  return [r.name.padEnd(16), KIND_LABEL[r.kind], r.command === '' ? '' : `/${r.command}`, stateWord(r), r.version === '' ? '' : `v${r.version}`, r.note]
    .filter(s => s !== '')
    .join(' ')
}

export function envLine(env: CheckEnv): string {
  return [
    `画面 ${env.surface === '' ? '分からない' : clean(env.surface)}`,
    `テーマ ${themeLabel(env.theme)}`,
    `Claude Code ${env.engine === '' ? '分からない' : clean(env.engine)}`,
    `ペイン ${env.panes.length === 0 ? 'なし' : env.panes.map(clean).join(' ')}`,
  ].join('  ')
}

export function countLine(c: Counts): string {
  return `全 ${c.total} 本  入っている ${c.installed}  コマンドあり ${c.withCommand}  予備名 ${c.spare}  見つからない ${c.missing}  確かめられない ${c.unknown}`
}

/** /mod-check の返事。コピーしてそのまま貼れる形 */
export function reportText(report: CheckReport): string {
  const updated = report.updated ?? []
  return [
    `mod-check の結果 ${jstStamp(report.at)} (日本時間)`,
    envLine(report.env),
    countLine(countRows(report.rows)),
    ...(updated.length === 0 ? [] : [updatedLine(updated)]),
    ...report.rows.map(rowLine),
  ].join('\n')
}

// ---- 版の見張り ----

/** フォルダの 1 つ上(末尾の区切りは無視)。上が無ければ空 */
export const parentDir = (dir: string) => {
  const d = dir.replace(/[\\/]+$/, '')
  const at = Math.max(d.lastIndexOf('/'), d.lastIndexOf('\\'))
  return at <= 0 ? '' : d.slice(0, at)
}

/** 隣に並ぶ mod の plugin.json(依頼者の mods/<name> の並び。マーケットプレイスの形では無い) */
export const siblingManifest = (root: string, name: string) => `${parentDir(root)}/${name}/.claude-plugin/plugin.json`

/** plugin.json の中身から版。読めなければ undefined */
export function versionOf(text: string): string | undefined {
  try {
    const v = (JSON.parse(text) as { version?: unknown }).version
    return typeof v === 'string' && v !== '' ? clean(v) : undefined
  } catch {
    return undefined
  }
}

/** 覚えた版と今の版を比べ、変わった物(表の順)。どちらかが読めなかった mod は飛ばす */
export const diffVersions = (loaded: Readonly<Record<string, string>>, now: Readonly<Record<string, string>>): ModUpdate[] =>
  MODS.flatMap(m => {
    const from = loaded[m.name]
    const to = now[m.name]
    return from !== undefined && to !== undefined && from !== to ? [{ name: m.name, from, to }] : []
  })

const updateWord = (u: ModUpdate) => `${u.name} ${u.from}→${u.to}`

/** 帯とトーストの文 */
export const updateBand = (updated: readonly ModUpdate[]) =>
  `mod が新しくなりました(${updated[0] ? updateWord(updated[0]) : ''}${updated.length > 1 ? ` ほか ${updated.length - 1} 本` : ''})。VS Code を開き直してください`

/** 貼る文とペインの 1 行 */
export const updatedLine = (updated: readonly ModUpdate[]) => `開き直し待ち ${updated.map(updateWord).join('  ')}`

// ---- 色 ----

export const kindColor = (k: CheckKind) =>
  k === 'ok' ? C.green : k === 'spare' ? C.yellow : k === 'nocmd' ? C.orange : k === 'unknown' ? C.dim : C.red

/** terminal の Text に渡すテーマの名前 */
export const kindTheme = (k: CheckKind) =>
  k === 'ok' ? 'success' : k === 'spare' || k === 'nocmd' ? 'warning' : k === 'unknown' ? 'subtle' : 'error'

// ---- SVG ----

/** 上の札: 4 つの数と、画面・テーマ・版 */
export function summarySvg(report: CheckReport, surface = report.env.surface): string {
  const c = countRows(report.rows)
  const tiles: [string, number, string][] = [
    ['入っている', c.installed, C.green],
    ['コマンドあり', c.withCommand, C.blue],
    ['予備名', c.spare, C.yellow],
    ['見つからない', c.missing, C.red],
  ]
  const tw = 82
  const gap = 8
  const x0 = 14
  const ty = HEADER_TOP
  const tileSvg = tiles
    .map(([label, n, color], i) => {
      const x = x0 + i * (tw + gap)
      return (
        panel(x, ty, tw, 58) +
        `<rect x="${x}" y="${ty}" width="${tw}" height="4" rx="2" fill="${color}"/>` +
        countUp(n, `x="${x + tw / 2}" y="${ty + 32}" font-size="22" font-weight="bold" fill="${color}" text-anchor="middle"`, String, i * 0.08) +
        `<text x="${x + tw / 2}" y="${ty + 50}" font-size="12" fill="${C.dim}" text-anchor="middle">${esc(label)}</text>`
      )
    })
    .join('')
  const env = [
    ['画面', surface === '' ? '分からない' : surface],
    ['テーマ', themeLabel(report.env.theme)],
    ['Claude Code', report.env.engine === '' ? '分からない' : report.env.engine],
    ['確かめられない', `${c.unknown} 本 (コマンドも state も無い mod)`],
  ]
  const ey = ty + 58 + 24
  const envSvg = env
    .map(
      ([k, v], i) =>
        `<text x="${x0}" y="${ey + i * 20}" font-size="12" fill="${C.dim}">${esc(k ?? '')}</text>` +
        `<text x="${x0 + 100}" y="${ey + i * 20}" font-size="12" fill="${C.text}">${esc(short(v ?? '', 34))}</text>`,
    )
    .join('')
  const h = ey + (env.length - 1) * 20 + 14
  const ok = c.missing === 0
  return frame(h, header('mod の点検', `全 ${c.total} 本  ${jstStamp(report.at)}`, ok ? C.green : C.red) + tileSvg + fadeIn(envSvg, 0.3))
}

const HEADER_TOP = HEADER_H + 12
const ROW_H = 24
const NOTE_H = 18

/** mod ごとの行。問題のある物が上。添え書きのある行は 2 段 */
export function rowsSvg(rows: readonly CheckRow[]): string {
  let y = 10
  const body = rows
    .map((r, i) => {
      const color = kindColor(r.kind)
      const top = y
      const h = ROW_H + (r.note === '' ? 0 : NOTE_H)
      y += h + 4
      const right = [r.command === '' ? '' : `/${r.command}`, stateWord(r) === 'state まだ' ? 'state まだ' : ''].filter(s => s !== '').join('  ')
      return fadeIn(
        panel(10, top, 360, h) +
          growBar(10, top + 4, 4, h - 8, color, 0) +
          `<text x="22" y="${top + 16}" font-size="13" fill="${C.text}">${esc(short(r.name, 18))}</text>` +
          `<text x="152" y="${top + 16}" font-size="12" font-weight="bold" fill="${color}">${esc(KIND_LABEL[r.kind])}</text>` +
          `<text x="362" y="${top + 16}" font-size="12" fill="${C.dim}" text-anchor="end">${esc(short(right, 26))}</text>` +
          (r.note === '' ? '' : `<text x="22" y="${top + 33}" font-size="12" fill="${C.dim}">${esc(short(r.note, 44))}</text>`),
        Math.min(i, 20) * 0.02,
      )
    })
    .join('')
  return frame(Math.max(y + 6, 40), body)
}
