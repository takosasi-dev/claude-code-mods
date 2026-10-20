import type { EngineInterface, Register } from 'claude-code'

import type { UsagePaneData } from '../types/index'
import { followTheme, readTheme } from './style'

const PANE = 'usage-pane'
const usageKey = { plugin: 'usage-pane', key: 'usage' } as const

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

// 絶対パス(/x、\x、C:\x、C:/x)だけを受け付ける。相対パスは今のフォルダから読まれてしまう
const isAbsolute = (path: string) => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)

// Text に入れる前に制御文字を落とす(エンジンは制御文字を含む Text を拒む)
const clean = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, '')

// ファイルを読んで $.state に置く(描画フックの外で呼ぶ)
async function refresh($: EngineInterface, file: string) {
  if (file === '') return
  let data: UsagePaneData | null = null
  try {
    const o = JSON.parse(await $.fs.read(file)) as Partial<UsagePaneData> | null
    if (o && typeof o.sessionPct === 'number' && typeof o.weeklyPct === 'number') data = o as UsagePaneData
  } catch {
    data = null
  }
  await $.state.set(usageKey, { data })
}

export const register: Register = (on, options) => {
  followTheme(on)
  const raw = String(options.usageFile ?? '').trim()
  // 絶対パスでなければ未設定と同じ扱い
  const file = isAbsolute(raw) ? raw : ''

  on('session.start', async ($, e, next) => {
    await readTheme($)
    // 組み込みの /usage とぶつけないよう別名にする
    await $.command.register({ name: 'usage-pane', description: '使用量をペインに表示' }).catch(() => {})
    await refresh($, file)
    // 読むのはここ(30 秒ごと)とコマンドだけ。残り時間の表示も進めるため描き直しも頼む
    $.clock.every(30_000, async () => {
      await refresh($, file)
      $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  on('command.run', { command: 'usage-pane' }, async $ => {
    await refresh($, file)
    await $.ui.open({ id: PANE, title: '使用量' })

    return { text: '使用量ペインを開きました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    // 空(か相対パス)なら読まない (空を今のフォルダと読ませない)
    if (file === '') return <Text dimColor>使用量ファイルが未設定です。/config で usage-pane の usageFile に JSON の絶対パスを入れてください</Text>

    const { value } = await $.state.get(usageKey)
    if (!value) return <Text dimColor>読み込み中…</Text>
    const u = value.data
    if (!u) return <Text dimColor>{`使用量ファイルを読めません: ${clean(file)}`}</Text>

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
          row(`${clean(u.modelName)} 週`, u.modelPct, u.modelResetAt)}
        {typeof u.fetchedAt === 'number' && (
          <Text dimColor>{`取得: ${Math.max(0, Math.floor((now - u.fetchedAt) / 60_000))}分前`}</Text>
        )}
      </Box>
    )
  })
}
