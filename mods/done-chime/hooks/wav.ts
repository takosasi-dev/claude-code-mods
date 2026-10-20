import type { DoneChimeSettings, DoneChimeSound, DoneChimeVolume } from '../types'

const FONT = 'font-family="sans-serif"'
export const RATE = 8000

export const SOUNDS: { value: DoneChimeSound; label: string }[] = [
  { value: 'chord', label: '和音' },
  { value: 'bell', label: 'ベル' },
  { value: 'pon', label: 'ポン' },
]
export const VOLUMES: { value: DoneChimeVolume; label: string }[] = [
  { value: 'low', label: '小' },
  { value: 'mid', label: '中' },
  { value: 'high', label: '大' },
]
export const THRESHOLDS = [10, 30, 60, 120]
export const DEFAULTS: DoneChimeSettings = { isOn: true, sound: 'chord', threshold: 30, volume: 'mid' }

/** 長さ (秒)。どれも 1 秒未満 */
const LENGTH: Record<DoneChimeSound, number> = { chord: 0.6, bell: 0.8, pon: 0.3 }
/** 音量は振幅で変える */
const GAIN: Record<DoneChimeVolume, number> = { low: 0.25, mid: 0.5, high: 0.9 }

const TAU = Math.PI * 2
const attack = (t: number) => Math.min(1, t / 0.01)

// 音の形 (-1..1)。8kHz なので 4kHz を超える高さは使わない
const VOICE: Record<DoneChimeSound, (t: number) => number> = {
  // ド・ミ・ソのサイン波の和
  chord: t => (attack(t) * Math.exp(-t * 4) * [523.25, 659.25, 783.99].reduce((a, f) => a + Math.sin(TAU * f * t), 0)) / 3,
  // 倍音のずれた鐘の音。高い成分ほど早く消える
  bell: t =>
    attack(t) *
    (Math.sin(TAU * 660 * t) * Math.exp(-t * 3.5) * 0.6 +
      Math.sin(TAU * 1822 * t) * Math.exp(-t * 6) * 0.3 +
      Math.sin(TAU * 3564 * t) * Math.exp(-t * 10) * 0.1),
  // 880 から 660 に下がる短い音 (位相は高さの積分: 880t - 366.7t^2 で 0.3 秒に 660 へ)
  pon: t => attack(t) * Math.exp(-t * 14) * Math.sin(TAU * (880 * t - (220 / (2 * 0.3)) * t * t)),
}

/** 振幅をかけた後の標本 (-1..1) */
export const samples = (sound: DoneChimeSound, volume: DoneChimeVolume) => {
  const n = Math.round(RATE * LENGTH[sound])
  const g = GAIN[volume]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Math.max(-1, Math.min(1, VOICE[sound](i / RATE) * g)))
  return out
}

/** 8kHz 8bit mono の WAV */
export const wavBytes = (sound: DoneChimeSound, volume: DoneChimeVolume) => {
  const pcm = samples(sound, volume)
  const bytes = new Uint8Array(44 + pcm.length)
  const view = new DataView(bytes.buffer)
  const tag = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  tag(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt の長さ
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE, true) // 1 秒の byte 数
  view.setUint16(32, 1, true) // 1 標本の byte 数
  view.setUint16(34, 8, true)
  tag(36, 'data')
  view.setUint32(40, pcm.length, true)
  pcm.forEach((v, i) => (bytes[44 + i] = Math.round(128 + v * 127)))
  return bytes
}

