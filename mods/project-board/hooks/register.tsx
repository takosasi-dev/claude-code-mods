import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ProjectBoardProject, ProjectBoardSort } from '../types'
import {
  ageDays,
  ageLabel,
  arrange,
  cardSvg,
  dateLabel,
  FRESH_ROWS,
  freshnessSvg,
  normalize,
  obsidianUrl,
  toProject,
} from './board'
import { followTheme, readTheme } from './style'

const PANE = 'project-board'
const TITLE = 'プロジェクト'
const RELOAD_MS = 5 * 60_000
const HEAD = 4000
const FULL = 100_000

const PROJECTS = atom({ plugin: 'project-board', key: 'projects' } as const, [])
const LOADED = atom({ plugin: 'project-board', key: 'loadedAt' } as const, 0)
const ERROR = atom({ plugin: 'project-board', key: 'error' } as const, '')
const SORT = atom({ plugin: 'project-board', key: 'sort' } as const, 'new')
const FILTER = atom({ plugin: 'project-board', key: 'filter' } as const, '')
const DETAIL = atom({ plugin: 'project-board', key: 'detail' } as const, null)

// 絶対パス(/x、\x、C:\x、C:/x)だけを受け付ける。相対パスや「C:」は今のフォルダから読まれてしまう
const isAbsolute = (path: string) => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)

// 設定のフォルダ: 絶対パスでなければ未設定(空)。末尾の区切りは外すが、根(C:\ や /)は区切りを残す
const folderOption = (value: unknown) => {
  const raw = String(value ?? '').trim()
  if (!isAbsolute(raw)) return ''
  const trimmed = raw.replace(/[\\/]+$/, '')
  return trimmed === '' || /^[A-Za-z]:$/.test(trimmed) ? raw.slice(0, trimmed.length + 1) : trimmed
}

