// 外に出す操作の見分けと、確認の読み取り、ペインの SVG と文。どれも純関数
import type { GuardEntry, GuardOutcome, GuardPermit } from '../types'
import { C, HEADER_H, clean, esc, frame, header, panel, short } from './style'
import { type Shell, type Word, baseName, parse } from './words'

export const LOG_MAX = 20

// ── 外に出す操作の見分け。語に分けて読む (引用符・コメント・ヒアドキュメントの中の言葉を拾わない)

// 頭に付いても中身は後ろのコマンド (env X=1 git push、then git push など)。値は値を 1 語取るオプション
const PREFIX = new Map<string, readonly string[]>([
  ['env', ['-u', '-C', '--unset', '--chdir']],
  ['sudo', ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-D']],
  ['xargs', ['-n', '-I', '-L', '-P', '-d', '-s', '-E', '-a']],
  ['npx', ['-p', '--package']],
  ['bunx', ['-p', '--package']],
  ['time', ['-f', '-o']],
  ['nice', ['-n']],
  ['timeout', ['-s', '-k', '--signal', '--kill-after']],
  ['exec', ['-a']],
  ...['command', 'builtin', 'nohup', 'pnpx', 'call', '.', '!', 'if', 'elif', 'then', 'else', 'do', 'while', 'until'].map(n => [n, []] as [string, readonly string[]]),
])

/** 頭の VAR=値・前置き (env・sudo・then・! など) を飛ばした、コマンドの名前の位置 */
function headAt(words: Word[]) {
  let k = 0
  while (k < words.length) {
    if (/^[A-Za-z_]\w*=/.test(words[k]?.bare ?? '')) {
      k++
      continue
    }
    const name = baseName(words[k]?.text ?? '')
    const takes = PREFIX.get(name)
    if (takes === undefined) break
    k++
    while ((words[k]?.text ?? '').startsWith('-')) k += takes.includes(words[k]?.text ?? '') ? 2 : 1
    // timeout 10 git push の 10
    if (name === 'timeout') k++
  }
  return k
}

/** 入れ子のシェル (bash -c "..."・eval・powershell -Command "..."・iex・cmd /c) の中身と、そのシェル */
function innerOf(name: string, args: Word[]): { command: string; shell: Shell } | undefined {
  const after = (re: RegExp) => {
    const k = args.findIndex(w => re.test(w.text))
    return k < 0 ? undefined : args.slice(k + 1).map(w => w.text).join(' ')
  }
  const as = (command: string | undefined, shell: Shell) => (command === undefined ? undefined : { command, shell })
  if (name === 'powershell' || name === 'pwsh') return as(after(/^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?:?$/i), 'powershell')
  if (name === 'cmd') return as(after(/^\/[ck]$/i), 'cmd')
  if (name === 'bash' || name === 'sh' || name === 'zsh' || name === 'dash') return as(after(/^-\w*c$/), 'bash')
  if (name === 'eval') return { command: args.map(w => w.text).join(' '), shell: 'bash' }
  if (name === 'iex' || name === 'invoke-expression') return { command: args.filter(w => !/^-c(?:ommand)?:?$/i.test(w.text)).map(w => w.text).join(' '), shell: 'powershell' }
  return undefined
}

/** 区切りの並び。入れ子のシェルの中身は、その場所に広げる */
function flat(command: string, shell: Shell, depth = 0): Word[][] {
  return parse(command, shell).flatMap(ws => {
    const at = headAt(ws)
    const inner = depth < 3 ? innerOf(baseName(ws[at]?.text ?? ''), ws.slice(at + 1)) : undefined
    return inner ? flat(inner.command, inner.shell, depth + 1) : [ws]
  })
}

/** オプション (と、その値) を飛ばした残りの語 */
const positional = (args: Word[], takes: readonly string[]) => {
  const out: string[] = []
  for (let k = 0; k < args.length; k++) {
    const t = args[k]?.text ?? ''
    if (!t.startsWith('-')) out.push(t)
    else if (takes.includes(t)) k++
  }
  return out
}

// git のサブコマンドの前で値を 1 語取るオプション
const GIT_ARGS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source'])
// Start-Process で値を 1 語取るオプション (-FilePath と -ArgumentList の値は読む側)
const START_ARGS = ['-windowstyle', '-workingdirectory', '-redirectstandardoutput', '-redirectstandarderror', '-redirectstandardinput', '-credential', '-verb']
const PKG_ARGS: Record<string, readonly string[]> = { npm: ['--prefix', '-C', '-w', '--workspace'], pnpm: ['-C', '--dir', '--filter', '-F'], yarn: ['--cwd'] }

/** git push の中身: push の後ろの語と、-C の場所 */
type Push = { args: Word[]; dirs: string[] }
type Seen = { label: string; push?: Push }

function gitSeen(args: Word[], depth: number): Seen | undefined {
  const dirs: string[] = []
  const alias = new Map<string, string>()
  let k = 0
  for (; k < args.length; k++) {
    const t = args[k]?.text ?? ''
    if (!t.startsWith('-')) break
    if (!GIT_ARGS.has(t)) continue
    const v = args[++k]?.text ?? ''
    if (t === '-C') dirs.push(v)
    const m = t === '-c' ? /^alias\.([^=]+)=([\s\S]*)$/i.exec(v) : null
    if (m) alias.set((m[1] ?? '').toLowerCase(), m[2] ?? '')
  }
  let sub = args[k]?.text ?? ''
  let rest = args.slice(k + 1)
  const a = alias.get(sub.toLowerCase())
  if (a?.startsWith('!')) {
    // シェルの別名 (alias.x='!git push') は中身をコマンドとして読む
    const cmd = [a.slice(1), ...rest.map(w => w.text)].join(' ')
    return depth < 3 ? flat(cmd, 'bash', depth + 1).map(ws => seenIn(ws, depth + 1)).find(s => s !== undefined) : undefined
  }
  if (a !== undefined) {
    const words = parse(a, 'bash')[0] ?? []
    sub = words[0]?.text ?? ''
    rest = [...words.slice(1), ...rest]
  }
  return sub === 'push' ? { label: 'git push', push: { args: rest, dirs } } : undefined
}

/** 1 つの区切りが外に出す操作か */
function seenIn(words: Word[], depth: number): Seen | undefined {
  const at = headAt(words)
  const name = baseName(words[at]?.text ?? '')
  const args = words.slice(at + 1)
  if (name === 'git') return gitSeen(args, depth)
  if ((name === 'start-process' || name === 'saps') && depth < 3) {
    // Start-Process git -ArgumentList push は、-FilePath と -ArgumentList の中身を 1 つのコマンドとして読む
    const isValue = (prev: string) => prev.length > 3 && START_ARGS.some(o => o.startsWith(prev.toLowerCase()))
    return seenIn(args.filter((w, k) => !w.text.startsWith('-') && w.text !== '@' && !isValue(args[k - 1]?.text ?? '')), depth + 1)
  }
  if (name === 'gh') {
    const [a, b] = positional(args, ['-R', '--repo'])
    if (a === 'release' && /^(?:create|upload|edit|delete)$/.test(b ?? '')) return { label: 'gh release' }
    if (a === 'repo' && b === 'create') return { label: 'gh repo create' }
  }
  if (Object.hasOwn(PKG_ARGS, name)) {
    const [a, b] = positional(args, PKG_ARGS[name] ?? [])
    if (a === 'publish' || (name === 'yarn' && a === 'npm' && b === 'publish')) return { label: 'npm publish' }
  }
  return undefined
}

/** 外に出す操作を前から順に。index は区切りの並び (segs) の何番目か */
function seenAll(command: string, shell: Shell) {
  const segs = flat(command, shell)
  return { segs, seen: segs.flatMap((ws, index) => {
    const s = seenIn(ws, 0)
    return s ? [{ ...s, index }] : []
  }) }
}

/** 外に出す操作なら、その名前 (git push など)。違えば無し。shell は Bash のツールなら bash、PowerShell なら powershell */
export function outwardOf(command: string, shell: Shell = 'bash'): string | undefined {
  return seenAll(command, shell).seen[0]?.label
}

/** 最初の git push (push の後ろの語・-C の場所) と、それより前の区切り */
function pushAt(command: string, shell: Shell) {
  const { segs, seen } = seenAll(command, shell)
  const p = seen.find(s => s.label === 'git push')
  return p ? { before: segs.slice(0, p.index), push: p.push } : undefined
}

/** コマンドに git push があるか (公開前のチェックをするか) */
export const hasPush = (command: string, shell: Shell = 'bash') => pushAt(command, shell) !== undefined

// ── 公開前のチェック (git push の時だけ)

const CD = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location'])
const isAbsolute = (dir: string) => /^[A-Za-z]:[\\/]/.test(dir) || dir.startsWith('/') || dir.startsWith('\\\\')
const joinDir = (base: string | undefined, dir: string) => (base === undefined || isAbsolute(dir) ? dir : `${base.replace(/[\\/]+$/, '')}/${dir}`)

/**
 * push を読むリポジトリの場所。push より前の cd / Set-Location / pushd を順にたどり、push の git -C <dir> を足した物。
 * 書かれていなければ無し (セッションの場所で読む)
 */
export function repoDirOf(command: string, shell: Shell = 'bash'): string | undefined {
  const p = pushAt(command, shell)
  if (!p) return undefined
  let dir: string | undefined
  for (const ws of p.before) {
    const at = headAt(ws)
    if (!CD.has(baseName(ws[at]?.text ?? ''))) continue
    const to = ws.slice(at + 1).find(w => !/^(?:\/d|-(?:literal)?path)$/i.test(w.text))?.text
    if (to !== undefined) dir = joinDir(dir, to)
  }
  for (const c of p.push?.dirs ?? []) dir = joinDir(dir, c)
  return dir
}

/** 場所をセッションの場所から決める。/d/x の形は Windows では D:/x にする */
export function resolveDir(dir: string | undefined, cwd: string) {
  if (dir === undefined || dir === '' || dir === '.') return cwd
  const isWindows = /^[A-Za-z]:/.test(cwd)
  const msys = /^\/([A-Za-z])(\/|$)/.exec(dir)
  if (isWindows && msys) return `${msys[1]?.toUpperCase()}:/${dir.slice(3)}`
  if (isAbsolute(dir)) return dir
  return `${cwd.replace(/[\\/]+$/, '')}/${dir}`
}

// git push で値を 1 語取るオプション
const PUSH_ARGS = ['-o', '--push-option', '--repo', '--receive-pack', '--exec']

/**
 * 送るコミットの範囲。push の引数からリモートと refspec を読み、送る ref から、そのリモートに既にある物を除く
 * (git push origin main なら main --not --remotes=origin)。--tags / --all ならブランチとタグ全部。
 * 読めなければ HEAD からどのリモートにも無い物
 */
export function rangeOf(command: string, shell: Shell = 'bash'): string[] {
  const args = pushAt(command, shell)?.push?.args ?? []
  const [remote, ...refs] = positional(args, PUSH_ARGS)
  // URL やパスのリモートは remotes の名前に無いので、どのリモートにも無い物にする
  const isName = remote !== undefined && /^[\w.-]+$/.test(remote) && !remote.startsWith('-') && !args.some(w => w.text.startsWith('--repo'))
  const not = ['--not', isName ? `--remotes=${remote}` : '--remotes']
  if (args.some(w => /^--(?:tags|all|mirror|branches)$/.test(w.text))) return ['--branches', '--tags', ...not]
  // git push origin tag v1 の tag は語の飾り
  const srcs = refs
    .filter((r, k) => !(r === 'tag' && k < refs.length - 1))
    .map(r => r.replace(/^\+/, '').split(':')[0] ?? '')
    .filter(s => s !== '')
  // - で始まる物は git log のオプションになるので使わない
  return srcs.length > 0 && srcs.every(s => !s.startsWith('-')) ? [...srcs, ...not] : ['HEAD', ...not]
}

/** git log に渡す書式。コミットの頭に \x01、作者名・メール・コミッター名・メールを \x00 で区切る */
export const LOG_FORMAT = '--format=%x01%H%x00%an%x00%ae%x00%cn%x00%ce'

export type CheckConfig = { allowed: string[]; words: string[] }

/** 設定の「a, b、c」を分ける */
export const listOf = (raw: unknown) =>
  String(raw ?? '')
    .split(/[,、\n]/)
    .map(s => s.trim())
    .filter(s => s !== '')

const isAllowedEmail = (email: string, allowed: string[]) => {
  const e = email.toLowerCase()
  if (/noreply|no-reply/.test(e)) return true
  if (/@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|localhost|test|invalid|example)$/.test(e)) return true
  return allowed.some(a => {
    const x = a.toLowerCase()
    return x.startsWith('@') ? e.endsWith(x) : e === x
  })
}

