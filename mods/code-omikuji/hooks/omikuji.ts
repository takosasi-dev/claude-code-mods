// 運勢を決める乱数・言葉・SVG と terminal 用の行。どれも純関数
import type { OmikujiDay, OmikujiRank, OmikujiResult } from '../types'

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** 日付と混ぜる固定の値。変えると全員の運勢が変わる */
const SALT = 'code-omikuji/1'

// ── 言葉 (どれも自作。実在の人物・商品名は使わない)
const RANKS: readonly [OmikujiRank, number][] = [
  ['大吉', 16],
  ['中吉', 18],
  ['小吉', 18],
  ['吉', 22],
  ['末吉', 12],
  ['凶', 10],
  ['大凶', 4],
]
export const RANK_NAMES = RANKS.map(r => r[0])
const isGood = (r: OmikujiRank) => r === '大吉' || r === '中吉' || r === '小吉' || r === '吉'

export const WORDS = {
  good: [
    '書いたコードが一度で通る日。迷わず進め',
    '小さなコミットが大きな前進になる',
    '長年のバグが向こうから名乗り出てくる',
    'テストが味方につく。赤から緑へ一直線',
    '思いつきの設計がそのまま正解になる',
    '久しぶりに読んだ自分のコードが分かりやすい',
    '依存の更新が何事もなく終わる',
    '名前付けが冴える。変数名に迷わない',
    '午前中のひらめきを大切に',
    'リファクタリングの好機。今日なら壊れない',
    'エラーメッセージが親切に原因を教えてくれる',
    'ビルドが速い。待ち時間に茶でも一杯',
  ],
  bad: [
    '焦りは禁物。一行ずつ確かめよ',
    '動いているコードには触れぬが吉',
    '「ちょっとだけ」の修正が長引く兆し',
    '本番の前にもう一度テストを回すべし',
    '疲れたら手を止めて休むが勝ち',
    '古いコメントを信じすぎぬこと',
    '貼り付けたコードの出どころを確かめよ',
    '締め切り前の大改修は控えよ',
    '原因は思わぬ所にあり。足元を見よ',
    '再起動で直るものは、また壊れる',
    'ログを読む手間を惜しむべからず',
    '今日の失敗は明日の知恵。記録を残せ',
  ],
  // 規格や昔からの名前の言語だけにする
  language: [
    'C',
    'C++',
    'Lisp',
    'Scheme',
    'Haskell',
    'OCaml',
    'Fortran',
    'COBOL',
    'SQL',
    'Prolog',
    'アセンブリ',
    'シェルスクリプト',
    '正規表現',
    'Markdown',
    'YAML',
    'TOML',
  ],
  command: [
    'git status',
    'git diff --stat',
    'git log --oneline -5',
    'git stash list',
    'git blame',
    'ls -la',
    'grep -rn',
    'make test',
    'cd ..',
    'pwd',
    'du -sh *',
    'tree -L 2',
    'diff -u',
    'echo $?',
    'history | tail',
    'clear',
  ],
  bug: [
    '一つ直すと二つ見つかる。ただし全部浅い',
    '原因は一文字の打ち間違い',
    '再現手順が自然と見つかる',
    '境界値に潜む。ゼロと空を疑え',
    '夕方に出たバグは翌朝の自分に任せよ',
    'タイムゾーンが犯人の気配',
    '改行コードにご用心',
    'キャッシュを消すと消える',
    '気配なし。静かな一日',
    '古いバグが新しい顔で戻ってくる',
    '人の書いた所ではなく、自分の書いた所にあり',
    '小さな警告を見逃すと大きくなる',
  ],
  review: [
    '一発で承認。指摘ゼロの予感',
    '鋭い指摘が一つ。それが宝になる',
    '待ち人来たる。返事は午後',
    '説明を一行足すだけで通る',
    '差分は小さく分けると吉',
    '名前付けの議論が長引く兆し',
    '褒め言葉をもらえる日',
    '出す前に読み返すと見落としが見つかる',
    '返事が遅くとも焦らず待て',
    '人の差分を読むと学びあり',
    'テストを添えれば話が早い',
    '夜のレビューは見落とし多し',
  ],
  lost: [
    'stash の奥にあり',
    '昨日の reflog に眠る',
    '別のブランチで見つかる',
    '閉じたタブの中',
    'ゴミ箱を探せ',
    '設定ファイルの末尾',
    '古い課題票のコメント欄',
    '手元のメモの三ページ目',
    '環境変数の中に隠れている',
    '出てこない。書き直すが早い',
    '検索で一発。ただし綴りに注意',
  ],
  warning: [
    '今日は force push 厄日',
    '金曜の本番反映は凶',
    'rm -rf の前に二度見よ',
    '「とりあえず」で入れた依存は残る',
    'コメントアウトのまま放置するべからず',
    'main への直コミットは控えよ',
    '秘密の鍵をコミットに混ぜるな',
    '確かめずに一括置換するな',
    '理由を知らずに「動いた」で進むな',
    'テストを消して通すのは厄の元',
    '寝不足のマージは後悔のもと',
    'TODO を増やすだけの日にするな',
  ],
  commit: [
    'fix: ',
    'feat: ',
    'refactor: ',
    'docs: ',
    'test: ',
    'perf: ',
    'chore: ',
    '直す: ',
    '足す: ',
    '片付ける: ',
    '整える: ',
    '名前を変える: ',
    '分ける: ',
    '元に戻す: ',
  ],
} as const

