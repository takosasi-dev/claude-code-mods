// 記録の控え (設定 backupDir) と、ペインの「控えから戻す」欄 (docs/mod-guide.md の 9 節)。
// turn-gacha・daily-quest・wait-games が同じ物を持つ。戻す欄の開け閉めは $.state に置かず、
// モジュールの値で持って描き直しを頼む (state の key を増やさない)
import type { ElementConstructor, BoxProps, ButtonProps, EngineInterface, PluginOptions, TextProps } from 'claude-code'

import { C, backupDaily, jstDay, listBackups } from './style'

type $ = EngineInterface

const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p)

/** 記録の控えのフォルダ (設定 backupDir)。絶対パスだけ。空なら控えない */
export let backupDir = ''
export const setBackupDir = (options: PluginOptions) => {
  const dir = String(options.backupDir ?? '').trim()
  backupDir = isAbsolute(dir) ? dir : ''
}

/** key ごとに、今日もう控えを確かめた日 (1 日 1 回だけファイルを読みに行く) */
const backedDay = new Map<string, string>()
export const isBackedToday = (key: string, now: number) => !backupDir || backedDay.get(key) === jstDay(now)

/** その日はじめての時だけ、store の生の値 (知らない欄ごと) を控える */
export async function backup($: $, key: string, raw: unknown, now: number) {
  if (isBackedToday(key, now) || raw === undefined) return
  backedDay.set(key, jstDay(now))
  // 書けない時も、その日はもう試さない (ターンのたびに読み書きしない)
  await backupDaily($, backupDir, key, raw, now).catch(() => {})
}

/** day の key の控えの値。無い・読めない時は undefined */
export async function backupOf($: $, key: string, day: string) {
  return (await listBackups($, backupDir, key).catch(() => [])).find(b => b.day === day)?.value
}

// ---- 戻す欄 ----

/** null は閉じている。days は控えのある日 (新しい順)、pick は選んだ日 ('' はまだ) */
let view: { days: string[]; pick: string } | null = null
export const isRestoring = () => view !== null

function show($: $, v: typeof view) {
  view = v
  $.ui.invalidate('ui.render')
}

/** セッションの始まりに閉じる (リロードの前の欄を残さない) */
export const resetRestore = () => {
  view = null
  backedDay.clear()
}

export function closeRestore($: $) {
  show($, null)
}

/** 控えのある日を並べて開く。key は日を並べる元の記録 */
export async function openRestore($: $, key: string) {
  const days = (await listBackups($, backupDir, key).catch(() => [])).map(b => b.day)
  show($, { days, pick: '' })
}

type Parts = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps>; Button: ElementConstructor<ButtonProps> }

/** 「控えから戻す」のボタン (脇の操作)。開いている時は「戻すのをやめる」 */
export function restoreButton($: $, { Button }: Parts, key: string) {
  return <Button key="restore" dimColor label={view ? '戻すのをやめる' : '控えから戻す'} onPress={() => void (view ? closeRestore($) : openRestore($, key))} />
}

/** 戻す欄: 日を選ぶ → 確かめる → 戻す。onRestore は選んだ日を受け取って書く */
export function restoreCard($: $, { Box, Text, Button }: Parts, onRestore: (day: string) => void) {
  const v = view
  if (!v) return null
  return (
    <Box key="restore-card" flexDirection="column" borderStyle="round" borderColor={C.yellow} paddingX={1} paddingY={1} gap={1}>
      <Text bold color={C.yellow}>
        控えから戻す
      </Text>
      {!backupDir ? (
        <Text dimColor>設定の backupDir を入れると控えが取れます</Text>
      ) : v.days.length === 0 ? (
        <Text dimColor>まだ控えがありません (1 日 1 回取ります)</Text>
      ) : (
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {v.days.map(day => (
            <Button key={`day-${day}`} dimColor={v.pick !== day} label={day} onPress={() => show($, view ? { ...view, pick: day } : null)} />
          ))}
        </Box>
      )}
      {v.pick ? (
        <Box flexDirection="column" gap={1}>
          <Text>{`${v.pick}: この日の記録に戻しますか。今の記録は上書きされます`}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="restore-ok" variant="primary" label="戻す" onPress={() => onRestore(v.pick)} />
            <Button key="restore-no" dimColor label="やめる" onPress={() => show($, view ? { ...view, pick: '' } : null)} />
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
