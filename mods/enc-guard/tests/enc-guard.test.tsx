import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { barePyWrites, bytesOf, hasBarePsWrite, hasBom, hasHighByte, runsPython } from '../hooks/enc'

const NOW = Date.parse('2026-10-22T05:00:00Z')
const SURFACES = ['vscode', 'terminal'] as const
const BLOCK = { options: { mode: '止める' } }
const PANE = {
  plugin: 'enc-guard',
  component: 'Pane',
  requestId: 'enc-guard',
  props: { title: '文字コードの見張り', isFocused: false, bodyColumns: 29, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** バイトを base64 にする ($.fs.read の bytes の答えを作る) */
const b64 = (bytes: number[]) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = bytes.slice(i, i + 3)
    const word = (a << 16) | (b << 8) | c
    s += B64[(word >> 18) & 63]! + B64[(word >> 12) & 63]!
    s += i + 1 < bytes.length ? B64[(word >> 6) & 63]! : '='
    s += i + 2 < bytes.length ? B64[word & 63]! : '='
  }
  return s
}
const BOM = [0xef, 0xbb, 0xbf]
const NICHI = [0xe6, 0x97, 0xa5] // 「日」の UTF-8
const ASCII = [0x23, 0x20, 0x61] // "# a"

/** files: パスと中身のバイト。ran: 走ったツールの印 */
type World = { cwd: string; files: Record<string, number[]>; ran: string[]; toasts: string[]; registered: string[] }

