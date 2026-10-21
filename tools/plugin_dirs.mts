// mod の一覧を、入れ方に合わせた形で出す。一覧は marketplace.json の順に、mods/ にあって marketplace.json に
// まだ無い物(作りかけの新しい mod)を足したもの。mod-hub・toast-inbox・mod-check を先頭にする(どれも後から読み込まれる mod を見るため)。何も書き換えない。
//
//   node tools/plugin_dirs.mts [clone 先]   CLAUDE_CODE_PLUGIN_DIRS に入れる値を出す(clone 先の既定はこのリポジトリ)
//                                           区切りは Windows なら ; ほかは :。各要素は <clone 先>/mods/<mod> の絶対パス
//   node tools/plugin_dirs.mts --readme      README の「入れ方」に貼る、カテゴリーごとの install の行と全部入れるループ
//   node tools/plugin_dirs.mts --readme --en 同じ物を README.en.md 向けに
//
// カテゴリーは mods/mod-hub/hooks/hub.ts の CATEGORY 表から読む。表に無い物(mod-hub 自身を除く)は「常時」に入れる。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MARKET = 'takosasi-dev/claude-code-mods'
const FIRST = ['mod-hub', 'toast-inbox', 'mod-check']

const listed: string[] = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins.map((p: { name: string }) => p.name)
const extra = readdirSync(join(ROOT, 'mods')).filter(m => existsSync(join(ROOT, 'mods', m, 'hooks', 'hooks.json')) && !listed.includes(m)).sort()
const all = [...FIRST, ...[...listed, ...extra].filter(m => !FIRST.includes(m))]
if (extra.length > 0) console.error(`marketplace.json にまだ無い mod: ${extra.join(', ')}(マーケットプレイスから入れるには marketplace.json に足す)`)

const args = process.argv.slice(2)

if (!args.includes('--readme')) {
  const base = resolve(args.find(a => !a.startsWith('--')) ?? ROOT)
  const dirs = all.map(m => join(base, 'mods', m))
  const missing = dirs.filter(d => !existsSync(d))
  if (missing.length > 0) console.error(`見つからないフォルダ: ${missing.join(', ')}`)
  console.log(dirs.join(delimiter))
  process.exit(0)
}

// hub.ts の `'git-pane': '開発', ...` を拾う
const hub = readFileSync(join(ROOT, 'mods', 'mod-hub', 'hooks', 'hub.ts'), 'utf8')
const table = hub.match(/const CATEGORY[^{]*\{([^}]*)\}/)?.[1]
if (!table) throw new Error('hub.ts の CATEGORY 表が読めません')
const category = new Map([...table.matchAll(/'([\w-]+)':\s*'([^']+)'/g)].map(m => [m[1], m[2]]))

const en = args.includes('--en')
const GROUPS = ['開発', '状況', '道具', '遊び', '常時']
const LABEL: Record<string, string> = en
  ? { 開発: 'Dev', 状況: 'Status', 道具: 'Tools', 遊び: 'Fun', 常時: 'Always on' }
  : { 開発: '開発', 状況: '状況', 道具: '道具', 遊び: '遊び', 常時: '常時' }
const line = (m: string) => `claude plugin install ${m} --marketplace ${MARKET}`
const block = (mods: string[]) => ['```sh', ...mods.map(line), '```'].join('\n')

const rest = all.filter(m => !FIRST.includes(m))
const out: string[] = [en ? `**First** (${FIRST.join(', ')})` : `**最初に**(${FIRST.join('・')})`, '', block(FIRST), '']
for (const g of GROUPS) {
  const mods = rest.filter(m => (category.get(m) ?? '常時') === g)
  if (mods.length === 0) continue
  const count = en ? `${mods.length} mod${mods.length > 1 ? 's' : ''}` : `${mods.length} 本`
  out.push(`<details><summary>${LABEL[g]}${en ? ' ' : ''}(${count}): ${mods.join(en ? ', ' : '・')}</summary>`, '', block(mods), '', '</details>', '')
}
const names = all.join(' ')
out.push(en ? `All ${all.length} at once (bash / zsh):` : `全部(${all.length} 本)をまとめて(bash / zsh):`, '')
out.push('```sh', `for m in ${names}; do claude plugin install "$m" --marketplace ${MARKET}; done`, '```', '')
out.push(en ? 'PowerShell:' : 'PowerShell:', '')
out.push('```powershell', `foreach ($m in ${all.map(m => `'${m}'`).join(',')}) { claude plugin install $m --marketplace ${MARKET} }`, '```')
console.log(out.join('\n'))
