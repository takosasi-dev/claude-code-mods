import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DoneChimeSettings } from '../types'
import { clean, followTheme, mayWrite, readTheme, rememberVersion } from './style'
import { DEFAULTS, SOUNDS, THRESHOLDS, VOLUMES, cleanSettings, isWindowsPath, powershellArgv, powershellExe, shouldChime, summary, waveSvg, wavBase64 } from './wav'

const PANE = 'done-chime'
const TITLE = '終わりの音'
const DESCRIPTION = '答え終わりに鳴らす音の設定を開く'
const KEYS = ['isOn', 'sound', 'threshold', 'volume'] as const

const SETTINGS = atom({ plugin: 'done-chime', key: 'settings' } as const, DEFAULTS)
const NOTE = atom({ plugin: 'done-chime', key: 'note' } as const, '')

type $ = EngineInterface

// 制御文字 (C0・DEL・C1) を落とす (エンジンは制御文字を含む Text の子を拒み、ペインが閉じる)
const head = (s: string) => clean(s).replace(/\s+/g, ' ').slice(0, 200)

// /chime を自分で取れたか (取れなければ /done-chime にして、/chime は横取りしない)
let ownsMain = false

// store への書き込みは 1 本ずつ。設定は項目ごとのキーに書くので、他のセッションが変えた別の項目を消さない (C1)
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(f: () => Promise<T>) => {
  const p = chain.then(f, f)
  chain = p.catch(() => {})
  return p
}

const change = async <K extends (typeof KEYS)[number]>($: $, key: K, value: DoneChimeSettings[K]) => {
  await update($, SETTINGS, s => ({ ...s, [key]: value }))
  // 古い版のまま動いているなら書かない (mayWrite がトーストで開き直しを頼む)
  const ok = await serial(async () => {
    if (!(await mayWrite($, await $.clock.now()))) throw new Error('stale')
    await $.store.set(key, value)
  }).then(
    () => true,
    () => false,
  )
  await update($, NOTE, () => (ok ? '' : '設定を残せませんでした(このセッションの間だけ効きます)'))
}

/** 鳴らす。Windows は PowerShell の SoundPlayer、ほかは $.audio.play */
const play = async ($: $, s: DoneChimeSettings) => {
  const base64 = wavBase64(s.sound, s.volume)
  const cwd = await $.session.cwd().catch(() => '')
  let note = ''
  try {
    if (isWindowsPath(cwd)) {
      // 絶対パスで、mod のフォルダから起こす (作業フォルダに置かれた powershell.exe などを起こさない)
      const exe = powershellExe(await $.env.get('SystemRoot').catch(() => undefined))
      const r = await $.process.run(powershellArgv(base64, exe), { cwd: $.plugin.root, timeoutMs: 10_000 })
      if (r.exitCode !== 0) note = `鳴らせませんでした(終了コード ${r.exitCode}): ${head(r.stderr || r.stdout)}`
    } else {
      await $.audio.play({ base64, mime: 'audio/wav' })
    }
  } catch (err) {
    note = `鳴らせませんでした: ${head(err instanceof Error ? err.message : String(err))}`
  }
  await update($, NOTE, () => note)
}

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '終わりの音の設定を開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    await readTheme($)
    const started = await next(e)
    await rememberVersion($)
    const got = await $.command.register({ name: 'chime', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'chime'
    if (!ownsMain) await $.command.register({ name: 'done-chime', description: DESCRIPTION }).catch(() => {})
    // 読めない項目は既定値のまま (書き戻さない)
    const raw: Record<string, unknown> = {}
    for (const k of KEYS) raw[k] = await $.store.get(k).catch(() => undefined)
    await update($, SETTINGS, () => cleanSettings(raw))
    return started
  })

  on('command.run', { command: 'chime' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  // /chime を持てた時は予備名を開かない (同じ名前の別のコマンドを横取りしない)
  on('command.run', { command: 'done-chime' }, ($, e, next) => (ownsMain ? next(e) : openPane($)))

  on('turn.complete', async ($, e, next) => {
    const s = await read($, SETTINGS)
    // 鳴らし終わりを待たずにターンの終わりを返す
    if (shouldChime(s, e)) void play($, s).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const s = await read($, SETTINGS)
    const note = await read($, NOTE)
    const line = summary(s)

    return (
      <Box flexDirection="column" gap={1}>
        {e.surface !== 'terminal' && 'Svg' in t ? <t.Svg source={waveSvg(s)} alt={line} /> : <Text color={s.isOn ? 'green' : undefined}>{line}</Text>}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="toggle" dimColor label={s.isOn ? 'オフにする' : 'オンにする'} onPress={async () => change($, 'isOn', !(await read($, SETTINGS)).isOn)} />
          <Button key="try" label="試しに鳴らす" variant="primary" onPress={async () => play($, await read($, SETTINGS))} />
        </Box>
        {'Select' in t && (
          <Box flexDirection="column">
            <t.Select key="sound" label="音の種類" value={s.sound} options={SOUNDS} onSelect={v => change($, 'sound', cleanSettings({ sound: v }).sound)} />
            <t.Select
              key="threshold"
              label="しきい値"
              value={String(s.threshold)}
              options={THRESHOLDS.map(n => ({ value: String(n), label: `${n} 秒以上` }))}
              onSelect={v => change($, 'threshold', cleanSettings({ threshold: Number(v) }).threshold)}
            />
            <t.Select key="volume" label="音量" value={s.volume} options={VOLUMES} onSelect={v => change($, 'volume', cleanSettings({ volume: v }).volume)} />
          </Box>
        )}
        {note !== '' && <Text dimColor>{note}</Text>}
      </Box>
    )
  })
}
