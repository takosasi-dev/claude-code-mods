// mod を 1 本足すたびに手で直していた所(mod-hub の分類とアイコン、mod-check の表と state の読み、marketplace.json、
// README の表 2 つ)を 1 回でやる。撮影(tools/shots.mts)と README の画像・入れ方の行は中身が要るので手で足す。
//
//   node tools/new_mod.mts <name> --cat 遊び --cmd week --ja "説明" --en "description"
//        mods/<name>/ に雛形を作って登録する。--cmd は無くてもよい(常時の mod)。予備のコマンド名は <name>
//   node tools/new_mod.mts --sync
//        mod-check の hooks/probe.ts と types/index.d.ts の「他の mod の state」を、各 mod の types/index.d.ts から作り直す
//   node tools/new_mod.mts --check
//        登録の抜けと --sync のずれを出す。あれば 1 で終わる(check_all が呼ぶ)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MODS = join(ROOT, 'mods')
const CATS = ['開発', '状況', '道具', '遊び'] as const

const P = {
  hub: join(MODS, 'mod-hub/hooks/hub.ts'),
  icons: join(MODS, 'mod-hub/hooks/icons.ts'),
  check: join(MODS, 'mod-check/hooks/check.ts'),
  probe: join(MODS, 'mod-check/hooks/probe.ts'),
  checkTypes: join(MODS, 'mod-check/types/index.d.ts'),
  market: join(ROOT, '.claude-plugin/marketplace.json'),
  readme: join(ROOT, 'README.md'),
  readmeEn: join(ROOT, 'README.en.md'),
  shots: join(ROOT, 'tools/shots.mts'),
}

// 改行は元のファイルに合わせる(CRLF のファイルを LF で書き戻すと全行が差分になる)
const readText = (p: string) => readFileSync(p, 'utf8')
const writeText = (p: string, s: string, like = '') => writeFileSync(p, like.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)
const lf = (s: string) => s.replace(/\r\n/g, '\n')

const modNames = () => readdirSync(MODS).filter(m => existsSync(join(MODS, m, '.claude-plugin/plugin.json'))).sort()

// ---- state の表を各 mod の types から読む ----

/** types/index.d.ts の interface PluginState の中、'<name>': { ... } の一番上の key */
export function stateKeys(dts: string, name: string): string[] | null {
  const s = lf(dts)
  const at = s.indexOf('interface PluginState')
  if (at < 0) return null
  const head = s.indexOf(`'${name}': {`, at)
  if (head < 0) return null
  let i = s.indexOf('{', head) + 1
  let depth = 1
  let token = ''
  const keys: string[] = []
  let inComment = false
  for (; i < s.length && depth > 0; i++) {
    const ch = s[i]
    if (inComment) {
      if (ch === '*' && s[i + 1] === '/') { inComment = false; i++ }
      continue
    }
    if (ch === '/' && s[i + 1] === '*') { inComment = true; i++; continue }
    if (ch === '/' && s[i + 1] === '/') { i = s.indexOf('\n', i); if (i < 0) break; continue }
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth++
    else if (ch === '}' || ch === ')' || ch === ']' || (ch === '>' && s[i - 1] !== '=')) depth--
    else if (depth === 1 && ch === ':' && /^[A-Za-z_$][\w$]*\??$/.test(token.trim())) keys.push(token.trim().replace(/\?$/, ''))
    if (depth === 1 && /[\n;]/.test(ch ?? '')) token = ''
    else if (depth === 1 && ch !== ':') token += ch
    else if (depth !== 1) token = ''
  }
  return keys
}

function stateTable(): [string, string[]][] {
  return modNames()
    .filter(m => m !== 'mod-check')
    .map(m => {
      const p = join(MODS, m, 'types/index.d.ts')
      return [m, existsSync(p) ? stateKeys(readText(p), m) : null] as const
    })
    .filter((x): x is [string, string[]] => x[1] !== null && x[1].length > 0)
}

const PROBE_HEAD = '  return {\n'
const PROBE_TAIL = '\n  }\n}\n'
const TYPES_MARK = '    // ここから下は、書かれたかどうか(version)だけを見る他の mod の state\n'
const TYPES_TAIL = '\n  }\n}\n'

