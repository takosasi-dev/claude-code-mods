// 運勢を決める乱数・言葉・SVG と terminal 用の行。どれも純関数
import type { OmikujiDay, OmikujiRank, OmikujiResult } from '../types'
import { C, HEADER_H, countUp, fadeIn, frame, header } from './style'

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
    '型の誤りが先に教えてくれる。走らせる前に直せる',
    '手が止まった所で、ちょうど良い見本が見つかる',
    '消した行の数が書いた行の数を上回る。良い日',
    '設定ファイルが一度で読み込まれる',
    '質問を書いている途中で、自分で答えが分かる',
    '差分が小さくまとまる。読む人も喜ぶ',
    '前に書いた手順書が今日の自分を助ける',
    '遅かった処理の原因がすぐに見つかる',
    'ずっと赤かった検査がようやく緑になる',
    '区切りの良い所で手が止まる。早めに休める',
    '思い切った削除がすべて正しい',
    '迷ったら単純な方を選べ。それが当たり',
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
    '同じ名前の関数が二つある気配。確かめよ',
    '写してきた設定を見直すべし',
    '「後で直す」は今日も来ない',
    '空き容量に気を配れ',
    '一度にあれこれ変えると、原因が分からなくなる',
    'エラーを握りつぶすと後で泣く',
    '疲れた目で読む差分は信用するな',
    '日付の計算は二度確かめよ',
    '思い込みの仕様に注意。書いた物を読み直せ',
    '待ち時間に別の作業を始めると、両方遅れる',
    '大きな依存を足す前に、手元の物で足りぬか見よ',
    '画面を閉じる前に保存を確かめよ',
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
    'Pascal',
    'Ada',
    'ALGOL',
    'Simula',
    'Smalltalk',
    'Forth',
    'APL',
    'BASIC',
    'Erlang',
    'Tcl',
    'AWK',
    'sed',
    'Standard ML',
    'Common Lisp',
    'Modula-2',
    'Datalog',
    'VHDL',
    '擬似コード',
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
    'git switch -',
    'git show --stat',
    'git log --graph',
    'git branch -vv',
    'git remote -v',
    'git grep -n',
    'git tag -l',
    'wc -l',
    'head -20',
    'tail -f',
    'sort | uniq -c',
    'find . -name',
    'env | sort',
    'date',
    'cat -n',
    'less',
    'mkdir -p',
    'uptime',
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
    'ログに一行足すだけで見つかる',
    '型を付けると隠れる所がなくなる',
    '並び順の思い込みが原因',
    '一つずれの誤り。始まりと終わりを数えよ',
    '空白が二つ並んでいる',
    '大文字と小文字の違いに潜む',
    '古い版の依存が残っている',
    '非同期の待ち忘れ。await を探せ',
    '同じ処理が二度走っている',
    '手元では出ず、本番だけで出る兆し',
    '見つけた時にはもう直っている',
    '丸めの誤差にご用心',
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
    '質問を一つされる。答えると話が進む',
    '読みやすいと言われる日',
    '返事は短く、承認は早い',
    '図を一枚添えると伝わる',
    '名前を一つ変えるだけで済む',
    '思わぬ人から助言が届く',
    '大きな差分は二つに割ると吉',
    '気になる所を先に自分で書いておくと早い',
    '意見が割れたら小さく試すべし',
    '昔の自分の差分を読むと赤面する',
    '急ぎの頼みにこそ丁寧に応えよ',
    '承認の前に手元で動かすと安心',
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
    '二つ前のコミットの中',
    '下書きのまま残した文書',
    '別の作業フォルダに置いたまま',
    '写した物の履歴',
    '端末の、ずっと上の方',
    '消したと思ったブランチの先',
    '同じ名前の別のファイル',
    '机の上の付箋',
    '昨日の自分の作業の記録',
    '試験用のフォルダの奥',
    '長い関数の真ん中あたり',
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
    '夜中の思いつきは朝に見直せ',
    'エラーを読まずに検索するな',
    '理由の書いてない無効化は残すな',
    '本番の設定を手元で試すな',
    '確かめないまま「直った」と言うな',
    '同じ修正を三か所に書くな',
    '消す前に写しを取れ',
    '警告をまとめて黙らせるな',
    '長すぎる関数をさらに伸ばすな',
    '一つのコミットに全部詰めるな',
    '人のブランチに黙って書くな',
    '休みの前日の大きな反映は避けよ',
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
    'build: ',
    'ci: ',
    'style: ',
    'revert: ',
    '試す: ',
    '消す: ',
    '速くする: ',
    '守る: ',
    '書き足す: ',
    'まとめる: ',
    'ほどく: ',
    '移す: ',
    '言い換える: ',
    '確かめる: ',
  ],
} as const