// ── 乱数 (FNV-1a で種を作り、mulberry32 で回す)
function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * その日の運勢。同じ日と同じ n なら必ず同じ結果。
 * n = 0 が本番、1 以上は「遊びの一回」
 */
export function fortune(date: string, n = 0): OmikujiResult {
  const r = rng(hash(`${date}|${SALT}|${n}`))
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)] as T
  let x = r() * 100
  let rank: OmikujiRank = '吉'
  for (const [name, w] of RANKS) {
    if (x < w) {
      rank = name
      break
    }
    x -= w
  }
  return {
    date,
    number: 1 + Math.floor(r() * 100),
    rank,
    words: pick(isGood(rank) ? WORDS.good : WORDS.bad),
    language: pick(WORDS.language),
    command: pick(WORDS.command),
    bug: pick(WORDS.bug),
    review: pick(WORDS.review),
    lost: pick(WORDS.lost),
    warning: pick(WORDS.warning),
    commit: pick(WORDS.commit),
  }
}

// ── store の中身は信用しない (古い版・手で書き換えた値で「第undefined番」や描画失敗にしない)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TEXT_KEYS = ['words', 'language', 'command', 'bug', 'review', 'lost', 'warning', 'commit'] as const
const isRank = (r: unknown): r is OmikujiRank => RANK_NAMES.includes(r as OmikujiRank)
const isDate = (d: unknown): d is string => typeof d === 'string' && DATE_RE.test(d)

/** 運勢として形が揃っているか (rank は 7 つの名前、number は 1〜100 の整数、文字の項目は全部 string) */
export function isResult(v: unknown): v is OmikujiResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const n = o.number
  return isDate(o.date) && isRank(o.rank) && Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 100 && TEXT_KEYS.every(k => typeof o[k] === 'string')
}

/** store の直近の日のうち、形の合う物だけ */
export const toDays = (v: unknown): OmikujiDay[] =>
  Array.isArray(v)
    ? v.filter((d): d is OmikujiDay => typeof d === 'object' && d !== null && isDate(d.date) && isRank(d.rank)).map(d => ({ date: d.date, rank: d.rank }))
    : []

/** JST の日付 `YYYY-MM-DD` (Date のタイムゾーンに頼らない) */
export const jstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)

