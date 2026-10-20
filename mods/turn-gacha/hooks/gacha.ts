// カードの表・抽選・保存の形・SVG と terminal 用の行。どれも純関数
import type { GachaCard, GachaDraw, GachaRarity, GachaSave, GachaSlot } from '../types'
import { C, esc, header, HEADER_H } from './style'

export type Card = GachaCard & { line: string }

const c = (id: string, rarity: GachaRarity, slot: GachaSlot, name: string, line: string): Card => ({ id, rarity, slot, name, line })

/** カードの表 (N 16 / R 12 / SR 8 / SSR 4)。id は保存に使うので変えない。slot は dev-rpg で装備する枠 */
export const CARDS: readonly Card[] = [
  c('n01', 'N', 'weapon', '消し忘れた console.log', '本番で誰かが読んでいる'),
  c('n02', 'N', 'charm', 'TODO: あとで直す', 'あとは来ない'),
  c('n03', 'N', 'armor', '行末の空白', '差分にだけ姿を見せる'),
  c('n04', 'N', 'armor', 'タブと空白の混在', '静かな戦争'),
  c('n05', 'N', 'charm', '謎の数字 42', '意味は誰も知らない'),
  c('n06', 'N', 'weapon', 'コメントアウトした旧コード', 'いつか使うかもしれない'),
  c('n07', 'N', 'charm', '開きっぱなしのタブ 50 枚', 'どれが本物の資料か'),
  c('n08', 'N', 'weapon', '長すぎる変数名', '説明だけはできている'),
  c('n09', 'N', 'charm', 'final_v3_本当の最終版', '最終版はまだ先'),
  c('n10', 'N', 'weapon', '再起動で直ったバグ', '原因は闇の中'),
  c('n11', 'N', 'charm', '読まれない README', '書いた日が一番輝いていた'),
  c('n12', 'N', 'armor', '黄色い警告', 'エラーじゃないから'),
  c('n13', 'N', 'armor', '空っぽの catch', '何も起きなかったことにする'),
  c('n14', 'N', 'weapon', 'どこかで見たコード片', '出どころは覚えていない'),
  c('n15', 'N', 'armor', '終わらないビルド', 'お茶を淹れる時間'),
  c('n16', 'N', 'charm', '使われない import', 'いつかの名残'),
  c('r01', 'R', 'weapon', 'きれいな差分', 'レビューが一瞬で終わる'),
  c('r02', 'R', 'armor', '型エラー 0 件', '赤い波線が消えた'),
  c('r03', 'R', 'charm', '意味のあるコミットメッセージ', '半年後の自分が喜ぶ'),
  c('r04', 'R', 'armor', 'すぐ終わった CI', '待つ間もなかった'),
  c('r05', 'R', 'weapon', '見つかった再現手順', '半分は直ったも同然'),
  c('r06', 'R', 'weapon', '消せたデッドコード', '消すのは書くより気持ちいい'),
  c('r07', 'R', 'armor', '効いたキャッシュ', '二回目は一瞬'),
  c('r08', 'R', 'charm', '読める関数名', 'コメントがいらない'),
  c('r09', 'R', 'armor', '通った lint', '文句ひとつない'),
  c('r10', 'R', 'charm', '小さなプルリク', '誰もこわがらない'),
  c('r11', 'R', 'weapon', '先に書いたテスト', '迷わず進める'),
  c('r12', 'R', 'charm', '当たった仮説', 'ログが味方した'),
  c('s01', 'SR', 'weapon', '一行で直ったバグ', '三時間さがして一行'),
  c('s02', 'SR', 'armor', '競合なしのマージ', '何事もなかったように混ざる'),
  c('s03', 'SR', 'charm', 'ぴたりと決まった名前', '命名の神が降りてきた'),
  c('s04', 'SR', 'armor', '金曜夕方の無事なデプロイ', '誰も呼び出されない週末'),
  c('s05', 'SR', 'weapon', '二倍速くなった処理', '計測は嘘をつかない'),
  c('s06', 'SR', 'armor', '静かなビルドログ', '警告がひとつも出ない'),
  c('s07', 'SR', 'charm', '一度で通ったレビュー', '承認がすぐに付いた'),
  c('s08', 'SR', 'charm', '説明書どおりに動いた API', '書いてある通りだった'),
  c('x01', 'SSR', 'weapon', '一発で通ったテスト', '書いて走らせたら全部緑'),
  c('x02', 'SSR', 'charm', 'つかまえた幽霊バグ', 'たまにしか出ないあの子をついに'),
  c('x03', 'SSR', 'weapon', '千行の削除', '機能はそのまま、コードは半分'),
  c('x04', 'SSR', 'armor', '障害ゼロの一年', 'ずっと平和だった'),
]

