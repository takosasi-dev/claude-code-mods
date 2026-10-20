import type { Register } from 'claude-code'

const PANE = 'usage-pane'

type Usage = {
  sessionPct: number
  weeklyPct: number
  sessionResetAt?: unknown
  weeklyResetAt?: unknown
  modelName?: unknown
  modelPct?: unknown
  modelResetAt?: unknown
  fetchedAt?: unknown
}

// リセットまでの残り。1日以上は「日+時間」、それ未満は「時間+分」
const left = (iso: unknown, now: number) => {
  // 小数秒が 6 桁でも読めるよう 3 桁に切る
  const at = typeof iso === 'string' ? Date.parse(iso.replace(/(\.\d{3})\d+/, '$1')) : NaN
  if (Number.isNaN(at)) return ''
  if (at <= now) return 'リセット済み'
  const min = Math.floor((at - now) / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return d > 0 ? `あと${d}日${h}時間` : h > 0 ? `あと${h}時間${m}分` : `あと${m}分`
}

export const register: Register = (on, options) => {
  const file = String(options.usageFile ?? '').trim()

  on('session.start', async ($, e, next) => {
    // 組み込みの /usage とぶつけないよう別名にする
    await $.command.register({ name: 'usage-pane', description: '使用量をペインに表示' }).catch(() => {})
    // 閉じているときの invalidate は何も描かないので常時回す
    $.clock.every(30_000, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  on('command.run', { command: 'usage-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: '使用量' })

    return { text: '使用量ペインを開きました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    // 空なら読まない (空を今のフォルダと読ませない)
    if (file === '') return <Text dimColor>使用量ファイルが未設定です。/config で usage-pane の usageFile に JSON の絶対パスを入れてください</Text>

    let u: Usage
    try {
      u = JSON.parse(await $.fs.read(file))
      if (typeof u.sessionPct !== 'number' || typeof u.weeklyPct !== 'number') throw new Error('bad')
    } catch {
      return <Text dimColor>{`使用量ファイルを読めません: ${file}`}</Text>
    }

    const width = Math.max(5, Math.min(20, e.props.bodyColumns - 34))
    const row = (label: string, pct: number, resetAt: unknown) => {
      const p = Math.min(100, Math.max(0, pct))
      const fill = Math.round((p / 100) * width)
      const color = p >= 80 ? 'red' : p >= 50 ? 'yellow' : undefined

      return (
        <Box flexDirection="row" gap={1}>
          <Box width={12}>
            <Text wrap="truncate">{label}</Text>
          </Box>
          <Text color={color}>{`${'█'.repeat(fill)}${'░'.repeat(width - fill)} ${Math.round(p)}%`}</Text>
          <Text dimColor>{left(resetAt, now)}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {row('5時間枠', u.sessionPct, u.sessionResetAt)}
        {row('週', u.weeklyPct, u.weeklyResetAt)}
        {typeof u.modelName === 'string' &&
          typeof u.modelPct === 'number' &&
          row(`${u.modelName} 週`, u.modelPct, u.modelResetAt)}
        {typeof u.fetchedAt === 'number' && (
          <Text dimColor>{`取得: ${Math.max(0, Math.floor((now - u.fetchedAt) / 60_000))}分前`}</Text>
        )}
      </Box>
    )
  })
}
