import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { WeekSnaps } from '../types'
import { asSnaps, baseOf, cardLines, cardSvg, dayKey, growthRows, KEEP_DAYS, levelOf, reportMd, snapOf, usageOf, withSnap } from '../hooks/card'
import { setTheme } from '../hooks/style'

// 2026-10-22(木) 03:00 UTC = 日本時間 12:00
const NOW = Date.parse('2026-10-22T03:00:00Z')
const DAY = 86_400_000
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'week-card',
  component: 'Pane',
  requestId: 'week-card',
  props: { title: '今週のカード', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

const usageDay = (day: string, turns: number) => ({ day, turns, tools: turns * 3, inputTokens: turns * 100, outputTokens: turns * 1000, minutes: turns * 2 })
/** usage-history の week (10/16〜10/22)。10/19 がいちばん多い */
const WEEK = [usageDay('2026-10-16', 4), usageDay('2026-10-17', 0), usageDay('2026-10-18', 6), usageDay('2026-10-19', 20), usageDay('2026-10-20', 5), usageDay('2026-10-21', 3), usageDay('2026-10-22', 2)]
const CARDS = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }]
/** Lv 12 (xp 1760)・30 階・図鑑 3 種・魚 4 匹・お題 21 個・5 日連続 */
const RICH = {
  week: WEEK,
  hero: { xp: 1760, deepest: 30 },
  save: { book: { c1: { count: 2, firstAt: 1 }, c2: { count: 1, firstAt: 1 }, c4: { count: 1, firstAt: 1 }, gone: { count: 1, firstAt: 1 } } },
  cards: CARDS,
  tank: { fish: [{ kind: 'maru' }, { kind: 'maru' }, { kind: 'shima' }, { kind: 'akari' }] },
  streak: 5,
  totalDone: 21,
}
/** 7 日前 (10/15) の終わりの写し */
const BASE_SNAP = { level: 10, deepest: 22, cards: 1, fish: 3, quests: 9, streak: 1 }
type Others = Partial<Record<keyof typeof RICH, unknown>>

type Boot = { others?: () => Others; store?: Record<string, unknown>; taken?: boolean; getFails?: () => boolean }