export const RARITIES: readonly GachaRarity[] = ['SSR', 'SR', 'R', 'N']
const BY_ID = new Map(CARDS.map(x => [x.id, x]))
export const cardOf = (id: string) => BY_ID.get(id)

/** 出る確率 (%)。ノーミス (そのターンのエラーが 0) なら SR と SSR が少し上がる */
export const rates = (isClean: boolean): Record<GachaRarity, number> =>
  isClean ? { SSR: 3, SR: 13, R: 28, N: 56 } : { SSR: 2, SR: 10, R: 28, N: 60 }

/** 0 以上 1 未満の数 2 つから 1 枚選ぶ。r1 でレア度、r2 でそのレア度の中の 1 枚 */
export function pull(r1: number, r2: number, isClean: boolean): Card {
  const p = rates(isClean)
  let edge = 0
  let rarity: GachaRarity = 'N'
  for (const r of RARITIES) {
    // 百分率の整数で足す (0.02 + 0.1 のような小数の誤差を避ける)
    edge += p[r]
    if (r1 * 100 < edge) {
      rarity = r
      break
    }
  }
  const pool = CARDS.filter(x => x.rarity === rarity)
  return pool[Math.min(pool.length - 1, Math.floor(r2 * pool.length))] ?? CARDS[0]!
}

export const MANUAL_PER_DAY = 3
export const KEEP_HISTORY = 10

export const EMPTY: GachaSave = { book: {}, total: 0, manualDay: '', manualUsed: 0, history: [] }

/** 手元の日付 YYYY-MM-DD */
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 今日あと何回手で引けるか */
export const manualLeft = (s: GachaSave, now: number) => MANUAL_PER_DAY - (s.manualDay === dayKey(now) ? s.manualUsed : 0)

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** store から読んだ値を形にそろえる。知らないカードや壊れた値は捨てる */
export function fromSaved(raw: unknown): GachaSave {
  if (typeof raw !== 'object' || raw === null) return EMPTY
  const o = raw as Record<string, unknown>
  const book: GachaSave['book'] = {}
  if (typeof o.book === 'object' && o.book !== null)
    for (const [id, v] of Object.entries(o.book as Record<string, unknown>)) {
      const x = (v ?? {}) as Record<string, unknown>
      if (BY_ID.has(id) && num(x.count) > 0) book[id] = { count: num(x.count), firstAt: num(x.firstAt) }
    }
  const history = (Array.isArray(o.history) ? o.history : [])
    .filter((d): d is GachaDraw => typeof d === 'object' && d !== null && BY_ID.has(String((d as GachaDraw).cardId)))
    .slice(0, KEEP_HISTORY)
    .map(d => ({ cardId: d.cardId, at: num(d.at), isNew: d.isNew === true, isClean: d.isClean === true, isManual: d.isManual === true }))
  return {
    book,
    total: num(o.total),
    manualDay: typeof o.manualDay === 'string' ? o.manualDay : '',
    manualUsed: num(o.manualUsed),
    history,
  }
}

/** 1 枚引いた後の保存の形 */
export function addDraw(s: GachaSave, card: Card, now: number, flags: { isClean: boolean; isManual: boolean }): GachaSave {
  const had = s.book[card.id]
  const draw: GachaDraw = { cardId: card.id, at: now, isNew: !had, isClean: flags.isClean, isManual: flags.isManual }
  const today = dayKey(now)
  return {
    book: { ...s.book, [card.id]: { count: (had?.count ?? 0) + 1, firstAt: had?.firstAt ?? now } },
    total: s.total + 1,
    manualDay: flags.isManual ? today : s.manualDay,
    manualUsed: flags.isManual ? (s.manualDay === today ? s.manualUsed : 0) + 1 : s.manualUsed,
    history: [draw, ...s.history].slice(0, KEEP_HISTORY),
  }
}