// 見本でよく使う名前 (<ドライブ>:\Users\<名前> の <名前> がこれなら気にしない)
const PLACEHOLDER = /^(?:public|default|default user|all users|user|users|username|yourname|your-name|your_name|name|me|you|someone|runner|shared|admin|administrator|example|foo|bar|xxx+|\.\.\.|…)$/i
const HOME = /(?:\b[A-Za-z]:[\\/]+|(?<![\w.])\/[A-Za-z]\/|(?<![\w.])\/)(?:Users|home)[\\/]+([^\\/\s"'`<>:*?|,;)\]}]+)/g
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g

/** 人に見せる時は頭 2 字だけ残す */
export const mask = (s: string) => (s.length <= 2 ? `${s}***` : `${s.slice(0, 2)}***`)
const maskEmail = (e: string) => {
  const [local = '', domain = ''] = e.split('@')
  return `${mask(local)}@${domain}`
}

type Hit = { what: string; files: Set<string>; commits: Set<string> }

/**
 * git log -p の出力から、公開前に気になる所を拾う。作者・コミッターのメールが noreply でない、
 * 足した行に個人のメール・ユーザー名入りのパス・指定した言葉がある。1 行ずつの文で返す (最大 8)
 */
export function scanPush(out: string, cfg: CheckConfig): string[] {
  const hits = new Map<string, Hit>()
  const hit = (key: string, what: string, commit: string, file?: string) => {
    const h = hits.get(key) ?? { what, files: new Set<string>(), commits: new Set<string>() }
    h.commits.add(commit)
    if (file !== undefined) h.files.add(file)
    hits.set(key, h)
  }
  const words = cfg.words.map(w => w.toLowerCase())
  for (const chunk of out.split('\x01').slice(1)) {
    const [head = '', ...lines] = chunk.split('\n')
    const [hash = '', an = '', ae = '', cn = '', ce = ''] = head.split('\x00')
    for (const email of new Set([ae, ce])) if (email !== '' && !isAllowedEmail(email, cfg.allowed)) hit(`author:${email}`, `作者のメールが noreply ではない: ${maskEmail(email)}`, hash)
    for (const w of words) if (`${an}\n${cn}`.toLowerCase().includes(w)) hit(`author-word:${w}`, `作者名に「${w}」`, hash)
    let file = ''
    for (const line of lines) {
      if (line.startsWith('+++ ')) {
        file = line.slice(4).replace(/^b\//, '')
        continue
      }
      if (!line.startsWith('+')) continue
      const added = line.slice(1)
      for (const m of added.matchAll(EMAIL)) if (!isAllowedEmail(m[0], cfg.allowed)) hit(`email:${m[0].toLowerCase()}`, `個人のメールらしい文字列: ${maskEmail(m[0])}`, hash, file)
      for (const m of added.matchAll(HOME)) {
        const name = m[1] ?? ''
        // 1 字の名前 (/home/a) はテストの見本とみなす
        if (name.length < 2 || PLACEHOLDER.test(name) || /^[<$%{[(*]/.test(name)) continue
        hit(`home:${name.toLowerCase()}`, `ユーザー名入りのパス: ${m[0].slice(0, m[0].length - name.length)}${mask(name)}`, hash, file)
      }
      const low = added.toLowerCase()
      for (const w of words) if (low.includes(w)) hit(`word:${w}`, `気にする言葉「${w}」`, hash, file)
    }
  }
  return [...hits.values()].slice(0, 8).map(h => {
    const files = [...h.files]
    const where = files.length === 0 ? `${h.commits.size} コミット` : files.length === 1 ? files[0] : `${files[0]} ほか ${files.length - 1} 件`
    // 足した行やファイル名から来た文字が混じるので、制御文字を落とす
    return clean(`${h.what} (${short(where ?? '', 60)})`)
  })
}

const PUB = String.raw`(?:push|プッシュ|公開|リリース|release|publish|アップロード|upload|デプロイ|deploy)`
/**
 * 公開する事を言っているか (公開しますか・push して・公開+リリース・リリース v1・publish to npm)。
 * 公開の言葉の後ろが「する」の形の時だけ。公開前に・push は後で・リリースノート・push しない は違う
 */
export const PUBLISH_DO = new RegExp(
  String.raw`${PUB}(?:\s*(?:を|も)?\s*(?:し(?!ない|ません|なく)|する|させ|やる|やって|実行|行|ok\b|[+＋・&]|v\d|[?？!！。]|$)|\s+(?:to|it|now|this|the|them)\b)`,
  'i',
)
/** 断る返事か */
export const NEGATIVE =
  /やめ|止め|しない|しません|しなく|せず|してない|していない|中止|キャンセル|見送|待って|後で|あとで|まだ|いいえ|ダメ|だめ|駄目|不要|いらない|要らない|やらない|無理|却下|拒否|\bno\b|\bnope\b|\bnah\b|cancel|don't|do not|not now|skip|abort/i
/** 頭が肯定の返事か (はい・実行する・OK・yes など) */
export const AFFIRM =
  /^\s*(?:はい|ええ|うん|お願い|実行|進め|進んで|どうぞ|いいよ|いいです|よいです|大丈夫|問題な|許可|承認|了解|オッケー|オーケー|する|します|して|やる|やって|(?:ok|okay|yes|y|yep|yeah|sure|go|please)\b)/i

/** AskUserQuestion の答えの文から「問い」=「答え」の組を拾う */
export function answersOf(text: string) {
  return [...text.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)].map(m => ({ question: m[1] ?? '', answer: m[2] ?? '' }))
}

/**
 * 公開してよいと答えたか。答えが断りでなく、答えそのものが公開すると言っている (公開+リリース・push する) か、
 * 問いが公開するかを聞いていて答えが肯定 (はい・実行・OK) の組が 1 つあれば許す。
 * 公開と関係ない問い (公開前に README を直しますか) の「はい」や、読めない答えでは許さない (見張りがその場で聞き直す)
 */
export function approvedIn(text: string) {
  const pair = answersOf(text).find(({ question, answer }) => !NEGATIVE.test(answer) && (PUBLISH_DO.test(answer) || (PUBLISH_DO.test(question) && AFFIRM.test(answer))))
  return pair ? short(pair.question, 60) : undefined
}

/** 確認が今のターンで効くか (確認したターンと、その次のターンまで) */
export const isValid = (permit: GuardPermit | null, turn: number) => permit !== null && turn <= permit.turn + 1

export const YES = '実行する'
export const NO = 'やめる'

const bullets = (findings: readonly string[]) => findings.map(f => `・${f}`).join('\n')

/** その場で聞く文。公開前のチェックで引っかかった所があれば並べる */
export function askText(label: string, command: string, findings: readonly string[] = []) {
  const found = findings.length === 0 ? '' : `公開前のチェックで気になる所がありました。\n${bullets(findings)}\n\n`
  return `外に出す操作 (${label}) を実行しようとしています。${found}実行しますか？\n\n${short(command.trim(), 300)}`
}

/** 止めた時に Claude へ返す文 */
export function denyText(label: string, outcome: GuardOutcome, answer = '', findings: readonly string[] = []) {
  const found = findings.length === 0 ? '' : `\n公開前のチェックで気になった所:\n${bullets(findings)}`
  if (outcome === 'asked-no') {
    const said = answer !== '' && answer !== NO ? `(ユーザーの返事:「${short(answer, 200)}」)` : ''
    return `ship-guard: ユーザーが実行しないと答えたので ${label} を止めました${said}。返事に従ってください。${found}`
  }
  return `ship-guard: ${label} は外に出す操作です。ユーザーの確認が取れなかったので止めました。AskUserQuestion で実行してよいか確かめてから、もう一度実行してください。${found}`
}

const OUTCOME: Record<GuardOutcome, { word: string; color: () => string; term?: string }> = {
  confirmed: { word: '確認済みで通した', color: () => C.green, term: 'success' },
  'asked-yes': { word: 'その場で聞いて通した', color: () => C.blue },
  'asked-no': { word: '断られたので止めた', color: () => C.yellow, term: 'warning' },
  'no-ask': { word: '聞けないので止めた', color: () => C.red, term: 'error' },
}

/** 時刻は JST に固定する */
const clock = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000)
  return [d.getUTCHours(), d.getUTCMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}

export type PaneInput = { isOff: boolean; log: GuardEntry[]; permit: GuardPermit | null; turn: number }

const permitWord = (i: PaneInput) => (isValid(i.permit, i.turn) ? `確認済み: ${i.permit?.about ?? ''}` : '確認はまだありません')

/** ペインの SVG 1 枚。新しい順に 8 件 */
export function paneSvg(i: PaneInput) {
  const rows = i.log.slice(-8).reverse()
  const accent = i.isOff ? C.dim : C.green
  let s = panel(8, 8, 364, 72)
  s += `<text x="20" y="34" font-size="15" font-weight="bold" fill="${accent}">${i.isOff ? 'このセッションは見張っていません' : '見張り中'}</text>`
  s += `<text x="20" y="58" font-size="12" fill="${C.dim}">${esc(short(permitWord(i), 30))}</text>`
  const h = Math.max(1, rows.length) * 40 + 40
  s += panel(8, 90, 364, h)
  s += `<text x="20" y="114" font-size="13" font-weight="bold" fill="${C.text}">最近の記録</text>`
  if (rows.length === 0) s += `<text x="20" y="144" font-size="12" fill="${C.dim}">git push・gh release・npm publish などはまだありません</text>`
  rows.forEach((r, k) => {
    const y = 130 + k * 40
    const o = OUTCOME[r.outcome]
    s += `<rect x="20" y="${y}" width="4" height="30" rx="2" fill="${o.color()}"/>`
    s += `<text x="32" y="${y + 13}" font-size="13" font-weight="bold" fill="${C.text}">${esc(r.label)}</text>`
    s += `<text x="360" y="${y + 13}" font-size="12" text-anchor="end" fill="${C.dim}">${clock(r.at)}</text>`
    s += `<text x="32" y="${y + 28}" font-size="12" fill="${o.color()}">${o.word}${findingsWord(r)}</text>`
  })
  // 最後に引っかかった公開前チェックの中身
  const found = lastFindings(i.log)
  let fh = 0
  if (found.length > 0) {
    fh = found.length * 20 + 40
    const y0 = 98 + h
    s += panel(8, y0, 364, fh)
    s += `<text x="20" y="${y0 + 24}" font-size="13" font-weight="bold" fill="${C.yellow}">最後の公開前チェックで気になった所</text>`
    found.forEach((f, k) => (s += `<text x="20" y="${y0 + 46 + k * 20}" font-size="12" fill="${C.text}">・${esc(short(f, 30))}</text>`))
    fh += 8
  }
  return frame(HEADER_H + 100 + h + fh, header('外に出す操作の見張り', `${i.log.length} 件`, accent) + `<g transform="translate(0 ${HEADER_H})">${s}</g>`)
}

const findingsWord = (r: GuardEntry) => (r.findings && r.findings.length > 0 ? `・気になる所 ${r.findings.length} 件` : '')

/** 新しい順に見て、最初に公開前チェックで引っかかった記録の中身 (最大 5) */
const lastFindings = (log: readonly GuardEntry[]) => [...log].reverse().find(r => (r.findings?.length ?? 0) > 0)?.findings?.slice(0, 5) ?? []

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** Svg の alt と terminal で使う文の行 */
export function paneLines(i: PaneInput): Line[] {
  const lines: Line[] = [
    { text: i.isOff ? 'このセッションは見張っていません' : '見張り中', isBold: true, color: i.isOff ? undefined : 'success' },
    { text: permitWord(i), isDim: true },
  ]
  if (i.log.length === 0) lines.push({ text: 'git push・gh release・npm publish などはまだありません', isDim: true })
  for (const r of i.log.slice(-8).reverse()) lines.push({ text: `${clock(r.at)} ${r.label} ─ ${OUTCOME[r.outcome].word}${findingsWord(r)}`, color: OUTCOME[r.outcome].term })
  const found = lastFindings(i.log)
  if (found.length > 0) {
    lines.push({ text: '最後の公開前チェックで気になった所', isBold: true, color: 'warning' })
    for (const f of found) lines.push({ text: `・${f}` })
  }
  return lines
}
