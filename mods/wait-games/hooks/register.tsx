import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Dir, Fifteen, Game2048, GameKind, GameStats, Lights, Memory, Mines, Puzzle, RecordKind, Sudoku, SudokuSize } from '../types'
import { applyFifteen, look as lookFifteen, newFifteen, SIDE as FIFTEEN_SIDE } from './fifteen'
import { newGame, play } from './game2048'
import { applyLights, look as lookLights, newLights, SIDE as LIGHTS_SIDE } from './lights'
import { applyMemory, look as lookMemory, newMemory } from './memory'
import { COLS, look, newMines, reveal, ROWS, toggleFlag } from './mines'
import { addStats, EMPTY_STATS, keepUnknown, statsFromSaved } from './stats'
import type { StatsDelta } from './stats'
import { applySudoku, boxOf, look as lookSudoku, newSudoku, selectCell } from './sudoku'
import {
  board2048Rows,
  board2048Svg,
  C,
  fifteenHead,
  fifteenSvg,
  lightsHead,
  lightsSvg,
  lines2048,
  memoryHead,
  memorySvg,
  minesHead,
  minesSvg,
  sudokuHead,
  sudokuSvg,
} from './svg'
import type { Head } from './svg'
import { followTheme, readTheme } from './style'

const PANE = 'wait-games'
const TITLE = 'ミニゲーム'
const DESCRIPTION = 'Claude の返事を待つ間に 2048・マインスイーパー・15 パズル・ライツアウト・数独・神経衰弱で遊ぶ'

/** ゲームの並び (Select の順) */
const GAMES: { value: GameKind; label: string }[] = [
  { value: '2048', label: '2048' },
  { value: 'mines', label: 'マインスイーパー' },
  { value: 'fifteen', label: '15 パズル' },
  { value: 'lights', label: 'ライツアウト' },
  { value: 'sudoku', label: '数独' },
  { value: 'memory', label: '神経衰弱' },
]
const STORE_KEY = 'stats'

const GAME = atom({ plugin: 'wait-games', key: 'game' } as const, '2048' as GameKind)
const G2048 = atom({ plugin: 'wait-games', key: 'g2048' } as const, newGame(Math.random) as Game2048)
const MINES = atom({ plugin: 'wait-games', key: 'mines' } as const, newMines() as Mines)
const FLAG = atom({ plugin: 'wait-games', key: 'flagMode' } as const, false)
const FIFTEEN = atom({ plugin: 'wait-games', key: 'fifteen' } as const, newFifteen(Math.random) as Fifteen)
const LIGHTS = atom({ plugin: 'wait-games', key: 'lights' } as const, newLights(Math.random) as Lights)
// 既定は軽い 4x4 (9x9 は作るのに少し時間がかかるので、ボタンを押した時だけ作る)
const SUDOKU = atom({ plugin: 'wait-games', key: 'sudoku' } as const, newSudoku(4, Math.random) as Sudoku)
const MEMORY = atom({ plugin: 'wait-games', key: 'memory' } as const, newMemory(Math.random) as Memory)
const STATS = atom({ plugin: 'wait-games', key: 'stats' } as const, EMPTY_STATS as GameStats)
const PLAYING = atom({ plugin: 'wait-games', key: 'isPlaying' } as const, false)
const TURN_NOTE = atom({ plugin: 'wait-games', key: 'turnNote' } as const, '')
const NOTE = atom({ plugin: 'wait-games', key: 'note' } as const, '')

type $ = EngineInterface

const BROKEN = '記録を読めなかったので、最高点と勝ちを残せません(上書きしないよう止めています)'

let ownsMain = false

// store に書く物は 1 本ずつ流す (連打で同じ値を読んで 1 回分消えないように)
let chain: Promise<unknown> = Promise.resolve()
const serial = (f: () => Promise<unknown>) => (chain = chain.then(f, f))

/** store の記録と生の値。キーが無ければ空、読めない時 (例外・形が違う) は stats が undefined */
async function readStore($: $): Promise<{ stats: GameStats | undefined; raw: unknown }> {
  try {
    const raw = await $.store.get(STORE_KEY)
    return { stats: statsFromSaved(raw), raw }
  } catch {
    return { stats: undefined, raw: undefined }
  }
}

async function load($: $) {
  const saved = (await readStore($)).stats
  if (saved) await update($, STATS, () => saved)
  else await update($, NOTE, () => BROKEN)
}