/** レア度ごとの持っている種類・全種類・枚数 */
export function rarityStats(s: GachaSave) {
  return RARITIES.map(r => {
    const all = CARDS.filter(x => x.rarity === r)
    const owned = all.filter(x => s.book[x.id])
    return { rarity: r, owned: owned.length, all: all.length, count: owned.reduce((n, x) => n + (s.book[x.id]?.count ?? 0), 0) }
  })
}

export const ownedKinds = (s: GachaSave) => CARDS.filter(x => s.book[x.id]).length

/** 他の mod に見せるカードの表 (一言は除く)。state の cards に置く */
export const PUBLIC_CARDS: GachaCard[] = CARDS.map(({ id, rarity, slot, name }) => ({ id, rarity, slot, name }))

// ── 図鑑の実績 (図鑑から毎回数えるので、保存はしない)

export type BookGoal = { id: string; name: string; hint: string; test: (s: GachaSave) => boolean }
const hasAll = (s: GachaSave, r: GachaRarity) => CARDS.every(x => x.rarity !== r || s.book[x.id])

export const BOOK_GOALS: readonly BookGoal[] = [
  { id: 'first', name: 'はじめの一枚', hint: '1 枚引く', test: s => ownedKinds(s) >= 1 },
  { id: 'ssr-first', name: '虹色の出会い', hint: 'SSR を 1 枚引く', test: s => CARDS.some(x => x.rarity === 'SSR' && s.book[x.id]) },
  { id: 'n-all', name: 'N コンプ', hint: 'N を 16 種そろえる', test: s => hasAll(s, 'N') },
  { id: 'half', name: '図鑑の半分', hint: '20 種そろえる', test: s => ownedKinds(s) >= 20 },
  { id: 'sr-all', name: 'SR コンプ', hint: 'SR を 8 種そろえる', test: s => hasAll(s, 'SR') },
  { id: 'all', name: '全 40 種', hint: '全部そろえる', test: s => ownedKinds(s) >= CARDS.length },
]

export const goalsMet = (s: GachaSave) => BOOK_GOALS.filter(g => g.test(s))

// ── 描画

/** 絵の中身として決まっている色 (金の枠の真ん中) */
const GOLD_MID = '#f2cc60'
/** レア度の色 (SSR は虹の代わりの紫)。テーマで変わるので呼ぶたびに読む */
export const rarityColor = (r: GachaRarity) => ({ N: C.weak, R: C.blue, SR: C.yellow, SSR: C.purple })[r]
const W = 380

const wide = (ch: string) => /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
const units = (s: string) => [...s].reduce((n, ch) => n + (wide(ch) ? 2 : 1), 0)

/** 幅 (半角いくつ分) に収まるように行を分ける。最大 2 行、はみ出しは … */
export function wrap(s: string, max: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of s) {
    if (units(cur + ch) > max) {
      out.push(cur)
      cur = ''
    }
    cur += ch
  }
  out.push(cur)
  if (out.length <= 2) return out
  const second = out[1] ?? ''
  return [out[0] ?? '', `${second.slice(0, -1)}…`]
}