/** others に無い mod は「入っていない」(state.get に答えない) */
const boot = async ($: Engine, on: On, opts: Boot = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  let writes = 0
  on('store.get', (_$, e) => (opts.getFails?.() ? { deny: '読めません' } : { value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    writes++
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  const others = opts.others
  if (others) {
    // 他の mod の state は { value: { value, version } } の二重の形で答える
    const answer = (k: keyof typeof RICH) => () => {
      const v = others()[k]
      return { value: { value: v as never, version: v === undefined ? 0 : 1 } }
    }
    on('state.get', { plugin: 'usage-history', key: 'week' }, answer('week'))
    on('state.get', { plugin: 'dev-rpg', key: 'hero' }, answer('hero'))
    on('state.get', { plugin: 'turn-gacha', key: 'save' }, answer('save'))
    on('state.get', { plugin: 'turn-gacha', key: 'cards' }, answer('cards'))
    on('state.get', { plugin: 'aqua-pet', key: 'tank' }, answer('tank'))
    on('state.get', { plugin: 'daily-quest', key: 'streak' }, answer('streak'))
    on('state.get', { plugin: 'daily-quest', key: 'totalDone' }, answer('totalDone'))
  }
  // 偽の fs: 版を読む plugin.json だけ
  let version = '0.1.0'
  on('fs.read', (_$, e) => (e.path.replace(/\\/g, '/').endsWith('/.claude-plugin/plugin.json') ? { value: JSON.stringify({ name: 'week-card', version }) } : { deny: 'ENOENT' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (opts.taken && e.name === 'week' ? { deny: '組み込みと被っています' } : { value: { command: e.name } }))
  on('command.run', { command: 'week' }, () => ({ text: '別の /week' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const filled: string[] = []
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: 'C:/work/demo', surface: 'vscode', isInteractive: true })
  return { clock, raw: m, writes: () => writes, toasts, filled, snaps: () => asSnaps(m.get('snaps')) ?? {}, setVersion: (v: string) => (version = v) }
}

const turn = ($: Engine) => $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })

test('他の mod の state を確かめる・日ごとの写し・比べる元・増えた数・週報の文 (純関数)', () => {
  expect(levelOf(1760)).toBe(12)
  expect(snapOf(RICH)).toEqual({ level: 12, deepest: 30, cards: 3, fish: 4, quests: 21, streak: 5 })
  // dev-rpg に一番深い階がまだ無い版・何も入っていない・形の違う値
  expect(snapOf({ hero: { xp: 0 } })).toEqual({ level: 1 })
  expect(snapOf({})).toEqual({})
  expect(snapOf({ hero: 'x', save: [], tank: { fish: 3 }, streak: '5' })).toEqual({})

  // week は日付で合わせる。昨日で止まった week でも今日は 0、7 日より前は落とす
  const u = usageOf([usageDay('2026-10-14', 50), usageDay('2026-10-21', 3)], NOW)!
  expect(u.map(d => d.day)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'])
  expect(u.map(d => d.turns)).toEqual([0, 0, 0, 0, 0, 3, 0])
  expect(usageOf(undefined, NOW)).toBeUndefined()

  // 知らない欄は残し、今日の分だけ置き換え、古い日を刈り込む
  const raw: Record<string, unknown> = { futureField: 1, '2026-10-22': { level: 1, futureMetric: 7 } }
  for (let k = 1; k <= KEEP_DAYS; k++) raw[dayKey(NOW - k * DAY)] = { level: 1 }
  const next = withSnap(raw, '2026-10-22', { level: 3 })
  expect(next.futureField).toBe(1)
  expect(next['2026-10-22']).toEqual({ level: 3, futureMetric: 7 })
  expect(Object.keys(next).filter(k => k !== 'futureField').length).toBe(KEEP_DAYS)
  expect(next).not.toHaveProperty(dayKey(NOW - KEEP_DAYS * DAY))

  // 比べる元は 7 日前。無ければその後で今日より前の一番古い日
  const snaps: WeekSnaps = { '2026-10-14': { level: 1 }, '2026-10-15': { level: 2 }, '2026-10-18': { level: 3 }, '2026-10-22': { level: 4 } }
  expect(baseOf(snaps, NOW)?.day).toBe('2026-10-15')
  expect(baseOf({ '2026-10-18': { level: 3 }, '2026-10-22': { level: 4 } }, NOW)?.day).toBe('2026-10-18')
  expect(baseOf({ '2026-10-22': { level: 4 } }, NOW)).toBeUndefined()

  const rows = growthRows(snapOf(RICH), BASE_SNAP)
  expect(rows.map(r => [r.label, r.value, r.delta])).toEqual([
    ['冒険の書', 'Lv 12', 2],
    ['ダンジョン', '30 階', 8],
    ['ガチャの図鑑', '3 種', 2],
    ['水槽の魚', '4 匹', 1],
    ['こなしたお題', '21 個', 12],
    ['お題の連続', '5 日', undefined],
  ])
  // 元の写しに無い欄は 0 から。元が無ければ増えた数は出さない
  expect(growthRows({ deepest: 4 }, { level: 1 })[0]?.delta).toBe(4)
  expect(growthRows({ level: 4 }, undefined)[0]?.delta).toBeUndefined()

  const base = { day: '2026-10-15', snap: BASE_SNAP }
  const md = reportMd(NOW, usageOf(WEEK, NOW), snapOf(RICH), base)
  expect(md).toBe(
    [
      '## 今週の Claude Code (10/16〜10/22)',
      '',
      '- ターン 40 回 (1 日平均 5.7、いちばん多かった日 10/19(月) 20 ターン)',
      '- 作業時間 1 時間 20 分 / ツール 120 回 / 使った日 6 日',
      '- トークン 入力 4000 / 出力 4.0万',
      '- 冒険の書 Lv 12 (+2)',
      '- ダンジョン 30 階 (+8)',
      '- ガチャの図鑑 3 種 (+2)',
      '- 水槽の魚 4 匹 (+1)',
      '- こなしたお題 21 個 (+12)',
      '- お題の連続 5 日',
      '',
      '増えた数は 10/15(木) の終わりとの比べです。',
    ].join('\n'),
  )
  expect(reportMd(NOW, undefined, {}, undefined)).toBe('## 今週の Claude Code (10/16〜10/22)\n')

  setTheme(false)
  const svg = cardSvg(NOW, usageOf(WEEK, NOW), snapOf(RICH), base)
  expect(svg).toContain('今週のカード')
  expect(svg).toContain('この 1 週間で増えた物')
  expect(svg).toContain('+12')
  expect(svg).toContain('10/15(木) の終わりから')
  expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
  const empty = cardSvg(NOW, undefined, {}, undefined)
  expect(empty).toContain('usage-history を入れると 1 週間の使い方が出ます')
  expect(empty).toContain('>daily-quest・turn-gacha・dev-rpg・aqua-pet</text>')
  expect(empty).toContain('>を入れると、増えた物が出ます</text>')
  expect(cardLines(NOW, undefined, { level: 2 }, undefined).map(l => l.text)).toContain('増えた数は、明日から出ます (写しは今日から)')
})

test('ターンの終わりに今日の写しを store に残す。変わらなければ書かない', async ($, on) => {
  let rich = RICH
  const s = await boot($, on, { others: () => rich })
  expect(s.snaps()['2026-10-22']).toEqual({ level: 12, deepest: 30, cards: 3, fish: 4, quests: 21, streak: 5 })
  const after = s.writes()
  await turn($)
  await s.clock.settle()
  expect(s.writes()).toBe(after)
  rich = { ...RICH, totalDone: 22 }
  await turn($)
  await s.clock.settle()
  expect(s.writes()).toBe(after + 1)
  expect(s.snaps()['2026-10-22']?.quests).toBe(22)
})

test('知らない欄 (新しい版が書いた物) は、1 ターン後も store に残る。入っていない mod の欄も消さない', async ($, on) => {
  let rich: Others = { hero: RICH.hero }
  const s = await boot($, on, {
    others: () => rich,
    store: { snaps: { futureField: 1, '2026-10-21': { level: 9, futureMetric: 3 }, '2026-10-22': { level: 11, fish: 9, futureMetric: 5 } } },
  })
  rich = { hero: { xp: 3000, deepest: 31 } }
  await turn($)
  await s.clock.settle()
  expect(s.raw.get('snaps')).toEqual({
    futureField: 1,
    '2026-10-21': { level: 9, futureMetric: 3 },
    '2026-10-22': { level: levelOf(3000), deepest: 31, fish: 9, futureMetric: 5 },
  })
})

test('何も入っていない時は書かず、カードに入れ方を出す', async ($, on) => {
  const s = await boot($, on)
  await turn($)
  await s.clock.settle()
  expect(s.writes()).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'usage-history を入れると 1 週間の使い方が出ます' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'daily-quest・turn-gacha・dev-rpg・aqua-pet を入れると、増えた物が出ます' })).toBeDefined()
})

for (const surface of SURFACES) {
  test(`${surface}: /week でカードが出て、「週報に貼る文」のボタンで入力欄に Markdown を入れる`, async ($, on) => {
    const s = await boot($, on, { others: () => RICH, store: { snaps: { '2026-10-15': BASE_SNAP } } })
    expect((await $.command.run({ command: 'week', ...RUN })).text).toBe('今週のカードを開きました。')
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.alt)).toBe('今週のカード 10/16〜10/22 ターン 40 / 作業 1 時間 20 分')
      expect(String(svg?.props.source)).toContain('+12')
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'ターン 40 / 作業 1 時間 20 分 / ツール 120' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'こなしたお題 21 個 (+12)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '10/15(木) の終わりから' })).toBeDefined()
    }
    const button = await ui.find({ type: 'Button', key: 'paste' })
    expect(button?.props.variant).toBe('primary')
    await ui.press({ key: 'paste' })
    expect(s.filled).toHaveLength(1)
    expect(s.filled[0]).toContain('## 今週の Claude Code (10/16〜10/22)')
    expect(s.filled[0]).toContain('- 冒険の書 Lv 12 (+2)')
    expect(s.toasts).toContain('週報に貼る文を入力欄に入れました(送信はしていません)')
    await ui.unmount()
  })
}