function synced(): { probe: string; types: string } {
  const table = stateTable()
  const probe = lf(readText(P.probe))
  const pa = probe.indexOf(PROBE_HEAD) + PROBE_HEAD.length
  const pb = probe.indexOf(PROBE_TAIL, pa)
  const rows = table.map(([m, keys]) => `  '${m}': [${keys.map(k => `() => $.state.get({ plugin: '${m}', key: '${k}' })`).join(', ')}],`)
  const types = lf(readText(P.checkTypes))
  const ta = types.indexOf(TYPES_MARK) + TYPES_MARK.length
  const tb = types.lastIndexOf(TYPES_TAIL)
  const lines = table.map(([m, keys]) => `    '${m}': { ${keys.map(k => `${k}: unknown`).join('; ')} }`)
  if (pa < PROBE_HEAD.length || pb < 0 || ta < TYPES_MARK.length || tb < ta) throw new Error('probe.ts か mod-check の types の形が変わりました')
  return { probe: probe.slice(0, pa) + rows.join('\n') + probe.slice(pb), types: types.slice(0, ta) + lines.join('\n') + types.slice(tb) }
}

// ---- 登録の抜け ----

const has = {
  hub: (m: string, s: string) => s.includes(`'${m}': '`),
  icons: (m: string, s: string) => s.includes(`'${m}': (c, a) =>`),
  check: (m: string, s: string) => s.includes(`{ name: '${m}',`),
  market: (m: string, s: string) => s.includes(`"name": "${m}"`),
  readme: (m: string, s: string) => s.includes(`\n| ${m} |`),
  shots: (m: string, s: string) => s.includes(`'${m}': `) || s.includes(`  ${m}: `),
}

// 表に載せないと決めている物。mod-hub は自分を並べない
const ALWAYS = ['reply-frame', 'danger-frame', 'long-turn-toast']
const NOT_IN = { hub: ['mod-hub', ...ALWAYS], icons: ['mod-hub', ...ALWAYS], shots: [...ALWAYS, 'devlog-pane', 'usage-pane'] } as Record<string, string[]>

export function gaps(): string[] {
  const text = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, lf(readText(p))])) as Record<keyof typeof P, string>
  const out: string[] = []
  for (const m of modNames()) {
    for (const [where, test, label] of [
      ['hub', has.hub, 'mod-hub の CATEGORY'],
      ['icons', has.icons, 'mod-hub の ICONS'],
      ['check', has.check, 'mod-check の MODS'],
      ['market', has.market, 'marketplace.json'],
      ['readme', has.readme, 'README.md の表'],
      ['readmeEn', has.readme, 'README.en.md の表'],
      ['shots', has.shots, 'tools/shots.mts'],
    ] as const) {
      if ((NOT_IN[where] ?? []).includes(m)) continue
      if (!test(m, text[where])) out.push(`${m}: ${label} に無い`)
    }
  }
  const s = synced()
  if (s.probe !== lf(readText(P.probe))) out.push('mod-check の hooks/probe.ts が各 mod の types とずれている(--sync で直る)')
  if (s.types !== lf(readText(P.checkTypes))) out.push('mod-check の types/index.d.ts が各 mod の types とずれている(--sync で直る)')
  const probed = new Set(stateTable().map(([m]) => m))
  for (const m of modNames().filter(n => n !== 'mod-check')) {
    const row = new RegExp(`\\{ name: '${m}',[^}]*hasState: (true|false)`).exec(text.check)
    if (row && (row[1] === 'true') !== probed.has(m)) out.push(`${m}: mod-check の MODS の hasState が types と合わない`)
  }
  return out
}

// ---- 雛形 ----

// 書き換えはいったん pending にためて、全部の錨が見つかってから書く(途中で止まると半端に残るため)
const pending = new Map<string, string>()
const current = (path: string) => pending.get(path) ?? lf(readText(path))

function insertBefore(path: string, anchor: string, after: string, line: string) {
  const s = current(path)
  const a = s.indexOf(anchor)
  if (a < 0) throw new Error(`${path} に ${anchor} がありません`)
  const b = s.indexOf(after, a)
  if (b < 0) throw new Error(`${path} の ${anchor} の終わりが見つかりません`)
  pending.set(path, s.slice(0, b) + line + s.slice(b))
}

