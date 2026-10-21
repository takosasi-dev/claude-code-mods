// README に載せる各 mod の画面の「動く絵」を GIF にする。node 24 でそのまま動く (型は node が外す)
//
//   node tools/gif.mts mod-hub cc-dash   名前を渡した mod を docs/images/<mod>.gif に書く (名前は必須)
//   --light                              明るいテーマで撮って docs/images/<mod>-light.gif に書く
//   --sec=2 --fps=15 --scale=2 --hold=0.5  動く長さ (秒)・1 秒のコマ数・解像度の倍率・終わりで止める長さ (秒)
//   --chrome=<path> か 環境変数 CHROME   Chrome の場所 (既定は Windows の標準の場所)
//   ffmpeg は PATH にある物を使う
//
// 架空のデータは tools/shots.mts の SHOTS をそのまま使う (下の loadShots。tools/perf.mts も使う)。
// <img> の SVG は窓なしの Chrome では SMIL が進まないので、SVG をページにじかに入れ、
// svg.pauseAnimations() と svg.setCurrentTime(t) で時刻を決める。1 コマ = 1 つの iframe
// (同じ SVG を並べても id がぶつからないように) にして、全コマを格子に並べた 1 枚を 1 回だけ撮り、
// ffmpeg で 1 コマずつ切り出して GIF にする。一時ファイルは os.tmpdir() の下に作って最後に消す。
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Pic = string | { svg: string; at: number }
type Shots = Record<string, () => Promise<Pic[]>>

const SHOTS_FILE = new URL('./shots.mts', import.meta.url)

/**
 * tools/shots.mts の SHOTS と load を読む。shots.mts は読み込むと撮影まで走るので、
 * `export const SHOTS` があって実行部が `if (import.meta.main)` の中ならそのまま import し、
 * そうでなければソースから SHOTS の表と、その上の定義 (load・NOW・seeded など) を切り出して一時の .mts から読む。
 */