const svgDoc = (h: number, defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">` +
  `<defs>${defs}</defs><rect width="${W}" height="${h}" fill="${C.bg}"/>${body}</svg>`

// 虹 (SSR)。グラデーションを横に流し続ける
const RAINBOW =
  `<linearGradient id="rainbow" x1="0" y1="0" x2="0.5" y2="0.5" spreadMethod="repeat">` +
  ['#f85149', '#f78166', '#f2cc60', '#3fb950', '#58a6ff', '#bc8cff', '#f85149']
    .map((col, i) => `<stop offset="${(i / 6).toFixed(3)}" stop-color="${col}"/>`)
    .join('') +
  `<animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="0.5 0.5" dur="2.5s" repeatCount="indefinite"/>` +
  `</linearGradient>`
const GOLD =
  `<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="${C.yellow}"/><stop offset="0.5" stop-color="${GOLD_MID}"/><stop offset="1" stop-color="${C.yellow}"/></linearGradient>`
// 光の筋 (SR と SSR)
const SHINE =
  `<linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">` +
  `<stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff6d5" stop-opacity="0.55"/>` +
  `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`
const GLOW = `<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>`

const strokeOf = (r: GachaRarity) => (r === 'SSR' ? 'url(#rainbow)' : r === 'SR' ? 'url(#gold)' : rarityColor(r))

/** 4 つの角を持つきらめき */
const sparkle = (x: number, y: number, size: number, begin: number) =>
  `<path d="M${x} ${y - size} Q${x} ${y} ${x + size} ${y} Q${x} ${y} ${x} ${y + size} Q${x} ${y} ${x - size} ${y} Q${x} ${y} ${x} ${y - size}Z" fill="#ffffff" opacity="0">` +
  `<animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="${begin}s" repeatCount="indefinite"/></path>`

const star = (x: number, y: number, r: number, fill: string) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 === 0 ? r : r * 0.45
    return `${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`
  })
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`
}

const STARS: Record<GachaRarity, number> = { N: 1, R: 2, SR: 3, SSR: 4 }

/** 最新のカードを大きく。めくれて現れ、レア度で枠と光が変わる */
export function cardSvg(draw: GachaDraw | undefined): string {
  const H = 330
  const card = draw ? cardOf(draw.cardId) : undefined
  if (!draw || !card) {
    return svgDoc(
      H,
      '',
      `<rect x="80" y="14" width="220" height="300" rx="16" fill="${C.face}" stroke="${C.line}" stroke-width="2" stroke-dasharray="6 6"/>` +
        `<text x="190" y="150" font-size="40" font-weight="bold" fill="${C.line}" text-anchor="middle">?</text>` +
        `<text x="190" y="196" font-size="13" fill="${C.weak}" text-anchor="middle">まだ引いていません</text>` +
        `<text x="190" y="218" font-size="12" fill="${C.weak}" text-anchor="middle">ターンが終わると 1 回引けます</text>`,
    )
  }
  const r = card.rarity
  const stroke = strokeOf(r)
  const color = rarityColor(r)
  const isHigh = r === 'SR' || r === 'SSR'
  // カードの中身は中心 (0,0) から描き、外の g でめくる
  let body = ''
  // 後ろの光 (SR 以上は脈打つ)
  if (r !== 'N')
    body +=
      `<rect x="-112" y="-152" width="224" height="304" rx="18" fill="none" stroke="${stroke}" stroke-width="10" filter="url(#glow)" opacity="${isHigh ? 0.9 : 0.5}">` +
      (isHigh ? `<animate attributeName="opacity" values="0.35;0.95;0.35" dur="2s" repeatCount="indefinite"/>` : '') +
      `</rect>`
  body += `<rect x="-110" y="-150" width="220" height="300" rx="16" fill="${C.face}" stroke="${stroke}" stroke-width="4"/>`
  body += `<rect x="-100" y="-140" width="200" height="280" rx="10" fill="none" stroke="${stroke}" stroke-width="1" opacity="0.5"/>`
  // レア度の大きな文字と星
  body += `<text x="0" y="-100" font-size="34" font-weight="bold" fill="${stroke}" text-anchor="middle">${r}</text>`
  const n = STARS[r]
  for (let i = 0; i < n; i++) body += star((i - (n - 1) / 2) * 22, -76, 8, r === 'SSR' ? 'url(#rainbow)' : color)
  // 真ん中の紋章
  body +=
    `<circle cx="0" cy="-12" r="40" fill="${C.bg}" stroke="${stroke}" stroke-width="2"/>` +
    `<circle cx="0" cy="-12" r="31" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3 4" opacity="0.8">` +
    `<animateTransform attributeName="transform" type="rotate" from="0 0 -12" to="360 0 -12" dur="${isHigh ? 6 : 14}s" repeatCount="indefinite"/></circle>` +
    `<text x="0" y="-5" font-size="20" font-weight="bold" fill="${C.text}" text-anchor="middle">${esc(card.id.toUpperCase())}</text>`
  // 名前と一言
  const name = wrap(card.name, 22)
  name.forEach((t, i) => {
    body += `<text x="0" y="${name.length === 1 ? 58 : 50 + i * 21}" font-size="17" font-weight="bold" fill="${C.text}" text-anchor="middle">${esc(t)}</text>`
  })
  wrap(card.line, 30).forEach((t, i) => {
    body += `<text x="0" y="${97 + i * 16}" font-size="12" fill="${C.weak}" text-anchor="middle">${esc(t)}</text>`
  })
  // 下の札
  const tags: [string, string][] = []
  if (draw.isNew) tags.push(['NEW', C.green])
  if (draw.isClean) tags.push(['ノーミス', C.yellow])
  tags.push([draw.isManual ? '手動' : 'ターン', C.weak])
  let x = -tags.reduce((w, [t]) => w + units(t) * 6.5 + 18, 0) / 2 + 4
  for (const [t, col] of tags) {
    const w = units(t) * 6.5 + 14
    body +=
      `<rect x="${x}" y="122" width="${w}" height="18" rx="9" fill="none" stroke="${col}"/>` +
      `<text x="${x + w / 2}" y="135" font-size="12" fill="${col}" text-anchor="middle">${esc(t)}</text>`
    x += w + 4
  }
  // 光の筋 (SR 以上)
  if (isHigh)
    body +=
      `<g clip-path="url(#card)"><rect x="-260" y="-160" width="90" height="320" fill="url(#shine)" transform="skewX(-20)">` +
      `<animate attributeName="x" values="-260;300" dur="${r === 'SSR' ? 1.8 : 2.6}s" begin="0.6s" repeatCount="indefinite"/></rect></g>`
  if (r === 'SSR') body += sparkle(-92, -128, 9, 0.2) + sparkle(94, -60, 7, 0.9) + sparkle(-88, 100, 8, 1.3) + sparkle(90, 130, 10, 0.5)

  const defs =
    (r === 'SSR' ? RAINBOW : '') +
    (r === 'SR' ? GOLD : '') +
    (isHigh ? `${SHINE}<clipPath id="card"><rect x="-110" y="-150" width="220" height="300" rx="16"/></clipPath>` : '') +
    (r !== 'N' ? GLOW : '')
  // めくれる: 横の倍率を 0 から 1 へ。SSR は一度ふくらむ
  const flip =
    r === 'SSR'
      ? `<animateTransform attributeName="transform" type="scale" values="0 1;1.08 1.08;1 1" keyTimes="0;0.7;1" dur="0.9s" fill="freeze"/>`
      : `<animateTransform attributeName="transform" type="scale" values="0 1;1 1" dur="0.5s" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1" fill="freeze"/>`
  return svgDoc(H, defs, `<g transform="translate(190 165)"><g>${flip}${body}</g></g>`)
}

