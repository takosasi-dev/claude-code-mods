import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULTS, isWindowsPath, powershellArgv, samples, shouldChime, wavBase64, wavBytes, waveSvg } from '../hooks/wav'

// 本物の音は鳴らさない: process.run と audio.play は下で差し替えて、呼ばれた物を記録するだけ
const NOW = Date.parse('2026-10-20T03:00:00Z')
const UNIX_CWD = '/tmp/demo'
const WIN_CWD = 'D:\\demo'
const SURFACES = ['vscode', 'terminal'] as const
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
const presentation = { isFullscreen: false, columns: 80 }
const PANE = {
  plugin: 'done-chime',
  component: 'Pane',
  requestId: 'done-chime',
  props: {
    title: '終わりの音',
    isFocused: false,
    bodyColumns: 29,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

type Opts = {
  cwd?: string
  denyChime?: boolean
  stored?: Record<string, unknown>
  run?: 'ok' | 'fail' | 'missing'
}

const setup = (on: On, opts: Opts = {}) => {
  mock.clock(on, { now: NOW })
  const saved: Record<string, unknown> = { ...opts.stored }
  const runs: string[][] = []
  const plays: { base64?: string; mime?: string }[] = []
  const registered: string[] = []
  on('store.get', (_$, e) => ({ value: saved[e.key] }))
  on('store.set', (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: opts.cwd ?? UNIX_CWD }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_$, e) => {
    if (opts.denyChime && e.name === 'chime') return { deny: '組み込みのコマンドです' }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    if (opts.run === 'missing') return { deny: 'spawn powershell ENOENT\u0007' }
    const exitCode = opts.run === 'fail' ? 1 : 0
    const stderr = opts.run === 'fail' ? 'Exception\u001b[31m: no audio device' : ''
    return { value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('audio.play', (_$, e) => {
    plays.push({ base64: e.clip.base64, mime: e.clip.mime })
    return { value: undefined }
  })
  return { saved, runs, plays, registered }
}

const begin = ($: Engine) => $.session.start({ cwd: UNIX_CWD, surface: 'vscode', isInteractive: true })
const complete = ($: Engine, durationMs: number, extra: { reason?: 'answer' | 'error' | 'aborted'; agentId?: string } = {}) =>
  $.turn.complete({
    answer: 'ok',
    durationMs,
    isAborted: extra.reason === 'aborted',
    turnId: 't1',
    reason: extra.reason ?? 'answer',
    ...(extra.agentId ? { agentId: extra.agentId } : {}),
  })

// 鳴らす処理はターンの終わりを待たせないので、記録が来るまで少し回す
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

test('WAV の頭: RIFF・WAVE・fmt・8kHz 8bit mono・長さ。どれも 1 秒未満', () => {
  for (const sound of ['chord', 'bell', 'pon'] as const) {
    const b = wavBytes(sound, 'mid')
    const v = new DataView(b.buffer)
    expect(ascii(b, 0, 4)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(b.length - 8)
    expect(ascii(b, 8, 4)).toBe('WAVE')
    expect(ascii(b, 12, 4)).toBe('fmt ')
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(8000)
    expect(v.getUint16(34, true)).toBe(8)
    expect(ascii(b, 36, 4)).toBe('data')
    expect(v.getUint32(40, true)).toBe(b.length - 44)
    expect(b.length - 44).toBeLessThan(8000)
    expect(b.length - 44).toBeGreaterThan(1000)
    // base64 を戻すと同じ byte 列
    const back = atob(wavBase64(sound, 'mid'))
    expect(back.length).toBe(b.length)
    expect(back.charCodeAt(100)).toBe(b[100])
  }
})

test('音量は振幅で変わる', () => {
  const peak = (v: 'low' | 'mid' | 'high') => Math.max(...samples('chord', v).map(Math.abs))
  expect(peak('low')).toBeLessThan(peak('mid'))
  expect(peak('mid')).toBeLessThan(peak('high'))
  expect(peak('high')).toBeLessThanOrEqual(1)
})

test('しきい値の判定: メインのターンが答えで終わり、しきい値以上の時だけ', () => {
  const s = { ...DEFAULTS, threshold: 30 }
  expect(shouldChime(s, { reason: 'answer', durationMs: 30_000 })).toBe(true)
  expect(shouldChime(s, { reason: 'answer', durationMs: 29_999 })).toBe(false)
  expect(shouldChime(s, { reason: 'error', durationMs: 90_000 })).toBe(false)
  expect(shouldChime(s, { reason: 'aborted', durationMs: 90_000 })).toBe(false)
  expect(shouldChime(s, { reason: 'answer', durationMs: 90_000, agentId: 'sub-1' })).toBe(false)
  expect(shouldChime({ ...s, isOn: false }, { reason: 'answer', durationMs: 90_000 })).toBe(false)
})

test('Windows の作業フォルダの形', () => {
  expect(isWindowsPath('D:\\demo')).toBe(true)
  expect(isWindowsPath('d:/demo')).toBe(true)
  expect(isWindowsPath('\\\\server\\share')).toBe(true)
  expect(isWindowsPath('/tmp/demo')).toBe(false)
  expect(isWindowsPath('')).toBe(false)
})

test('Windows で呼ぶ argv: シェルを通さず、base64 を SoundPlayer に MemoryStream で渡す。長さも収まる', () => {
  const b64 = wavBase64('bell', 'high') // いちばん長い音
  const argv = powershellArgv(b64)
  expect(argv.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command'])
  const script = argv[4] ?? ''
  expect(script).toContain(`FromBase64String('${b64}')`)
  expect(script).toContain('System.IO.MemoryStream')
  expect(script).toContain('System.Media.SoundPlayer')
  expect(script).toContain('PlaySync()')
  expect(argv.join(' ').length).toBeLessThan(30_000) // Windows のコマンド行は 32767 字まで
  expect(() => powershellArgv("x');Remove-Item ~ #")).toThrow()
})

test('長いターンの終わり: Windows は powershell、音は audio.play で鳴らさない', async ($, on) => {
  const { runs, plays } = setup(on, { cwd: WIN_CWD })
  await begin($)
  await complete($, 45_000)
  await settle()
  expect(runs.length).toBe(1)
  expect(runs[0]?.[0]).toBe('powershell')
  expect(plays.length).toBe(0)
})

test('長いターンの終わり: Windows 以外は audio.play に WAV を渡し、powershell は呼ばない', async ($, on) => {
  const { runs, plays } = setup(on, { cwd: UNIX_CWD })
  await begin($)
  await complete($, 45_000)
  await settle()
  expect(runs.length).toBe(0)
  expect(plays.length).toBe(1)
  expect(plays[0]?.mime).toBe('audio/wav')
  expect(atob(plays[0]?.base64 ?? '').slice(0, 4)).toBe('RIFF')
})

test('短いターン・サブエージェント・エラー・中断・オフでは鳴らさない', async ($, on) => {
  const { runs, plays } = setup(on, { cwd: WIN_CWD, stored: { threshold: 60 } })
  await begin($)
  await complete($, 59_000)
  await complete($, 300_000, { agentId: 'sub-1' })
  await complete($, 300_000, { reason: 'error' })
  await complete($, 300_000, { reason: 'aborted' })
  await settle()
  expect(runs.length + plays.length).toBe(0)
  await complete($, 60_000)
  await settle()
  expect(runs.length).toBe(1)
})

test('/chime の画面: 波形・オン/オフ・音の種類・しきい値・音量を変えると store に項目ごとに残る', async ($, on) => {
  const { saved, registered } = setup(on, { cwd: WIN_CWD })
  await begin($)
  expect(registered).toEqual(['chime'])
  const r = await $.command.run({ command: 'chime', args: '', origin: { kind: 'composer' }, presentation })
  expect(r).toMatchObject({ text: '終わりの音の設定を開きました。' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'vscode') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toContain('和音')
      expect(String(svg?.props.alt)).toContain('30 秒以上')
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /30 秒以上/ })).toBeDefined()
    }
    expect(await ui.find({ type: 'Button', text: '試しに鳴らす' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.select({ key: 'sound', value: 'bell' })
  await ui.select({ key: 'threshold', value: '120' })
  await ui.select({ key: 'volume', value: 'high' })
  expect(saved).toEqual({ sound: 'bell', threshold: 120, volume: 'high' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('ベル')
  expect(svg).toContain('#d29922')
  await ui.press({ key: 'toggle' })
  expect(saved.isOn).toBe(false)
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.props.label).toBe('オンにする')
  await ui.press({ key: 'toggle' })
  expect(saved.isOn).toBe(true)
})

test('試しに鳴らすは、オフでも今の音で鳴らす', async ($, on) => {
  const { runs } = setup(on, { cwd: WIN_CWD, stored: { isOn: false, sound: 'pon', volume: 'low' } })
  await begin($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'try' })
  await settle()
  expect(runs.length).toBe(1)
  expect(runs[0]?.[4]).toContain(wavBase64('pon', 'low'))
})

test('前のセッションの設定を読み戻し、合わない値は既定に戻す', async ($, on) => {
  setup(on, { stored: { isOn: false, sound: 'gong', threshold: 45, volume: 'low' } })
  await begin($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'オフ: 鳴らしません' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  const line = (await ui.find({ type: 'Text', text: /オン/ }))?.text ?? ''
  expect(line).toContain('30 秒以上') // 45 は選べる値でないので既定
  expect(line).toContain('和音') // gong も既定
  expect(line).toContain('音量 小')
})

test('powershell が無い時: 画面は壊れず、理由を制御文字なしで出す (C3)', async ($, on) => {
  const { runs } = setup(on, { cwd: WIN_CWD, run: 'missing' })
  await begin($)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'try' })
  await settle()
  expect(runs.length).toBe(1)
  const note = await ui.find({ type: 'Text', text: /鳴らせませんでした/ })
  expect(note?.text).toContain('ENOENT')
  expect(CTRL.test(note?.text ?? '')).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'try' })).toBeDefined()
})

test('powershell が終了コード 1 の時: 出力の頭を制御文字なしで出す', async ($, on) => {
  setup(on, { cwd: WIN_CWD, run: 'fail' })
  await begin($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'try' })
  await settle()
  const note = await ui.find({ type: 'Text', text: /鳴らせませんでした/ })
  expect(note?.text).toContain('終了コード 1')
  expect(note?.text).toContain('no audio device')
  expect(CTRL.test(note?.text ?? '')).toBe(false)
})

test('/chime が拒まれたら /done-chime で開き、/chime は横取りしない (C2)', async ($, on) => {
  const { registered } = setup(on, { denyChime: true })
  on('command.run', { command: 'chime' }, () => ({ text: '組み込みの chime' }))
  await begin($)
  expect(registered).toEqual(['done-chime'])
  const own = await $.command.run({ command: 'done-chime', args: '', origin: { kind: 'composer' }, presentation })
  expect(own).toMatchObject({ text: '終わりの音の設定を開きました。' })
  const other = await $.command.run({ command: 'chime', args: '', origin: { kind: 'composer' }, presentation })
  expect(other).toMatchObject({ text: '組み込みの chime' })
})

test('波形の SVG は viewBox だけで、文字 12 以上', () => {
  const s = waveSvg(DEFAULTS)
  expect(s).toContain('viewBox="0 0 380 140"')
  expect(s).not.toMatch(/<svg[^>]* width=/)
  for (const m of s.matchAll(/font-size="(\d+)"/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12)
  expect(s.length).toBeLessThan(131_072)
})