export type Season = '春' | '夏' | '秋' | '冬'

/** 日付 `YYYY-MM-DD` (JST) の季節。3〜5 月が春、6〜8 月が夏、9〜11 月が秋、ほかは冬 */
export const seasonOf = (date: string): Season => {
  const m = Number(date.slice(5, 7))
  return m >= 3 && m <= 5 ? '春' : m >= 6 && m <= 8 ? '夏' : m >= 9 && m <= 11 ? '秋' : '冬'
}

/** 季節の一言。その季節の日だけ、総合の一言の候補に混ざる */
export const SEASON_WORDS: Record<Season, { good: readonly string[]; bad: readonly string[] }> = {
  春: {
    good: [
      '芽吹きの季節。始めた試みがしっかり根付く',
      'つぼみがほころぶように、小さな差分が次々通る',
      '春風のように依存の更新が通り抜ける',
      '新しく来た人に教えると、自分の理解も深まる',
      '日が長くなる。夕方の調べ物がはかどる',
    ],
    bad: [
      '花粉のように警告も積もる。早めに払え',
      '年度替わりの設定変更に気を付けよ',
      '陽気につられて確かめが甘くなる',
      '名前の変わった物に古い名前が残っている',
      '春の夜の眠気に負けて差分を出すな',
    ],
  },
  夏: {
    good: [
      '夕立のあとのように、ログがすっきり晴れる',
      '暑さに負けず、短い関数が涼しく並ぶ',
      '時間をかけた調べ物が実を結ぶ',
      '冷えた麦茶のように、はっきりした答えが出る',
      '朝の涼しいうちに難所を越えられる',
    ],
    bad: [
      '暑さで機械も人も遅くなる。休みを挟め',
      '日が長いと作業も長引く。区切りを決めよ',
      '蒸し暑い日の大改修は控えよ',
      '時刻を夏の時間で数える国に注意',
      '機械の熱に気を配れ。ファンの音を聞け',
    ],
  },
  秋: {
    good: [
      '実りの秋。積み重ねたテストが報われる',
      '月の明るい夜は、設計の筋がよく見える',
      '落ち葉を掃くように古いコードが片付く',
      '読書の秋。仕様書を読むと近道が見つかる',
      '澄んだ空のように、頭の中が整う',
    ],
    bad: [
      '日が短くなる。早めに保存せよ',
      '食べ過ぎと同じく、機能の詰め込み過ぎに注意',
      '長雨のようにビルドが続く気配',
      '衣替えのつもりの書き換えが長引く',
      '夜長に任せて寝る時間を削るな',
    ],
  },
  冬: {
    good: [
      '静かな冬の朝は集中がよく続く',
      '雪の原のように、白紙から書くと早い',
      'こたつで思いついた案が当たる',
      '年の終わりに古い課題が片付く',
      '温かい飲み物を手に読むと、難しい所も分かる',
    ],
    bad: [
      '寒さで指がかじかむ。打ち間違いに注意',
      '年の瀬の駆け込みの反映は避けよ',
      '暖かい部屋の眠気に負けるな',
      '休み明けは手順を思い出すまで慎重に',
      '乾いた空気のように、言葉が足りず誤解を招く',
    ],
  },
}

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
  const season = SEASON_WORDS[seasonOf(date)]
  return {
    date,
    number: 1 + Math.floor(r() * 100),
    rank,
    words: pick(isGood(rank) ? [...WORDS.good, ...season.good] : [...WORDS.bad, ...season.bad]),
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

/** store の直近の日のうち、形の合う物だけ (知らない欄は残す。新しい版が足した欄を消さない) */
export const toDays = (v: unknown): OmikujiDay[] =>
  Array.isArray(v) ? v.filter((d): d is OmikujiDay => typeof d === 'object' && d !== null && isDate(d.date) && isRank(d.rank)) : []

/** store の生の値が物なら中身、そうでなければ空 (知らない欄を残して書くための元) */
export const objOf = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** JST の日付 `YYYY-MM-DD` (Date のタイムゾーンに頼らない) */
export const jstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)