/** 図鑑のコンプ率リング・レア度別の所持数・直近 10 回 */
export function statsSvg(s: GachaSave, left: number): string {
  const owned = ownedKinds(s)
  const pct = Math.round((owned / CARDS.length) * 100)
  const R = 44
  const len = 2 * Math.PI * R
  const arc = (owned / CARDS.length) * len
  let b = `<rect x="8" y="8" width="364" height="140" rx="8" fill="${C.face}" stroke="${C.line}"/>`
  b +=
    `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${C.bg}" stroke-width="12"/>` +
    `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${owned === CARDS.length ? C.yellow : C.green}" stroke-width="12" stroke-linecap="round" ` +
    `stroke-dasharray="${arc.toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 70 70)">` +
    `<animate attributeName="stroke-dasharray" from="0 ${len.toFixed(1)}" to="${arc.toFixed(1)} ${len.toFixed(1)}" dur="0.8s" fill="freeze"/></circle>` +
    `<text x="70" y="76" font-size="20" font-weight="bold" fill="${C.text}" text-anchor="middle">${pct}%</text>` +
    `<text x="70" y="136" font-size="12" fill="${C.weak}" text-anchor="middle">${owned} / ${CARDS.length} 種</text>`
  rarityStats(s).forEach((x, i) => {
    const y = 22 + i * 26
    const col = rarityColor(x.rarity)
    b +=
      `<rect x="136" y="${y}" width="36" height="18" rx="4" fill="none" stroke="${col}"/>` +
      `<text x="154" y="${y + 13}" font-size="12" font-weight="bold" fill="${col}" text-anchor="middle">${x.rarity}</text>` +
      `<rect x="180" y="${y + 6}" width="96" height="6" rx="3" fill="${C.bg}"/>` +
      (x.owned ? `<rect x="180" y="${y + 6}" width="${((x.owned / x.all) * 96).toFixed(1)}" height="6" rx="3" fill="${col}"/>` : '') +
      `<text x="284" y="${y + 13}" font-size="12" fill="${C.text}">${x.owned}/${x.all}種</text>` +
      `<text x="364" y="${y + 13}" font-size="12" fill="${C.weak}" text-anchor="end">${x.count}枚</text>`
  })
  b += `<text x="136" y="136" font-size="12" fill="${C.weak}">累計 ${s.total} 回 / 今日の手動 あと ${Math.max(0, left)} 回</text>`

  let y = 176
  b += `<text x="12" y="${y}" font-size="13" font-weight="bold" fill="${C.text}">直近 ${KEEP_HISTORY} 回</text>`
  y += 10
  if (s.history.length === 0) {
    b += `<text x="12" y="${y + 18}" font-size="12" fill="${C.weak}">まだ引いていません</text>`
    y += 30
  }
  for (const d of s.history) {
    const card = cardOf(d.cardId)
    if (!card) continue
    const col = rarityColor(card.rarity)
    b +=
      `<rect x="12" y="${y + 4}" width="36" height="18" rx="4" fill="${col}" opacity="0.2"/>` +
      `<text x="30" y="${y + 17}" font-size="12" font-weight="bold" fill="${col}" text-anchor="middle">${card.rarity}</text>` +
      `<text x="56" y="${y + 17}" font-size="13" fill="${C.text}">${esc(wrap(card.name, 34)[0] ?? '')}</text>` +
      (d.isNew ? `<text x="364" y="${y + 17}" font-size="12" fill="${C.green}" text-anchor="end">NEW</text>` : '')
    y += 24
  }
  return svgDoc(y + 10, '', b)
}

