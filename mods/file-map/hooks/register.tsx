import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileMapFilter, FileTouch } from '../types'
import { TOP, fileMapSvg, groupLines, pathOf, placeOf, ranked, summaryText, topText } from './filemap'
import { followTheme, readTheme } from './style'

const PANE = 'file-map'
const TITLE = 'ファイルの地図'
const DESCRIPTION = 'このセッションで触ったファイルをフォルダごとの四角で見る'
/** 覚えておくファイルの数。超えたら古く触った物から捨てる */
const KEEP = 1000

const READERS = new Set(['Read', 'Grep', 'Glob'])
// MultiEdit はこのビルドの表に無いので名前の文字列で比べる
const WRITERS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const FILES = atom({ plugin: 'file-map', key: 'files' } as const, [] as FileTouch[])
const FILTER = atom({ plugin: 'file-map', key: 'filter' } as const, 'all' as FileMapFilter)

type $ = EngineInterface

async function record($: $, tool: string, file: string, isSub: boolean) {
  const cwd = await $.session.cwd().catch(() => '')
  const at = await $.clock.now()
  const { label, group } = placeOf(cwd, file)
  const isWrite = WRITERS.has(tool)
  await update($, FILES, list => {
    const old = list.find(f => f.label === label)
    const f: FileTouch = {
      label,
      group,
      reads: (old?.reads ?? 0) + (isWrite ? 0 : 1),
      writes: (old?.writes ?? 0) + (isWrite ? 1 : 0),
      subs: (old?.subs ?? 0) + (isSub ? 1 : 0),
      last: at,
    }
    const rest = list.filter(x => x.label !== label)
    return [...(rest.length >= KEEP ? [...rest].sort((a, b) => b.last - a.last).slice(0, KEEP - 1) : rest), f]
  })
}

// ponytail: 主の名前を持てたかはモジュール変数。リロードでも session.start が来て決め直す
let ownsMain = false

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'ファイルの地図を開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // /filemap が拒まれたら /file-map にする
    const got = await $.command.register({ name: 'filemap', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'filemap'
    if (!ownsMain) await $.command.register({ name: 'file-map', description: DESCRIPTION }).catch(() => {})
    await readTheme($)
    return started
  })

  // /filemap を持てなかった時は、その名前の持ち主に回す
  on('command.run', { command: 'filemap' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'file-map' }, openPane)

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, FILES, () => [])
    return next(e)
  })

  // 見るだけ。ツールが終わってから数える (断られた・失敗した呼び出しは数えない)
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const tool = String(e.tool)
    if ((READERS.has(tool) || WRITERS.has(tool)) && r.deny === undefined && r.isError !== true) {
      const file = pathOf(tool, e as unknown as Record<string, unknown>)
      if (file !== '') await record($, tool, file, e.agentId !== undefined)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const files = await read($, FILES)
    const filter = await read($, FILTER)
    const top = ranked(files, filter).slice(0, TOP)
    const setFilter = (v: FileMapFilter) => () => void update($, FILTER, () => v)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg key="map" source={fileMapSvg(files, filter)} alt={summaryText(files, filter)} />
        ) : (
          <Box key="groups" flexDirection="column">
            {groupLines(files, filter).map((l, i) => (
              <Text key={`group-${i}`} color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        <Box key="filters" flexDirection="row" gap={1}>
          <Button key="filter-all" label="全部" variant={filter === 'all' ? 'primary' : undefined} onPress={setFilter('all')} />
          <Button key="filter-written" label="書いた物だけ" variant={filter === 'written' ? 'primary' : undefined} onPress={setFilter('written')} />
        </Box>
        {top.length > 0 && (
          <Box key="top" flexDirection="column">
            <Text key="top-head" bold>{`多く触った順 ${top.length} 件`}</Text>
            {top.map((f, i) => (
              <Text key={`top-${i}`} color={f.writes > 0 ? 'yellow' : undefined}>
                {topText(f)}
              </Text>
            ))}
          </Box>
        )}
        {files.length > 0 && <Button key="reset" label="記録を消す" onPress={() => void update($, FILES, () => [])} />}
      </Box>
    )
  })
}
