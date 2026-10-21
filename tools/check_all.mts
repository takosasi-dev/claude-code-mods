// 全 mod に plugin validate・plugin test・tsc を走らせ、最後に表で出す。node 24 でそのまま動く (型は node が外す)
//
//   node tools/check_all.mts              mods/ の下を全部
//   node tools/check_all.mts git-pane ... 名前を渡した mod だけ
//   --types=<claude-code.d.ts>            tsc に渡すエンジンの型 (既定は下の順で探す)
//   環境変数 CLAUDE_EXE                   claude.exe の場所 (既定は VS Code 拡張の中の一番新しい版)
//
// 同時に 4 本まで走らせる。1 本の mod の中では validate → test → tsc の順。
// 型は --types= → mods/<mod>/.claude-plugin/types/claude-code/index.d.ts (エンジンが読み込み時に書く)
// → bundled-skills の一番新しい版の plugin-authoring/types/claude-code.d.ts の順で探す。
// tsconfig は os.tmpdir() の下に作って最後に消す。claude は一時の CLAUDE_CONFIG_DIR で走らせ、
// 本物の ~/.claude と、settings の env の CLAUDE_CODE_PLUGIN_DIRS に触らせない。
// 最後に node tools/copy_shared.mts --check も走らせる。1 つでも落ちれば 1 で終わる。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const JOBS = 4
const args = process.argv.slice(2)
const only = args.filter(a => !a.startsWith('--'))

/** 版の数字で並べて一番新しい物 (文字列で比べると 2.1.9 が 2.1.304 より後になる) */
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

/** bundled-skills/<版>/<hash>/plugin-authoring/types/claude-code.d.ts の一番新しい版 */
function bundledTypes(): string | undefined {
  const base = join(tmpdir(), 'claude', 'bundled-skills')
  if (!existsSync(base)) return undefined
  const files = readdirSync(base).flatMap(v =>
    readdirSync(join(base, v), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(base, v, d.name, 'plugin-authoring', 'types', 'claude-code.d.ts'))
      .filter(existsSync)
      .map(f => ({ v, f })),
  )
  const v = newest(files.map(x => x.v))
  return files.find(x => x.v === v)?.f
}

const typesArg = args.find(a => a.startsWith('--types='))?.slice(8)
const typesOf = (mod: string) => {
  const own = join(ROOT, 'mods', mod, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')
  return typesArg ?? (existsSync(own) ? own : bundled)
}

type Run = { code: number; out: string }
function run(cmd: string, argv: string[], env: NodeJS.ProcessEnv, shell = false): Promise<Run> {
  return new Promise(resolve => {
    const opts = { cwd: ROOT, env, shell, stdio: ['ignore', 'pipe', 'pipe'] as const, windowsHide: true }
    // shell で走らせる時は 1 本の文字列で渡す (配列だと node が警告を出す)
    const p = shell ? spawn([cmd, ...argv].join(' '), opts) : spawn(cmd, argv, opts)
    let out = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (out += d))
    const timer = setTimeout(() => p.kill(), 300_000)
    p.on('error', e => (out += String(e)))
    p.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out })
    })
  })
}

const exe = findExe()
const bundled = bundledTypes()
const mods = readdirSync(join(ROOT, 'mods')).filter(m => existsSync(join(ROOT, 'mods', m, '.claude-plugin', 'plugin.json')))
const unknown = only.filter(m => !mods.includes(m))
if (unknown.length) throw new Error(`知らない mod: ${unknown.join(', ')}`)
const targets = only.length ? only : mods

const tmp = mkdtempSync(join(tmpdir(), 'check-all-'))
const baseEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
delete baseEnv.CLAUDE_CODE_PLUGIN_DIRS
const npx = (rest: string[]) => run('npx', ['-y', '-p', 'typescript@5', 'tsc', ...rest], baseEnv, true)

type Result = { mod: string; validate: Run; test: Run; tsc: Run | undefined; pass: number; fail: number }

