import type { EngineInterface, Register } from 'claude-code'

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
  const path = `${logDir}${sep}${jstDate(await $.clock.now())}.md`
  const stat = await $.fs.stat(path).catch(() => undefined)
  const mtimeMs = stat?.mtimeMs ?? 0
  const { value } = await $.state.get(log)
  if (value?.path === path && value.mtimeMs === mtimeMs) return
  const text = stat ? await $.fs.read(path).then(fit, () => null) : null
  await $.state.set(log, { path, mtimeMs, text })
}

export const register: Register = (on, options) => {
  const logDir = String(options.logDir ?? '').trim().replace(/[\\/]+$/, '')

  on('session.start', async ($, e, next) => {
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