/** date で終わる直近 n 日 (古い順) */
export function lastDays(date: string, n = 7) {
  const t = Date.parse(`${date}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

/** 今日の分を足して、直近 7 日より古い分を落とす */
export function addDay(history: readonly OmikujiDay[], day: OmikujiDay): OmikujiDay[] {
  const keep = new Set(lastDays(day.date))
  return [...history.filter(d => d.date !== day.date && keep.has(d.date)), day].sort((p, q) => p.date.localeCompare(q.date))
}

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

/** 入力欄に入れる 1 行 */
export const fillText = (f: OmikujiResult) =>
  `今日の運勢は${f.rank}。ラッキー言語は ${f.language}、ラッキーなコマンドは ${f.command}、` +
  `バグ運は「${f.bug}」、レビュー運は「${f.review}」、戒めは「${f.warning}」。`

// ── 描画
const KD = '〇一二三四五六七八九'
const kd = (d: number) => KD[d] ?? ''
/** 100 までの漢数字 */
export function kanji(n: number): string {
  if (n === 100) return '百'
  if (n < 10) return kd(n)
  const ten = Math.floor(n / 10)
  return `${ten === 1 ? '' : kd(ten)}十${n % 10 ? kd(n % 10) : ''}`
}
const kanjiDate = (date: string) => `${kanji(Number(date.slice(5, 7)))}月${kanji(Number(date.slice(8, 10)))}日`

const C = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  weak: '#8b949e',
  washi: '#f3ead6',
  fiber: '#e0d2b4',
  sumi: '#2b2118',
  shu: '#d9381e',
  wood: '#8a5530',
  woodDark: '#5e3519',
}
export const RANK_COLOR: Record<OmikujiRank, string> = {
  大吉: '#e83929',
  中吉: '#f78166',
  小吉: '#d29922',
  吉: '#3fb950',
  末吉: '#58a6ff',
  凶: '#bc8cff',
  大凶: '#8b949e',
}
const W = 380

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const wide = (ch: string) => /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)

/** 幅 (全角 2・半角 1) で折り返す */
export function wrap(s: string, max: number) {
  const out: string[] = []
  let cur = ''
  let n = 0
  for (const ch of s) {
    const w = wide(ch) ? 2 : 1
    if (n + w > max) {
      out.push(cur)
      cur = ''
      n = 0
    }
    cur += ch
    n += w
  }
  if (cur) out.push(cur)
  return out
}

/** 縦に 1 文字ずつ並べる */
const vertical = (s: string, x: number, y: number, step: number, attrs: string) =>
  [...s]
    .map((ch, i) => {
      const cy = y + i * step
      // 長音は縦書きでは縦に向ける
      const turn = ch === 'ー' ? ` transform="rotate(90 ${x} ${cy - step * 0.35})"` : ''
      return `<text x="${x}" y="${cy}" text-anchor="middle"${turn} ${attrs}>${esc(ch)}</text>`
    })
    .join('')

const commitText = (f: OmikujiResult) => `「${f.commit}…」`

const ITEMS: [keyof OmikujiResult, string][] = [
  ['language', '言語'],
  ['command', 'コマンド'],
  ['bug', 'バグ運'],
  ['review', 'レビュー運'],
  ['lost', '失せ物'],
  ['warning', '戒め'],
  ['commit', '書き出し'],
]

/** 開いた紙。y=12 から始まり、下の端の y を返す */
function paper(f: OmikujiResult, isPlay: boolean): { svg: string; bottom: number } {
  // 中身を先に組んで高さを決める
  let body = ''
  let y = 226
  for (const line of wrap(f.words, 40)) {
    body += `<text x="190" y="${y}" font-size="14" font-weight="bold" fill="${C.sumi}" text-anchor="middle">${esc(line)}</text>`
    y += 20
  }
  y += 6
  body += `<line x1="52" y1="${y}" x2="328" y2="${y}" stroke="${C.shu}" stroke-width="0.8" stroke-dasharray="3 3"/>`
  y += 24
  for (const [key, label] of ITEMS) {
    const value = key === 'commit' ? commitText(f) : String(f[key])
    body +=
      `<rect x="46" y="${y - 13}" width="74" height="18" rx="2" fill="none" stroke="${C.shu}" stroke-width="0.8"/>` +
      `<text x="83" y="${y}" font-size="12" font-weight="bold" fill="${C.shu}" text-anchor="middle">${label}</text>`
    for (const line of wrap(value, 30)) {
      body += `<text x="130" y="${y}" font-size="13" fill="${C.sumi}">${esc(line)}</text>`
      y += 19
    }
    y += 9
  }
  const bottom = y + 6

  // 和紙の繊維 (結果から決まるので毎回同じ)
  const r = rng(hash(`${f.date}|${f.number}|fiber`))
  let fibers = ''
  for (let i = 0; i < 26; i++) {
    const x = 34 + r() * 300
    const fy = 22 + r() * (bottom - 40)
    fibers += `<path d="M${x.toFixed(1)} ${fy.toFixed(1)} q ${(4 + r() * 8).toFixed(1)} ${(r() * 4 - 2).toFixed(1)} ${(10 + r() * 14).toFixed(1)} ${(r() * 6 - 3).toFixed(1)}" stroke="${C.fiber}" stroke-width="0.8" fill="none"/>`
  }

  const rankChars = [...f.rank]
  const rankSize = rankChars.length === 1 ? 72 : 58
  const rankTop = rankChars.length === 1 ? 140 : 102
  let s =
    `<rect x="24" y="12" width="332" height="${bottom - 12}" rx="3" fill="${C.washi}"/>` +
    fibers +
    `<rect x="32" y="20" width="316" height="${bottom - 28}" fill="none" stroke="${C.shu}" stroke-width="1.6"/>` +
    `<rect x="36" y="24" width="308" height="${bottom - 36}" fill="none" stroke="${C.shu}" stroke-width="0.6"/>` +
    // 右の列: 題と番号
    vertical('コード運勢', 316, 56, 22, `font-size="17" font-weight="bold" fill="${C.sumi}"`) +
    vertical(`第${kanji(f.number)}番`, 288, 56, 17, `font-size="13" fill="${C.sumi}"`) +
    // 左の列: 日付
    vertical(kanjiDate(f.date), 64, 56, 16, `font-size="13" fill="${C.sumi}"`) +
    // 真ん中: 朱の運勢と丸い印
    `<circle cx="190" cy="${rankTop + (rankChars.length - 1) * (rankSize / 2) - rankSize * 0.35}" r="${rankChars.length === 1 ? 54 : 70}" fill="none" stroke="${C.shu}" stroke-width="1" opacity="0.35"/>` +
    vertical(f.rank, 190, rankTop, rankSize + 2, `font-size="${rankSize}" font-weight="bold" fill="${C.shu}"`) +
    `<line x1="52" y1="200" x2="328" y2="200" stroke="${C.shu}" stroke-width="1.2"/>` +
    body
  if (isPlay)
    s +=
      `<g transform="rotate(-12 96 168)"><rect x="58" y="152" width="78" height="30" rx="4" fill="none" stroke="${C.shu}" stroke-width="2" opacity="0.8"/>` +
      `<text x="97" y="173" font-size="15" font-weight="bold" fill="${C.shu}" text-anchor="middle" opacity="0.8">遊び</text></g>`
  return { svg: s, bottom }
}

/** 筒を振って棒が出てくるまで (おおよそ 2.4 秒)。最後に消える */
function shaker(f: OmikujiResult) {
  const pivot = '190 360'
  const swing = ['0', '-16', '14', '-12', '10', '-6', '3', '0'].map(a => `${a} ${pivot}`).join(';')
  return (
    `<g><animate attributeName="opacity" from="1" to="0" begin="2.5s" dur="0.4s" fill="freeze"/>` +
    `<ellipse cx="190" cy="372" rx="70" ry="9" fill="#000" opacity="0.35"/>` +
    `<g><animateTransform attributeName="transform" type="rotate" values="${swing}" dur="1.5s" fill="freeze"/>` +
    `<path d="M148 210 L232 210 L226 360 L154 360 Z" fill="${C.wood}" stroke="${C.woodDark}" stroke-width="2"/>` +
    `<ellipse cx="190" cy="210" rx="42" ry="9" fill="${C.woodDark}"/>` +
    `<ellipse cx="190" cy="210" rx="9" ry="3.5" fill="#1a0f08"/>` +
    // 棒は穴より上だけ見せる (筒の中に隠しておき、振り終わったら押し上げる)
    `<clipPath id="ok-hole"><rect x="150" y="0" width="80" height="211"/></clipPath>` +
    `<g clip-path="url(#ok-hole)"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="0 -84" begin="1.5s" dur="0.6s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>` +
    `<rect x="185" y="214" width="10" height="90" rx="2" fill="#e9dbb4" stroke="#b49a64" stroke-width="0.8"/>` +
    `<rect x="185" y="214" width="10" height="12" rx="2" fill="${C.shu}"/></g></g>` +
    `<rect x="151" y="232" width="78" height="7" fill="${C.woodDark}" opacity="0.7"/>` +
    `<rect x="154" y="334" width="72" height="7" fill="${C.woodDark}" opacity="0.7"/>` +
    `<rect x="174" y="248" width="32" height="80" fill="${C.washi}"/>` +
    vertical('御神籤', 190, 270, 24, `font-size="19" font-weight="bold" fill="${C.shu}"`) +
    `</g>` +
    // 振っている間の音
    `<g font-size="16" font-weight="bold" fill="${C.text}" opacity="0"><animate attributeName="opacity" values="0;1;0;1;0;1;0" dur="1.5s" fill="freeze"/>` +
    `<text x="96" y="250" text-anchor="middle">シャカ</text><text x="284" y="300" text-anchor="middle">シャカ</text></g>` +
    // 棒の番号
    `<g opacity="0"><animate attributeName="opacity" from="0" to="1" begin="2.0s" dur="0.3s" fill="freeze"/>` +
    `<text x="214" y="130" font-size="16" font-weight="bold" fill="${C.text}">第${kanji(f.number)}番</text></g>` +
    `</g>`
  )
}