export async function loadShots(): Promise<{ SHOTS: Shots; load: (file: string) => Promise<any> }> {
  const src = readFileSync(SHOTS_FILE, 'utf8')
  if (/^export const SHOTS\b/m.test(src) && /import\.meta\.main/.test(src)) {
    const m = await import(SHOTS_FILE.href)
    if (m.SHOTS && m.load) return m
  }
  const start = src.search(/^const SHOTS\b/m)
  const end = src.indexOf('// ---- HTML と PNG ----')
  if (start < 0 || end < start) throw new Error('tools/shots.mts から SHOTS を切り出せません。shots.mts に export const SHOTS と import.meta.main の囲みを入れてください')
  // 一時ファイルから読むので、mods の場所の基準 (import.meta.url) を shots.mts の場所に差し替える
  const code = (src.slice(0, start).replaceAll('import.meta.url', JSON.stringify(SHOTS_FILE.href)) + src.slice(start, end)) + '\nexport { SHOTS, load }\n'
  const dir = mkdtempSync(join(tmpdir(), 'shots-src-'))
  try {
    const file = join(dir, 'shots-table.mts')
    writeFileSync(file, code)
    return await import(pathToFileURL(file).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const PAD = 10
const GAP = 8
const IMG_W = 380 - PAD * 2

const heightOf = (svg: string) => {
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg)
  if (!vb) throw new Error('viewBox が無い SVG')
  return (IMG_W * Number(vb[2])) / Number(vb[1])
}

const attr = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

/** t 秒の所で止めた 1 コマのページ (iframe の中身) */
const frame = (svgs: string[], bg: string, t: number) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>` +
  `html,body{margin:0;background:${bg}}body{width:380px;padding:${PAD}px;box-sizing:border-box}` +
  `body>div{line-height:0}body>div+div{margin-top:${GAP}px}svg{width:100%;height:auto;display:block}</style></head><body>` +
  svgs.map(s => `<div>${s}</div>`).join('') +
  // SMIL は svg ごとに時刻を決め、CSS の動きも同じ時刻で止める
  `<script>for(const s of document.querySelectorAll('svg'))if(!s.ownerSVGElement){s.pauseAnimations();s.setCurrentTime(${t})}` +
  `for(const a of document.getAnimations()){a.pause();a.currentTime=${t * 1000}}</script></body></html>`

async function makeGif(mod: string, make: () => Promise<Pic[]>, o: { light: boolean; sec: number; hold: number; fps: number; scale: number; chrome: string; tmp: string; outDir: string; load: (f: string) => Promise<any> }) {
  const style = await o.load(`${mod}/hooks/style.ts`)
  style.setTheme(o.light)
  const svgs = (await make()).map(p => (typeof p === 'string' ? p : p.svg))
  const h = Math.ceil(PAD * 2 + GAP * (svgs.length - 1) + svgs.reduce((n, s) => n + heightOf(s), 0))
  const n = Math.round(o.sec * o.fps)
  const cols = Math.min(n, 8)
  const rows = Math.ceil(n / cols)
  const cells = Array.from({ length: n }, (_, k) =>
    `<iframe style="width:380px;height:${h}px;border:0;display:block;float:left" srcdoc="${attr(frame(svgs, style.C.bg, k / o.fps))}"></iframe>`,
  )
  const html = join(o.tmp, `${mod}.html`)
  const sheet = join(o.tmp, `${mod}.png`)
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:${cols * 380}px;background:${style.C.bg}">${cells.join('')}</body></html>`)
  execFileSync(
    o.chrome,
    [
      '--headless=new',
      `--screenshot=${sheet}`,
      `--window-size=${cols * 380},${rows * h}`,
      `--force-device-scale-factor=${o.scale}`,
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=2000',
      `--user-data-dir=${join(o.tmp, 'profile')}`,
      pathToFileURL(html).href,
    ],
    // Chrome は TEMP に .tmp や scoped_dir を残すので、TEMP も消す一時フォルダに向ける
    { stdio: 'ignore', timeout: 120_000, env: { ...process.env, TEMP: o.tmp, TMP: o.tmp } },
  )
  // 1 コマの大きさ (画面の画素)。格子の n 番目を切り出す
  const w = Math.round(380 * o.scale)
  const ch = Math.round(h * o.scale)
  const gif = join(o.outDir, `${mod}${o.light ? '-light' : ''}.gif`)
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    // 入力の長さを切らないと palettegen が終わりを待ち続ける
    '-loop', '1', '-framerate', String(o.fps), '-t', String(n / o.fps), '-i', sheet,
    // 終わりの絵を hold 秒だけ止めてから頭に戻る
    '-vf', `crop=${w}:${ch}:mod(n\\,${cols})*${w}:floor(n/${cols})*${ch},tpad=stop_mode=clone:stop_duration=${o.hold},split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0',
    gif,
  ], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 120_000 })
  const kb = Math.round(statSync(gif).size / 1024)
  console.log(`${mod}${o.light ? '-light' : ''}.gif  ${w}x${ch}  ${n} コマ  ${kb}KB${kb > 1024 ? '  (1MB を超えました。--scale か --fps を下げてください)' : ''}`)
}

/** SHOTS の絵が止まっている物は、GIF だけ動く方のデータで描く (sec はその既定の長さ) */
const MOVING: Record<string, { sec: number; make: (load: (f: string) => Promise<any>) => Promise<Pic[]> }> = {
  // SHOTS は振り終わった紙だけ。GIF は筒を振って紙が開くまで
  'code-omikuji': {
    sec: 4,
    make: async load => {
      const m = await load('code-omikuji/hooks/omikuji.ts')
      const today = m.jstDate(Date.now())
      const history = m.lastDays(today, 7).map((date: string) => ({ date, rank: m.fortune(date).rank }))
      return [m.paneSvg(m.fortune(today), today, history, { isShake: true, isPlay: false })]
    },
  },
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const opt = (name: string, def: number) => Number(args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? def)
  const only = args.filter(a => !a.startsWith('--'))
  const { SHOTS, load } = await loadShots()
  if (!only.length) throw new Error(`mod の名前を渡してください (使える物: ${Object.keys(SHOTS).join(', ')})`)
  const unknown = only.filter(n => !(n in SHOTS))
  if (unknown.length) throw new Error(`知らない mod: ${unknown.join(', ')}`)
  const outDir = fileURLToPath(new URL('../docs/images/', import.meta.url))
  mkdirSync(outDir, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'gif-'))
  const o = {
    light: args.includes('--light'),
    sec: opt('sec', 2),
    hold: opt('hold', 0.5),
    fps: opt('fps', 15),
    scale: opt('scale', 2),
    chrome: args.find(a => a.startsWith('--chrome='))?.slice(9) ?? process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    tmp,
    outDir,
    load,
  }
  try {
    for (const mod of only) {
      const moving = MOVING[mod]
      const sec = args.some(a => a.startsWith('--sec=')) || !moving ? o.sec : moving.sec
      await makeGif(mod, moving ? () => moving.make(load) : SHOTS[mod]!, { ...o, sec })
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}