// 本文に file: リンクがありうるか。Markdown は file: も押せるリンクにするので、ありうる時は全部のリンクを押しても何もしない側にする。
// リンクの形 (参照・山かっこ・かっこ入りのパス) を拾い切るのは難しいので、本文に file: があるかで決める。
// Markdown はリンク先の \: と文字参照 (&#58; &colon; など) をほどくので、それらも file: とみなす
const mayHaveFileLink = (text: string) =>
  /\bfile:|&(?:#x?[0-9a-f]+|[a-z][a-z0-9]*);/i.test(text.replace(/\\([!-/:-@[-`{-~])/g, '$1'))

const SORTS: { value: ProjectBoardSort; label: string }[] = [
  { value: 'new', label: '更新が新しい順' },
  { value: 'name', label: '名前順' },
  { value: 'old', label: '古い順' },
]

// 一覧を読み直して state に置く。描画フックからは呼ばない
async function load($: EngineInterface, memoDir: string) {
  // 空なら読まない (空を今のフォルダと読ませない)
  if (memoDir === '') {
    await update($, ERROR, () => 'メモのフォルダが未設定です。/config で project-board の memoDir に *.md が並ぶフォルダの絶対パスを入れてください')
    return
  }
  const sep = memoDir.includes('\\') || !memoDir.includes('/') ? '\\' : '/'
  // 根(C:\ や /)は区切りで終わっているので足さない
  const base = /[\\/]$/.test(memoDir) ? memoDir : `${memoDir}${sep}`
  try {
    const entries = await $.fs.list(memoDir)
    const files = entries.filter(f => f.kind === 'file' && /\.md$/i.test(f.name))
    const list = await Promise.all(
      files.map(async f => {
        const path = `${base}${f.name}`
        const text = await $.fs.read(path).catch(() => '')
        return toProject(f.name, path, f.mtimeMs, text)
      }),
    )
    await update($, PROJECTS, () => list)
    await update($, ERROR, () => '')
  } catch {
    await update($, ERROR, () => `メモのフォルダを読めません: ${memoDir}`)
  }
  const at = await $.clock.now()
  await update($, LOADED, () => at)
}

async function openDetail($: EngineInterface, p: ProjectBoardProject, isFull: boolean) {
  let text: string
  try {
    text = normalize(await $.fs.read(p.path))
  } catch {
    text = `メモを読めませんでした: ${p.path}`
  }
  const limit = isFull ? FULL : HEAD
  const rest = text.length - limit
  const body = rest > 0 && isFull ? `${text.slice(0, limit)}\n\n(残り ${rest} 字は省略。Obsidian で開いてください)` : text.slice(0, limit)
  await update($, DETAIL, () => ({ name: p.name, body, more: !isFull && rest > 0 }))
}

export const register: Register = (on, options) => {
  const memoDir = folderOption(options.memoDir)
  const vaultRoot = folderOption(options.vaultRoot)
  const vaultName = String(options.vaultName ?? '').trim()

  followTheme(on)
  on('session.start', async ($, e, next) => {
    await readTheme($)
    await $.command.register({ name: 'projects', description: '引き継ぎメモのプロジェクト一覧を開く' }).catch(() => {})
    // 一度も開いていないセッションでは vault を読まない
    $.clock.every(RELOAD_MS, () => {
      void (async () => {
        if ((await read($, LOADED)) > 0) await load($, memoDir)
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'projects' }, async $ => {
    await load($, memoDir)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'プロジェクトのペインを開きました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Markdown, Code, Link } = t
    if (!('Select' in t)) return <Text dimColor>この画面では一覧を出せません</Text>
    const { Select, Input } = t
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined

    const now = await $.clock.now()
    const list = await read($, PROJECTS)
    const loadedAt = await read($, LOADED)
    const error = await read($, ERROR)
    const detail = await read($, DETAIL)

    if (detail) {
      const p = list.find(x => x.name === detail.name) ?? { name: detail.name, path: '', mtimeMs: now, title: '', lines: [] }
      const url = p.path ? obsidianUrl(p.path, vaultRoot, vaultName) : undefined

      return (
        <Box flexDirection="column" gap={1}>
          <Button key="back" dimColor label="戻る" onPress={() => void update($, DETAIL, () => null)} />
          {Svg ? (
            <Svg source={cardSvg(p, now)} alt={`${p.name}: ${p.lines.join(' / ')}`} />
          ) : (
            <Box key="card" flexDirection="column">
              <Text bold>{p.name}</Text>
              {p.title !== '' && p.title !== p.name && <Text dimColor>{p.title}</Text>}
              <Text dimColor>{`更新 ${dateLabel(p.mtimeMs)}(${ageLabel(p.mtimeMs, now)})`}</Text>
              {p.lines.map(l => (
                <Text>{`・${l}`}</Text>
              ))}
            </Box>
          )}
          {/* remote 画面の Link は https: しか開けないので、terminal 以外はパスを Code で出す */}
          {e.surface === 'terminal' && url ? (
            <Link href={url} label="Obsidian で開く" />
          ) : (
            p.path !== '' && <Code source={url ? `${p.path}\n${url}` : p.path} />
          )}
          {mayHaveFileLink(detail.body) ? <Markdown key="body" text={detail.body} onLinkPress={() => {}} /> : <Markdown key="body" text={detail.body} />}
          {detail.more && <Button key="more" label="続きを読む" onPress={() => void openDetail($, p, true)} />}
        </Box>
      )
    }

    const sort = await read($, SORT)
    const filter = await read($, FILTER)
    const shown = arrange(list, sort, filter)
    const days = shown.map(p => ageDays(p.mtimeMs, now))
    const count = (lo: number, hi: number) => days.filter(d => d > lo && d <= hi).length

    return (
      <Box flexDirection="column" gap={1}>
        {loadedAt === 0 && <Text dimColor>読み込み中</Text>}
        {error !== '' && <Text color="red">{error}</Text>}
        {Svg ? (
          <Svg
            source={freshnessSvg(shown, now)}
            alt={`鮮度: ${shown
              .slice(0, FRESH_ROWS)
              .map((p, i) => `${p.name} ${days[i]}日`)
              .join('、')}${shown.length > FRESH_ROWS ? `、ほか ${shown.length - FRESH_ROWS} 件` : ''}`}
          />
        ) : (
          <Text>{`鮮度 3日以内 ${count(-1, 3)} / 14日以内 ${count(3, 14)} / それ以上 ${count(14, Infinity)}`}</Text>
        )}
        <Box flexDirection="column">
          <Select key="sort" options={SORTS} value={sort} onSelect={v => void update($, SORT, () => v as ProjectBoardSort)} />
          <Button key="reload" dimColor label="再読込" onPress={() => void load($, memoDir)} />
        </Box>
        <Input
          key="filter"
          placeholder="名前で絞り込み"
          value={filter}
          submitLabel="絞り込む"
          onInput={v => void update($, FILTER, () => v)}
          onSubmit={v => void update($, FILTER, () => v)}
        />
        <Box flexDirection="column">
          {shown.length === 0 && loadedAt > 0 && <Text dimColor>該当するメモがありません</Text>}
          {shown.map(p => (
            <Button key={`open:${p.name}`} plain onPress={() => void openDetail($, p, false)}>
              {p.name} <Text dimColor>{ageLabel(p.mtimeMs, now)}</Text>
            </Button>
          ))}
        </Box>
        {loadedAt > 0 && <Text dimColor>{`${shown.length} / ${list.length} 件 ・ 読込 ${dateLabel(loadedAt).slice(11)}`}</Text>}
      </Box>
    )
  })
}
