import type { EngineInterface, Register } from 'claude-code'

import { followTheme, readTheme } from './style'
import { fit, jstDate } from './text'

const PANE = 'devlog'
const log = { plugin: 'devlog-pane', key: 'log' } as const

// 今日のログの mtime が変わったときだけ読み直す(読むだけ、書かない)
async function refresh($: EngineInterface, logDir: string) {
  // 空なら読まない (空を今のフォルダと読ませない)
  if (logDir === '') {
    await $.state.set(log, { path: '', mtimeMs: 0, text: null })
    return
  }
  const sep = logDir.includes('\\') || !logDir.includes('/') ? '\\' : '/'
  // 根(C:\ や /)は区切りで終わっているので足さない
  const base = /[\\/]$/.test(logDir) ? logDir : `${logDir}${sep}`
  const path = `${base}${jstDate(await $.clock.now())}.md`
  const stat = await $.fs.stat(path).catch(() => undefined)
  const mtimeMs = stat?.mtimeMs ?? 0
  const { value } = await $.state.get(log)
  if (value?.path === path && value.mtimeMs === mtimeMs) return
  const text = stat ? await $.fs.read(path).then(fit, () => null) : null
  await $.state.set(log, { path, mtimeMs, text })
}

// 設定のフォルダ: 絶対パス(/x、\x、C:\x、C:/x)でなければ未設定(空)。相対パスや「C:」は今のフォルダから読まれてしまう。
// 末尾の区切りは外すが、根(C:\ や /)は区切りを残す (project-board と同じ形)
const folderOption = (value: unknown) => {
  const raw = String(value ?? '').trim()
  if (!/^(?:[\\/]|[A-Za-z]:[\\/])/.test(raw)) return ''
  const trimmed = raw.replace(/[\\/]+$/, '')
  return trimmed === '' || /^[A-Za-z]:$/.test(trimmed) ? raw.slice(0, trimmed.length + 1) : trimmed
}

export const register: Register = (on, options) => {
  const logDir = folderOption(options.logDir)

  followTheme(on)

  on('session.start', async ($, e, next) => {
    await readTheme($)
    await $.command.register({ name: 'devlog', description: '今日の開発ログをペインに表示' }).catch(() => {})
    // ペインが開いている間だけ 30 秒ごとに確認
    $.clock.every(30_000, async () => {
      if ((await $.ui.panes()).some(pane => pane.id === PANE)) await refresh($, logDir)
    })
    return next(e)
  })

  on('command.run', { command: 'devlog' }, async $ => {
    await refresh($, logDir)
    await $.ui.open({ id: PANE, title: '開発ログ' })
    return { text: '開発ログのペインを開きました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Text, Markdown } = $.ui.resolve(e)
    const { value } = await $.state.get(log)
    if (!value) return <Text dimColor>読み込み中…</Text>
    if (value.path === '')
      return <Text dimColor>ログのフォルダが未設定です。/config で devlog-pane の logDir に YYYY-MM-DD.md が並ぶフォルダの絶対パスを入れてください</Text>
    if (value.text === null) return <Text dimColor>{`今日の開発ログはまだありません(${value.path})`}</Text>
    return <Markdown text={value.text} />
  })
}
