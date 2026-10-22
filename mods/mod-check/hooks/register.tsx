import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { CheckMark, CheckReport } from '../types'
import {
  buildRows,
  countLine,
  countRows,
  diffVersions,
  envLine,
  jstStamp,
  kindTheme,
  MODS,
  parentDir,
  reportText,
  rowLine,
  rowsSvg,
  SELF,
  siblingManifest,
  summarySvg,
  updateBand,
  versionOf,
} from './check'
import { checklistText, countMarks, ITEMS, MARK_LABEL, markCountLine, markOf, marksFrom, withMark } from './checklist'
import { probeStates } from './probe'
import { C, clean, followTheme, mayWrite, readTheme, rememberVersion } from './style'

type $ = EngineInterface

const PANE = 'mod-check'
const TITLE = 'mod の点検'
const DESCRIPTION = 'この mod 集の mod がちゃんと動いているかを 1 回で確かめる'
/** 点検表の印を残す $.store の key */
const STORE_KEY = 'checklist'

const REPORT = atom({ plugin: 'mod-check', key: 'report' } as const, null as CheckReport | null)
const SEEN = atom({ plugin: 'mod-check', key: 'seen' } as const, [])
const SURFACE = atom({ plugin: 'mod-check', key: 'surface' } as const, '')
const UPDATED = atom({ plugin: 'mod-check', key: 'updated' } as const, [])
const TAB = atom({ plugin: 'mod-check', key: 'tab' } as const, 'check')
const MARKS = atom({ plugin: 'mod-check', key: 'marks' } as const, {})
const LIST_TEXT = atom({ plugin: 'mod-check', key: 'listText' } as const, '')

/** 調べる。コマンドの一覧・state の読み・設定・版・自分のペインだけで、他の mod のコマンドは走らせない */
async function check($: $): Promise<CheckReport> {
  const [commands, states, config, version, panes, surfaces] = await Promise.all([
    $.command.list().catch(() => []),
    probeStates($),
    $.config.list().catch(() => []),
    $.session.version().catch(() => undefined),
    $.ui.panes().catch(() => []),
    $.session.surfaces().catch(() => []),
  ])
  const theme = config.find(r => r.key === 'theme')?.value
  const report: CheckReport = {
    at: await $.clock.now(),
    env: {
      surface: surfaces.length > 0 ? surfaces.join(' ') : await read($, SURFACE),
      theme: typeof theme === 'string' ? clean(theme) : '',
      engine: clean(version?.version ?? ''),
      panes: panes.map(p => clean(p.id)),
    },
    // 自分は動いているので、自分の state は書かれている扱い
    rows: buildRows(commands, { ...states, [SELF]: true }, await read($, SEEN)),
    updated: await read($, UPDATED),
  }
  await update($, REPORT, () => report)
  return report
}

// ---- 版の見張り(共通の rememberVersion / isStale は自分 1 本分なので、全 mod の分はここで持つ) ----

/** session.start で読んだ版。読み直しで消えてよい(読み直した時はその版が新しい基準) */
let baseline: Record<string, string> = {}
let checkedAt = 0
let isToldUpdate = false

/** 隣に並ぶ全 mod の版。読めない mod(マーケットプレイスから入れた形など)は入れない */
async function readVersions($: $): Promise<Record<string, string>> {
  const root = $.plugin.root
  if (parentDir(root) === '') return {}
  const got = await Promise.all(MODS.map(m => $.fs.read(siblingManifest(root, m.name)).then(versionOf, () => undefined)))
  return Object.fromEntries(MODS.flatMap((m, i) => (got[i] === undefined ? [] : [[m.name, got[i]] as const])))
}

/** ターンの終わりに読み直す(60 秒に 1 回まで)。変わった mod があれば帯に出し、トーストを 1 回出す */
async function recheck($: $) {
  const now = await $.clock.now()
  if (now - checkedAt < 60_000) return
  checkedAt = now
  const updated = diffVersions(baseline, await readVersions($))
  if (JSON.stringify(updated) !== JSON.stringify(await read($, UPDATED))) await update($, UPDATED, () => updated)
  if (updated.length > 0 && !isToldUpdate) {
    isToldUpdate = true
    $.ui.toast(updateBand(updated), { timeoutMs: 10_000 })
  }
}