/** 増えた分だけを、書く直前に読み直した store に足して書く (別のセッションの分を消さない) */
const record = ($: $, d: StatsDelta) =>
  serial(async () => {
    const { stats: saved, raw } = await readStore($)
    if (!saved) {
      await update($, NOTE, () => BROKEN)
      return
    }
    const next = addStats(saved, d)
    // 知らない欄 (新しい版が足した物) は読み直した生の値から残す
    const isSaved = await $.store.set(STORE_KEY, keepUnknown(raw, next)).then(
      () => true,
      () => false,
    )
    await update($, STATS, () => next)
    await update($, NOTE, () => (isSaved ? '' : '記録を保存できませんでした'))
  })

const touch = ($: $) => update($, PLAYING, () => true)

async function move2048($: $, dir: Dir) {
  await touch($)
  let isNewWin = false
  const g = await update($, G2048, cur => {
    const r = play(cur, dir, Math.random)
    isNewWin = r.isNewWin
    return r.game
  })
  const best = (await read($, STATS)).best2048
  if (isNewWin || g.score > best) await record($, { best2048: g.score, wins2048: isNewWin ? 1 : 0 })
}

async function pressCell($: $, i: number) {
  await touch($)
  const isFlag = await read($, FLAG)
  const now = await $.clock.now()
  let wasWon = false
  const s = await update($, MINES, cur => {
    wasWon = cur.status === 'won'
    return isFlag ? toggleFlag(cur, i) : reveal(cur, i, now, Math.random)
  })
  if (!wasWon && s.status === 'won') await record($, { winsMines: 1, fastestMines: Math.max(1, s.endedAt - s.startedAt) })
}

/** 押して解くゲームの 1 手。解けた時 (前は解けていなかった) だけ記録を足す */
// run は update($, <atom>, f) を呼ぶ形で渡す (update の atom はその場に書かないとエンジンが読めない)
async function playPuzzle<T extends Puzzle>($: $, run: (f: (cur: T) => T) => Promise<T>, apply: (cur: T, now: number) => T, kind: (s: T) => RecordKind) {
  await touch($)
  const now = await $.clock.now()
  let wasWon = false
  const s = await run(cur => {
    wasWon = cur.status === 'won'
    return apply(cur, now)
  })
  if (!wasWon && s.status === 'won') await record($, { puzzle: { kind: kind(s), moves: s.moves, ms: Math.max(1, s.endedAt - s.startedAt) } })
}

const sudokuKind = (s: Sudoku): RecordKind => (s.size === 4 ? 'sudoku4' : 'sudoku9')