async function check(mod: string): Promise<Result> {
  const dir = join(ROOT, 'mods', mod)
  const env = { ...baseEnv, CLAUDE_CONFIG_DIR: join(tmp, 'config', mod) }
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true })
  const validate = await run(exe, ['plugin', 'validate', dir], env)
  const test = await run(exe, ['plugin', 'test', dir], env)
  const num = (re: RegExp) => Number(re.exec(test.out)?.[1] ?? 0)
  const types = typesOf(mod)
  let tsc: Run | undefined
  if (types) {
    const config = join(tmp, 'tsc', mod, 'tsconfig.json')
    mkdirSync(join(config, '..'), { recursive: true })
    const include = [types, ...['hooks', 'tests', 'types'].map(d => join(dir, d)).filter(existsSync)].map(p => p.replaceAll('\\', '/'))
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler', strict: true, noUncheckedIndexedAccess: true,
          noEmit: true, skipLibCheck: true, jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment',
        },
        include,
      }),
    )
    tsc = await npx(['-p', `"${config}"`, '--pretty', 'false'])
  }
  return { mod, validate, test, tsc, pass: num(/^\s*(\d+) pass/m), fail: num(/^\s*(\d+) fail/m) }
}

try {
  if (!bundled && !typesArg) console.log('エンジンの型 (claude-code.d.ts) が見つからないので、tsc は型が置かれた mod だけ走らせます (--types= で渡せます)')
  // npx の初回の取り込みが並列で競合しないよう、先に 1 回だけ呼ぶ
  else await npx(['--version'])
  console.log(`claude: ${exe}\n${targets.length} 本を同時 ${JOBS} 本で調べます`)

  const results: Result[] = []
  const queue = [...targets]
  await Promise.all(
    Array.from({ length: JOBS }, async () => {
      for (let mod = queue.shift(); mod; mod = queue.shift()) {
        const r = await check(mod)
        results.push(r)
        process.stdout.write(`  ${mod} 済み\n`)
      }
    }),
  )
  results.sort((a, b) => a.mod.localeCompare(b.mod))
  const shared = await run(process.execPath, [join(ROOT, 'tools', 'copy_shared.mts'), '--check'], baseEnv)

  const isTestOk = (r: Result) => r.test.code === 0 && r.fail === 0 && r.pass > 0
  const isOk = (r: Result) => r.validate.code === 0 && isTestOk(r) && (!r.tsc || r.tsc.code === 0)
  const tscCount = (r: Run) => (r.out.match(/error TS\d+/g) ?? []).length
  const w = Math.max(4, ...results.map(r => r.mod.length))
  console.log(`\n${'mod'.padEnd(w)}  判定  validate  試験        tsc`)
  for (const r of results) {
    const test = `${r.pass}/${r.pass + r.fail}${isTestOk(r) ? '' : ' NG'}`
    const tsc = !r.tsc ? '型なし' : r.tsc.code === 0 ? 'ok' : `誤り ${tscCount(r.tsc) || '?'}`
    console.log(`${r.mod.padEnd(w)}  ${isOk(r) ? '通過' : '落ち'}  ${(r.validate.code === 0 ? 'ok' : 'NG').padEnd(8)}  ${test.padEnd(10)}  ${tsc}`)
  }
  const total = results.reduce((n, r) => n + r.pass + r.fail, 0)
  const failed = results.filter(r => !isOk(r))
  console.log(`\n通過 ${results.length - failed.length} / ${results.length} 本、試験 ${total} 件 (落ち ${results.reduce((n, r) => n + r.fail, 0)} 件)`)
  console.log(`copy_shared --check: ${shared.code === 0 ? 'ok' : 'NG'}  ${shared.out.trim().split('\n')[0]}`)

  // 落ちた mod は、どこで落ちたかの最初の数行
  const head = (out: string, re: RegExp) => {
    const lines = out.split(/\r?\n/).filter(l => l.trim())
    const hit = lines.filter(l => re.test(l))
    return (hit.length ? hit : lines.slice(-5)).slice(0, 5).map(l => `    ${l.slice(0, 200)}`).join('\n')
  }
  for (const r of failed) {
    console.log(`\n--- ${r.mod}`)
    if (r.validate.code !== 0) console.log(`  validate:\n${head(r.validate.out, /✘|error|fail/i)}`)
    if (!isTestOk(r)) console.log(`  試験:\n${head(r.test.out, /\(fail\)|error/i)}`)
    if (r.tsc && r.tsc.code !== 0) console.log(`  tsc:\n${head(r.tsc.out, /error TS/)}`)
  }
  process.exitCode = failed.length || shared.code !== 0 ? 1 : 0
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
