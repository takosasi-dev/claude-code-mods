// mod-check の $.state の契約と、読むだけの他の mod の state の写し。
// 他の mod の型は dependencies を使わず、ここに写す(見本: mods/dev-rpg/types/index.d.ts の 'turn-gacha')。
// mod-check が見るのは「書かれたか(version)」だけなので、中身はどれも unknown にしている

/** mod ごとの判定 */
export type CheckKind =
  /** 本来の名前のコマンドがある(コマンドの無い mod は state が書かれている) */
  | 'ok'
  /** 本来の名前が取られていて、予備の名前で入っている */
  | 'spare'
  /** state は書かれているのに、コマンドが見つからない */
  | 'nocmd'
  /** 読み込みを拒まれた(mod-check より後に読み込まれた mod だけ分かる) */
  | 'refused'
  /** コマンドも state も見つからない */
  | 'missing'
  /** コマンドも state も持たない mod で、確かめようが無い */
  | 'unknown'

export type CheckRow = {
  name: string
  category: string
  kind: CheckKind
  /** 見つかったコマンド(スラッシュ無し)。無ければ空 */
  command: string
  /** 外に見せる state を持つ mod か */
  hasState: boolean
  /** state のどれかが書かれていたか(持たない mod は false) */
  stateSeen: boolean
  /** 読み込みで見えた版(mod-check より後に読み込まれた mod だけ)。無ければ空 */
  version: string
  /** 添え書き(本来の名前の持ち主、拒まれた理由など)。無ければ空 */
  note: string
}

export type CheckEnv = {
  /** 描く画面(vscode・terminal など)。分からなければ空 */
  surface: string
  /** /config の theme の値。分からなければ空 */
  theme: string
  /** エンジンの版。分からなければ空 */
  engine: string
  /** mod-check 自身の開いているペイン(id) */
  panes: string[]
}

export type CheckReport = {
  /** 調べた時刻 (ms) */
  at: number
  env: CheckEnv
  rows: CheckRow[]
  /** 調べた時に版が変わっていた mod。無ければ空か無し */
  updated?: ModUpdate[]
}

/** plugin.register で見えた mod(mod-check より後に読み込まれた物だけ) */
export type CheckSeen = { name: string; version: string; refused: string }

/** セッションの途中で plugin.json の版が変わった mod(このセッションは古い版のまま動いている) */
export type ModUpdate = { name: string; from: string; to: string }

/** 点検表の 1 項目の印。good はよい、bad はだめ、todo はまだ(store には残さない) */
export type CheckMark = 'good' | 'bad' | 'todo'

declare module 'claude-code' {
  interface PluginState {
    'mod-check': {
      /** 最後に調べた結果。まだなら null */
      report: CheckReport | null
      /** 読み込みで見えた mod */
      seen: CheckSeen[]
      /** session.start で受け取った画面の種類 */
      surface: string
      /** 版が変わった mod(帯・ペイン・貼る文に出す) */
      updated: ModUpdate[]
      /** ペインのタブ。check は点検、list は点検表 */
      tab: 'check' | 'list'
      /** 点検表の印(id ごと。まだの物は無い) */
      marks: Record<string, CheckMark>
      /** 「点検の結果を貼る文」で出した文。まだなら空 */
      listText: string
    }
    // ここから下は、書かれたかどうか(version)だけを見る他の mod の state
    'agent-watch': { agents: unknown; now: unknown; hideDone: unknown; note: unknown }
    'aqua-pet': { tank: unknown }
    'canvas-pane': { board: unknown }
    'cc-dash': { tab: unknown; startedAt: unknown; turnCount: unknown; turnDurations: unknown; runningSince: unknown; calls: unknown; toolCounts: unknown; toolTotal: unknown; errorCount: unknown; usage: unknown; layout: unknown; isArranging: unknown }
    'ci-pane': { snap: unknown; isLoading: unknown }
    'code-omikuji': { today: unknown; play: unknown; plays: unknown; history: unknown; mode: unknown; isOpened: unknown; note: unknown }
    'compact-cue': { context: unknown; phase: unknown; lastBreak: unknown; told: unknown }
    'daily-quest': { today: unknown; streak: unknown; totalDone: unknown; saved: unknown; pending: unknown; turnErrors: unknown; note: unknown }
    'dev-rpg': { hero: unknown; tab: unknown; isConfirmingReset: unknown; news: unknown; battle: unknown; restore: unknown }
    'devlog-pane': { log: unknown }
    'done-chime': { settings: unknown; note: unknown }
    'edit-log': { entries: unknown; selected: unknown; detail: unknown; note: unknown }
    'enc-guard': { log: unknown; counts: unknown }
    'face-band': { now: unknown; isHidden: unknown; look: unknown }
    'fail-log': { entries: unknown; total: unknown; confirming: unknown }
    'file-map': { files: unknown; filter: unknown }
    'focus-timer': { run: unknown; done: unknown }
    'git-pane': { snap: unknown; note: unknown }
    'live-commentary': { log: unknown; score: unknown; clock: unknown; isOn: unknown }
    'mod-hub': { mods: unknown; commands: unknown; notice: unknown; sort: unknown; filter: unknown; pins: unknown; recent: unknown }
    'port-watch': { list: unknown; baseline: unknown; armed: unknown; isNarrow: unknown; note: unknown }
    'pre-check': { report: unknown; test: unknown; open: unknown }
    'project-board': { projects: unknown; loadedAt: unknown; error: unknown; sort: unknown; filter: unknown; detail: unknown }
    'prompt-book': { items: unknown; draft: unknown; tag: unknown; sort: unknown; armed: unknown; notice: unknown; isFlashing: unknown }
    'release-draft': { report: unknown; repo: unknown }
    'rule-switch': { save: unknown; armed: unknown; note: unknown }
    'rule-watch': { misses: unknown; counts: unknown; history: unknown; asks: unknown; memoPending: unknown; log: unknown }
    'run-guard': { saved: unknown }
    'session-recap': { turns: unknown; startedAt: unknown; pending: unknown; selected: unknown; summary: unknown; notice: unknown; command: unknown }
    'session-timeline': { turns: unknown }
    'ship-guard': { isOff: unknown; log: unknown; permit: unknown; turn: unknown }
    'spec-board': { snap: unknown; isLoading: unknown; detail: unknown }
    'test-runner': { run: unknown; history: unknown; note: unknown }
    'toast-inbox': { items: unknown; readAt: unknown; filter: unknown; confirmClear: unknown; commands: unknown; notice: unknown }
    'todo-board': { snap: unknown; history: unknown; running: unknown; filter: unknown; selected: unknown; note: unknown }
    'token-meter': { turns: unknown; total: unknown; sub: unknown; count: unknown; heaviest: unknown }
    'trophy-shelf': { firstAt: unknown }
    'turn-gacha': { save: unknown; cards: unknown; view: unknown; note: unknown; turnErrors: unknown }
    'turn-haiku': { poems: unknown; isAuto: unknown; isComposing: unknown; lastTurn: unknown; note: unknown }
    'usage-history': { days: unknown; heat: unknown; week: unknown; range: unknown; metric: unknown; restore: unknown; note: unknown }
    'usage-pane': { usage: unknown }
    'wait-games': { game: unknown; g2048: unknown; mines: unknown; flagMode: unknown; fifteen: unknown; lights: unknown; sudoku: unknown; memory: unknown; stats: unknown; isPlaying: unknown; turnNote: unknown; note: unknown }
    'week-card': { snaps: unknown }
    'work-bar': { run: unknown; last: unknown; isHidden: unknown; pick: unknown }
  }
}