/** 直近 7 日の丸の列 */
function week(today: string, history: readonly OmikujiDay[], y: number) {
  const by = new Map(history.map(d => [d.date, d.rank]))
  let s = `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">この 7 日</text>`
  y += 16
  lastDays(today).forEach((date, i) => {
    const cx = 40 + i * 50
    const rank = by.get(date)
    const isToday = date === today
    s += `<text x="${cx}" y="${y + 12}" font-size="12" fill="${isToday ? C.text : C.weak}" text-anchor="middle">${md(date)}</text>`
    if (isToday) s += `<circle cx="${cx}" cy="${y + 34}" r="16" fill="none" stroke="${C.text}" stroke-width="1"/>`
    s += rank
      ? `<circle cx="${cx}" cy="${y + 34}" r="12" fill="${RANK_COLOR[rank]}"/>` +
        `<text x="${cx}" y="${y + 66}" font-size="12" font-weight="bold" fill="${RANK_COLOR[rank]}" text-anchor="middle">${rank}</text>`
      : `<circle cx="${cx}" cy="${y + 34}" r="11" fill="none" stroke="${C.line}" stroke-width="2" stroke-dasharray="3 3"/>` +
        `<text x="${cx}" y="${y + 66}" font-size="12" fill="${C.weak}" text-anchor="middle">─</text>`
  })
  return { svg: s, bottom: y + 74 }
}