/** date で終わる直近 n 日 (古い順) */
export function lastDays(date: string, n = 7) {
  const t = Date.parse(`${date}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

/** 今日の分を足して、直近 7 日より古い分を落とす。今日の分が既にあれば、その知らない欄 (新しい版が足した欄) は残す */
export function addDay(history: readonly OmikujiDay[], day: OmikujiDay): OmikujiDay[] {
  const keep = new Set(lastDays(day.date))
  const had = history.find(d => d.date === day.date)
  return [...history.filter(d => d.date !== day.date && keep.has(d.date)), { ...had, ...day }].sort((p, q) => p.date.localeCompare(q.date))
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

// 紙と筒は絵の中身なので、テーマによらず同じ色 (和紙・墨・朱・木)
const PAPER = {
  washi: '#f3ead6',
  fiber: '#e0d2b4',
  sumi: '#2b2118',
  shu: '#d9381e',
  wood: '#8a5530',
  woodDark: '#5e3519',
}
/** 運勢の色 (今のテーマの色を呼ぶたびに読む。SVG と terminal の Text の両方で使う) */
export const rankColor = (rank: OmikujiRank) =>
  ({ 大吉: C.red, 中吉: C.orange, 小吉: C.yellow, 吉: C.green, 末吉: C.blue, 凶: C.purple, 大凶: C.dim })[rank]

/** 見出しの動きを抜く。紙だけの絵は描き直しのたびに動かさない */
const still = (s: string) => s.replace(/<animate\b[^>]*\/>/g, '')

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
    body += `<text x="190" y="${y}" font-size="14" font-weight="bold" fill="${PAPER.sumi}" text-anchor="middle">${esc(line)}</text>`
    y += 20
  }
  y += 6
  body += `<line x1="52" y1="${y}" x2="328" y2="${y}" stroke="${PAPER.shu}" stroke-width="0.8" stroke-dasharray="3 3"/>`
  y += 24
  for (const [key, label] of ITEMS) {
    const value = key === 'commit' ? commitText(f) : String(f[key])
    body +=
      `<rect x="46" y="${y - 13}" width="74" height="18" rx="2" fill="none" stroke="${PAPER.shu}" stroke-width="0.8"/>` +
      `<text x="83" y="${y}" font-size="12" font-weight="bold" fill="${PAPER.shu}" text-anchor="middle">${label}</text>`
    for (const line of wrap(value, 30)) {
      body += `<text x="130" y="${y}" font-size="13" fill="${PAPER.sumi}">${esc(line)}</text>`
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
    fibers += `<path d="M${x.toFixed(1)} ${fy.toFixed(1)} q ${(4 + r() * 8).toFixed(1)} ${(r() * 4 - 2).toFixed(1)} ${(10 + r() * 14).toFixed(1)} ${(r() * 6 - 3).toFixed(1)}" stroke="${PAPER.fiber}" stroke-width="0.8" fill="none"/>`
  }

  const rankChars = [...f.rank]
  const rankSize = rankChars.length === 1 ? 72 : 58
  const rankTop = rankChars.length === 1 ? 140 : 102
  let s =
    `<rect x="24" y="12" width="332" height="${bottom - 12}" rx="3" fill="${PAPER.washi}"/>` +
    fibers +
    `<rect x="32" y="20" width="316" height="${bottom - 28}" fill="none" stroke="${PAPER.shu}" stroke-width="1.6"/>` +
    `<rect x="36" y="24" width="308" height="${bottom - 36}" fill="none" stroke="${PAPER.shu}" stroke-width="0.6"/>` +
    // 右の列: 題と番号
    vertical('コード運勢', 316, 56, 22, `font-size="17" font-weight="bold" fill="${PAPER.sumi}"`) +
    vertical(`第${kanji(f.number)}番`, 288, 56, 17, `font-size="13" fill="${PAPER.sumi}"`) +
    // 左の列: 日付
    vertical(kanjiDate(f.date), 64, 56, 16, `font-size="13" fill="${PAPER.sumi}"`) +
    // 真ん中: 朱の運勢と丸い印
    `<circle cx="190" cy="${rankTop + (rankChars.length - 1) * (rankSize / 2) - rankSize * 0.35}" r="${rankChars.length === 1 ? 54 : 70}" fill="none" stroke="${PAPER.shu}" stroke-width="1" opacity="0.35"/>` +
    vertical(f.rank, 190, rankTop, rankSize + 2, `font-size="${rankSize}" font-weight="bold" fill="${PAPER.shu}"`) +
    `<line x1="52" y1="200" x2="328" y2="200" stroke="${PAPER.shu}" stroke-width="1.2"/>` +
    body
  if (isPlay)
    s +=
      `<g transform="rotate(-12 96 168)"><rect x="58" y="152" width="78" height="30" rx="4" fill="none" stroke="${PAPER.shu}" stroke-width="2" opacity="0.8"/>` +
      `<text x="97" y="173" font-size="15" font-weight="bold" fill="${PAPER.shu}" text-anchor="middle" opacity="0.8">遊び</text></g>`
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
    `<path d="M148 210 L232 210 L226 360 L154 360 Z" fill="${PAPER.wood}" stroke="${PAPER.woodDark}" stroke-width="2"/>` +
    `<ellipse cx="190" cy="210" rx="42" ry="9" fill="${PAPER.woodDark}"/>` +
    `<ellipse cx="190" cy="210" rx="9" ry="3.5" fill="#1a0f08"/>` +
    // 棒は穴より上だけ見せる (筒の中に隠しておき、振り終わったら押し上げる)
    `<clipPath id="ok-hole"><rect x="150" y="0" width="80" height="211"/></clipPath>` +
    `<g clip-path="url(#ok-hole)"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="0 -84" begin="1.5s" dur="0.6s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>` +
    `<rect x="185" y="214" width="10" height="90" rx="2" fill="#e9dbb4" stroke="#b49a64" stroke-width="0.8"/>` +
    `<rect x="185" y="214" width="10" height="12" rx="2" fill="${PAPER.shu}"/></g></g>` +
    `<rect x="151" y="232" width="78" height="7" fill="${PAPER.woodDark}" opacity="0.7"/>` +
    `<rect x="154" y="334" width="72" height="7" fill="${PAPER.woodDark}" opacity="0.7"/>` +
    `<rect x="174" y="248" width="32" height="80" fill="${PAPER.washi}"/>` +
    vertical('御神籤', 190, 270, 24, `font-size="19" font-weight="bold" fill="${PAPER.shu}"`) +
    `</g>` +
    // 振っている間の音
    `<g font-size="16" font-weight="bold" fill="${C.text}" opacity="0"><animate attributeName="opacity" values="0;1;0;1;0;1;0" dur="1.5s" fill="freeze"/>` +
    `<text x="96" y="250" text-anchor="middle">シャカ</text><text x="284" y="300" text-anchor="middle">シャカ</text></g>` +
    // 棒の番号。棒が上がる間に数が回って止まる
    countUp(f.number, `x="214" y="130" font-size="16" font-weight="bold" fill="${C.text}"`, n => `第${kanji(n)}番`, 1.6) +
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
    s += `<text x="${cx}" y="${y + 12}" font-size="12" fill="${isToday ? C.text : C.dim}" text-anchor="middle">${md(date)}</text>`
    if (isToday) s += `<circle cx="${cx}" cy="${y + 34}" r="16" fill="none" stroke="${C.text}" stroke-width="1"/>`
    s += rank
      ? `<circle cx="${cx}" cy="${y + 34}" r="12" fill="${rankColor(rank)}"/>` +
        `<text x="${cx}" y="${y + 66}" font-size="12" font-weight="bold" fill="${rankColor(rank)}" text-anchor="middle">${rank}</text>`
      : `<circle cx="${cx}" cy="${y + 34}" r="11" fill="none" stroke="${C.line}" stroke-width="2" stroke-dasharray="3 3"/>` +
        `<text x="${cx}" y="${y + 66}" font-size="12" fill="${C.dim}" text-anchor="middle">─</text>`
  })
  return { svg: s, bottom: y + 74 }
}