const openPane = async ($: $) => {
  await load($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'ミニゲームを開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // /games が拒まれたら (組み込みと被ったら) /wait-games にする
    const got = await $.command.register({ name: 'games', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'games'
    if (!ownsMain) await $.command.register({ name: 'wait-games', description: DESCRIPTION }).catch(() => {})
    await load($)
    return started
  })

  // /games を持てなかった時は、元の /games に回す
  on('command.run', { command: 'games' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'wait-games' }, openPane)

  // メインのターンが始まったら、遊んでいるかを数え直す
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, PLAYING, () => false)
      await update($, TURN_NOTE, () => '')
    }
    return next(e)
  })

  // メインのターンの間に遊んでいたら、終わった時に 1 回だけ知らせる。中断は自分で止めたので知らせない
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason !== 'aborted' && (await read($, PLAYING))) {
      const text = e.reason === 'answer' ? 'Claude のターンが終わりました' : 'Claude のターンが止まりました'
      await update($, PLAYING, () => false)
      await update($, TURN_NOTE, () => text)
      $.ui.toast(text)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const isTerminal = e.surface === 'terminal'
    const Svg = !isTerminal && 'Svg' in t ? t.Svg : undefined
    const game = await read($, GAME)
    const stats = await read($, STATS)
    const turnNote = await read($, TURN_NOTE)
    const note = await read($, NOTE)

    const pick = (v: string) => void update($, GAME, cur => GAMES.find(g => g.value === v)?.value ?? cur)
    const picker =
      'Select' in t ? (
        <t.Select key="game" label="ゲーム" options={GAMES} value={game} onSelect={pick} />
      ) : (
        <Box key="game" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {GAMES.map(g => (
            <Button key={`pick-${g.value}`} label={g.label} onPress={() => pick(g.value)} />
          ))}
        </Box>
      )

    /** 盤の上の見出し。vscode は SVG、terminal は 2 行の Text */
    // 名前 h は JSX の関数なので使わない
    const headOf = (svg: string, hd: Head) =>
      Svg ? (
        <Svg key="head" source={svg} alt={`${hd.left}、${hd.state}`} />
      ) : (
        <Box key="head" flexDirection="column">
          <Text>
            {hd.left} <Text color={hd.color}>{hd.state}</Text>
          </Text>
          <Text dimColor>{hd.record}</Text>
        </Box>
      )

    /** side×side の Button の盤。cell は Button を返す。group を渡すと、その幅ごとに間を広げる (数独の箱) */
    const board = (prefix: string, side: number, cell: (i: number) => RenderChildren, group = side) => (
      <Box key={`${prefix}-grid`} flexDirection="column">
        {Array.from({ length: side }, (_, r) => {
          const cols = Array.from({ length: side }, (_, c) => r * side + c)
          const row =
            group < side ? (
              Array.from({ length: side / group }, (_, k) => (
                <Box key={`${prefix}-r${r}g${k}`} flexDirection="row" columnGap={1}>
                  {cols.slice(k * group, (k + 1) * group).map(cell)}
                </Box>
              ))
            ) : (
              cols.map(cell)
            )
          return (
            <Box key={`${prefix}-r${r}`} flexDirection="row" columnGap={group < side ? 2 : 1} marginTop={group < side && r > 0 && r % group === 0 ? 1 : undefined}>
              {row}
            </Box>
          )
        })}
      </Box>
    )

    let body
    if (game === 'fifteen') {
      const g = await read($, FIFTEEN)
      body = (
        <Box key="fifteen" flexDirection="column" gap={1}>
          {headOf(fifteenSvg(g, stats), fifteenHead(g, stats))}
          {board('f', FIFTEEN_SIDE, i => {
            const l = lookFifteen(g, i)
            return <Button key={`f${i}`} label={l.text} plain dimColor={l.isBlank} onPress={() => void playPuzzle<Fifteen>($, f => update($, FIFTEEN, f), (cur, now) => applyFifteen(cur, i, now), () => 'fifteen')} />
          })}
          <Button key="new-fifteen" label="新しいゲーム" onPress={() => void update($, FIFTEEN, () => newFifteen(Math.random))} />
        </Box>
      )
    } else if (game === 'lights') {
      const g = await read($, LIGHTS)
      body = (
        <Box key="lights" flexDirection="column" gap={1}>
          {headOf(lightsSvg(g, stats), lightsHead(g, stats))}
          {board('l', LIGHTS_SIDE, i => {
            const l = lookLights(g, i)
            return <Button key={`l${i}`} label={isTerminal ? l.text : l.wide} plain dimColor={!l.isOn} onPress={() => void playPuzzle<Lights>($, f => update($, LIGHTS, f), (cur, now) => applyLights(cur, i, now), () => 'lights')} />
          })}
          <Button key="new-lights" label="新しいゲーム" onPress={() => void update($, LIGHTS, () => newLights(Math.random))} />
        </Box>
      )
    } else if (game === 'sudoku') {
      const g = await read($, SUDOKU)
      const fresh = (n: SudokuSize) => () => void update($, SUDOKU, () => newSudoku(n, Math.random))
      body = (
        <Box key="sudoku" flexDirection="column" gap={1}>
          {headOf(sudokuSvg(g, stats), sudokuHead(g, stats))}
          {board(
            's',
            g.size,
            i => {
              const l = lookSudoku(g, i)
              const label = isTerminal ? l.text : l.wide
              // 選んだマスは反転、重なった数字は赤、自分で入れた数字は青、初めからある数字はそのまま
              return (
                <Button key={`s${i}`} label={label} plain onPress={() => void update($, SUDOKU, cur => selectCell(cur, i))}>
                  <Text inverse={l.isSelected} color={l.isClash ? C.red : l.isGiven ? undefined : C.blue} dimColor={l.text === '.' && !l.isSelected}>
                    {label}
                  </Text>
                </Button>
              )
            },
            boxOf(g.size),
          )}
          <Box key="pad" flexDirection="row" flexWrap="wrap" columnGap={1}>
            {Array.from({ length: g.size }, (_, k) => k + 1).map(d => (
              <Button
                key={`d${d}`}
                label={isTerminal ? String(d) : String.fromCharCode(0xff10 + d)}
                plain
                dimColor={g.selected < 0}
                onPress={() => void playPuzzle($, f => update($, SUDOKU, f), (cur, now) => applySudoku(cur, d, now), sudokuKind)}
              />
            ))}
            <Button key="d0" label="消す" plain dimColor={g.selected < 0} onPress={() => void playPuzzle($, f => update($, SUDOKU, f), (cur, now) => applySudoku(cur, 0, now), sudokuKind)} />
          </Box>
          <Box key="sudoku-actions" flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key="sudoku-4" label="新しく 4x4" variant={g.size === 4 ? 'primary' : undefined} onPress={fresh(4)} />
            <Button key="sudoku-9" label="新しく 9x9" variant={g.size === 9 ? 'primary' : undefined} onPress={fresh(9)} />
          </Box>
        </Box>
      )
    } else if (game === 'memory') {
      const g = await read($, MEMORY)
      body = (
        <Box key="memory" flexDirection="column" gap={1}>
          {headOf(memorySvg(g, stats), memoryHead(g, stats))}
          {board('c', 4, i => {
            const l = lookMemory(g, i)
            const label = isTerminal ? l.text : l.wide
            return (
              <Button key={`c${i}`} label={label} plain onPress={() => void playPuzzle<Memory>($, f => update($, MEMORY, f), (cur, now) => applyMemory(cur, i, now), () => 'memory')}>
                <Text bold={l.isUp && !l.isMiss} color={l.isMiss ? C.red : undefined} dimColor={l.isDone}>
                  {label}
                </Text>
              </Button>
            )
          })}
          <Button key="new-memory" label="新しいゲーム" onPress={() => void update($, MEMORY, () => newMemory(Math.random))} />
        </Box>
      )
    } else if (game === '2048') {
      const g = await read($, G2048)
      const best = Math.max(stats.best2048, g.score)
      const view = Svg ? (
        <Svg key="board" source={board2048Svg(g, stats)} alt={`2048 スコア ${g.score}、最高点 ${best}${g.isOver ? '、ゲームオーバー' : ''}`} />
      ) : (
        <Box key="board" flexDirection="column">
          <Text bold>{lines2048(g, stats)[0]}</Text>
          {board2048Rows(g).map((row, r) => (
            <Box key={`r${r}`} flexDirection="row">
              {row.cells.map(cell => (
                <Text color={cell.color}>{cell.text}</Text>
              ))}
            </Box>
          ))}
          <Text dimColor={!g.isOver} color={g.isOver ? C.red : undefined}>
            {lines2048(g, stats)[1]}
          </Text>
        </Box>
      )
      const arrow = (dir: Dir, label: string) => <Button key={dir} label={label} onPress={() => void move2048($, dir)} />
      body = (
        <Box key="g2048" flexDirection="column" gap={1}>
          {view}
          <Box key="pad" flexDirection="column" alignItems="center">
            {arrow('up', '↑')}
            <Box key="pad-row" flexDirection="row" gap={1}>
              {arrow('left', '←')}
              {arrow('down', '↓')}
              {arrow('right', '→')}
            </Box>
          </Box>
          <Button key="new-2048" label="新しいゲーム" onPress={() => void update($, G2048, () => newGame(Math.random))} />
        </Box>
      )
    } else {
      const s = await read($, MINES)
      const isFlag = await read($, FLAG)
      const head = minesHead(s, stats)
      const rows = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => r * COLS + c))
      body = (
        <Box key="mines" flexDirection="column" gap={1}>
          {Svg ? (
            <Svg key="head" source={minesSvg(s, stats)} alt={`${head.left}、${head.state}`} />
          ) : (
            <Box key="head" flexDirection="column">
              <Text>
                {head.left} <Text color={head.color}>{head.state}</Text>
              </Text>
              <Text dimColor>{head.record}</Text>
            </Box>
          )}
          {/* 64 マスは plain の 1 文字の Button。29 桁でも 8 列 + 間 7 = 15 桁に収まる */}
          <Box key="grid" flexDirection="column">
            {rows.map((row, r) => (
              <Box key={`row${r}`} flexDirection="row" columnGap={1}>
                {row.map(i => {
                  const l = look(s, i)
                  return (
                    <Button
                      key={`m${i}`}
                      label={isTerminal ? l.text : l.wide}
                      plain
                      dimColor={l.isOpen && !l.isBoom}
                      variant={l.isBoom ? 'primary' : undefined}
                      onPress={() => void pressCell($, i)}
                    />
                  )
                })}
              </Box>
            ))}
          </Box>
          <Box key="mines-actions" flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button
              key="flag"
              label={isFlag ? '旗モード: オン' : '旗モード: オフ'}
              variant={isFlag ? 'primary' : 'secondary'}
              onPress={() => void update($, FLAG, v => !v)}
            />
            <Button key="new-mines" label="新しいゲーム" onPress={() => void update($, MINES, () => newMines())} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {turnNote !== '' && (
          <Box key="turn" flexDirection="column">
            <Text color={C.blue} bold>
              {turnNote}
            </Text>
            <Button key="turn-ok" label="閉じる" onPress={() => void update($, TURN_NOTE, () => '')} />
          </Box>
        )}
        {picker}
        {body}
        {note !== '' && <Text color={C.yellow}>{note}</Text>}
      </Box>
    )
  })
}