// エンジンの代役を下に置く (下の hook はテストの最初の $ より前に全部登録する)
const setup = (on: On, cwd = 'C:/work') => {
  mock.clock(on, { now: NOW })
  const w: World = { cwd, files: {}, ran: [], toasts: [], registered: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('command.register', (_$, e) => {
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    // エンジンはパスを OS の書き方に直して渡すので、/ にそろえて引く
    const bytes = w.files[e.path.replace(/\\/g, '/')]
    return bytes === undefined ? { deny: 'ENOENT' } : { value: { base64: b64(bytes) } }
  })
  on('tool.call', (_$, e) => {
    const args = e as unknown as Record<string, unknown>
    w.ran.push(String(args.command ?? args.file_path ?? ''))
    return { result: 'ok', text: 'ok' } as never
  })
  return w
}

const begin = ($: Engine, w: World) => $.session.start({ cwd: w.cwd, surface: 'vscode', isInteractive: true })
const ps = ($: Engine, command: string) => $.tool.call({ tool: 'PowerShell', command } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const write = ($: Engine, file_path: string, content: string) => $.tool.call({ tool: 'Write', file_path, content } as never)
const edit = ($: Engine, file_path: string, new_string: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string } as never)
const contextOf = (r: unknown) => ((r as { context?: string[] }).context ?? []).join('\n')

type View = Pick<Mounted, 'findAll'>
const shown = async (ui: View) => {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.alt)}\n${String(s.props.source)}`), ...texts.map(t => t.text)].join('\n')
}

test('純関数: -Encoding の無い Set-Content / Add-Content', () => {
  expect(hasBarePsWrite('Set-Content -Path a.txt -Value $s', true)).toBe(true)
  expect(hasBarePsWrite('$s | Add-Content log.txt', true)).toBe(true)
  expect(hasBarePsWrite('Set-Content a.txt $s -Encoding utf8', true)).toBe(false)
  expect(hasBarePsWrite('Set-Content a.txt $s -enc utf8', true)).toBe(false)
  expect(hasBarePsWrite('Write-Host "Set-Content x"', true)).toBe(false)
  expect(hasBarePsWrite('Get-Content a.txt; if ($?) { Set-Content b.txt $x }', true)).toBe(true)
  expect(hasBarePsWrite(`powershell -NoProfile -Command "Set-Content a.txt 'x'"`, false)).toBe(true)
  expect(hasBarePsWrite(`pwsh -c "Set-Content a.txt 'x' -Encoding utf8NoBOM"`, false)).toBe(false)
  expect(hasBarePsWrite('echo Set-Content a.txt', false)).toBe(false)
})

test('純関数: Python の書き込みと、Python を走らせるコマンド', () => {
  expect(barePyWrites("open('a.txt', 'w').write(s)")).toEqual(["open('a.txt', 'w')"])
  expect(barePyWrites("open(p, 'w', encoding='utf-8')")).toEqual(["open(p, 'w', encoding='utf-8')"])
  expect(barePyWrites("with open(p, 'w', encoding='utf-8', newline='') as f:")).toEqual([])
  expect(barePyWrites("open(p, mode='a', encoding='utf-8', newline='\\n')")).toEqual([])
  expect(barePyWrites("open(p, 'wb')\nopen(p)\nopen(p, 'r', encoding='utf-8')\nImage.open(p, 'w')")).toEqual([])
  expect(barePyWrites("Path(p).write_text(s)\nPath(q).write_text(s, encoding='utf-8')")).toEqual(['write_text(s)'])
  expect(barePyWrites("open(os.path.join(d, 'x'), 'w')")).toEqual(["open(os.path.join(d, 'x'), 'w')"])
  for (const c of ['python x.py', "python - <<'EOF'\nprint(1)\nEOF", 'PYTHONUTF8=1 py -3 a.py', 'C:\\Python313\\python.exe a.py', 'cd x && python3 -c "1"', 'uv run python a.py'])
    expect(runsPython(c)).toBe(true)
  for (const c of ['echo python', 'pip install x', 'node a.mjs']) expect(runsPython(c)).toBe(false)
})

test('純関数: base64 とBOM', () => {
  expect([...bytesOf(b64([...BOM, ...ASCII]))]).toEqual([...BOM, ...ASCII])
  expect([...bytesOf(b64([1, 2]))]).toEqual([1, 2])
  expect([...bytesOf(b64([1, 2, 3, 4]))]).toEqual([1, 2, 3, 4])
  expect(hasBom(bytesOf(b64([...BOM, ...NICHI])))).toBe(true)
  expect(hasBom(bytesOf(b64(NICHI)))).toBe(false)
  expect(hasHighByte(bytesOf(b64(ASCII)))).toBe(false)
  expect(hasHighByte(bytesOf(b64(NICHI)))).toBe(true)
})

test('知らせる: -Encoding の無い Set-Content は走らせてから、直し方を Claude に伝える', async ($, on) => {
  const w = setup(on)
  await begin($, w)
  expect(w.registered).toContain('enc')
  const r = await ps($, 'Set-Content -Path out.txt -Value $s')
  expect(w.ran).toEqual(['Set-Content -Path out.txt -Value $s'])
  expect(contextOf(r)).toContain('enc-guard: Set-Content に -Encoding が無い (Set-Content -Path out.txt -Value $s)。PowerShell 5.1 の Set-Content')
  expect(w.toasts).toEqual(['enc-guard: Set-Content に -Encoding が無い(Claude に伝えました)'])
  // 付いていれば何もしない
  const r2 = await ps($, 'Set-Content -Path out.txt -Value $s -Encoding utf8')
  expect(contextOf(r2)).toBe('')
})

test('止める: 前に分かる物は走らせずに止め、直し方を返す', BLOCK, async ($, on) => {
  const w = setup(on)
  await begin($, w)
  const r = await ps($, '$x | Add-Content log.txt')
  expect(w.ran).toEqual([])
  expect(r.deny).toContain('enc-guard: Set-Content に -Encoding が無い')
  expect(w.toasts).toEqual(['enc-guard: Set-Content に -Encoding が無い(止めました)'])
  const r2 = await write($, 'C:/work/run.bat', '@echo off\r\necho 日本語\r\n')
  expect(r2.deny).toContain('cmd は .bat / .cmd を cp932 で読む')
  expect(w.ran).toEqual([])
})

test('.ps1: 日本語入りを BOM なしで書いたら伝える。BOM 付きの全文や、もとから BOM のあるファイルは伝えない', async ($, on) => {
  const w = setup(on)
  await begin($, w)
  const r = await write($, 'C:/work/a.ps1', 'Write-Host "日本語"')
  expect(contextOf(r)).toContain('enc-guard: 日本語入りの .ps1 に BOM が無い (C:/work/a.ps1)')
  const r2 = await write($, 'C:/work/b.ps1', '\uFEFFWrite-Host "日本語"')
  w.files['C:/work/b.ps1'] = [...BOM, ...NICHI]
  expect(contextOf(r2)).toBe('')
  w.files['C:/work/c.ps1'] = [...BOM, ...ASCII]
  const r3 = await write($, 'C:/work/c.ps1', 'Write-Host "日本語"')
  expect(contextOf(r3)).toBe('')
  const r4 = await write($, 'C:/work/d.ps1', 'Write-Host "ascii only"')
  expect(contextOf(r4)).toBe('')
})

test('.ps1 の Edit は書いた後に読んで、BOM が無く ASCII 以外の字があれば伝える', async ($, on) => {
  const w = setup(on)
  await begin($, w)
  w.files['C:/work/e.ps1'] = [...ASCII, ...NICHI]
  const r = await edit($, 'C:/work/e.ps1', '# 日')
  expect(contextOf(r)).toContain('日本語入りの .ps1 に BOM が無い (C:/work/e.ps1)')
  w.files['C:/work/f.ps1'] = [...BOM, ...NICHI]
  expect(contextOf(await edit($, 'C:/work/f.ps1', '# 日'))).toBe('')
  w.files['C:/work/g.ps1'] = ASCII
  expect(contextOf(await edit($, 'C:/work/g.ps1', '# a'))).toBe('')
})

test('Python: Windows ではコマンドと .py の書き込みを見る', async ($, on) => {
  const w = setup(on)
  await begin($, w)
  const r = await bash($, "python - <<'EOF'\nopen('out.md', 'w').write(s)\nEOF")
  expect(contextOf(r)).toContain("open(p, 'w', encoding='utf-8', newline='')")
  const r2 = await write($, 'C:/work/tool.py', "with open(p, 'w', encoding='utf-8') as f:\n    f.write(s)\n")
  expect(contextOf(r2)).toContain('Python の open に encoding= / newline= が無い (C:/work/tool.py)')
  const r3 = await write($, 'C:/work/ok.py', "with open(p, 'w', encoding='utf-8', newline='') as f:\n    f.write(s)\n")
  expect(contextOf(r3)).toBe('')
})

test('Python: Windows 以外では見ない。設定で切れる', async ($, on) => {
  const w = setup(on, '/home/runner/proj')
  await begin($, w)
  const r = await bash($, "python3 -c \"open('a', 'w').write('x')\"")
  expect(contextOf(r)).toBe('')
})

test('Python: checkPython を切ると Windows でも見ない', { options: { checkPython: false } }, async ($, on) => {
  const w = setup(on)
  await begin($, w)
  const r = await bash($, "python -c \"open('a', 'w').write('x')\"")
  expect(contextOf(r)).toBe('')
})

test('ペイン: 数と記録', async ($, on) => {
  const w = setup(on)
  await begin($, w)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await shown(ui)).toContain('罠は踏んでいません')
    await ui.unmount()
  }
  await ps($, 'Set-Content a.txt $s')
  await write($, 'C:/work/run.cmd', 'echo 日本語')
  const vs = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await vs.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('このセッションで 2 回')
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  const text = await shown(term)
  expect(text).toContain('見つけたら Claude に伝えます')
  expect(text).toContain('.bat / .cmd に ASCII 以外の字: 1 回')
  expect(text).toContain('14:00 .bat / .cmd に ASCII 以外の字 ─ Claude に伝えた (C:/work/run.cmd)')
})
