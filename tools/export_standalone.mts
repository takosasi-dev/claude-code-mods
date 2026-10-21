// 冒険の書(dev-rpg)とガチャ(turn-gacha)を、単体のリポジトリ claude-code-dev-rpg へ写す。
// 正本はこのリポジトリ。単体版の README・CHANGELOG・marketplace.json・.gitignore は向こうの物なので触らない。
//
//   node tools/export_standalone.mts [写し先]           写す(写し先の既定は隣の ../claude-code-dev-rpg)
//   node tools/export_standalone.mts [写し先] --check   写しが正本とずれていたら場所を出して 1 で終わる(公開の前に)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const isCheck = process.argv.includes('--check')
const TARGET = process.argv.slice(2).find(a => !a.startsWith('--')) ?? join(ROOT, '..', 'claude-code-dev-rpg')

/** 写す物。フォルダは中身ごと、ファイルはそのまま */
const DIRS = ['mods/dev-rpg', 'mods/turn-gacha']
const FILES = ['LICENSE', 'docs/images/dev-rpg.png', 'docs/images/turn-gacha.png']

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

if (!existsSync(TARGET)) {
  console.error(`写し先がありません: ${TARGET}`)
  process.exit(1)
}

const changed: string[] = []
const removed: string[] = []

const sync = (rel: string) => {
  const from = readFileSync(join(ROOT, rel))
  const to = join(TARGET, rel)
  if (existsSync(to) && readFileSync(to).equals(from)) return
  changed.push(rel)
  if (isCheck) return
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, from)
}

for (const dir of DIRS) {
  const source = walk(join(ROOT, dir)).map(f => join(dir, f))
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
    process.exit(1)
  }
  console.log('単体版は正本と同じです')
} else {
  console.log(`写しました: 書いた ${changed.length} 件・消した ${removed.length} 件 → ${TARGET}`)
}
