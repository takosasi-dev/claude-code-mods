// 他の mod の $.state を読み、どれか 1 つでも書かれていたか(version > 0)を mod ごとに返す。
// plugin と key はソースに文字で書く決まり(validate が読む。文字でないと mod が読み込まれない)ので、表は手で並べる。
// key は各 mod の types/index.d.ts の PluginState から写した。描画の中では呼ばない(170 本ほどの購読になる)
import type { EngineInterface } from 'claude-code'

type Read = () => Promise<{ version: number }>

// $ を import の先へ渡せるのは function の宣言だけ(validate の決まり)
function reads($: EngineInterface): Record<string, Read[]> {
  return {
  'agent-watch': [() => $.state.get({ plugin: 'agent-watch', key: 'agents' }), () => $.state.get({ plugin: 'agent-watch', key: 'now' }), () => $.state.get({ plugin: 'agent-watch', key: 'hideDone' }), () => $.state.get({ plugin: 'agent-watch', key: 'note' })],
  'aqua-pet': [() => $.state.get({ plugin: 'aqua-pet', key: 'tank' })],
  'canvas-pane': [() => $.state.get({ plugin: 'canvas-pane', key: 'board' })],
  'cc-dash': [() => $.state.get({ plugin: 'cc-dash', key: 'tab' }), () => $.state.get({ plugin: 'cc-dash', key: 'startedAt' }), () => $.state.get({ plugin: 'cc-dash', key: 'turnCount' }), () => $.state.get({ plugin: 'cc-dash', key: 'turnDurations' }), () => $.state.get({ plugin: 'cc-dash', key: 'runningSince' }), () => $.state.get({ plugin: 'cc-dash', key: 'calls' }), () => $.state.get({ plugin: 'cc-dash', key: 'toolCounts' }), () => $.state.get({ plugin: 'cc-dash', key: 'toolTotal' }), () => $.state.get({ plugin: 'cc-dash', key: 'errorCount' }), () => $.state.get({ plugin: 'cc-dash', key: 'usage' }), () => $.state.get({ plugin: 'cc-dash', key: 'layout' }), () => $.state.get({ plugin: 'cc-dash', key: 'isArranging' })],
  'ci-pane': [() => $.state.get({ plugin: 'ci-pane', key: 'snap' }), () => $.state.get({ plugin: 'ci-pane', key: 'isLoading' })],
  'code-omikuji': [() => $.state.get({ plugin: 'code-omikuji', key: 'today' }), () => $.state.get({ plugin: 'code-omikuji', key: 'play' }), () => $.state.get({ plugin: 'code-omikuji', key: 'plays' }), () => $.state.get({ plugin: 'code-omikuji', key: 'history' }), () => $.state.get({ plugin: 'code-omikuji', key: 'mode' }), () => $.state.get({ plugin: 'code-omikuji', key: 'isOpened' }), () => $.state.get({ plugin: 'code-omikuji', key: 'note' })],
  'compact-cue': [() => $.state.get({ plugin: 'compact-cue', key: 'context' }), () => $.state.get({ plugin: 'compact-cue', key: 'phase' }), () => $.state.get({ plugin: 'compact-cue', key: 'lastBreak' }), () => $.state.get({ plugin: 'compact-cue', key: 'told' })],
  'daily-quest': [() => $.state.get({ plugin: 'daily-quest', key: 'today' }), () => $.state.get({ plugin: 'daily-quest', key: 'streak' }), () => $.state.get({ plugin: 'daily-quest', key: 'totalDone' }), () => $.state.get({ plugin: 'daily-quest', key: 'saved' }), () => $.state.get({ plugin: 'daily-quest', key: 'pending' }), () => $.state.get({ plugin: 'daily-quest', key: 'turnErrors' }), () => $.state.get({ plugin: 'daily-quest', key: 'note' })],
  'dev-rpg': [() => $.state.get({ plugin: 'dev-rpg', key: 'hero' }), () => $.state.get({ plugin: 'dev-rpg', key: 'tab' }), () => $.state.get({ plugin: 'dev-rpg', key: 'isConfirmingReset' }), () => $.state.get({ plugin: 'dev-rpg', key: 'news' }), () => $.state.get({ plugin: 'dev-rpg', key: 'battle' }), () => $.state.get({ plugin: 'dev-rpg', key: 'restore' })],
  'devlog-pane': [() => $.state.get({ plugin: 'devlog-pane', key: 'log' })],
  'done-chime': [() => $.state.get({ plugin: 'done-chime', key: 'settings' }), () => $.state.get({ plugin: 'done-chime', key: 'note' })],
  'edit-log': [() => $.state.get({ plugin: 'edit-log', key: 'entries' }), () => $.state.get({ plugin: 'edit-log', key: 'selected' }), () => $.state.get({ plugin: 'edit-log', key: 'detail' }), () => $.state.get({ plugin: 'edit-log', key: 'note' })],
  'enc-guard': [() => $.state.get({ plugin: 'enc-guard', key: 'log' }), () => $.state.get({ plugin: 'enc-guard', key: 'counts' })],
  'face-band': [() => $.state.get({ plugin: 'face-band', key: 'now' }), () => $.state.get({ plugin: 'face-band', key: 'isHidden' }), () => $.state.get({ plugin: 'face-band', key: 'look' })],
  'fail-log': [() => $.state.get({ plugin: 'fail-log', key: 'entries' }), () => $.state.get({ plugin: 'fail-log', key: 'total' }), () => $.state.get({ plugin: 'fail-log', key: 'confirming' })],
  'file-map': [() => $.state.get({ plugin: 'file-map', key: 'files' }), () => $.state.get({ plugin: 'file-map', key: 'filter' })],
  'focus-timer': [() => $.state.get({ plugin: 'focus-timer', key: 'run' }), () => $.state.get({ plugin: 'focus-timer', key: 'done' })],
  'git-pane': [() => $.state.get({ plugin: 'git-pane', key: 'snap' }), () => $.state.get({ plugin: 'git-pane', key: 'note' })],
  'live-commentary': [() => $.state.get({ plugin: 'live-commentary', key: 'log' }), () => $.state.get({ plugin: 'live-commentary', key: 'score' }), () => $.state.get({ plugin: 'live-commentary', key: 'clock' }), () => $.state.get({ plugin: 'live-commentary', key: 'isOn' })],
  'mod-hub': [() => $.state.get({ plugin: 'mod-hub', key: 'mods' }), () => $.state.get({ plugin: 'mod-hub', key: 'commands' }), () => $.state.get({ plugin: 'mod-hub', key: 'notice' }), () => $.state.get({ plugin: 'mod-hub', key: 'sort' }), () => $.state.get({ plugin: 'mod-hub', key: 'filter' }), () => $.state.get({ plugin: 'mod-hub', key: 'pins' }), () => $.state.get({ plugin: 'mod-hub', key: 'recent' })],
  'port-watch': [() => $.state.get({ plugin: 'port-watch', key: 'list' }), () => $.state.get({ plugin: 'port-watch', key: 'baseline' }), () => $.state.get({ plugin: 'port-watch', key: 'armed' }), () => $.state.get({ plugin: 'port-watch', key: 'isNarrow' }), () => $.state.get({ plugin: 'port-watch', key: 'note' })],
  'pre-check': [() => $.state.get({ plugin: 'pre-check', key: 'report' }), () => $.state.get({ plugin: 'pre-check', key: 'test' }), () => $.state.get({ plugin: 'pre-check', key: 'open' })],
  'project-board': [() => $.state.get({ plugin: 'project-board', key: 'projects' }), () => $.state.get({ plugin: 'project-board', key: 'loadedAt' }), () => $.state.get({ plugin: 'project-board', key: 'error' }), () => $.state.get({ plugin: 'project-board', key: 'sort' }), () => $.state.get({ plugin: 'project-board', key: 'filter' }), () => $.state.get({ plugin: 'project-board', key: 'detail' })],
  'prompt-book': [() => $.state.get({ plugin: 'prompt-book', key: 'items' }), () => $.state.get({ plugin: 'prompt-book', key: 'draft' }), () => $.state.get({ plugin: 'prompt-book', key: 'tag' }), () => $.state.get({ plugin: 'prompt-book', key: 'sort' }), () => $.state.get({ plugin: 'prompt-book', key: 'armed' }), () => $.state.get({ plugin: 'prompt-book', key: 'notice' }), () => $.state.get({ plugin: 'prompt-book', key: 'isFlashing' })],
  'release-draft': [() => $.state.get({ plugin: 'release-draft', key: 'report' }), () => $.state.get({ plugin: 'release-draft', key: 'repo' })],
  'rule-switch': [() => $.state.get({ plugin: 'rule-switch', key: 'save' }), () => $.state.get({ plugin: 'rule-switch', key: 'armed' }), () => $.state.get({ plugin: 'rule-switch', key: 'note' })],
  'rule-watch': [() => $.state.get({ plugin: 'rule-watch', key: 'misses' }), () => $.state.get({ plugin: 'rule-watch', key: 'counts' }), () => $.state.get({ plugin: 'rule-watch', key: 'history' }), () => $.state.get({ plugin: 'rule-watch', key: 'asks' }), () => $.state.get({ plugin: 'rule-watch', key: 'memoPending' }), () => $.state.get({ plugin: 'rule-watch', key: 'log' })],
  'run-guard': [() => $.state.get({ plugin: 'run-guard', key: 'saved' })],
  'session-recap': [() => $.state.get({ plugin: 'session-recap', key: 'turns' }), () => $.state.get({ plugin: 'session-recap', key: 'startedAt' }), () => $.state.get({ plugin: 'session-recap', key: 'pending' }), () => $.state.get({ plugin: 'session-recap', key: 'selected' }), () => $.state.get({ plugin: 'session-recap', key: 'summary' }), () => $.state.get({ plugin: 'session-recap', key: 'notice' }), () => $.state.get({ plugin: 'session-recap', key: 'command' })],
  'session-timeline': [() => $.state.get({ plugin: 'session-timeline', key: 'turns' })],
  'ship-guard': [() => $.state.get({ plugin: 'ship-guard', key: 'isOff' }), () => $.state.get({ plugin: 'ship-guard', key: 'log' }), () => $.state.get({ plugin: 'ship-guard', key: 'permit' }), () => $.state.get({ plugin: 'ship-guard', key: 'turn' })],
  'spec-board': [() => $.state.get({ plugin: 'spec-board', key: 'snap' }), () => $.state.get({ plugin: 'spec-board', key: 'isLoading' }), () => $.state.get({ plugin: 'spec-board', key: 'detail' })],
  'test-runner': [() => $.state.get({ plugin: 'test-runner', key: 'run' }), () => $.state.get({ plugin: 'test-runner', key: 'history' }), () => $.state.get({ plugin: 'test-runner', key: 'note' })],
  'toast-inbox': [() => $.state.get({ plugin: 'toast-inbox', key: 'items' }), () => $.state.get({ plugin: 'toast-inbox', key: 'readAt' }), () => $.state.get({ plugin: 'toast-inbox', key: 'filter' }), () => $.state.get({ plugin: 'toast-inbox', key: 'confirmClear' }), () => $.state.get({ plugin: 'toast-inbox', key: 'commands' }), () => $.state.get({ plugin: 'toast-inbox', key: 'notice' })],
  'todo-board': [() => $.state.get({ plugin: 'todo-board', key: 'snap' }), () => $.state.get({ plugin: 'todo-board', key: 'history' }), () => $.state.get({ plugin: 'todo-board', key: 'running' }), () => $.state.get({ plugin: 'todo-board', key: 'filter' }), () => $.state.get({ plugin: 'todo-board', key: 'selected' }), () => $.state.get({ plugin: 'todo-board', key: 'note' })],
  'token-meter': [() => $.state.get({ plugin: 'token-meter', key: 'turns' }), () => $.state.get({ plugin: 'token-meter', key: 'total' }), () => $.state.get({ plugin: 'token-meter', key: 'sub' }), () => $.state.get({ plugin: 'token-meter', key: 'count' }), () => $.state.get({ plugin: 'token-meter', key: 'heaviest' })],
  'trophy-shelf': [() => $.state.get({ plugin: 'trophy-shelf', key: 'firstAt' })],
  'turn-gacha': [() => $.state.get({ plugin: 'turn-gacha', key: 'save' }), () => $.state.get({ plugin: 'turn-gacha', key: 'cards' }), () => $.state.get({ plugin: 'turn-gacha', key: 'view' }), () => $.state.get({ plugin: 'turn-gacha', key: 'note' }), () => $.state.get({ plugin: 'turn-gacha', key: 'turnErrors' })],
  'turn-haiku': [() => $.state.get({ plugin: 'turn-haiku', key: 'poems' }), () => $.state.get({ plugin: 'turn-haiku', key: 'isAuto' }), () => $.state.get({ plugin: 'turn-haiku', key: 'isComposing' }), () => $.state.get({ plugin: 'turn-haiku', key: 'lastTurn' }), () => $.state.get({ plugin: 'turn-haiku', key: 'note' })],
  'usage-history': [() => $.state.get({ plugin: 'usage-history', key: 'days' }), () => $.state.get({ plugin: 'usage-history', key: 'heat' }), () => $.state.get({ plugin: 'usage-history', key: 'week' }), () => $.state.get({ plugin: 'usage-history', key: 'range' }), () => $.state.get({ plugin: 'usage-history', key: 'metric' }), () => $.state.get({ plugin: 'usage-history', key: 'restore' }), () => $.state.get({ plugin: 'usage-history', key: 'note' })],
  'usage-pane': [() => $.state.get({ plugin: 'usage-pane', key: 'usage' })],
  'wait-games': [() => $.state.get({ plugin: 'wait-games', key: 'game' }), () => $.state.get({ plugin: 'wait-games', key: 'g2048' }), () => $.state.get({ plugin: 'wait-games', key: 'mines' }), () => $.state.get({ plugin: 'wait-games', key: 'flagMode' }), () => $.state.get({ plugin: 'wait-games', key: 'fifteen' }), () => $.state.get({ plugin: 'wait-games', key: 'lights' }), () => $.state.get({ plugin: 'wait-games', key: 'sudoku' }), () => $.state.get({ plugin: 'wait-games', key: 'memory' }), () => $.state.get({ plugin: 'wait-games', key: 'stats' }), () => $.state.get({ plugin: 'wait-games', key: 'isPlaying' }), () => $.state.get({ plugin: 'wait-games', key: 'turnNote' }), () => $.state.get({ plugin: 'wait-games', key: 'note' })],
  'week-card': [() => $.state.get({ plugin: 'week-card', key: 'snaps' })],
  'work-bar': [() => $.state.get({ plugin: 'work-bar', key: 'run' }), () => $.state.get({ plugin: 'work-bar', key: 'last' }), () => $.state.get({ plugin: 'work-bar', key: 'isHidden' }), () => $.state.get({ plugin: 'work-bar', key: 'pick' })],
  }
}

/** state を読む mod の名前(試験で表と突き合わせる) */
export const PROBED = Object.keys(reads({} as EngineInterface))

/** mod ごとに、state のどれかが書かれていたか。読めない物(入っていない・答えが無い)は書かれていない扱い */
export async function probeStates($: EngineInterface): Promise<Record<string, boolean>> {
  const seen = async (r: Read) => {
    try {
      return (await r()).version > 0
    } catch {
      return false
    }
  }
  const entries = await Promise.all(Object.entries(reads($)).map(async ([name, list]) => [name, (await Promise.all(list.map(seen))).some(Boolean)] as const))
  return Object.fromEntries(entries)
}