/** 装備の枠の一文字 (dev-rpg で装備できる場所) */
export const SLOT_GLYPH: Record<GachaSlot, string> = { weapon: '武', armor: '防', charm: '守' }

/** 図鑑の一覧。上に図鑑の実績、持っていないカードは ？？？ */
export function bookSvg(s: GachaSave): string {
  const met = new Set(goalsMet(s).map(g => g.id))
  let b = header('図鑑', `${ownedKinds(s)} / ${CARDS.length} 種、実績 ${met.size} / ${BOOK_GOALS.length}`, C.purple)
  let y = HEADER_H + 8
  BOOK_GOALS.forEach((g, i) => {
    const cx = i % 2 === 0 ? 8 : 192
    const cy = y + Math.floor(i / 2) * 42
    const isMet = met.has(g.id)
    b +=
      `<rect x="${cx}" y="${cy}" width="180" height="36" rx="6" fill="${isMet ? C.face : C.bg}" stroke="${isMet ? C.yellow : C.line}"${isMet ? '' : ' stroke-dasharray="4 3"'}/>` +
      `<text x="${cx + 10}" y="${cy + 16}" font-size="12" font-weight="bold" fill="${isMet ? C.yellow : C.weak}">${esc(g.name)}</text>` +
      `<text x="${cx + 10}" y="${cy + 30}" font-size="12" fill="${C.weak}">${isMet ? '達成' : esc(g.hint)}</text>`
  })
  y += Math.ceil(BOOK_GOALS.length / 2) * 42 + 6
  for (const x of rarityStats(s)) {
    const col = rarityColor(x.rarity)
    b +=
      `<text x="12" y="${y + 18}" font-size="14" font-weight="bold" fill="${col}">${x.rarity}</text>` +
      `<text x="368" y="${y + 18}" font-size="12" fill="${C.weak}" text-anchor="end">${x.owned} / ${x.all} 種</text>`
    y += 28
    CARDS.filter(k => k.rarity === x.rarity).forEach((k, i) => {
      const cx = i % 2 === 0 ? 8 : 192
      const cy = y + Math.floor(i / 2) * 36
      const has = s.book[k.id]
      b += `<rect x="${cx}" y="${cy}" width="180" height="30" rx="6" fill="${has ? C.face : C.bg}" stroke="${has ? col : C.line}"/>`
      b += has
        ? `<text x="${cx + 8}" y="${cy + 20}" font-size="12" fill="${C.text}">${esc(wrap(k.name, 19)[0] ?? '')}${wrap(k.name, 19).length > 1 ? '…' : ''}</text>` +
          `<text x="${cx + 150}" y="${cy + 20}" font-size="12" fill="${C.weak}" text-anchor="end">${SLOT_GLYPH[k.slot]}</text>` +
          `<text x="${cx + 172}" y="${cy + 20}" font-size="12" fill="${col}" text-anchor="end">${has.count}</text>`
        : `<text x="${cx + 8}" y="${cy + 20}" font-size="12" fill="${C.weak}">？？？</text>`
    })
    y += Math.ceil(x.all / 2) * 36 + 8
  }
  return svgDoc(y, '', b)
}