/**
 * ペインに出す SVG 1 枚。isShake なら筒を振るアニメから紙が開くまで、
 * そうでなければ開いた紙だけ
 */
export function paneSvg(shown: OmikujiResult, today: string, history: readonly OmikujiDay[], opts: { isShake: boolean; isPlay: boolean }) {
  const p = paper(shown, opts.isPlay)
  const paperSvg = opts.isShake
    ? // 紙は上の端から開く
      `<g opacity="0"><animate attributeName="opacity" from="0" to="1" begin="2.6s" dur="0.5s" fill="freeze"/>` +
      `<g transform="translate(0 12)"><g><animateTransform attributeName="transform" type="scale" from="1 0.04" to="1 1" begin="2.6s" dur="0.7s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>` +
      `<g transform="translate(0 -12)">${p.svg}</g></g></g></g>`
    : p.svg
  const w = week(today, history, p.bottom + 28)
  const h = w.bottom + 8
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
    `<rect width="${W}" height="${h}" fill="${C.bg}"/>` +
    paperSvg +
    (opts.isShake ? shaker(shown) : '') +
    w.svg +
    `</svg>`
  )
}

/** Svg の alt と terminal で使う文の行 */
export function paneLines(shown: OmikujiResult, today: OmikujiResult, history: readonly OmikujiDay[], isPlay: boolean): Line[] {
  const lines: Line[] = [
    { text: `${md(shown.date)} のコード運勢  第${shown.number}番`, isBold: true },
    { text: shown.rank, color: RANK_COLOR[shown.rank], isBold: true },
    { text: shown.words },
  ]
  if (isPlay) lines.push({ text: `遊びの一回です(本番は${today.rank})`, color: 'yellow' })
  for (const [key, label] of ITEMS) lines.push({ text: `${label}: ${key === 'commit' ? commitText(shown) : String(shown[key])}` })
  const by = new Map(history.map(d => [d.date, d.rank]))
  lines.push({ text: `この 7 日: ${lastDays(today.date).map(d => `${md(d)} ${by.get(d) ?? '─'}`).join(' / ')}`, isDim: true })
  return lines
}