// ---- 点検表 ----

/** store の印を読み直して画面に出す。読めなければ今の印のまま */
async function loadMarks($: $) {
  const raw = await $.store.get(STORE_KEY).catch(() => undefined)
  if (raw !== undefined) await update($, MARKS, () => marksFrom(raw))
}

/** 1 項目の印を付ける。書く直前に読み直し、知らない欄を残して書く。古い版のままなら書かない */
async function setMark($: $, id: string, mark: CheckMark) {
  if (!(await mayWrite($, await $.clock.now()))) return
  let raw: unknown
  try {
    raw = await $.store.get(STORE_KEY)
  } catch {
    $.ui.toast('点検表の記録を読めなかったので、印を残していません', { timeoutMs: 5000 })
    return
  }
  const next = withMark(raw, id, mark)
  const isSaved = await $.store.set(STORE_KEY, next).then(
    () => true,
    () => false,
  )
  if (!isSaved) $.ui.toast('点検表の記録を書けませんでした', { timeoutMs: 5000 })
  else await update($, MARKS, () => marksFrom(next))
}

/** 「点検の結果を貼る文」。ペインに出し、コピーも試す */
async function paste($: $, surface: RenderSurface) {
  const text = checklistText(await read($, MARKS), jstStamp(await $.clock.now()))
  await update($, LIST_TEXT, () => text)
  const r = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  $.ui.toast(r.isCopied ? '点検の結果をコピーしました。そのまま貼ってください' : 'コピーできませんでした。下に出した文を選んでコピーしてください', { timeoutMs: 5000 })
}

const markColor = (m: CheckMark) => (m === 'good' ? C.green : m === 'bad' ? C.red : C.dim)

// /mod-check を自分で取れたか (取れなければ /modcheck にして、/mod-check は横取りしない)
let ownsMain = false

const openPane = async ($: $) => {
  const report = await check($)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: reportText(report) }
}

