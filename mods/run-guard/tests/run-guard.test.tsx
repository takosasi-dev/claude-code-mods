import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { EMPTY, LOG_MAX, classify, clock, fromRaw, isWritable, parse, shownLog, withUnknown } from '../hooks/guard'

// 試験はコマンドを文字列として調べるだけ。tool.call は一番下の偽物が受けるので、窓も音も出ず、モデルも呼ばない
const NOW = Date.parse('2026-10-22T05:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const PANE = {
  plugin: 'run-guard',
  component: 'Pane',
  requestId: 'run-guard',
  props: { title: '窓と音の見張り', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const ps = (c: string) => classify(c, 'powershell').map(f => f.group)
const sh = (c: string) => classify(c, 'bash').map(f => f.group)

test('純関数: 窓が出る物', () => {
  expect(ps('Start-Process notepad')).toEqual(['window'])
  expect(ps('Start-Process -FilePath "D:/repo/dist/app.exe" -ArgumentList "--dev"')).toEqual(['window'])
  expect(ps('start D:/repo/dist/app.exe')).toEqual(['window'])
  expect(ps('saps app.exe -Wait')).toEqual(['window'])
  expect(ps('Invoke-Item D:/repo/out.png')).toEqual(['window'])
  expect(ps('ii .')).toEqual(['window'])
  expect(ps('explorer.exe D:/repo')).toEqual(['window'])
  expect(sh('explorer .')).toEqual(['window'])
  expect(sh('start "" D:/repo/index.html')).toEqual(['window'])
  expect(sh('cmd /c start "" notepad')).toEqual(['window'])
  expect(sh('cmd.exe /c "start notepad"')).toEqual(['window'])
  expect(ps('code D:/repo')).toEqual(['window'])
  expect(sh('code .')).toEqual(['window'])
  expect(ps('& "C:/Program Files/Google/Chrome/Application/chrome.exe" D:/repo/index.html')).toEqual(['window'])
  expect(sh('msedge --new-window http://localhost:3000')).toEqual(['window'])
  expect(sh('firefox http://localhost:3000')).toEqual(['window'])
  expect(sh('chromium --user-data-dir=/tmp/x http://localhost')).toEqual(['window'])
  expect(sh('npx playwright test --headed')).toEqual(['window'])
  expect(sh(`node -e "const b = await chromium.launch({ headless: false })"`)).toEqual(['window'])
  expect(sh("python - <<'EOF'\nb = p.chromium.launch(headless=False)\nEOF")).toEqual(['window'])
  // 頭の VAR=値・パス・別名
  expect(sh('DEBUG=1 /c/tools/godot/godot.exe --path D:/repo/game --audio-driver Dummy')).toEqual(['window'])
  expect(ps('Microsoft.PowerShell.Management\\Start-Process notepad')).toEqual(['window'])
  // ; や if の中
  expect(ps('cd D:/repo; if ($?) { Start-Process app.exe }')).toEqual(['window'])
})

test('純関数: 音が出る物', () => {
  expect(ps('[console]::beep(440, 200)')).toEqual(['sound'])
  expect(ps('[System.Console]::Beep()')).toEqual(['sound'])
  expect(ps('(New-Object Media.SoundPlayer "C:/work/a.wav").PlaySync()')).toEqual(['sound'])
  expect(ps('$p = New-Object System.Media.SoundPlayer; $p.Play()')).toEqual(['sound'])
  expect(ps('[System.Media.SystemSounds]::Asterisk.Play()')).toEqual(['sound'])
  expect(ps("Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('done')")).toEqual(['sound'])
  expect(ps('$v = New-Object -ComObject SAPI.SpVoice')).toEqual(['sound'])
  expect(ps('[Win32.Snd]::PlaySound("C:/work/a.wav", 0, 1)')).toEqual(['sound'])
  expect(sh('ffplay -autoexit out.wav')).toEqual(['sound'])
  expect(sh('afplay a.wav && aplay b.wav; paplay c.wav')).toEqual(['sound', 'sound', 'sound'])
  expect(sh('say done')).toEqual(['sound'])
  expect(sh('mpv out.mp4')).toEqual(['sound'])
  expect(sh('vlc --play-and-exit out.mp3')).toEqual(['sound'])
  expect(sh('godot --path D:/repo/game')).toEqual(['window', 'sound'])
  expect(ps('& "D:/tools/Godot_v4.7.2-stable_win64.exe" --path .')).toEqual(['window', 'sound'])
})

test('純関数: 隔離なしの claude -p', () => {
  expect(sh('claude -p "hi"')).toEqual(['headless'])
  expect(sh('claude --print --output-format json "hi"')).toEqual(['headless'])
  expect(ps('& "C:/work/bin/claude.exe" -p hi')).toEqual(['headless'])
  // 片方だけでは足りない
  expect(sh('CLAUDE_CONFIG_DIR=$(mktemp -d) claude -p hi')).toEqual(['headless'])
  expect(ps('$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:9"; claude -p hi')).toEqual(['headless'])
  // 両方を決めていれば見ない (X=... と $env:X の両方の書き方)
  expect(sh('env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=$(mktemp -d) ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p hi')).toEqual([])
  expect(sh('export CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://127.0.0.1:9 CLAUDE_CODE_PLUGIN_DIRS=\nclaude -p hi')).toEqual([])
  expect(sh('export CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://127.0.0.1:9; unset CLAUDE_CODE_PLUGIN_DIRS; claude -p hi')).toEqual([])
  expect(ps('$env:CLAUDE_CONFIG_DIR = (New-Item -ItemType Directory D:/tmp/cc).FullName; $env:ANTHROPIC_BASE_URL="http://127.0.0.1:9"; Remove-Item Env:CLAUDE_CODE_PLUGIN_DIRS; claude -p hi')).toEqual([])
  // -p の無い claude・plugin validate / test・--version は見ない
  for (const c of ['claude plugin validate mods/x', 'claude plugin test mods/x -p', 'claude --version', 'claude mcp list', 'claude'])
    expect(sh(c)).toEqual([])
  // 止めた時の直し方に PLUGIN_DIRS を消すことを書く
  expect(classify('claude -p hi', 'bash')[0]?.fix).toContain('CLAUDE_CODE_PLUGIN_DIRS')
})

// 監査 (2026-10-22) の再現の入力。隔離は 3 つ (一時の CLAUDE_CONFIG_DIR・127.0.0.1 の BASE_URL・PLUGIN_DIRS を消す) がそろった時だけ
const ISO = 'env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=$(mktemp -d) ANTHROPIC_BASE_URL=http://127.0.0.1:9'
test('純関数: 隔離の見逃し (値を見る・echo の中は数えない・PLUGIN_DIRS・書き方)', () => {
  const hits = [
    'claude -p"hi"',
    'claude -pv hi',
    'claude -p=hi',
    "claude --model x -p 'hi'",
    '"claude" -p hi',
    'claude.exe -p hi',
    'echo hi | claude -p',
    // 値を見る: 本物の URL・本物の ~/.claude・空は隔離にならない
    'CLAUDE_CONFIG_DIR=$(mktemp -d) ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p hi',
    'export CLAUDE_CONFIG_DIR=/tmp/x; export ANTHROPIC_BASE_URL=http://x; claude -p hi',
    'ANTHROPIC_BASE_URL=https://api.anthropic.com CLAUDE_CONFIG_DIR=$HOME/.claude claude -p hi',
    'env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=$HOME/.claude ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p hi',
    'env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=~/.claude/ ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p hi',
    'env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR= ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p hi',
    'env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://127.0.0.1.evil.example claude -p hi',
    // echo の中・前の区切りの VAR= (export でない) は数えない
    'echo CLAUDE_CONFIG_DIR= ANTHROPIC_BASE_URL= ; claude -p hi',
    'CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://127.0.0.1:9 CLAUDE_CODE_PLUGIN_DIRS=; claude -p hi',
    // then / do / ! / xargs / if の後ろ・npx
    'if true; then claude -p hi; fi',
    'for f in a; do claude -p hi; done',
    '! claude -p hi',
    'xargs claude -p < f',
    'xargs -n 1 claude -p < f',
    'npx @anthropic-ai/claude-code -p hi',
    'npx -y @anthropic-ai/claude-code@latest --print hi',
    "bash -lc 'claude -p hi'",
    'sh -c "x"; claude -p hi',
  ]
  for (const c of hits) expect([c, sh(c)]).toEqual([c, ['headless']])
  expect(ps('$env:X=1; claude -p hi')).toEqual(['headless'])
  expect(ps('$env:CLAUDE_CONFIG_DIR="x"; $env:ANTHROPIC_BASE_URL="http://127.0.0.1:9"; claude -p hi')).toEqual(['headless'])
  expect(ps('$env:CLAUDE_CONFIG_DIR="$env:USERPROFILE\\.claude"; $env:ANTHROPIC_BASE_URL="http://127.0.0.1:9"; $env:CLAUDE_CODE_PLUGIN_DIRS=$null; claude -p hi')).toEqual(['headless'])

  const misses = [
    `${ISO} claude -p hi`,
    `${ISO} claude -p"hi"`,
    'env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://localhost:9/ claude -p hi',
    'env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://[::1]:9 claude -p hi',
    'CLAUDE_CODE_PLUGIN_DIRS= CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p hi',
    'env --unset=CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p hi',
    `if true; then ${ISO} claude -p hi; fi`,
    `xargs ${ISO} claude -p < f`,
    `${ISO} npx @anthropic-ai/claude-code -p hi`,
    // -p の無い claude・plugin / mcp の下のコマンド
    'claude plugin validate -p',
    'claude mcp list -p',
    'git commit -m "use claude -p"',
    'cat <<EOF\nclaude -p\nEOF',
    'node -e "x" # claude -p',
  ]
  for (const c of misses) expect([c, sh(c)]).toEqual([c, []])
  expect(ps('$env:CLAUDE_CONFIG_DIR="D:/tmp/cc"; $env:ANTHROPIC_BASE_URL="http://127.0.0.1:9"; $env:CLAUDE_CODE_PLUGIN_DIRS=""; claude -p hi')).toEqual([])
  expect(ps('$env:CLAUDE_CONFIG_DIR = "D:/tmp/cc"; $env:ANTHROPIC_BASE_URL = "http://127.0.0.1:9"; Remove-Item -Path Env:\\CLAUDE_CODE_PLUGIN_DIRS; claude -p hi')).toEqual([])
})

test('純関数: 窓と音の見逃し (iex・-EncodedCommand・Process::Start・winsound・playwright・MessageBeep・timeout)', () => {
  const START_NOTEPAD = 'UwB0AGEAcgB0AC0AUAByAG8AYwBlAHMAcwAgAG4AbwB0AGUAcABhAGQA' // UTF-16LE の Start-Process notepad
  expect(ps('Invoke-Expression "Start-Process notepad"')).toEqual(['window'])
  expect(ps('iex "Start-Process notepad"')).toEqual(['window'])
  expect(ps(`powershell -NoProfile -EncodedCommand ${START_NOTEPAD}`)).toEqual(['window'])
  expect(sh(`powershell -enc ${START_NOTEPAD}`)).toEqual(['window'])
  expect(sh(`pwsh -e ${START_NOTEPAD}`)).toEqual(['window'])
  expect(ps('[System.Diagnostics.Process]::Start("notepad")')).toEqual(['window'])
  expect(sh('python -c "import winsound; winsound.Beep(440,100)"')).toEqual(['sound'])
  expect(sh("python3 - <<'EOF'\nimport winsound\nwinsound.Beep(440, 100)\nEOF")).toEqual(['sound'])
  expect(ps('$p = New-Object -TypeName "System.Media.SoundPlayer"; $p.Play()')).toEqual(['sound'])
  expect(ps('New-Object -TypeName "System.Media.SoundPlayer"')).toEqual(['sound'])
  expect(sh('npx playwright test --ui')).toEqual(['window'])
  expect(sh('npx playwright codegen')).toEqual(['window'])
  expect(sh('python -m playwright open http://localhost')).toEqual(['window'])
  expect(ps('rundll32.exe user32.dll,MessageBeep')).toEqual(['sound'])
  expect(sh('timeout 5 godot --path .')).toEqual(['window', 'sound'])
  expect(sh('timeout -s KILL 5 godot --path .')).toEqual(['window', 'sound'])
  expect(sh('timeout --kill-after=2 --preserve-status 5 ffplay a.wav')).toEqual(['sound'])
  // 外れる側: 窓も音も出ない書き方
  const misses: [string, 'bash' | 'powershell'][] = [
    [`powershell -NoProfile -EncodedCommand VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIABoAGkA`, 'bash'], // Write-Output hi
    ['powershell -NoProfile -EncodedCommand ABC', 'powershell'],
    ['powershell -ExecutionPolicy Bypass -File x.ps1', 'bash'],
    ['iex "Get-ChildItem"', 'powershell'],
    ['python -c "print(1)"', 'bash'],
    ['grep -rn winsound src', 'bash'],
    ['npx playwright test', 'bash'],
    ['npx playwright install', 'bash'],
    ['timeout 5 godot --headless --path .', 'bash'],
    ['$p = Get-Process', 'powershell'],
    ['Write-Host "[System.Diagnostics.Process]::Start"', 'powershell'],
  ]
  for (const [c, shell] of misses) expect([c, classify(c, shell)]).toEqual([c, []])
})

test('純関数: 外れる物 (文字列・コメント・窓や音の出ない書き方)', () => {
  const misses: [string, 'bash' | 'powershell'][] = [
    ['echo "Start-Process"', 'powershell'],
    ['Write-Host Start-Process notepad', 'powershell'],
    ['# godot --path .', 'bash'],
    ['ls # start godot', 'bash'],
    ['<# Start-Process x #> Get-ChildItem', 'powershell'],
    ['Get-Process godot', 'powershell'],
    ['Stop-Process -Name godot -Force', 'powershell'],
    ['Get-Process | Where-Object Name -eq chrome', 'powershell'],
    ['Start-Process app.exe -WindowStyle Hidden -Wait', 'powershell'],
    ['Start-Process app.exe -ArgumentList @("--a") -win hidden', 'powershell'],
    ['Start-Process app.exe -WindowStyle:Hidden', 'powershell'],
    ['Start-Sleep 1; Start-Job { 1 }', 'powershell'],
    ['npm start', 'bash'],
    ['godot --headless --path D:/repo/game -s tests/run.gd', 'bash'],
    ['godot --version', 'bash'],
    ['chrome --headless=new --screenshot D:/repo/index.html', 'bash'],
    ['"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless --dump-dom http://x', 'bash'],
    ['firefox -headless --screenshot http://x', 'bash'],
    ['npx playwright test', 'bash'],
    ['node -e "chromium.launch({ headless: true })"', 'bash'],
    ['code --version', 'bash'],
    ['code --list-extensions', 'bash'],
    ['code --install-extension ext.vsix', 'bash'],
    ['mpv --no-audio --vo=null out.mp4', 'bash'],
    ['ffprobe out.wav', 'bash'],
    ['ffmpeg -i out.wav -f null -', 'bash'],
    ['aplay -l', 'bash'],
    ['grep -rn Media.SoundPlayer src', 'bash'],
    ['rg "::PlaySound" .', 'bash'],
    ['git commit -m "Start-Process で窓を出さない"', 'bash'],
    ["git commit -F - <<'EOF'\ngodot と chrome の起動を直す\nEOF", 'bash'],
    ["cat > run.ps1 <<'EOF'\nStart-Process notepad\n[console]::beep()\nEOF", 'bash'],
    ["$s = @'\nStart-Process notepad\n'@\nSet-Content -Encoding utf8 a.ps1 $s", 'powershell'],
    ['node tools/shots.mts run-guard', 'bash'],
    ['node tools/check_all.mts run-guard', 'bash'],
    ['curl http://localhost:3000/#start', 'bash'],
    ['Select-String -Path *.ts -Pattern godot', 'powershell'],
    ['say_hello.sh', 'bash'],
    ['${GODOT_HOME}/bin/tool --headless', 'bash'],
  ]
  for (const [c, shell] of misses) expect([c, classify(c, shell)]).toEqual([c, []])
})

test('純関数: 入れ子のシェルと windowApps', () => {
  expect(sh('powershell -NoProfile -Command "Start-Process notepad"')).toEqual(['window'])
  expect(sh('pwsh -c "[console]::beep()"')).toEqual(['sound'])
  expect(sh(`powershell -Command "Start-Process app.exe -WindowStyle Hidden"`)).toEqual([])
  expect(sh(`bash -c 'echo "Start-Process"'`)).toEqual([])
  expect(ps(`bash -lc "godot --path ."`)).toEqual(['window', 'sound'])
  // 外で決めた環境は中の claude にも効く
  expect(sh(`env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://127.0.0.1:9 bash -c "claude -p hi"`)).toEqual([])
  expect(sh(`CLAUDE_CONFIG_DIR=/tmp/cc ANTHROPIC_BASE_URL=http://127.0.0.1:9 bash -c "claude -p hi"`)).toEqual(['headless'])
  expect(classify('D:/repo/dist/MyGame.exe --dev', 'bash', ['mygame']).map(f => f.group)).toEqual(['window'])
  expect(classify('MyGame --dev', 'powershell', ['tool', 'mygame']).map(f => f.what)).toEqual(['mygame は窓のアプリ (設定 windowApps)'])
  expect(classify('D:/repo/dist/MyGame.exe --dev', 'bash')).toEqual([])
  // 語に分ける: 引用符の中は 1 語、( ) は語の切れ目
  expect(parse(`Start-Process "a b.exe" -ArgumentList @('x') -WindowStyle Hidden`, 'powershell').map(s => s.map(w => w.text))).toEqual([
    ['Start-Process', 'a b.exe', '-ArgumentList', '@', 'x', '-WindowStyle', 'Hidden'],
  ])
})

test('純関数: 知らない欄を残す・読めない値は既定', () => {
  expect(fromRaw(undefined)).toEqual(EMPTY)
  expect(fromRaw('broken')).toEqual(EMPTY)
  const later = { at: 2, groups: ['later'], command: 'y', action: 'later' }
  const raw = { futureField: 1, off: { sound: true, later: true }, counts: { window: 2, later: 5 }, log: [{ at: 1, groups: ['window'], command: 'x', action: 'blocked', note: 'n' }, later, 3] }
  const s = fromRaw(raw)
  expect(s.off).toEqual({ window: false, sound: true, headless: false })
  // 知らない action・group の行も持つ (描く時だけ除く)。物でない要素は落とす
  expect(s.log).toHaveLength(2)
  expect(shownLog(s)).toHaveLength(1)
  expect(withUnknown(raw, { ...s, counts: { ...s.counts, window: 3 } })).toEqual({
    futureField: 1,
    off: { later: true, window: false, sound: true, headless: false },
    counts: { later: 5, window: 3, sound: 0, headless: 0 },
    log: [{ at: 1, groups: ['window'], command: 'x', action: 'blocked', note: 'n' }, later],
  })
  // 書き戻してよい形か
  expect([undefined, {}, raw].map(isWritable)).toEqual([true, true, true])
  expect(['broken', null, [], { log: 'x' }, { off: 1 }, { counts: [] }].map(isWritable)).toEqual([false, false, false, false, false, false])
  // 時刻は日本時間
  expect(clock(Date.parse('2026-10-22T15:30:00Z'))).toBe('00:30')
})

// ── フックの試験

/** reply: その場で聞かれた時の答え。undefined なら聞けない (閉じられた) */
type World = { reply?: string; asked: string[]; ran: string[]; toasts: string[]; registered: string[]; raw: () => unknown; poke: (v: unknown) => void }

// エンジンの代役を下に置く (下の hook はテストの最初の $ より前に全部登録する)
const setup = (on: On, init?: unknown) => {
  const clock = mock.clock(on, { now: NOW })
  const m = new Map<string, unknown>(init === undefined ? [] : [['save', init]])
  const w: World = { reply: '実行する', asked: [], ran: [], toasts: [], registered: [], raw: () => m.get('save'), poke: v => m.set('save', v) }
  on('store.get', (_$, e) => ({ value: m.get(e.key) }))
  on('store.set', (_$, e) => {
    m.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]?.question ?? ''
    w.asked.push(q)
    if (w.reply === undefined) throw new Error('dismissed')
    return {
      result: { questions: e.questions, answers: { [q]: w.reply } },
      text: `User has answered your questions: "${q}"="${w.reply}". You can now continue with the user's answers in mind.`,
    } as never
  })
  // 本物は走らせない。走ったことだけ覚える
  on('tool.call', (_$, e) => {
    w.ran.push(String((e as unknown as { command?: unknown }).command ?? ''))
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
  })
  return { w, clock }
}

const begin = ($: Engine) => $.session.start({ cwd: 'C:/work', surface: 'vscode', isInteractive: true })
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const psCall = ($: Engine, command: string) => $.tool.call({ tool: 'PowerShell', command } as never)
const denyOf = (r: unknown) => String((r as { deny?: unknown }).deny ?? '')
const contextOf = (r: unknown) => ((r as { context?: string[] }).context ?? []).join('\n')

type View = Pick<Mounted, 'findAll'>
const shown = async (ui: View) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.alt)}\n${String(s.props.source)}`), ...texts.map(t => t.text)].join('\n')
}

test('/runguard でペインが開き、見つからない物は聞かずに通す', async ($, on) => {
  const { w } = setup(on)
  await begin($)
  expect(w.registered).toEqual(['runguard'])
  const r = await $.command.run({ command: 'runguard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(r.text).toContain('窓と音の見張り')
  await bash($, 'git status')
  await psCall($, 'Get-Process godot')
  expect(w.ran).toEqual(['git status', 'Get-Process godot'])
  expect(w.asked).toEqual([])
  expect(w.raw()).toBeUndefined()
})

test('止める (既定): 実行せず、直し方を返し、記録とトーストを残す', async ($, on) => {
  const { w } = setup(on)
  await begin($)
  const r = await psCall($, 'Start-Process D:/repo/dist/app.exe')
  expect(w.ran).toEqual([])
  expect(denyOf(r)).toContain('-WindowStyle Hidden を付けて')
  expect(denyOf(r)).toContain('実行していません')
  const r2 = await bash($, 'claude -p "hi"')
  expect(denyOf(r2)).toContain('CLAUDE_CODE_PLUGIN_DIRS')
  expect(denyOf(r2)).toContain('ANTHROPIC_BASE_URL=http://127.0.0.1:9')
  await bash($, 'godot --path D:/repo/game')
  expect(w.ran).toEqual([])
  const s = fromRaw(w.raw())
  expect(s.counts).toEqual({ window: 2, sound: 1, headless: 1 })
  expect(s.log.map(e => [e.groups, e.action])).toEqual([
    [['window'], 'blocked'],
    [['headless'], 'blocked'],
    [['window', 'sound'], 'blocked'],
  ])
  expect(w.toasts[0]).toBe('run-guard: 窓を止めました')
  expect(w.asked).toEqual([])
})

test('聞く: 実行するなら通し、やめるなら止め、聞けなければ止める', { options: { mode: '聞く' } }, async ($, on) => {
  const { w } = setup(on)
  await begin($)
  await bash($, 'ffplay -autoexit out.wav')
  expect(w.ran).toEqual(['ffplay -autoexit out.wav'])
  expect(w.asked[0]).toContain('ffplay で音を鳴らす')
  w.reply = 'やめる'
  const r = await bash($, 'ffplay -autoexit out.wav')
  expect(denyOf(r)).toContain('依頼者が実行しないと答えた')
  w.reply = undefined
  const r2 = await bash($, 'say done')
  expect(denyOf(r2)).toContain('聞けなかった')
  expect(w.ran).toHaveLength(1)
  expect(fromRaw(w.raw()).log.map(e => e.action)).toEqual(['asked-yes', 'asked-no', 'blocked'])
})

test('伝えるだけ: 実行して、結果の後ろに直し方を足す', { options: { mode: '伝えるだけ' } }, async ($, on) => {
  const { w } = setup(on)
  await begin($)
  const r = await bash($, 'chrome http://localhost:3000')
  expect(w.ran).toEqual(['chrome http://localhost:3000'])
  expect(denyOf(r)).toBe('')
  expect(contextOf(r)).toContain('--headless=new を付けて')
  expect(fromRaw(w.raw()).log.map(e => e.action)).toEqual(['told'])
})

test('windowApps の名前はいつも窓とみなす', { options: { windowApps: 'mygame, other.exe' } }, async ($, on) => {
  const { w } = setup(on)
  await begin($)
  const r = await bash($, 'D:/repo/dist/MyGame.exe --dev')
  expect(denyOf(r)).toContain('設定 windowApps')
  expect(w.ran).toEqual([])
})

for (const surface of SURFACES) {
  test(`ペイン (${surface}): 数と記録が出て、組を切ると通り、戻すとまた止める`, async ($, on) => {
    const { w } = setup(on)
    await begin($)
    await psCall($, '[console]::beep()')
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = await shown(ui)
    expect(text).toContain('見張り中')
    expect(text).toContain('音: 見張り中 ─ 1 回')
    expect(text).toContain('[console]::beep()')
    expect(text).toContain('止めた')
    if (surface === 'vscode') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    else expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'toggle-sound' }))?.props.dimColor).toBe(true)

    await ui.press({ key: 'toggle-sound' })
    expect(fromRaw(w.raw()).off.sound).toBe(true)
    expect(await shown(ui)).toContain('音: 切っています')
    const back = await ui.find({ type: 'Button', key: 'toggle-sound' })
    expect(back?.props.label).toBe('音の見張りを戻す')
    expect(back?.props.dimColor).toBeUndefined()
    await psCall($, '[console]::beep()')
    expect(w.ran).toEqual(['[console]::beep()'])
    // 他の組は止めたまま
    const r = await psCall($, 'Start-Process notepad')
    expect(denyOf(r)).not.toBe('')

    await ui.press({ key: 'toggle-sound' })
    const r2 = await psCall($, '[console]::beep()')
    expect(denyOf(r2)).not.toBe('')
    expect(w.ran).toHaveLength(1)
  })
}

test('別のセッションで切った組は、次のコマンドから効く', async ($, on) => {
  const { w } = setup(on)
  await begin($)
  w.poke({ ...EMPTY, off: { window: true, sound: false, headless: false } })
  await psCall($, 'Start-Process notepad')
  expect(w.ran).toEqual(['Start-Process notepad'])
})

test('知らない欄 (新しい版が書いた物) は、記録と切り替えの後も store に残る', async ($, on) => {
  const { w } = setup(on, { ...EMPTY, off: { ...EMPTY.off, later: true }, futureField: 1 })
  await begin($)
  await bash($, 'say hi')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'toggle-window' })
  const raw = w.raw() as Record<string, unknown>
  expect(raw.futureField).toBe(1)
  expect(raw.off).toEqual({ later: true, window: true, sound: false, headless: false })
  expect(fromRaw(raw).counts.sound).toBe(1)
})

test('知らない action の記録の行は、書き戻しても消えず、ペインには出ない', async ($, on) => {
  const later = { at: NOW - 1000, groups: ['later'], command: 'future-cmd', action: 'later', extra: 1 }
  const { w } = setup(on, { ...EMPTY, log: [later], futureField: 1 })
  await begin($)
  await bash($, 'say hi')
  const raw = w.raw() as { log: unknown[]; futureField: unknown }
  expect(raw.futureField).toBe(1)
  expect(raw.log[0]).toEqual(later)
  expect(raw.log).toHaveLength(2)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = await shown(ui)
  expect(text).toContain('say hi')
  expect(text).not.toContain('future-cmd')
})

test('読めない記録 (形が違う) には書かず、書けなかった分は次に書ける時に足す', async ($, on) => {
  const { w } = setup(on, 'broken')
  await begin($)
  const r = await bash($, 'say a')
  expect(denyOf(r)).not.toBe('')
  expect(w.raw()).toBe('broken')
  expect(w.toasts.some(t => t.includes('記録を読めなかった'))).toBe(true)
  // 読める形に戻ったら、前の分も一緒に書く
  w.poke({ ...EMPTY, futureField: 1 })
  await bash($, 'say b')
  const s = fromRaw(w.raw())
  expect(s.log.map(e => e.command)).toEqual(['say a', 'say b'])
  expect(s.counts.sound).toBe(2)
  expect((w.raw() as { futureField?: unknown }).futureField).toBe(1)
})

test('/runguard を持てた時は、予備名の /run-guard を横取りしない', async ($, on) => {
  setup(on)
  on('command.run', { command: 'run-guard' }, () => ({ text: '別の run-guard' }))
  await begin($)
  const presentation = { isFullscreen: false, columns: 80 }
  const other = await $.command.run({ command: 'run-guard', args: '', origin: { kind: 'composer' }, presentation })
  expect(other).toMatchObject({ text: '別の run-guard' })
})

test(`記録は ${LOG_MAX} 件まで、数はずっと足す`, async ($, on) => {
  const { w } = setup(on)
  await begin($)
  for (let k = 0; k < LOG_MAX + 3; k++) await bash($, `say ${k}`)
  const s = fromRaw(w.raw())
  expect(s.log).toHaveLength(LOG_MAX)
  expect(s.log.at(-1)?.command).toBe(`say ${LOG_MAX + 2}`)
  expect(s.counts.sound).toBe(LOG_MAX + 3)
  expect(w.ran).toEqual([])
})

// 版の覚えはモジュールに残るので、この試験は最後に置く
test('新しい版が入ったら store に書かない (見張りは続ける)', async ($, on) => {
  let version = '0.1.0'
  on('fs.read', (_$, e) => (e.path.replace(/\\/g, '/').endsWith('/plugin.json') ? { value: JSON.stringify({ name: 'run-guard', version }) } : { deny: 'ENOENT' }))
  const { w, clock } = setup(on)
  await begin($)
  await bash($, 'say a')
  expect(fromRaw(w.raw()).log).toHaveLength(1)
  version = '0.2.0'
  await clock.advance(61_000)
  const r = await bash($, 'say b')
  expect(denyOf(r)).not.toBe('')
  expect(fromRaw(w.raw()).log).toHaveLength(1)
  expect(w.toasts.some(t => t.includes('新しい版が入りました'))).toBe(true)
})
