// 各 mod の重さを測って docs/dev/perf.md に表で書く。node 24 でそのまま動く (型は node が外す)
//
//   node tools/perf.mts                  全 mod を測る
//   node tools/perf.mts git-pane ...     名前を渡した mod だけ (全部読ませた時の行は測らない)
//   --runs=3                             1 つの条件を何回走らせて中央値を取るか
//   --no-write                           perf.md に書かず、画面に出すだけ
//   環境変数 CLAUDE_EXE                  claude.exe の場所 (既定は VS Code 拡張の中の一番新しい版)
//
// 測る物
//   1. mod を 1 本だけ読ませた headless の claude -p の、起動から終わりまでの時間
//      ・読み込み: 組み込みの /color (その場で終わり、モデルを呼ばない) を渡す。mod なしの /color との差が読み込みの重さ
//      ・コマンド: その mod のコマンド (hooks/register.tsx で登録する名前のうち、組み込みと被らない 1 つ目) を渡す
//   2. 全部の mod を読ませた時の /color と /mod
//   3. 各 mod の SVG を作る関数を node で呼んだ時間 (tools/shots.mts の SHOTS をそのまま使う)
//
// 依頼者の ~/.claude と settings の env (CLAUDE_CODE_PLUGIN_DIRS) に触らせないため、claude は
//   ・env から CLAUDE_CODE_PLUGIN_DIRS を消す
//   ・CLAUDE_CONFIG_DIR を一時フォルダにする (settings.json も store も一時の物になる)
//   ・--setting-sources project と、空の一時フォルダを作業フォルダにする
// で走らせ、毎回 init の plugins 一覧が読ませた mod だけかを確かめる (違えば止まる)。
// モデルは呼ばない。ANTHROPIC_BASE_URL を閉じた口 (127.0.0.1:9) に向けておき、
// 結果が num_turns 0・API 時間 0・api_retry 無し・返事が全部 <synthetic> の時だけ採る (外れたらその場で止めて「モデル」と出す)。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadShots } from './gif.mts'

const ROOT = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const RUNS = Number(args.find(a => a.startsWith('--runs='))?.slice(7) ?? 3)
const only = args.filter(a => !a.startsWith('--'))