export const register: Register = on => {
  followTheme(on)

  // 自分より後に読み込まれる mod の版と、拒まれたかを覚える(止めはしない)
  on('plugin.register', async ($, e, next) => {
    const result = await next(e)
    const row = { name: clean(e.name), version: clean(e.version ?? ''), refused: result.refuse === undefined ? '' : clean(result.refuse) }
    await update($, SEEN, list => [...list.filter(s => s.name !== row.name), row]).catch(() => {})
    return result
  })

  on('session.start', async ($, e, next) => {
    const got = await $.command.register({ name: 'mod-check', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'mod-check'
    if (!ownsMain) await $.command.register({ name: 'modcheck', description: DESCRIPTION }).catch(() => {})
    if (e.surface) await update($, SURFACE, () => e.surface ?? '').catch(() => {})
    await readTheme($)
    await rememberVersion($)
    baseline = await readVersions($)
    checkedAt = await $.clock.now()
    isToldUpdate = false
    await update($, UPDATED, () => []).catch(() => {})
    await loadMarks($)
    // 途中で読み込まれた時も帯を聞きに来るように (docs/mod-guide.md の 3 節)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'mod-check' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  // 本来の名前を持てた時は予備名を登録していないので、同じ名前の別のコマンドを横取りしない
  on('command.run', { command: 'modcheck' }, ($, e, next) => (ownsMain ? next(e) : openPane($))).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await recheck($).catch(() => {})
    return done
  }).catch(($, e, next) => next(e))

  // 入力欄の上の帯。版が変わった mod が無い時は下の mod に任せる
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const updated = await read($, UPDATED)
    if (updated.length === 0) return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const band = (
      <Box key="mod-update" flexShrink={0}>
        <Text color="warning">{updateBand(updated)}</Text>
      </Box>
    )
    if (below.type === 'engine') return band
    return (
      <Box flexDirection="column">
        {band}
        <Box key="below">{below}</Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Code } = t
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const tab = await read($, TAB)
    const updated = await read($, UPDATED)

    // タブは選んでいる物を普通に、ほかを控えめに
    const tabs = (
      <Box key="tabs" flexDirection="row" gap={1}>
        <Button key="tab:check" label="点検" dimColor={tab !== 'check'} onPress={() => void update($, TAB, () => 'check')} />
        <Button
          key="tab:list"
          label="点検表"
          dimColor={tab !== 'list'}
          onPress={() =>
            void (async () => {
              await update($, TAB, () => 'list')
              await loadMarks($)
            })()
          }
        />
      </Box>
    )
    const notice =
      updated.length > 0 ? (
        <Text key="updated" color="warning">
          {updateBand(updated)}
        </Text>
      ) : null

    if (tab === 'list') {
      const marks = await read($, MARKS)
      const listText = await read($, LIST_TEXT)
      return (
        <Box flexDirection="column" gap={1}>
          {notice}
          {tabs}
          <Text key="count" bold>
            {markCountLine(countMarks(marks), ITEMS.length)}
          </Text>
          <Text key="how" dimColor>
            実画面で見て、項目ごとに よい・だめ・まだ を付けてください。印はこの mod の記録に残ります
          </Text>
          <Button key="paste" label="点検の結果を貼る文" variant="primary" onPress={p => void paste($, p.surface)} />
          {listText !== '' ? <Code key="pasted" source={listText} /> : null}
          {ITEMS.map(it => {
            const mark = markOf(marks, it.id)
            return (
              <Box key={`item:${it.id}`} flexDirection="column" borderStyle="round" borderColor={markColor(mark)} paddingX={1}>
                <Text bold color={markColor(mark)}>{`${it.mod}${it.command === '' ? '' : ` ${it.command}`}  ${MARK_LABEL[mark]}`}</Text>
                <Text dimColor>{it.look}</Text>
                <Box flexDirection="row" gap={1}>
                  {(['good', 'bad', 'todo'] as const).map(m => (
                    <Button key={`mark:${it.id}:${m}`} label={MARK_LABEL[m]} dimColor={m !== mark} onPress={() => void setMark($, it.id, m)} />
                  ))}
                </Box>
              </Box>
            )
          })}
        </Box>
      )
    }

    const report = await read($, REPORT)
    const again = (
      <Button key="again" variant="primary" onPress={() => void check($).catch(() => {})}>
        <Text>調べ直す</Text>
      </Button>
    )
    if (report === null) {
      return (
        <Box flexDirection="column" gap={1}>
          {notice}
          {tabs}
          <Text bold>mod の点検</Text>
          <Text dimColor>まだ調べていません</Text>
          {again}
        </Box>
      )
    }
    // 画面の種類は今描いている物がいちばん確か
    const live = { ...report, env: { ...report.env, surface: e.surface } }
    const counts = countRows(report.rows)

    return (
      <Box flexDirection="column" gap={1}>
        {notice}
        {tabs}
        {Svg ? (
          <Svg key="summary" source={summarySvg(live)} alt={countLine(counts)} />
        ) : (
          <Box key="summary" flexDirection="column">
            <Text bold>mod の点検</Text>
            <Text>{countLine(counts)}</Text>
            <Text dimColor>{envLine(live.env)}</Text>
          </Box>
        )}
        {again}
        <Text dimColor>{`/${ownsMain ? 'mod-check' : 'modcheck'} の返事に同じ結果が文で出ています。そのままコピーして貼ってください`}</Text>
        {Svg ? (
          <Svg key="rows" source={rowsSvg(report.rows)} alt={`mod ごとの結果 ${report.rows.length} 本`} />
        ) : (
          <Box key="rows" flexDirection="column">
            {report.rows.map(r => (
              <Text key={`row:${r.name}`} color={kindTheme(r.kind)}>
                {rowLine(r)}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