export type Line = { text: string; color?: string; isDim?: boolean; isBold?: boolean }
const TERM_COLOR: Record<GachaRarity, string | undefined> = { N: undefined, R: 'blue', SR: 'yellow', SSR: 'magenta' }

/** Svg の alt と terminal で使う、カードの行 */
export function cardLines(draw: GachaDraw | undefined): Line[] {
  const card = draw ? cardOf(draw.cardId) : undefined
  if (!draw || !card) return [{ text: 'まだ引いていません(ターンが終わると 1 回引けます)', isDim: true }]
  const tags = [draw.isNew ? 'NEW' : '', draw.isClean ? 'ノーミス補正' : '', draw.isManual ? '手で引いた' : 'ターン終わり'].filter(Boolean)
  return [
    { text: `【${card.rarity}】${card.name}`, color: TERM_COLOR[card.rarity], isBold: true },
    { text: `「${card.line}」`, isDim: true },
    { text: tags.join(' / '), isDim: true },
  ]
}

/** Svg の alt と terminal で使う、図鑑と履歴の行 */
export function statsLines(s: GachaSave, left: number): Line[] {
  const owned = ownedKinds(s)
  return [
    { text: `図鑑 ${owned} / ${CARDS.length} 種 (${Math.round((owned / CARDS.length) * 100)}%)`, isBold: true },
    { text: rarityStats(s).map(x => `${x.rarity} ${x.owned}/${x.all}種 ${x.count}枚`).join(' / ') },
    { text: `累計 ${s.total} 回 / 今日の手動 あと ${Math.max(0, left)} 回`, isDim: true },
    ...s.history.flatMap(d => {
      const card = cardOf(d.cardId)
      return card ? [{ text: `${card.rarity.padEnd(3)} ${card.name}${d.isNew ? ' NEW' : ''}`, color: TERM_COLOR[card.rarity] }] : []
    }),
  ]
}

/** Svg の alt と terminal で使う、図鑑の一覧の行 */
export function bookLines(s: GachaSave): Line[] {
  const met = new Set(goalsMet(s).map(g => g.id))
  const goals: Line[] = BOOK_GOALS.map(g =>
    met.has(g.id) ? { text: `実績 ${g.name} 達成`, color: 'yellow' } : { text: `実績 ${g.name} まだ(${g.hint})`, isDim: true },
  )
  return [...goals, ...CARDS.map((k): Line => {
    const has = s.book[k.id]
    return has
      ? { text: `${k.rarity.padEnd(3)} ${k.name} ${has.count}枚`, color: TERM_COLOR[k.rarity] }
      : { text: `${k.rarity.padEnd(3)} ？？？`, isDim: true }
  })]
}