const newest = (names: string[]) => names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)
function findExe(): string {
  if (process.env.CLAUDE_EXE) return process.env.CLAUDE_EXE
  const ext = join(homedir(), '.vscode', 'extensions')
  const dirs = existsSync(ext) ? readdirSync(ext).filter(d => d.startsWith('anthropic.claude-code-')) : []
  const exe = (d: string) => join(ext, d, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude')
  const found = newest(dirs.filter(d => existsSync(exe(d))))
  if (!found) throw new Error('claude.exe が見つかりません。環境変数 CLAUDE_EXE で場所を渡してください')
  return exe(found)
}

const exe = findExe()
const all = readdirSync(join(ROOT, 'mods')).sort().filter(m => existsSync(join(ROOT, 'mods', m, '.claude-plugin', 'plugin.json')))
const nameOf = (mod: string) => JSON.parse(readFileSync(join(ROOT, 'mods', mod, '.claude-plugin', 'plugin.json'), 'utf8')).name as string
const unknown = only.filter(m => !all.includes(m))
if (unknown.length) throw new Error(`知らない mod: ${unknown.join(', ')}`)
const targets = only.length ? only : all

const tmp = mkdtempSync(join(tmpdir(), 'perf-'))
const work = join(tmp, 'work')
mkdirSync(work)
const env: NodeJS.ProcessEnv = {
  ...process.env,
  CLAUDE_CONFIG_DIR: join(tmp, 'config'),
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
}
delete env.CLAUDE_CODE_PLUGIN_DIRS

type Run = { ms: number; plugins: string[]; slash: string[]; isLocal: boolean; text: string }

/** headless で 1 回。プロンプトは node から配列で渡す (Git Bash のパス書き換えを受けない) */
function claude(prompt: string, mods: string[]): Promise<Run> {
  const argv = ['-p', prompt, '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config']
  for (const m of mods) argv.push('--plugin-dir', join(ROOT, 'mods', m))
  return new Promise(resolve => {
    const t0 = performance.now()
    const p = spawn(exe, argv, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const r: Run = { ms: 0, plugins: [], slash: [], isLocal: false, text: '' }
    let buf = ''
    let isModel = false
    let result: any
    const timer = setTimeout(() => p.kill(), 30_000)
    p.stdout.on('data', d => {
      buf += d
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let j: any
        try {
          j = JSON.parse(line)
        } catch {
          continue
        }
        if (j.type === 'system' && j.subtype === 'init') {
          r.plugins = (j.plugins ?? []).filter((x: any) => x.path !== 'builtin').map((x: any) => x.name)
          r.slash = j.slash_commands ?? []
        }
        // モデルへ行きかけた (コマンドが無くて文として送られた) ら、すぐ止める
        if ((j.type === 'system' && j.subtype === 'api_retry') || (j.type === 'assistant' && j.message?.model !== '<synthetic>')) {
          isModel = true
          p.kill()
        }
        if (j.type === 'result') result = j
      }
    })
    p.stderr.on('data', () => {})
    p.on('close', () => {
      clearTimeout(timer)
      r.ms = performance.now() - t0
      r.isLocal = !isModel && result?.num_turns === 0 && result?.duration_api_ms === 0
      r.text = String(result?.result ?? '').split('\n')[0]!.slice(0, 60)
      resolve(r)
    })
  })
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/**
 * 条件 (プロンプトと読ませる mod) ごとに RUNS 回の中央値。機械の揺れが偏らないよう、条件を 1 回ずつ交互に走らせる。
 * 読み込んだ mod が違えば止まる。モデルへ行きかけた条件は undefined にして、それ以上は走らせない
 */
async function measure(conds: [prompt: string, mods: string[]][]): Promise<(number | undefined)[]> {
  const times: (number[] | undefined)[] = conds.map(() => [])
  for (let i = 0; i < RUNS; i++) {
    for (const [k, [prompt, mods]] of conds.entries()) {
      if (!times[k]) continue
      const r = await claude(prompt, mods)
      const want = mods.map(nameOf)
      if (!same(r.plugins, want)) throw new Error(`読み込まれた mod が違います (欲しい物 ${want.length} 本、読まれた物: ${r.plugins.join(', ') || 'なし'})。CLAUDE_CODE_PLUGIN_DIRS が効いているかもしれません`)
      if (r.isLocal) times[k].push(r.ms)
      else times[k] = undefined
    }
  }
  return times.map(t => (t ? median(t) : undefined))
}

type Row = { mod: string; cmd: string; base: number; load: number; cmdMs: number | undefined; isCmdLocal: boolean; svgCold?: number; svgWarm?: number; svgChars?: number }

const fmt = (ms: number | undefined) => (ms === undefined ? '-' : String(Math.round(ms)))
const diff = (ms: number | undefined, base: number) => (ms === undefined ? '-' : `${ms - base >= 0 ? '+' : ''}${Math.round(ms - base)}`)

try {
  console.log(`claude: ${exe}\n各条件 ${RUNS} 回の中央値`)
  // 1 回目は一時の設定フォルダを作る分だけ遅いので捨てる。ここで mod が 1 本も読まれていないことも見る
  const first = await claude('/color', [])
  if (first.plugins.length) throw new Error(`mod を渡していないのに読まれています: ${first.plugins.join(', ')}`)
  if (!first.isLocal) throw new Error('/color がモデルへ行きかけました。測るのをやめます')
  const baseSlash = new Set(first.slash)
  const bases: number[] = []

  const rows: Row[] = []
  for (const mod of targets) {
    // init の slash_commands は session.start のコマンド登録を待たずに出ることがあるので、
    // コマンドは register.tsx の $.command.register の名前から取る。組み込みと被る名前は飛ばす (予備の名前を使う)
    const reg = join(ROOT, 'mods', mod, 'hooks', 'register.tsx')
    const names = existsSync(reg) ? [...readFileSync(reg, 'utf8').matchAll(/command\s*\.register\(\{\s*name:\s*'([\w-]+)'/g)].map(m => m[1]!) : []
    const cmd = names.find(s => !baseSlash.has(s)) ?? ''
    // 「差」は同じ時に交互に走らせた mod なしとの差
    const [base, load, c] = await measure([['/color', []], ['/color', [mod]], ...(cmd ? [[`/${cmd}`, [mod]] as [string, string[]]] : [])])
    if (base === undefined || load === undefined) throw new Error('/color がモデルへ行きかけました。測るのをやめます')
    bases.push(base)
    rows.push({ mod, cmd, base, load, cmdMs: c, isCmdLocal: !cmd || c !== undefined })
    console.log(`${mod.padEnd(18)} 読み込み ${fmt(load)} ms (${diff(load, base)})  ${cmd ? `/${cmd} ${fmt(c)} ms${c === undefined ? ' モデルへ行きかけたので止めた' : ` (${diff(c, base)})`}` : 'コマンドなし'}`)
  }

  let allRow: { base: number; load: number | undefined; mod: number | undefined } | undefined
  if (!only.length) {
    const [base, load, hub] = await measure([['/color', []], ['/color', all], ['/mod', all]])
    allRow = { base: base!, load, mod: hub }
    console.log(`全 ${all.length} 本: /color ${fmt(load)} ms (${diff(load, base!)})  /mod ${fmt(hub)} ms`)
  }

  // SVG を作る関数。初回は mod のモジュールの読み込みを含む。2 回目以降は 5 回の中央値
  const { SHOTS, load } = await loadShots()
  for (const r of rows) {
    const make = SHOTS[r.mod]
    if (!make) continue
    ;(await load(`${r.mod}/hooks/style.ts`)).setTheme(false)
    let t0 = performance.now()
    const pics = await make()
    r.svgCold = performance.now() - t0
    const warm: number[] = []
    for (let i = 0; i < 5; i++) {
      t0 = performance.now()
      await make()
      warm.push(performance.now() - t0)
    }
    r.svgWarm = median(warm)
    r.svgChars = pics.reduce((n, p) => n + (typeof p === 'string' ? p : p.svg).length, 0)
  }

  // ---- perf.md ----
  const v = /claude-code-([\d.]+)/.exec(exe)?.[1] ?? '?'
  const lines = [
    `測った日: ${new Date().toISOString().slice(0, 10)}、Claude Code ${v}、${process.platform}、各条件 ${RUNS} 回の中央値 (ms)。`,
    `mod なしの /color: **${fmt(median(bases))} ms** (mod ごとに交互に測った物の中央値)。「差」は、その mod と交互に測った mod なしの /color との差です。`,
    '',
    '| mod | コマンド | 読み込み (/color) | 差 | コマンド | 差 | SVG 初回 | SVG 2 回目以降 | SVG の字数 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(r =>
      [
        r.mod,
        r.cmd ? `/${r.cmd}` : '(なし)',
        fmt(r.load), diff(r.load, r.base),
        r.isCmdLocal ? fmt(r.cmdMs) : 'モデル', r.isCmdLocal ? diff(r.cmdMs, r.base) : '-',
        r.svgCold === undefined ? '-' : r.svgCold.toFixed(1),
        r.svgWarm === undefined ? '-' : r.svgWarm.toFixed(2),
        r.svgChars === undefined ? '-' : r.svgChars.toLocaleString('en-US'),
      ].join(' | ').replace(/^/, '| ').concat(' |'),
    ),
    ...(allRow ? ['', `全 ${all.length} 本を読ませた時: /color **${fmt(allRow.load)} ms** (${diff(allRow.load, allRow.base)})、/mod **${fmt(allRow.mod)} ms** (${diff(allRow.mod, allRow.base)})。`] : []),
  ]
  const table = lines.join('\n')
  console.log(`\n${table}`)

  if (!args.includes('--no-write')) {
    // 自動で書くのは印の間だけ。印の外 (見当や直す案) は手で書いて残す
    const file = join(ROOT, 'docs', 'dev', 'perf.md')
    const START = '<!-- perf.mts: ここから自動 -->'
    const END = '<!-- perf.mts: ここまで自動 -->'
    mkdirSync(join(ROOT, 'docs', 'dev'), { recursive: true })
    const old = existsSync(file) ? readFileSync(file, 'utf8') : `# mod の重さ\n\n\`node tools/perf.mts\` で測り直せます。\n\n${START}\n${END}\n`
    const a = old.indexOf(START)
    const b = old.indexOf(END)
    const next = a >= 0 && b > a ? `${old.slice(0, a + START.length)}\n${table}\n${old.slice(b)}` : `${old.trimEnd()}\n\n${START}\n${table}\n${END}\n`
    writeFileSync(file, next)
    console.log(`\n${file} に書きました`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