test('/week を持てなかった時は /week-card にして、/week を横取りしない', async ($, on) => {
  await boot($, on, { taken: true })
  expect((await $.command.run({ command: 'week', ...RUN })).text).toBe('別の /week')
  expect((await $.command.run({ command: 'week-card', ...RUN })).text).toBe('今週のカードを開きました。')
})

test('store を読めない時 (reject・形が違う) は書かず、トーストで知らせる。読めたらまた書く', async ($, on) => {
  // 読めない時に state の写しで書くと、ほかの日が丸ごと消える (withSnap は raw が無ければ今日だけになる)
  expect(Object.keys(withSnap(undefined, '2026-10-22', { level: 5 }))).toEqual(['2026-10-22'])
  let fails = false
  let rich = RICH
  const old = { futureField: 1, '2026-10-15': BASE_SNAP }
  const s = await boot($, on, { others: () => rich, store: { snaps: old }, getFails: () => fails })
  const before = s.writes()
  fails = true
  rich = { ...RICH, totalDone: 30 }
  await turn($)
  await s.clock.settle()
  await turn($)
  await s.clock.settle()
  expect(s.writes()).toBe(before)
  expect(s.toasts.filter(t => t.includes('記録を読めなかった'))).toHaveLength(1)
  // 形が違う (配列) 時も書かない
  fails = false
  s.raw.set('snaps', ['壊れた'])
  rich = { ...RICH, totalDone: 31 }
  await turn($)
  await s.clock.settle()
  expect(s.writes()).toBe(before)
  expect(s.raw.get('snaps')).toEqual(['壊れた'])
  // 読めるようになれば、ほかの日を残して今日の分を書く
  s.raw.set('snaps', old)
  await turn($)
  await s.clock.settle()
  expect(s.writes()).toBe(before + 1)
  expect(s.raw.get('snaps')).toMatchObject({ futureField: 1, '2026-10-15': BASE_SNAP, '2026-10-22': { quests: 31 } })
})

// ここから下は「古い版」の印が残る。新しい試験はこの上に足す
test('新しい版が入ったら (plugin.json の版が変わったら) 写しを書かず、トーストで 1 回だけ開き直しを頼む', async ($, on) => {
  let rich = RICH
  const s = await boot($, on, { others: () => rich })
  const before = s.writes()
  s.setVersion('0.2.0')
  await s.clock.advance(61_000)
  rich = { ...RICH, totalDone: 30 }
  await turn($)
  await s.clock.settle()
  rich = { ...RICH, totalDone: 31 }
  await turn($)
  await s.clock.settle()
  expect(s.writes()).toBe(before)
  expect(s.snaps()['2026-10-22']?.quests).toBe(21)
  expect(s.toasts.filter(t => t.includes('新しい版が入りました'))).toHaveLength(1)
})
