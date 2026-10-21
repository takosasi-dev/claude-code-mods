// README に載せる各 mod の画面の PNG を作る。node 24 でそのまま動く (型は node が外す)
//
//   node tools/shots.mts                 画面のある mod を全部撮る
//   node tools/shots.mts git-pane cc-dash 名前を渡した mod だけ撮る
//   --light                              明るいテーマで撮って docs/images/<mod>-light.png に書く
//   --chrome=<path> か 環境変数 CHROME   Chrome の場所 (既定は Windows の標準の場所)
//
// 各 mod の hooks/*.ts の SVG を作る関数に架空のデータを渡し、幅 380px・背景 #0d1117 の HTML に
// <img src="data:image/svg+xml;base64,..."> で縦に並べる (VS Code のペインと同じ描き方)。
// それを窓なしの Chrome で 2 倍の解像度の PNG にして docs/images/<mod>.png に書く。
// 一時ファイルは os.tmpdir() の下に作って最後に消す。
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// mod の中に拡張子なしの import ('./phrases' など) があるので、見つからなければ .ts を足して探す
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(`${spec}.ts`, ctx)
      throw e
    }
  },
})

const load = (file: string): Promise<any> => import(new URL(`../mods/${file}`, import.meta.url).href)

// 時刻の欄が毎回ずれて行の区切り (10 分ごと) で絵が変わらないよう、正時 + 50 分に寄せる
const NOW = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 50 * 60_000
const MIN = 60_000
const DAY = 86_400_000

// 決まった並びの乱数 (毎回同じ絵にする)
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// 1 枚の SVG。{ svg, at } なら開いて at 秒たった所で撮る (既定は SETTLE 秒)
type Pic = string | { svg: string; at: number }