export const toBase64 = (bytes: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export const wavBase64 = (sound: DoneChimeSound, volume: DoneChimeVolume) => toBase64(wavBytes(sound, volume))

/** Windows か (作業フォルダが X:\ や \\server の形) */
export const isWindowsPath = (cwd: string) => /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('\\\\')

/** Windows で鳴らす argv。base64 は英数字と + / = だけなので '' の中にそのまま入れられる */
export const powershellArgv = (base64: string) => {
  if (!/^[A-Za-z0-9+/=]*$/.test(base64)) throw new Error('base64 ではありません')
  const script = `$b=[Convert]::FromBase64String('${base64}');$m=New-Object System.IO.MemoryStream(,$b);$p=New-Object System.Media.SoundPlayer($m);$p.PlaySync()`
  return ['powershell', '-NoProfile', '-NonInteractive', '-Command', script]
}

/** ターンの終わりに鳴らすか */
export const shouldChime = (s: DoneChimeSettings, e: { agentId?: string; reason: string; durationMs: number }) =>
  s.isOn && e.agentId === undefined && e.reason === 'answer' && e.durationMs >= s.threshold * 1000

/** store の値を洗う。合わない物は既定値 */
export const cleanSettings = (raw: Record<string, unknown>): DoneChimeSettings => ({
  isOn: typeof raw.isOn === 'boolean' ? raw.isOn : DEFAULTS.isOn,
  sound: SOUNDS.some(s => s.value === raw.sound) ? (raw.sound as DoneChimeSound) : DEFAULTS.sound,
  threshold: THRESHOLDS.includes(raw.threshold as number) ? (raw.threshold as number) : DEFAULTS.threshold,
  volume: VOLUMES.some(v => v.value === raw.volume) ? (raw.volume as DoneChimeVolume) : DEFAULTS.volume,
})

export const labelOf = <T extends string>(list: { value: T; label: string }[], v: T) => list.find(x => x.value === v)?.label ?? v

export const summary = (s: DoneChimeSettings) =>
  s.isOn
    ? `オン: ${s.threshold} 秒以上かかったターンの終わりに「${labelOf(SOUNDS, s.sound)}」を音量 ${labelOf(VOLUMES, s.volume)} で鳴らします`
    : 'オフ: 鳴らしません'

const COLOR: Record<DoneChimeSound, string> = { chord: '#58a6ff', bell: '#d29922', pon: '#3fb950' }

/** 波形の絵。縦線で各列の最小と最大を描き、再生位置の線が流れる */
export const waveSvg = (s: DoneChimeSettings) => {
  const pcm = samples(s.sound, s.volume)
  const cols = 180
  const per = Math.ceil(pcm.length / cols)
  const mid = 70
  let d = ''
  for (let c = 0; c < cols; c++) {
    const part = pcm.slice(c * per, (c + 1) * per)
    if (part.length === 0) break
    const x = (20 + c * 1.9).toFixed(1)
    d += `M${x} ${(mid - Math.max(...part) * 50).toFixed(1)}V${(mid - Math.min(...part) * 50 + 0.5).toFixed(1)}`
  }
  const c = s.isOn ? COLOR[s.sound] : '#8b949e'
  const sec = LENGTH[s.sound]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 140">
<rect x="0.5" y="0.5" width="379" height="139" rx="8" fill="#161b22" stroke="#30363d"/>
<line x1="20" y1="${mid}" x2="362" y2="${mid}" stroke="#30363d"/>
<path d="${d}" stroke="${c}" stroke-width="1.4" fill="none"/>
<line y1="20" y2="120" x1="20" x2="20" stroke="#c9d1d9" stroke-opacity="0.6"><animate attributeName="x1" values="20;362;362" keyTimes="0;0.5;1" dur="${(sec * 2 + 1).toFixed(1)}s" repeatCount="indefinite"/><animate attributeName="x2" values="20;362;362" keyTimes="0;0.5;1" dur="${(sec * 2 + 1).toFixed(1)}s" repeatCount="indefinite"/></line>
<text x="20" y="134" font-size="12" fill="#8b949e" ${FONT}>${labelOf(SOUNDS, s.sound)} / ${sec} 秒 / 音量 ${labelOf(VOLUMES, s.volume)}</text>
<text x="360" y="134" text-anchor="end" font-size="12" fill="${s.isOn ? '#3fb950' : '#8b949e'}" ${FONT}>${s.isOn ? `オン ${s.threshold} 秒以上` : 'オフ'}</text>
</svg>`
}
