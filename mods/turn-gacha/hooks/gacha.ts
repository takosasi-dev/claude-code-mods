// カードの表・抽選・保存の形・SVG と terminal 用の行。どれも純関数
import type { GachaDraw, GachaRarity, GachaSave } from '../types'

export type Card = { id: string; rarity: GachaRarity; name: string; line: string }

const c = (id: string, rarity: GachaRarity, name: string, line: string): Card => ({ id, rarity, name, line })

/** カードの表 (N 16 / R 12 / SR 8 / SSR 4)。id は保存に使うので変えない */
export const CARDS: readonly Card[] = [
  c('n01', 'N', '消し忘れた console.log', '本番で誰かが読んでいる'),
  c('n02', 'N', 'TODO: あとで直す', 'あとは来ない'),
  c('n03', 'N', '行末の空白', '差分にだけ姿を見せる'),
  c('n04', 'N', 'タブと空白の混在', '静かな戦争'),
  c('n05', 'N', '謎の数字 42', '意味は誰も知らない'),
  c('n06', 'N', 'コメントアウトした旧コード', 'いつか使うかもしれない'),
  c('n07', 'N', '開きっぱなしのタブ 50 枚', 'どれが本物の資料か'),
  c('n08', 'N', '長すぎる変数名', '説明だけはできている'),
  c('n09', 'N', 'final_v3_本当の最終版', '最終版はまだ先'),
  c('n10', 'N', '再起動で直ったバグ', '原因は闇の中'),
  c('n11', 'N', '読まれない README', '書いた日が一番輝いていた'),
  c('n12', 'N', '黄色い警告', 'エラーじゃないから'),
  c('n13', 'N', '空っぽの catch', '何も起きなかったことにする'),
  c('n14', 'N', 'どこかで見たコード片', '出どころは覚えていない'),
  c('n15', 'N', '終わらないビルド', 'お茶を淹れる時間'),
  c('n16', 'N', '使われない import', 'いつかの名残'),
  c('r01', 'R', 'きれいな差分', 'レビューが一瞬で終わる'),
  c('r02', 'R', '型エラー 0 件', '赤い波線が消えた'),
  c('r03', 'R', '意味のあるコミットメッセージ', '半年後の自分が喜ぶ'),
  c('r04', 'R', 'すぐ終わった CI', '待つ間もなかった'),
  c('r05', 'R', '見つかった再現手順', '半分は直ったも同然'),
  c('r06', 'R', '消せたデッドコード', '消すのは書くより気持ちいい'),
  c('r07', 'R', '効いたキャッシュ', '二回目は一瞬'),
  c('r08', 'R', '読める関数名', 'コメントがいらない'),
  c('r09', 'R', '通った lint', '文句ひとつない'),
  c('r10', 'R', '小さなプルリク', '誰もこわがらない'),
  c('r11', 'R', '先に書いたテスト', '迷わず進める'),
  c('r12', 'R', '当たった仮説', 'ログが味方した'),
  c('s01', 'SR', '一行で直ったバグ', '三時間さがして一行'),
  c('s02', 'SR', '競合なしのマージ', '何事もなかったように混ざる'),
  c('s03', 'SR', 'ぴたりと決まった名前', '命名の神が降りてきた'),
  c('s04', 'SR', '金曜夕方の無事なデプロイ', '誰も呼び出されない週末'),
  c('s05', 'SR', '二倍速くなった処理', '計測は嘘をつかない'),
  c('s06', 'SR', '静かなビルドログ', '警告がひとつも出ない'),
  c('s07', 'SR', '一度で通ったレビュー', '承認がすぐに付いた'),
  c('s08', 'SR', '説明書どおりに動いた API', '書いてある通りだった'),
  c('x01', 'SSR', '一発で通ったテスト', '書いて走らせたら全部緑'),
  c('x02', 'SSR', 'つかまえた幽霊バグ', 'たまにしか出ないあの子をついに'),
  c('x03', 'SSR', '千行の削除', '機能はそのまま、コードは半分'),
  c('x04', 'SSR', '障害ゼロの一年', 'ずっと平和だった'),
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

// ── 描画

const C = {
  bg: '#0d1117',
  face: '#161b22',
  line: '#30363d',
  text: '#c9d1d9',
  weak: '#8b949e',
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
  orange: '#f78166',
  gold: '#f2cc60',
}
/** レア度の色 (SSR は虹の代わりの紫) */
export const RARITY_COLOR: Record<GachaRarity, string> = { N: C.weak, R: C.blue, SR: C.yellow, SSR: C.purple }
const W = 380

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
  `<stop offset="0" stop-color="${C.yellow}"/><stop offset="0.5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.yellow}"/></linearGradient>`
// 光の筋 (SR と SSR)
const SHINE =
  `<linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">` +
  `<stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff6d5" stop-opacity="0.55"/>` +
  `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`
const GLOW = `<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>`

const strokeOf = (r: GachaRarity) => (r === 'SSR' ? 'url(#rainbow)' : r === 'SR' ? 'url(#gold)' : RARITY_COLOR[r])

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
  const color = RARITY_COLOR[r]
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
    const col = RARITY_COLOR[x.rarity]
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
    const col = RARITY_COLOR[card.rarity]
    b +=
      `<rect x="12" y="${y + 4}" width="36" height="18" rx="4" fill="${col}" opacity="0.2"/>` +
      `<text x="30" y="${y + 17}" font-size="12" font-weight="bold" fill="${col}" text-anchor="middle">${card.rarity}</text>` +
      `<text x="56" y="${y + 17}" font-size="13" fill="${C.text}">${esc(wrap(card.name, 34)[0] ?? '')}</text>` +
      (d.isNew ? `<text x="364" y="${y + 17}" font-size="12" fill="${C.green}" text-anchor="end">NEW</text>` : '')
    y += 24
  }
  return svgDoc(y + 10, '', b)
}

/** 図鑑の一覧。持っていないカードは ？？？ */
export function bookSvg(s: GachaSave): string {
  let b = ''
  let y = 8
  for (const x of rarityStats(s)) {
    const col = RARITY_COLOR[x.rarity]
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
        ? `<text x="${cx + 8}" y="${cy + 20}" font-size="12" fill="${C.text}">${esc(wrap(k.name, 21)[0] ?? '')}${wrap(k.name, 21).length > 1 ? '…' : ''}</text>` +
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
  return CARDS.map(k => {
    const has = s.book[k.id]
    return has
      ? { text: `${k.rarity.padEnd(3)} ${k.name} ${has.count}枚`, color: TERM_COLOR[k.rarity] }
      : { text: `${k.rarity.padEnd(3)} ？？？`, isDim: true }
  })
}