function scaffold(name: string, cat: string, cmd: string, ja: string, en: string) {
  const dir = join(MODS, name)
  if (existsSync(dir)) throw new Error(`もうあります: ${dir}`)
  const title = ja.split(/[。、]/)[0] || name
  const files: Record<string, string> = {
    '.claude-plugin/plugin.json': JSON.stringify({ name, version: '0.1.0', description: ja, author: { name: 'takosasi-dev' }, types: './types/index.d.ts' }, null, 2) + '\n',
    'tsconfig.json': '{\n  "extends": "./.claude-plugin/types/tsconfig.json"\n}\n',
    'hooks/hooks.json': '{ "modules": ["./register.tsx"] }\n',
    'types/index.d.ts': `/** 開いた回数 */\nexport type Opened = number\n\ndeclare module 'claude-code' {\n  interface PluginState {\n    '${name}': {\n      opened: Opened\n    }\n  }\n}\n`,
    'hooks/register.tsx': [
      `import { atom, read, update } from 'claude-code'`,
      `import type { EngineInterface, Register } from 'claude-code'`,
      ``,
      `import { followTheme, readTheme } from './style'`,
      ``,
      `const PANE = '${name}'`,
      `const TITLE = ${JSON.stringify(title)}`,
      `const DESCRIPTION = ${JSON.stringify(title + 'のペインを開く')}`,
      ``,
      `const OPENED = atom({ plugin: '${name}', key: 'opened' } as const, 0)`,
      ``,
      `let ownsMain = false`,
      ``,
      `async function openPane($: EngineInterface) {`,
      `  await update($, OPENED, n => n + 1)`,
      `  await $.ui.open({ id: PANE, title: TITLE })`,
      `  return { text: '${name}: ' + TITLE + 'を開きました。' }`,
      `}`,
      ``,
      `export const register: Register = on => {`,
      `  followTheme(on)`,
      ``,
      `  on('session.start', async ($, e, next) => {`,
      `    const started = await next(e)`,
      ...(cmd
        ? [
            `    // /${cmd} が拒まれたら /${name} にする`,
            `    const got = await $.command.register({ name: '${cmd}', description: DESCRIPTION }).catch(() => undefined)`,
            `    ownsMain = got?.command === '${cmd}'`,
            `    if (!ownsMain) await $.command.register({ name: '${name}', description: DESCRIPTION }).catch(() => {})`,
          ]
        : [`    await $.command.register({ name: '${name}', description: DESCRIPTION }).catch(() => {})`]),
      `    await readTheme($)`,
      `    return started`,
      `  })`,
      ``,
      ...(cmd ? [`  on('command.run', { command: '${cmd}' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))`] : []),
      // 本来の名前を持てた時は予備名を登録していないので、同じ名前の別のコマンドを横取りしない
      cmd
        ? `  on('command.run', { command: '${name}' }, ($, e, next) => (ownsMain ? next(e) : openPane($))).catch(($, e, next) => next(e))`
        : `  on('command.run', { command: '${name}' }, openPane)`,
      ``,
      `  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {`,
      `    const { Box, Text } = $.ui.resolve(e)`,
      `    const opened = read($, OPENED)`,
      `    return (`,
      `      <Box flexDirection="column">`,
      `        <Text>{TITLE}</Text>`,
      `        <Text dimColor>{\`開いた回数 \${opened}\`}</Text>`,
      `      </Box>`,
      `    )`,
      `  })`,
      `}`,
      ``,
    ].join('\n'),
    [`tests/${name}.test.tsx`]: [
      `import { expect, test } from 'claude-code/testing'`,
      ``,
      `test('/${cmd || name} でペインが開く', async ($, on) => {`,
      `  on('session.start', (_$, e) => ({ cwd: e.cwd }))`,
      `  on('command.register', (_$, e) => ({ value: { command: e.name } }))`,
      `  on('ui.open', () => ({ value: { isPlaced: true as const } }))`,
      `  await $.session.start({ cwd: 'C:/work', surface: 'vscode', isInteractive: true })`,
      `  const r = await $.command.run({ command: '${cmd || name}', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })`,
      `  expect(r.text).toContain('${name}')`,
      `})`,
      ``,
    ].join('\n'),
  }
  insertBefore(P.hub, 'const CATEGORY: Record<string, Category> = {', '\n}', `\n  '${name}': '${cat}',`)
  insertBefore(P.icons, 'const ICONS: Record<string, (c: string, a: string) => string> = {', '\n}',
    `\n  // 仮の絵。描き直す\n  '${name}': (c, a) => \`<rect x="7" y="7" width="18" height="18" rx="4" \${line(c)}/><circle cx="16" cy="16" r="3" fill="\${a}"/>\`,`)
  const row = `  { name: '${name}', category: '${cat}', ${cmd ? `main: '${cmd}', spare: '${name}', ` : ''}hasState: true },\n`
  const check = current(P.check)
  const next = /^  \{ name: '([^']+)'/gm
  let at = -1
  for (const m of check.matchAll(next)) if ((m[1] ?? '') > name && m.index! > check.indexOf('export const MODS')) { at = m.index!; break }
  if (at < 0) insertBefore(P.check, 'export const MODS', '\n]', `\n${row.trimEnd()}`)
  else pending.set(P.check, check.slice(0, at) + row + check.slice(at))
  // marketplace.json は書き換えた後も JSON として読めるかを確かめる
  insertBefore(P.market, '"plugins"', '\n  ]', `,\n    { "name": "${name}", "source": "./mods/${name}", "description": ${JSON.stringify(ja)} }`)
  JSON.parse(pending.get(P.market) ?? '')
  const call = cmd ? `\`/${cmd}\`` : '常時'
  insertBefore(P.readme, '| mod | 呼び方 | 何をするか |', '\n\n', `\n| ${name} | ${call} | ${ja} |`)
  insertBefore(P.readmeEn, '| mod | How to open | What it does |', '\n\n', `\n| ${name} | ${cmd ? `\`/${cmd}\`` : 'Always on'} | ${en} |`)

  // ここまでで錨が全部見つかったので書く
  for (const d of ['.claude-plugin', 'hooks', 'tests', 'types']) mkdirSync(join(dir, d), { recursive: true })
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text)
  copyFileSync(join(ROOT, 'shared/style.ts'), join(dir, 'hooks/style.ts'))
  for (const [path, text] of pending) writeText(path, text, readText(path))
}

// ---- 入口 ----

if (import.meta.main) {
  const args = process.argv.slice(2)
  const opt = (k: string) => {
    const i = args.indexOf(k)
    const v = i >= 0 ? (args[i + 1] ?? '') : ''
    return v.startsWith('--') ? '' : v
  }
  if (args[0] === '--check') {
    const g = gaps()
    for (const line of g) console.log(line)
    console.log(g.length === 0 ? 'new_mod --check: ok  登録の抜けはありません' : `new_mod --check: ${g.length} 件`)
    process.exit(g.length === 0 ? 0 : 1)
  }
  if (args[0] !== '--sync') {
    const name = args[0] ?? ''
    const cat = opt('--cat')
    if (!/^[a-z][a-z0-9-]*$/.test(name) || name.startsWith('claude-')) throw new Error('名前は英小文字・数字・- で、claude- で始めない')
    if (!(CATS as readonly string[]).includes(cat)) throw new Error(`--cat は ${CATS.join('・')} のどれか`)
    if (!opt('--ja') || !opt('--en')) throw new Error('--ja と --en の説明が要ります')
    if (opt('--cmd') && !/^[a-z][a-z0-9-]*$/.test(opt('--cmd'))) throw new Error('--cmd は英小文字・数字・- だけ')
    if (/[|\r\n]/.test(opt('--ja') + opt('--en'))) throw new Error('説明に | と改行は使えません(README の表が崩れる)')
    scaffold(name, cat, opt('--cmd'), opt('--ja'), opt('--en'))
    console.log(`mods/${name}/ を作って登録しました。アイコン・撮影(tools/shots.mts)・README の画像は手で足してください`)
  }
  const s = synced()
  writeText(P.probe, s.probe, readText(P.probe))
  writeText(P.checkTypes, s.types, readText(P.checkTypes))
  console.log('mod-check の probe.ts と types を作り直しました')
}
