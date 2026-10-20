import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Dir, Game2048, GameKind, GameStats, Mines } from '../types'
import { newGame, play } from './game2048'
import { COLS, look, newMines, reveal, ROWS, toggleFlag } from './mines'
import { addStats, EMPTY_STATS, statsFromSaved } from './stats'
import type { StatsDelta } from './stats'
import { board2048Rows, board2048Svg, C, lines2048, minesHead, minesSvg } from './svg'

const PANE = 'wait-games'
const TITLE = 'ミニゲーム'
const DESCRIPTION = 'Claude の返事を待つ間に 2048 とマインスイーパーで遊ぶ'
const STORE_KEY = 'stats'

const GAME = atom({ plugin: 'wait-games', key: 'game' } as const, '2048' as GameKind)
const G2048 = atom({ plugin: 'wait-games', key: 'g2048' } as const, newGame(Math.random) as Game2048)
const MINES = atom({ plugin: 'wait-games', key: 'mines' } as const, newMines() as Mines)
const FLAG = atom({ plugin: 'wait-games', key: 'flagMode' } as const, false)
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

/** store の記録。キーが無ければ空、読めない時 (例外・形が違う) は undefined */
async function readStore($: $): Promise<GameStats | undefined> {
  try {
    return statsFromSaved(await $.store.get(STORE_KEY))
  } catch {
    return undefined
  }
}

async function load($: $) {
  const saved = await readStore($)
  if (saved) await update($, STATS, () => saved)
  else await update($, NOTE, () => BROKEN)
}

/** 増えた分だけを、書く直前に読み直した store に足して書く (別のセッションの分を消さない) */
const record = ($: $, d: StatsDelta) =>
  serial(async () => {
    const saved = await readStore($)
    if (!saved) {
      await update($, NOTE, () => BROKEN)
      return
    }
    const next = addStats(saved, d)
    const isSaved = await $.store.set(STORE_KEY, next).then(
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

const openPane = async ($: $) => {
  await load($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'ミニゲームを開きました。' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
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

    const pick = (v: string) => void update($, GAME, () => (v === 'mines' ? 'mines' : '2048'))
    const picker =
      'Select' in t ? (
        <t.Select
          key="game"
          label="ゲーム"
          options={[
            { value: '2048', label: '2048' },
            { value: 'mines', label: 'マインスイーパー' },
          ]}
          value={game}
          onSelect={pick}
        />
      ) : (
        <Box key="game" flexDirection="row" gap={1}>
          <Button key="pick-2048" label="2048" onPress={() => pick('2048')} />
          <Button key="pick-mines" label="マインスイーパー" onPress={() => pick('mines')} />
        </Box>
      )

    let body
    if (game === '2048') {
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
