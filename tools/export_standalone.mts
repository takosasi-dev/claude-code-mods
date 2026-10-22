// 冒険の書(dev-rpg)とガチャ(turn-gacha)を、単体のリポジトリ claude-code-dev-rpg へ写す。
// 正本はこのリポジトリの HEAD(コミットした物だけ。作業中の変更や追跡していないファイルは写さない)。
// 単体版の README・CHANGELOG・marketplace.json・.gitignore は向こうの物なので触らない。
//
//   node tools/export_standalone.mts [写し先]           写す(写し先の既定は隣の ../claude-code-dev-rpg)
//   node tools/export_standalone.mts [写し先] --check   写しが正本とずれていたら場所を出して 1 で終わる(公開の前に)
//
// 写す前に、写し先が単体版のリポジトリで、まだコミットしていない変更が無いことを確かめる。
// tools/sync_public.py(私用だけにある)があれば、写す物を同じ決まり(作者のパス・名前・秘密の形)で見て、当たれば写さない。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const isCheck = process.argv.includes('--check')
const TARGET = process.argv.slice(2).find(a => !a.startsWith('--')) ?? join(ROOT, '..', 'claude-code-dev-rpg')
const ORIGIN = 'takosasi-dev/claude-code-dev-rpg'

/** 写す物。フォルダは中身ごと、ファイルはそのまま */
const DIRS = ['mods/dev-rpg', 'mods/turn-gacha']
const FILES = ['LICENSE', 'docs/images/dev-rpg.png', 'docs/images/turn-gacha.png']

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'safe.directory=*', '-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024, windowsHide: true })

/** エンジンが読み込むたびに書く型。写さない */
const isSkipped = (rel: string) => rel.split(/[\\/]/).join('/').includes('.claude-plugin/types')

function walk(base: string, dir = base): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const full = join(dir, d.name)
    const rel = relative(base, full)
    if (isSkipped(rel)) return []
    return d.isDirectory() ? walk(base, full) : [rel]
  })
}

/** 写し先を確かめる。だめなら理由 */
function targetProblem(): string | undefined {
  if (!existsSync(TARGET)) return `写し先がありません: ${TARGET}`
  if (isCheck) return undefined
  const url = git(TARGET, ['remote', 'get-url', 'origin']).toString().trim().replace(/\/$/, '').replace(/\.git$/, '')
  if (!url.endsWith(`/${ORIGIN}`) && !url.endsWith(`:${ORIGIN}`)) return `写し先 ${TARGET} の origin が ${url || '(無し)'} です。${ORIGIN} ではないので止めます`
  // 写すと戻せなくなるので、まだコミットしていない変更があれば止める
  if (git(TARGET, ['status', '--porcelain']).toString().trim()) return `写し先 ${TARGET} にコミットしていない変更があります。先にコミットするか片付けてください`
  return undefined
}

/** HEAD の中身を staged に出す */
function stage(staged: string) {
  const paths = git(ROOT, ['ls-tree', '-r', '--name-only', 'HEAD', '--', ...DIRS, ...FILES])
    .toString()
    .split('\n')
    .filter(p => p && !isSkipped(p))
  for (const p of FILES) if (!paths.includes(p)) throw new Error(`HEAD に ${p} がありません`)
  for (const rel of paths) {
    const to = join(staged, rel)
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, git(ROOT, ['show', `HEAD:${rel}`]))
  }
}

/** 私用だけにある検査で見る。当たれば出力 */
function scanProblem(staged: string): string | undefined {
  const checker = join(ROOT, 'tools', 'sync_public.py')
  if (!existsSync(checker)) return undefined
  try {
    execFileSync('python', ['-B', checker, '--scan', staged], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true })
    return undefined
  } catch (e) {
    return `作者の環境のパス・名前・秘密の形が残っているので写しません:\n${String((e as { stdout?: Buffer }).stdout ?? e)}`
  }
}

function run(staged: string): number {
  const problem = targetProblem()
  if (problem) {
    console.error(problem)
    return 1
  }
  stage(staged)
  const found = scanProblem(staged)
  if (found) {
    console.error(found)
    return 1
  }

  const changed: string[] = []
  const removed: string[] = []
  const sync = (rel: string) => {
    const from = readFileSync(join(staged, rel))
    const to = join(TARGET, rel)
    if (existsSync(to) && readFileSync(to).equals(from)) return
    changed.push(rel)
    if (isCheck) return
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, from)
  }
  for (const dir of DIRS) {
    const source = walk(join(staged, dir)).map(f => join(dir, f))
    source.forEach(sync)
    // 正本で消した物は写し先からも消す
    const kept = new Set(source)
    for (const rel of walk(join(TARGET, dir)).map(f => join(dir, f))) {
      if (kept.has(rel)) continue
      removed.push(rel)
      if (!isCheck) rmSync(join(TARGET, rel))
    }
  }
  FILES.forEach(sync)

  if (isCheck) {
    if (changed.length + removed.length > 0) {
      console.error(`単体版が正本とずれています:\n${[...changed, ...removed.map(r => `${r} (正本に無い)`)].join('\n')}\nnode tools/export_standalone.mts で写してください`)
      return 1
    }
    console.log('単体版は正本と同じです')
  } else {
    console.log(`写しました: 書いた ${changed.length} 件・消した ${removed.length} 件 → ${TARGET}`)
  }
  return 0
}

const staged = mkdtempSync(join(tmpdir(), 'standalone-'))
try {
  process.exitCode = run(staged)
} finally {
  rmSync(staged, { recursive: true, force: true })
}