// mod 名 → その mod の画面に並ぶ SVG (上から順)。ここに 1 行足せば撮る物が増える
const SHOTS: Record<string, () => Promise<Pic[]>> = {
  'mod-hub': async () => {
    const m = await load('mod-hub/hooks/hub.ts')
    const i = await load('mod-hub/hooks/icons.ts')
    // アイコンは 32x32 なので、1 枚ずつ載せると引き伸ばされる。iconStrip に通す
    return [
      m.headerSvg(14),
      i.iconStrip(['git-pane', 'todo-board', 'test-runner', 'cc-dash', 'usage-history', 'file-map', 'focus-timer', 'toast-inbox', 'aqua-pet', 'turn-gacha', 'wait-games']),
      i.bandSvg('固定', 2),
      i.bandSvg('開発', 9),
    ]
  },

  'cc-dash': async () => {
    const m = await load('cc-dash/hooks/svg.ts')
    const counts: [string, number][] = [['Read', 48], ['Edit', 31], ['Bash', 22], ['Grep', 17], ['Write', 6], ['Glob', 4]]
    const rank = new Map(counts.map(([t], i) => [t, i]))
    const colorOf = (t: string) => m.TOOL_COLORS[(rank.get(t) ?? 0) % m.TOOL_COLORS.length]
    const durations = Array.from({ length: 20 }, (_, i) => 8_000 + ((i * 37_000) % 95_000))
    return [
      m.overviewSvg({ elapsedMs: 74 * MIN, turns: 23, tools: 128, errors: 2, isRunning: true }),
      m.turnsSvg(durations),
      m.toolBarsSvg(counts, 128, colorOf),
      // 直近 30 回のタイムラインは縦に長く画像が重くなるので載せない
      m.gaugesSvg(
        [
          { label: '5時間枠', pct: 42, left: 'あと2時間18分' },
          { label: '週', pct: 67, left: 'あと3日5時間' },
        ],
        '取得: 2分前',
      ),
    ]
  },

  'work-bar': async () => {
    const m = await load('work-bar/hooks/svg.ts')
    return [
      m.barSvg({ elapsed: 95, tool: 'Bash: npm test', calls: 14, lastError: false }),
      m.flowSvg(m.flowColor(95)),
      m.lastSvg({ seconds: 212, calls: 31, errors: 1 }),
    ]
  },

  'project-board': async () => {
    const m = await load('project-board/hooks/board.ts')
    const p = (name: string, days: number, title: string, lines: string[]) => ({ name, path: `notes/${name}.md`, mtimeMs: NOW - days * DAY, title, lines })
    const all = [
      p('demo-app', 0, 'demo-app 引き継ぎ', ['ログイン画面の見た目を整えた', '次: パスワード再設定のメール', '待ち: 配色の確認']),
      p('notes-cli', 2, 'notes-cli', ['検索に日付の絞り込みを足した', '次: 出力を JSON にも']),
      p('pixel-garden', 6, 'pixel-garden', ['タイルの当たり判定を直す']),
      p('budget-sheet', 11, 'budget-sheet', ['月ごとの集計']),
      p('weather-bot', 19, 'weather-bot', ['通知の時刻を設定にする']),
      p('chat-sample', 40, 'chat-sample', ['保留']),
    ]
    return [m.cardSvg(all[0], NOW), m.cardSvg(all[1], NOW), m.freshnessSvg(all, NOW)]
  },

  'git-pane': async () => {
    const m = await load('git-pane/hooks/git.ts')
    const f = (path: string, add: number, del: number, o: Partial<{ isStaged: boolean; isUntracked: boolean }> = {}) => ({
      path, add, del, isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, ...o,
    })
    const snap = {
      kind: 'repo', cwd: '/work/demo-app', branch: 'feature/login-form', upstream: 'origin/feature/login-form', ahead: 2, behind: 0,
      files: [
        f('src/components/LoginForm.tsx', 84, 12, { isStaged: true }),
        f('src/api/auth.ts', 41, 9),
        f('src/styles/form.css', 23, 4),
        f('tests/auth.test.ts', 36, 0, { isUntracked: true }),
        f('README.md', 5, 1),
      ],
      commits: [
        { hash: 'a1b2c3d', subject: 'ログインフォームの入力チェックを追加', time: NOW - 25 * MIN },
        { hash: 'e4f5a6b', subject: 'auth の API 呼び出しを分ける', time: NOW - 3 * 60 * MIN },
        { hash: 'c7d8e9f', subject: 'フォームの見た目を整える', time: NOW - DAY },
      ],
      loadedAt: NOW,
    }
    return [m.paneSvg(snap, NOW)]
  },

  'token-meter': async () => {
    const m = await load('token-meter/hooks/svg.ts')
    const turns = Array.from({ length: 24 }, (_, i) => ({
      n: i + 1,
      input: 300 + ((i * 137) % 900),
      output: 400 + ((i * 251) % 2500),
      cacheRead: i < 2 ? 0 : 40_000 + i * 2_500,
      cacheWrite: i % 5 === 0 ? 12_000 : 600,
    }))
    const sum = (u: typeof turns[number]) => u.input + u.output + u.cacheRead + u.cacheWrite
    const total = turns.reduce((a, t) => ({ input: a.input + t.input, output: a.output + t.output, cacheRead: a.cacheRead + t.cacheRead, cacheWrite: a.cacheWrite + t.cacheWrite }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    const heaviest = turns.reduce((h, t) => (sum(t) > sum(h) ? t : h))
    return [m.summarySvg(total, { ...total, runs: 3 }), m.barsSvg(turns, heaviest)]
  },

  'focus-timer': async () => {
    const m = await load('focus-timer/hooks/svg.ts')
    return [m.ringSvg({ status: '集中中', mode: 'focus', leftMs: 12 * MIN + 34_000, totalMs: 25 * MIN, isRunning: true }), m.todaySvg(5)]
  },

  'session-recap': async () => {
    const m = await load('session-recap/hooks/svg.ts')
    const plan: [string, Record<string, number>, number, number][] = [
      ['ログイン画面の作りを調べて', { Read: 6, Grep: 3 }, 0, 3],
      ['入力チェックを足して', { Edit: 5, Read: 2 }, 5, 7],
      ['テストを走らせて', { Bash: 3 }, 13, 4],
      ['落ちたテストを直して', { Edit: 3, Bash: 2 }, 18, 6],
      ['README に使い方を書いて', { Write: 1, Read: 1 }, 26, 2],
      ['別のエージェントで見直して', { Agent: 2 }, 30, 9],
      ['3 行で要約して', {}, 41, 1],
      ['次は何をする?', { Read: 2 }, 44, 2],
    ]
    const t0 = NOW - 48 * MIN
    const turns = plan.map(([prompt, tools, at, len], i) => ({
      turnId: `t${i}`, start: t0 + at * MIN, end: t0 + (at + len) * MIN, label: prompt, prompt, tools, errors: i === 2 ? 1 : 0, reason: 'answer',
    }))
    const longest = turns.reduce((a, x) => (x.end - x.start > a.end - a.start ? x : a))
    const totals = { elapsedMs: 48 * MIN, turns: turns.length, tools: 41, errors: 1, longest, isRunning: false }
    return [m.totalsSvg(totals), m.timelineSvg(turns, NOW, 't3')]
  },

  'edit-log': async () => {
    const m = await load('edit-log/hooks/editlog.ts')
    const files = ['src/app.ts', 'src/components/Header.tsx', 'src/utils/format.ts', 'tests/app.test.ts', 'README.md']
    const tools = ['Edit', 'Edit', 'MultiEdit', 'Write', 'Edit']
    const entries = Array.from({ length: 11 }, (_, i) => {
      const file = files[(i * 3) % 5]!
      return { id: i + 1, at: NOW - (11 - i) * 4 * MIN, file, label: file, tool: tools[i % 5]!, isError: i === 7, lines: 2 + ((i * 7) % 30), isSub: i % 6 === 5 }
    })
    return [m.overviewSvg(entries)]
  },

  'todo-board': async () => {
    const m = await load('todo-board/hooks/todo.ts')
    // git grep の出力 (パス NUL 行 NUL 本文) を作って mod の読み取りに通す
    const hits: [string, number, string][] = [
      ['src/api/auth.ts', 42, '// FIXME: トークンの期限切れを扱っていない'],
      ['src/api/auth.ts', 88, '// TODO: ログアウト時に保存した値を消す'],
      ['src/api/auth.ts', 131, '// HACK: 古いサーバー向けに見出しを足している'],
      ['src/app.ts', 18, '// TODO: 設定を読む所を分ける'],
      ['src/app.ts', 64, '// TODO: 起動の時間を測る'],
      ['src/components/LoginForm.tsx', 77, '// TODO: エラー文を日本語に'],
      ['src/utils/format.ts', 9, '// HACK: 日付の丸めを仮で合わせている'],
      ['src/api/client.ts', 120, '// TODO: リトライの回数を設定にする'],
      ['src/styles/theme.ts', 3, '// XXX: 色の名前を見直す'],
    ]
    const parsed = m.parseGrep(hits.map(h => h.join('\0')).join('\n'))
    const snap = { kind: 'repo', cwd: '/work/demo-app', ...parsed, isCut: false, loadedAt: NOW }
    const history = [14, 13, 13, 12, 11, 11, 10, 9].map((total, i) => ({ at: NOW - (7 - i) * DAY, total }))
    return [m.paneSvg(snap, history)]
  },

  'test-runner': async () => {
    const m = await load('test-runner/hooks/runner.ts')
    const hist = Array.from({ length: 14 }, (_, i) => ({ status: i % 5 === 3 ? 'fail' : i === 9 ? 'stopped' : 'pass', ms: 3000 + ((i * 1300) % 9000) }))
    const res = { status: 'fail', command: 'npm test', exitCode: 1, ms: 12_345, finishedAt: NOW, tail: '', passed: 41, failed: 2 }
    return [m.paneSvg({ kind: 'done', result: res }, hist, 'npm test')]
  },

  'prompt-book': async () => {
    const m = await load('prompt-book/hooks/book.ts')
    const uses = [24, 15, 9, 6, 11]
    const items = m.seeds(NOW).map((p: any, i: number) => ({ ...p, uses: uses[i], lastUsedAt: NOW - i * 3 * 3_600_000 }))
    items.push({ id: 'p6', title: '変更点をまとめる', body: '今日の変更点を箇条書きでまとめて', tags: ['要約'], uses: 4, lastUsedAt: NOW - DAY, createdAt: NOW - 5 * DAY })
    return [m.chartSvg(items, '', false)]
  },

  'live-commentary': async () => {
    const m = await load('live-commentary/hooks/svg.ts')
    return [
      m.stadiumSvg(true, '熱血'),
      m.boardSvg({ ok: 37, err: 2, streak: 12 }, { startedAt: NOW - 83_000, now: NOW, lastMs: 154_000 }),
      // 流れる字幕は左端で止まっている間 (1.6 秒) に撮る
      { svg: m.tickerSvg({ at: NOW, text: 'Edit で app.ts に切り込んだ! 鋭い!', kind: 'play' }, true), at: 0.5 },
    ]
  },

  'turn-gacha': async () => {
    const m = await load('turn-gacha/hooks/gacha.ts')
    const rand = seeded(7)
    let save = m.EMPTY
    for (let i = 0; i < 46; i++) save = m.addDraw(save, m.pull(rand(), rand(), i % 3 === 0), NOW - (46 - i) * 20 * MIN, { isClean: i % 3 === 0, isManual: false })
    // 最新は SR。SSR の虹色の縁は PNG が 250KB を超えるので避ける
    const sr = m.CARDS.find((c: any) => c.rarity === 'SR')
    save = m.addDraw(save, sr, NOW, { isClean: true, isManual: false })
    // history は新しい順。図鑑 (bookSvg) は別の画面で縦に長いので載せない
    return [m.cardSvg(save.history[0]), m.statsSvg(save, 2)]
  },

  'dev-rpg': async () => {
    const m = await load('dev-rpg/hooks/rpg.ts')
    let h = m.startSession(
      m.fromSaved({ xp: 1650, sessions: 6, turns: 212, achievements: { 'first-bash': NOW, 'first-edit': NOW, 'recover-3': NOW, 'turns-100': NOW, 'level-10': NOW } }),
      NOW - 50 * MIN,
    )
    h = { ...h, hpPct: 64, xpFrom: 0.2 }
    for (let i = 0; i < 9; i++) h = m.onTool(h, ['Grep', 'Edit', 'Bash'][i % 3], i === 4, NOW)
    // 実績の書 (achievementsSvg) は別のタブで縦に長いので載せない。装備はガチャのカードから
    const g = await load('turn-gacha/hooks/gacha.ts')
    const owned = g.PUBLIC_CARDS.filter((c: any) => ['x01', 's02', 'n02', 'r01'].includes(c.id))
    for (const id of ['x01', 's02', 'n02']) {
      const c = owned.find((x: any) => x.id === id)
      h = m.setGear(h, c.slot, c)
    }
    // 0.3.0 の成長と戦い: SP を振ってスキルを覚え、魔物と 2 ラウンド戦ったところ
    h = { ...h, alloc: { str: 4, vit: 3, int: 1, agi: 0 }, learned: { slash: NOW, heal: NOW, scan: NOW }, wins: 7, battles: 9, encounters: 3 }
    const bt = await load('dev-rpg/hooks/battle.ts')
    const worn = m.wear(h, owned)
    let b = bt.startBattle(worn, 20261021, false)
    b = bt.act(b, { kind: 'skill', id: 'scan' }, h.learned)
    b = bt.act(b, { kind: 'skill', id: 'slash' }, h.learned)
    // 装備の画面 (gearSvg) と成長の画面 (growthSvg) も載せると重くなるので、ステータスと戦いだけ
    return [m.statusSvg(worn), bt.battleSvg(worn, b)]
  },

  'code-omikuji': async () => {
    const m = await load('code-omikuji/hooks/omikuji.ts')
    const today = m.jstDate(NOW)
    const history = m.lastDays(today, 7).map((date: string) => ({ date, rank: m.fortune(date).rank }))
    return [m.paneSvg(m.fortune(today), today, history, { isShake: false, isPlay: false })]
  },

  'agent-watch': async () => {
    const m = await load('agent-watch/hooks/watch.ts')
    const r = (id: string, type: string, description: string, status: string, ago: number, o: object = {}) => ({
      id, type, description, status, isListed: true, startedAt: NOW - ago * 1000, durationMs: 0, tools: 0, lastTool: '', errors: 0, ...o,
    })
    const list = [
      r('a1', 'general-purpose', 'ログイン画面のテストを書く', 'running', 95, { tools: 14, lastTool: 'Edit' }),
      r('a2', 'Explore', 'API の呼び出し箇所を探す', 'running', 40, { tools: 9, lastTool: 'Grep' }),
      r('a3', 'Plan', '設定画面の作りを考える', 'waiting', 180, { tools: 6, lastTool: 'Read' }),
      r('a4', 'general-purpose', 'README の使い方を直す', 'completed', 420, { tools: 11, lastTool: 'Write', endedAt: NOW - 120_000, durationMs: 184_000 }),
      r('a5', 'Explore', '古い依存を洗い出す', 'failed', 600, { tools: 7, lastTool: 'Bash', errors: 2, endedAt: NOW - 300_000, durationMs: 96_000 }),
    ]
    return [m.paneSvg({ shown: list, counts: m.countsOf(list), hidden: 0, now: NOW })]
  },

  'canvas-pane': async () => {
    const m = await load('canvas-pane/hooks/canvas.ts')
    const months = ['1月', '2月', '3月', '4月', '5月', '6月']
    return [
      m.barSvg(months, [
        { name: '新規', values: [12, 18, 15, 22, 27, 31] },
        { name: '解約', values: [4, 5, 3, 6, 4, 5] },
      ]),
      m.lineSvg(months, [{ name: '応答時間 (ms)', values: [320, 290, 305, 260, 240, 210] }]),
      m.pieSvg(['Web', 'iOS', 'Android', 'その他'], [46, 27, 21, 6]),
    ]
  },

  'rule-switch': async () => {
    const m = await load('rule-switch/hooks/rules.ts')
    return [m.boardSvg({ on: { ja: true, plan: true, test: true, short: true, custom1: true }, custom: [{ id: 'custom1', text: '変数名は英語で、コメントは日本語で書く' }] })]
  },

  'wait-games': async () => {
    const svg = await load('wait-games/hooks/svg.ts')
    const sudoku = await load('wait-games/hooks/sudoku.ts')
    const memory = await load('wait-games/hooks/memory.ts')
    const r = seeded(7)
    const stats = {
      best2048: 6_412, wins2048: 1, winsMines: 7, fastestMines: 41_300,
      puzzles: {
        fifteen: { wins: 4, bestMoves: 58, fastest: 72_400 },
        lights: { wins: 9, bestMoves: 7, fastest: 15_800 },
        sudoku9: { wins: 2, bestMoves: 51, fastest: 412_000 },
        memory: { wins: 12, bestMoves: 11, fastest: 38_200 },
      },
    }
    const g = {
      board: [2, 4, 8, 2, 0, 16, 32, 4, 2, 64, 128, 8, 0, 2, 256, 16],
      score: 3_184, moves: 212, hasWon: false, isOver: false, slides: [], merged: [], spawned: [],
    }
    // マインスイーパーと新しい 4 つは盤がボタンで、SVG は見出しだけ。2048 と見出し 2 つを載せる
    return [svg.board2048Svg(g, stats), svg.sudokuSvg(sudoku.newSudoku(9, r), stats), svg.memorySvg({ ...memory.newMemory(r), moves: 6 }, stats)]
  },

  'spec-board': async () => {
    const m = await load('spec-board/hooks/board.ts')
    const it = (name: string, state: string, waiting: string, phase: string, note: string) => ({ name, state, waiting, phase, note })
    const snap = {
      kind: 'ok',
      waiting: [
        it('ログイン画面', '着手済', '確認待ち', 'Phase 2/4', 'フォームの入力チェックまで済み。配色の確認待ち'),
        it('通知の設定', '一部未実装', '実物待ち', 'Phase 3/3', 'メールの文面がまだ届いていない'),
      ],
      progress: [
        it('ログイン画面', '着手済', '確認待ち', 'Phase 2/4', ''),
        it('検索の絞り込み', '着手済', 'なし', 'Phase 1/3', ''),
        it('通知の設定', '一部未実装', '実物待ち', 'Phase 3/3', ''),
      ],
      next: [
        { score: 82, name: '検索の絞り込み', state: '着手済', reasons: '途中 / 依存なし' },
        { score: 64, name: 'CSV の書き出し', state: '未着手', reasons: '小さい / 依頼あり' },
        { score: 41, name: 'ダークテーマ', state: '未着手', reasons: '小さい' },
      ],
      loadedAt: NOW,
      notice: '',
    }
    return [m.paneSvg(snap)]
  },

  'ci-pane': async () => {
    const m = await load('ci-pane/hooks/ci.ts')
    const run = (name: string, kind: string, label: string, ago: number, event: string) => ({ name, kind, label, url: '', createdAt: NOW - ago * MIN, event })
    const snap = {
      kind: 'ok',
      branch: 'feature/login-form',
      pr: {
        number: 42, title: 'ログインフォームの入力チェックを追加', state: 'OPEN', isDraft: false, url: '', review: 'REVIEW_REQUIRED',
        checks: [
          { name: 'build', kind: 'pass' }, { name: 'lint', kind: 'pass' }, { name: 'test (node 22)', kind: 'pass' },
          { name: 'test (node 24)', kind: 'run' }, { name: 'e2e', kind: 'fail' }, { name: 'deploy-preview', kind: 'skip' },
        ],
      },
      prNote: '',
      runs: [
        run('CI', 'run', '実行中', 2, 'pull_request'),
        run('E2E', 'fail', '失敗', 9, 'pull_request'),
        run('CI', 'pass', '成功', 48, 'push'),
        run('Release', 'skip', 'スキップ', 180, 'push'),
      ],
      runsNote: '',
      loadedAt: NOW,
    }
    return [m.prSvg(snap), m.runsSvg(snap)]
  },

  'port-watch': async () => {
    const m = await load('port-watch/hooks/ports.ts')
    const rows = [
      { port: 3000, pid: 4120, name: 'node.exe' },
      { port: 5173, pid: 4188, name: 'node.exe' },
      { port: 8000, pid: 5230, name: 'python.exe' },
      { port: 5432, pid: 1504, name: 'postgres.exe' },
      { port: 135, pid: 988, name: 'svchost.exe' },
      { port: 445, pid: 4, name: 'System' },
    ]
    const baseline = rows.slice(3).map(m.rowKey)
    return [m.tilesSvg(m.countsOf(rows, baseline), false)]
  },

  'pre-check': async () => {
    const m = await load('pre-check/hooks/check.ts')
    const f = (path: string, add: number, del: number, isStaged = true) => ({ path, add, del, isStaged, isUnstaged: !isStaged, isBinary: false })
    const repo = {
      kind: 'repo', loadedAt: NOW,
      files: [f('src/components/LoginForm.tsx', 84, 12), f('src/api/auth.ts', 41, 9), f('tests/auth.test.ts', 36, 0, false)],
      untracked: ['docs/notes.md'], untrackedCount: 1,
      secrets: [], conflicts: [],
      large: [{ path: 'assets/demo.mp4', size: 3_400_000 }],
      isCut: false,
    }
    const test = { kind: 'done', status: 'pass', command: 'npm test', exitCode: 0, ms: 8_200, tail: '' }
    const items = m.itemsOf(repo, test, true)
    return [m.paneSvg(items, m.verdictOf(items, true))]
  },

  // 帯の顔は 1 つずつの小さな SVG なので、5 つの気分を 1 枚の SVG に横に並べる
  'face-band': async () => {
    const m = await load('face-band/hooks/face.ts')
    const moods = ['idle', 'think', 'tool', 'happy', 'sad']
    const faces = moods.map((mood, i) => m.faceSvg(mood).replace('<svg ', `<svg x="${i * 96}" y="0" width="96" height="72" `)).join('')
    return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 72">${faces}</svg>`]
  },

  'done-chime': async () => {
    const m = await load('done-chime/hooks/wav.ts')
    return [m.waveSvg({ isOn: true, sound: 'chord', threshold: 30, volume: 'mid' })]
  },

  'turn-haiku': async () => {
    const m = await load('turn-haiku/hooks/haiku.ts')
    // 一文字ずつ墨がにじんで出るので、書き終わった所 (6 秒後) で撮る
    return [{ svg: m.tanzakuSvg({ id: 'h1', at: NOW, text: '画面越し 赤が緑に 変わる朝' }), at: 6 }]
  },

  // 季節と時刻で背景が変わる。秋の夕方 (JST 17:30 = 15 分刻みの 70 番) で撮る
  'aqua-pet': async () => {
    const m = await load('aqua-pet/hooks/tank.ts')
    const fish = [
      { id: 0, kind: 'maru', bornAt: NOW - 12 * DAY, turnsSeen: 64 },
      { id: 1, kind: 'shima', bornAt: NOW - 9 * DAY, turnsSeen: 30 },
      { id: 2, kind: 'mizutama', bornAt: NOW - 6 * DAY, turnsSeen: 21 },
      { id: 3, kind: 'hirenaga', bornAt: NOW - 3 * DAY, turnsSeen: 9 },
      { id: 4, kind: 'ougi', bornAt: NOW - DAY, turnsSeen: 3 },
      { id: 5, kind: 'akari', bornAt: NOW, turnsSeen: 0, name: 'ぴか' },
    ]
    const tank = {
      ...m.INITIAL, turns: 55, bornAt: NOW - 12 * DAY, fullness: 80, fedAt: NOW, murk: 1, name: 'demo', isRunning: true, lastActiveAt: NOW, fish,
      view: { period: '夕', season: '秋', slot: 70, fullness: 80, isIdle: false, isUpset: false, isFeeding: false, days: 12 },
    }
    return [m.drawTank(tank), m.fishListSvg(fish)]
  },

  'session-timeline': async () => {
    const m = await load('session-timeline/hooks/timeline.ts')
    const S = 1000
    const tool = (name: string, a: number, b: number | undefined, extra: Record<string, unknown> = {}) =>
      ({ id: `${name}${a}`, tool: name, start: a, ...(b === undefined ? {} : { end: b }), isError: false, isSub: false, ...extra })
    const turn = (id: string, agoMin: number, secs: number | undefined, label: string, reason?: string) => {
      const start = NOW - agoMin * 60 * S
      return { turnId: id, start, ...(secs === undefined ? {} : { end: start + secs * S }), label, ...(reason ? { reason } : {}), tools: [] as unknown[] }
    }
    const turns = [
      turn('t1', 40, 25, '型の定義を読んで', 'answer'),
      turn('t2', 30, 150, '帯のタイムラインを作って', 'answer'),
      turn('t3', 20, 80, 'テストを走らせて', 'answer'),
      turn('t4', 10, 12, 'やっぱり止めて', 'aborted'),
      turn('t5', 1, undefined, 'サブエージェントで調べて'),
    ]
    const at = (i: number, s: number) => turns[i]!.start + s * S
    turns[0]!.tools = [tool('Read', at(0, 2), at(0, 4)), tool('Grep', at(0, 5), at(0, 7)), tool('Read', at(0, 9), at(0, 12))]
    turns[1]!.tools = [
      tool('Read', at(1, 3), at(1, 8)), tool('Edit', at(1, 20), at(1, 24)), tool('Write', at(1, 40), at(1, 46)),
      tool('Bash', at(1, 60), at(1, 95), { isError: true }), tool('Edit', at(1, 100), at(1, 104)), tool('Bash', at(1, 110), at(1, 140)),
    ]
    turns[2]!.tools = [tool('Bash', at(2, 2), at(2, 60)), tool('WebFetch', at(2, 62), at(2, 70))]
    turns[3]!.tools = [tool('Read', at(3, 1), at(3, 3))]
    turns[4]!.tools = [
      tool('Agent', at(4, 2), at(4, 50)), tool('Read', at(4, 5), at(4, 9), { isSub: true }), tool('Grep', at(4, 12), at(4, 15), { isSub: true }),
      tool('Bash', at(4, 20), at(4, 35), { isSub: true }), tool('Read', at(4, 52), undefined),
    ]
    return [m.timelineSvg(turns, NOW)]
  },

  'file-map': async () => {
    const m = await load('file-map/hooks/filemap.ts')
    const f = (label: string, group: string, reads: number, writes = 0, subs = 0) => ({ label, group, reads, writes, subs, last: 0 })
    const files = [
      f('src/hooks/register.tsx', 'src/hooks', 9, 6), f('src/hooks/timeline.ts', 'src/hooks', 4, 8), f('src/hooks/style.ts', 'src/hooks', 3),
      f('src/types/index.d.ts', 'src/types', 5, 1), f('tests/session-timeline.test.tsx', 'tests', 2, 5), f('README.md', '直下', 4, 1),
      f('package.json', '直下', 2), f('docs/mod-guide.md', 'docs', 6, 0, 2), f('docs/images/a.png', 'docs/images', 1),
      f('../other/settings.json', '外', 2), f('src/lib/util.ts', 'src/lib', 3), f('src/lib/path.ts', 'src/lib', 1, 1),
    ]
    return [m.fileMapSvg(files, 'all')]
  },

  'toast-inbox': async () => {
    const m = await load('toast-inbox/hooks/inbox.ts')
    const plugins = ['focus-timer', 'dev-rpg', 'dev-rpg', 'live-commentary', 'live-commentary', 'live-commentary', 'aqua-pet', 'engine']
    const items = plugins.map((plugin, k) => ({ plugin, text: `通知 ${k}`, at: NOW - (plugins.length - k) * 7 * MIN, kind: k % 3 === 0 ? 'status' : 'toast' }))
    return [m.inboxSvg(items, NOW - 20 * MIN)]
  },

  'usage-history': async () => {
    const m = await load('usage-history/hooks/history.ts')
    const days: Record<string, unknown> = {}
    for (let k = 0; k < 40; k++) {
      const turns = Math.round(8 + 14 * Math.abs(Math.sin(k * 1.7)) + (k % 7 === 2 ? 15 : 0))
      days[m.dayKey(NOW - k * DAY)] = {
        turns, tools: turns * 6, inputTokens: turns * 900, outputTokens: turns * 2400, cacheRead: turns * 40_000, durationMs: turns * 95_000, subTurns: Math.round(turns / 4),
      }
    }
    const heat = Array.from({ length: 168 }, (_, s) => {
      const h = s % 24
      return h >= 9 ? Math.round((Math.floor(s / 24) < 5 ? 6 : 3) * Math.abs(Math.sin(h / 3)) + (h >= 20 ? 6 : 0)) : 0
    })
    return [m.chartSvg(days, NOW, 7, 'turns'), m.heatSvg(heat)]
  },
}

// ---- HTML と PNG ----

const PAD = 10
const GAP = 8
const IMG_W = 380 - PAD * 2

const heightOf = (svg: string) => {
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg)
  if (!vb) throw new Error('viewBox が無い SVG')
  return (IMG_W * Number(vb[2])) / Number(vb[1])
}

// <img> の中の SMIL は --virtual-time-budget では進まず、伸びるアニメが 0 幅のまま撮れる。
// そこで全部のアニメの begin を SETTLE 秒早め、「開いて SETTLE 秒たった絵」にする
// (begin が無い物は -SETTLE、数値の物はそこから SETTLE 引く。数値でない begin は触らない)
// 加えて、1 回きりで止まるアニメ (fill="freeze"・繰り返し無し) が要素の最初の子で、at 秒までに
// 終わる物なら、終わりの値を親の属性に書いてアニメを消す。clipPath の中のアニメは begin を
// ずらしても撮った絵に出ないため (タイマーの輪のような長いアニメは途中なので触らない)
const secs = (v: string | undefined) => {
  const m = /^(-?[\d.]+)(ms|s)?$/.exec(v?.trim() ?? '0')
  return m ? Number(m[1]) / (m[2] === 'ms' ? 1000 : 1) : Infinity
}
const bake = (svg: string, at: number) => {
  // 親の開きタグと animate の間に文字 (<text> の中身) があってもよい
  const re = /<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*>([^<]*)<animate\s((?:[\w:-]+="[^"]*"\s*)*)\/>/g
  for (let prev = ''; prev !== svg; ) {
    prev = svg
    svg = svg.replace(re, (all, name: string, attrs: string, inner: string, anim: string) => {
      const a = Object.fromEntries([...anim.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
      const end = a.to ?? a.values?.split(';').pop()?.trim()
      if (a.fill !== 'freeze' || a.repeatCount || a.repeatDur || !a.attributeName || end === undefined) return all
      if (secs(a.begin) + secs(a.dur) > at) return all
      const old = new RegExp(`\\s${a.attributeName}="[^"]*"`)
      return `<${name}${old.test(attrs) ? attrs.replace(old, ` ${a.attributeName}="${end}"`) : `${attrs} ${a.attributeName}="${end}"`}>${inner}`
    })
  }
  return svg
}

const SETTLE = 3
const settle = (svg: string, at = SETTLE) =>
  bake(svg, at).replace(/<(?:animate|animateTransform|animateMotion|set)\b[^>]*>/g, tag => {
    const b = /\sbegin="(-?[\d.]+)(ms|s)?"/.exec(tag)
    if (b) return tag.replace(b[0], ` begin="${(Number(b[1]) / (b[2] === 'ms' ? 1000 : 1) - at).toFixed(3)}s"`)
    if (/\sbegin=/.test(tag)) return tag
    return tag.replace(/^<\w+/, name => `${name} begin="-${at}s"`)
  })

const page = (svgs: Pic[], bg: string) =>
  `<!doctype html><html style="background:${bg}"><head><meta charset="utf-8"></head>` +
  `<body style="margin:0;background:${bg};width:380px;padding:${PAD}px;box-sizing:border-box">` +
  svgs
    .map((s, i) => `<img style="width:100%;display:block;${i < svgs.length - 1 ? `margin-bottom:${GAP}px` : ''}" src="data:image/svg+xml;base64,${Buffer.from(typeof s === 'string' ? settle(s) : settle(s.svg, s.at)).toString('base64')}">`)
    .join('') +
  `</body></html>`

const args = process.argv.slice(2)
const chrome = args.find(a => a.startsWith('--chrome='))?.slice(9) ?? process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const only = args.filter(a => !a.startsWith('--'))
const isLight = args.includes('--light')
const unknown = only.filter(n => !(n in SHOTS))
if (unknown.length) throw new Error(`知らない mod: ${unknown.join(', ')}`)

const outDir = fileURLToPath(new URL('../docs/images/', import.meta.url))
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'shots-'))
try {
  for (const [mod, make] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(mod)) continue
    // その mod の style.ts の色を替えてから描く (色は描く時に C から読まれる)
    const style = await load(`${mod}/hooks/style.ts`)
    style.setTheme(isLight)
    const svgs = await make()
    const height = Math.ceil(PAD * 2 + GAP * (svgs.length - 1) + svgs.reduce((n, s) => n + heightOf(typeof s === 'string' ? s : s.svg), 0))
    const html = join(tmp, `${mod}.html`)
    const png = join(outDir, `${mod}${isLight ? '-light' : ''}.png`)
    writeFileSync(html, page(svgs, style.C.bg))
    execFileSync(
      chrome,
      [
        '--headless=new',
        `--screenshot=${png}`,
        `--window-size=380,${height}`,
        '--force-device-scale-factor=2',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--virtual-time-budget=4000',
        `--user-data-dir=${join(tmp, 'profile')}`,
        pathToFileURL(html).href,
      ],
      // Chrome は TEMP に .tmp や scoped_dir を残すので、TEMP も消す一時フォルダに向ける
      { stdio: 'ignore', timeout: 60_000, env: { ...process.env, TEMP: tmp, TMP: tmp } },
    )
    console.log(`${mod}${isLight ? '-light' : ''}.png  380x${height}  ${Math.round(statSync(png).size / 1024)}KB`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
