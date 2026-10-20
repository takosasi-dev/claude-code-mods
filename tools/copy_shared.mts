// shared/style.ts(正本)を各 mod の hooks/style.ts に写す。mod は 1 本ずつ別に入れる物なので、共通の見た目は写して持つ。
//
//   node tools/copy_shared.mts           写す
//   node tools/copy_shared.mts --check   写しが正本とずれていたら名前を出して 1 で終わる(公開の前に)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SOURCE = readFileSync(join(ROOT, 'shared', 'style.ts'), 'utf8')
const isCheck = process.argv.includes('--check')

const mods = readdirSync(join(ROOT, 'mods')).filter(m => existsSync(join(ROOT, 'mods', m, 'hooks')))
const stale: string[] = []
for (const mod of mods) {
  const target = join(ROOT, 'mods', mod, 'hooks', 'style.ts')
  const now = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  if (now === SOURCE) continue
  if (isCheck) stale.push(mod)
  else writeFileSync(target, SOURCE)
}

if (isCheck && stale.length > 0) {
  console.error(`hooks/style.ts が正本とずれています: ${stale.join(', ')}\nnode tools/copy_shared.mts で写してください`)
  process.exit(1)
}
console.log(isCheck ? `${mods.length} 本とも正本と同じです` : `${mods.length} 本に写しました`)