/**
 * ペインに出す SVG 1 枚。isShake なら筒を振るアニメから紙が開くまで、
 * そうでなければ開いた紙だけ (紙だけの絵は振り終わりに差し替わるので、何も動かさない)
 */
export function paneSvg(shown: OmikujiResult, today: string, history: readonly OmikujiDay[], opts: { isShake: boolean; isPlay: boolean }) {
  const p = paper(shown, opts.isPlay)
  const paperSvg = opts.isShake
    ? // 紙は上の端から開く
      `<g opacity="0"><animate attributeName="opacity" from="0" to="1" begin="2.6s" dur="0.5s" fill="freeze"/>` +
      `<g transform="translate(0 12)"><g><animateTransform attributeName="transform" type="scale" from="1 0.04" to="1 1" begin="2.6s" dur="0.7s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>` +
      `<g transform="translate(0 -12)">${p.svg}</g></g></g></g>`
    : p.svg
  const w = week(today, history, HEADER_H + p.bottom + 28)
  const head = header('コード運勢', opts.isPlay ? '遊びの一回' : `${md(shown.date)} の本番`, C.red)
  return frame(
    w.bottom + 8,
    (opts.isShake ? head : still(head)) +
    // 紙と筒は y=0 から描いてあるので、見出しの下へ下ろす
    `<g transform="translate(0 ${HEADER_H})">${paperSvg}${opts.isShake ? shaker(shown) : ''}</g>` +
    // 今日の丸は紙が開いてから出す (振っている間に運勢が見えないように)
    (opts.isShake ? fadeIn(w.svg, 3.0) : w.svg),
  )
}

/** Svg の alt と terminal で使う文の行 */
export function paneLines(shown: OmikujiResult, today: OmikujiResult, history: readonly OmikujiDay[], isPlay: boolean): Line[] {
  const lines: Line[] = [
    { text: `${md(shown.date)} のコード運勢  第${shown.number}番`, isBold: true },
    { text: shown.rank, color: rankColor(shown.rank), isBold: true },
    { text: shown.words },
  ]
  if (isPlay) lines.push({ text: `遊びの一回です(本番は${today.rank})`, color: 'yellow' })
  for (const [key, label] of ITEMS) lines.push({ text: `${label}: ${key === 'commit' ? commitText(shown) : String(shown[key])}` })
  const by = new Map(history.map(d => [d.date, d.rank]))
  lines.push({ text: `この 7 日: ${lastDays(today.date).map(d => `${md(d)} ${by.get(d) ?? '─'}`).join(' / ')}`, isDim: true })
  return lines
}
