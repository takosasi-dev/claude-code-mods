import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RpgBattle, RpgGachaCard, RpgHero, RpgSaved, RpgSlot, RpgStat, RpgTab } from '../types'
import { act, battleLines, battleSvg, canUse, endBattle, growthLines, growthSvg, nextBoss, spawnBoss, startBattle } from './battle'
import type { Command } from './battle'
import {
  INITIAL,
  INITIAL_SAVED,
  SKILLS,
  SLOTS,
  SLOT_LABEL,
  STATS,
  STAT_LABEL,
  STAT_NOTE,
  SP_RULE,
  achievementLines,
  achievementsSvg,
  fromSaved,
  gearLines,
  gearSvg,
  grant,
  hpPctAt,
  learnSkill,
  raiseStat,
  respec,
  skillOf,
  spOf,
  levelInfo,
  levelUpText,
  mergeSaved,
  onTool,
  onTurnEnd,
  onTurnStart,
  ownedCards,
  setGear,
  startSession,
  statusLines,
  statusSvg,
  toSaved,
  upgradeHero,
  wear,
  wornOf,
} from './rpg'
import type { Achievement } from './rpg'
import { followTheme, readTheme } from './style'

const PANE = 'dev-rpg'
const TITLE = '冒険の書'
const DESCRIPTION = '作業が経験値になる RPG。魔物と戦い、SP で能力とスキルを育てる'
const STORE_KEY = 'hero'

const HERO = atom({ plugin: 'dev-rpg', key: 'hero' } as const, INITIAL)
const TAB = atom({ plugin: 'dev-rpg', key: 'tab' } as const, 'status' as RpgTab)
const CONFIRM = atom({ plugin: 'dev-rpg', key: 'isConfirmingReset' } as const, false)
const NEWS = atom({ plugin: 'dev-rpg', key: 'news' } as const, '')
const BATTLE = atom({ plugin: 'dev-rpg', key: 'battle' } as const, null as RpgBattle | null)
// turn-gacha の state (読むだけ。turn-gacha が無ければ undefined のまま)
const GACHA_SAVE = { plugin: 'turn-gacha', key: 'save' } as const
const GACHA_CARDS = { plugin: 'turn-gacha', key: 'cards' } as const

type $ = EngineInterface

const BROKEN = '記録を読めなかったので、今の冒険は保存していません'

let ownsMain = false

// store に書く物 (保存・やり直し) は 1 本ずつ流す。重なると同じ差分を 2 回足してしまう
let chain: Promise<unknown> = Promise.resolve()
const serial = (f: () => Promise<unknown>) => (chain = chain.then(f, f))

/** store の値。キーが無ければ最初から、読めない時 (例外・形が違う) は undefined */
async function readStore($: $): Promise<RpgSaved | undefined> {
  try {
    const raw = await $.store.get(STORE_KEY)
    if (raw === undefined) return INITIAL_SAVED
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? fromSaved(raw) : undefined
  } catch {
    return undefined
  }
}

/** state が空なら (新しいセッション・/clear の後) store から読み戻して冒険の回数を足す。リロードなら state の方が新しいのでそのまま */
async function ensureLoaded($: $) {
  const cur = await read($, HERO)
  if (cur.s.startedAt !== 0) {
    // 0.2 の勇者が state に残っていたら (開いたまま /reload-plugins した時) 新しい値を足す
    if (upgradeHero(cur) !== cur) await update($, HERO, upgradeHero)
    return
  }
  const saved = await readStore($)
  if (!saved) await update($, NEWS, () => BROKEN)
  const now = await $.clock.now()
  await update($, HERO, x => (x.s.startedAt === 0 ? startSession(saved ?? INITIAL_SAVED, now) : x))
}

/** 描く時と戦いの手で読む勇者 (0.2 の形のままでも 0.3.0 の値を足して読む。書くのは ensureLoaded) */
const readHero = async ($: $) => upgradeHero(await read($, HERO))

/** 今の store を読み直し、前に合わせた時から増えた分だけを足して書く。画面も store に合わせる */
const save = ($: $) =>
  serial(async () => {
    const store = await readStore($)
    if (!store) {
      await update($, NEWS, () => BROKEN)
      return
    }
    // $.state.get は 1 つの dispatch の中では同じ時点を読むので、差分は update の中 (最新の値) で取る
    let written: RpgSaved | undefined
    await update($, HERO, x0 => {
      if (x0.s.startedAt === 0) return x0
      const x = upgradeHero(x0)
      written = mergeSaved(store, x.synced, toSaved(x))
      return { ...x, ...written, synced: written }
    })
    if (!written) return
    await $.store.set(STORE_KEY, written).catch(async () => {
      // 書けなかった分は、読んだ store からの差分として次に足す
      await update($, HERO, x => ({ ...x, synced: store }))
      await update($, NEWS, () => '記録を保存できませんでした。次のターンの終わりにもう一度書きます')
    })
  })

/** 装備の候補の並び (レア度の高い順) */
const RANK: Record<RpgGachaCard['rarity'], number> = { SSR: 0, SR: 1, R: 2, N: 3 }

/** ガチャで持っているカード。turn-gacha が無い・読めない時は undefined。描画の中で呼ぶと、ガチャが変わった時に描き直る */
async function readOwned($: $): Promise<RpgGachaCard[] | undefined> {
  try {
    return ownedCards((await $.state.get(GACHA_SAVE)).value, (await $.state.get(GACHA_CARDS)).value)
  } catch {
    return undefined
  }
}

/** 変える → 実績を見る。レベルが上がった時だけトーストを出す (store に書くのは save) */
async function change($: $, fn: (h: RpgHero, now: number) => RpgHero, isTurnEnd = false, lead: string[] = []) {
  await ensureLoaded($)
  const now = await $.clock.now()
  const owned = await readOwned($)
  let before = 1
  let gained: Achievement[] = []
  const hero = await update($, HERO, x => {
    before = levelInfo(x.xp).level
    const r = grant(fn(x, now), now, isTurnEnd, owned)
    gained = r.gained
    return r.hero
  })
  const after = levelInfo(hero.xp).level
  const news: string[] = [...lead]
  if (after > before) {
    $.ui.toast(levelUpText(after))
    news.push(levelUpText(after))
  }
  if (gained.length > 0) news.push(`実績「${gained.map(a => a.name).join('」「')}」を手に入れた`)
  if (news.length > 0) await update($, NEWS, () => news.join(' / '))
}

/** HP は時間で減る。整数が変わった時だけ書く (経験値のアニメは動かさない) */
async function refresh($: $) {
  const now = await $.clock.now()
  const hero = await read($, HERO)
  if (hpPctAt(hero, now) === hero.hpPct) return
  await update($, HERO, x => ({ ...x, hpPct: hpPctAt(x, now), xpFrom: levelInfo(x.xp).frac }))
}

/** 枠にカードを着ける (id が空なら外す)。持っていないカードは着けない。装備は最後に書いた物が勝つ */
async function equip($: $, slot: RpgSlot, id: string) {
  const card = (await readOwned($))?.find(c => c.id === id && c.slot === slot)
  if (id !== '' && !card) {
    await update($, NEWS, () => 'そのカードは持っていません')
    return
  }
  await update($, NEWS, () => (card ? `${SLOT_LABEL[slot]}に「${card.name}」を着けた` : `${SLOT_LABEL[slot]}を外した`))
  await change($, h => setGear(h, slot, card))
  await save($)
}

// ---------------------------------------------------------------- 戦い

/** 魔物を探す (isBoss ならボスに挑む)。遭遇を 1 つ使う。ボスが湧いていれば、遭遇の代わりにその気配を使う。戦っている間は何もしない */
async function fight($: $, isBoss: boolean) {
  if ((await read($, BATTLE))?.result === 'fight') return
  await ensureLoaded($)
  const now = await $.clock.now()
  const hero = wear(await readHero($), await readOwned($))
  const isSpawned = isBoss && hero.bossSign > 0
  if (!isSpawned && hero.encounters <= 0) {
    await update($, NEWS, () => 'まだ魔物の気配がない。ターンを終えると現れる')
    return
  }
  // 種は時刻と戦った回数から (同じ時刻に 2 回押しても別の敵)
  const battle = startBattle(hero, (now ^ Math.imul(hero.battles + 1, 2654435761)) >>> 0, isBoss, isSpawned)
  // 続けて押された時は、先に置いた戦いを残す (気配も 1 つだけ使う)。update は先を越されるとやり直すので、印も毎回付け直す
  let isPlaced = false
  await update($, BATTLE, b => {
    isPlaced = b?.result !== 'fight'
    return isPlaced ? battle : b
  })
  if (!isPlaced) return
  await update($, NEWS, () => '')
  await change($, h =>
    isSpawned ? { ...h, bossSign: 0, battles: h.battles + 1 } : { ...h, encounters: Math.max(0, h.encounters - 1), battles: h.battles + 1 },
  )
  await save($)
}

/** 1 手。終わったら戦いの後の HP を残し、勝っていれば経験値と勝ち数も入れて残す */
async function command($: $, cmd: Command) {
  const { learned } = await readHero($)
  let ended: RpgBattle | undefined
  await update($, BATTLE, b => {
    ended = undefined // update はやり直すことがある。前の試みの印を残さない
    if (!b || b.result !== 'fight') return b
    const next = act(b, cmd, learned)
    if (next.result !== 'fight') ended = next
    return next
  })
  if (!ended) return
  const done = ended
  const lead: string[] = []
  if (done.result === 'won') {
    lead.push(`${done.enemy.name}に勝った! 経験値 ${done.gainedXp}`)
    if (done.enemy.isBoss && (await readHero($)).defeated[done.enemy.id] === undefined) lead.push(`ボスを初めて倒した! SP +${SP_RULE.boss}`)
  } else if (done.result === 'lost') lead.push('力尽きた… しばらく休むと HP が戻る')
  await change($, (h, now) => endBattle(h, done, now), false, lead)
  await save($)
}

/** 終わった戦いを片付けて、魔物の気配の画面に戻る */
const closeBattle = ($: $) => update($, BATTLE, b => (b?.result === 'fight' ? b : null))

// ---------------------------------------------------------------- 成長

async function raise($: $, stat: RpgStat) {
  const lead: string[] = []
  const fn = (h: RpgHero) => {
    const next = raiseStat(h, stat)
    lead.length = 0
    lead.push(next ? `${STAT_LABEL[stat]}が 1 上がった (${STAT_NOTE[stat]})` : 'SP が足りません')
    return next ?? h
  }
  await change($, fn, false, lead)
  await save($)
}

async function learn($: $, id: string) {
  const lead: string[] = []
  const fn = (h: RpgHero, now: number) => {
    const next = learnSkill(h, id, now)
    lead.length = 0
    lead.push(typeof next === 'string' ? next : `「${skillOf(id)?.name ?? id}」を覚えた!`)
    return typeof next === 'string' ? h : next
  }
  await change($, fn, false, lead)
  await save($)
}

async function unspend($: $) {
  await change($, respec, false, ['振った SP を全部戻した'])
  await save($)
}

/** やり直しは消す操作なので、store を丸ごと書き替える */
const reset = ($: $) =>
  serial(async () => {
    const now = await $.clock.now()
    const fresh = startSession(INITIAL_SAVED, now)
    const hero = { ...fresh, synced: toSaved(fresh) }
    await $.store.set(STORE_KEY, hero.synced)
    await update($, HERO, () => hero)
    await update($, BATTLE, () => null)
    await update($, CONFIRM, () => false)
    await update($, TAB, () => 'status' as const)
    await update($, NEWS, () => '冒険をやり直しました。Lv 1 から')
  })

const openPane = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: '冒険の書を開きました。' }
}

export const register: Register = on => {
  followTheme(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await readTheme($)
    // /rpg が拒まれたら (組み込みと被ったら) /dev-rpg にする
    const got = await $.command.register({ name: 'rpg', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'rpg'
    if (!ownsMain) await $.command.register({ name: 'dev-rpg', description: DESCRIPTION }).catch(() => {})
    // 読み戻して (冒険の回数を足して) 実績を見て、残す
    await change($, h => h)
    await save($)
    $.clock.every(60_000, () => void refresh($).catch(() => {}))
    return started
  })

  on('session.end', async ($, e, next) => {
    await save($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'rpg' }, ($, e, next) => (ownsMain ? openPane($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'dev-rpg' }, openPane)

  // 主ループのターンだけ数える (サブエージェントの分は agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await change($, onTurnStart)
    return next(e)
  })

  // 答えて終わったターンだけ数える (中断・エラー・拒否は数えない)。ボスが湧くのもここ。保存はどのターンの終わりでも
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      if (e.reason === 'answer') {
        const lead: string[] = []
        const fn = (h: RpgHero, now: number) => {
          const after = spawnBoss(onTurnEnd(h, now), now)
          lead.length = 0
          if (after.bossSign > h.bossSign) lead.push(`ボスの気配! ${nextBoss(after).name}が待っている (気配を使わずに挑めて、経験値 1.5 倍)`)
          return after
        }
        await change($, fn, true, lead)
        if (lead.length > 0) $.ui.toast(`ボスの気配! ${nextBoss(await readHero($)).name}が湧いた`)
      }
      await save($)
    }
    return next(e)
  })

  // 見るだけ。断られた呼び出し (deny) は数えない
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && !('deny' in ran && ran.deny !== undefined)) {
      const tool = String(e.tool)
      const isError = 'isError' in ran && ran.isError === true
      await change($, (h, now) => onTool(h, tool, isError, now))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const Select = 'Select' in t ? t.Select : undefined
    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : undefined
    const owned = await readOwned($)
    // 持っていない装備は外した姿で見せる (store の装備はそのまま)
    const hero = wear(await readHero($), owned)
    const tab = await read($, TAB)
    const isConfirming = await read($, CONFIRM)
    const news = await read($, NEWS)
    const battle = await read($, BATTLE)
    const isFighting = battle?.result === 'fight'
    const sp = spOf(hero)
    const level = levelInfo(hero.xp).level
    const boss = nextBoss(hero)
    const lines =
      tab === 'status'
        ? statusLines(hero)
        : tab === 'gear'
          ? gearLines(hero, owned)
          : tab === 'battle'
            ? battleLines(hero, battle)
            : tab === 'growth'
              ? growthLines(hero)
              : achievementLines(hero)
    const source =
      tab === 'status'
        ? statusSvg(hero)
        : tab === 'gear'
          ? gearSvg(hero, owned)
          : tab === 'battle'
            ? battleSvg(hero, battle)
            : tab === 'growth'
              ? growthSvg(hero)
              : achievementsSvg(hero)
    const worn = wornOf(hero.equip, owned)
    const go = (to: RpgTab) =>
      void (async () => {
        await update($, CONFIRM, () => false)
        await update($, TAB, () => to)
      })()
    /** そのタブなら「ステータスに戻る」、違えば開く */
    const toggle = (to: RpgTab) => go(tab === to ? 'status' : to)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={source} alt={lines.map(l => l.text).join('\n')} />
        ) : (
          <Box key="lines" flexDirection="column">
            {lines.map(l => (
              <Text color={l.color} dimColor={l.isDim} bold={l.isBold}>
                {l.text}
              </Text>
            ))}
          </Box>
        )}
        {tab === 'gear' && owned !== undefined && Select && (
          <Box key="equip" flexDirection="column">
            {SLOTS.map(k => (
              <Select
                key={`equip:${k}`}
                label={`${SLOT_LABEL[k]}: `}
                options={[
                  { value: '', label: 'なし' },
                  ...owned
                    .filter(c => c.slot === k)
                    .sort((a, b) => RANK[a.rarity] - RANK[b.rarity] || a.id.localeCompare(b.id))
                    .map(c => ({ value: c.id, label: `${c.rarity} ${c.name}` })),
                ]}
                value={worn[k]?.id ?? ''}
                onSelect={(v: string) => void equip($, k, v)}
              />
            ))}
          </Box>
        )}
        {tab === 'battle' && battle && isFighting && (
          <Box key="commands" flexDirection="column">
            <Button key="act:attack" label="攻撃" variant="primary" onPress={() => void command($, { kind: 'attack' })} />
            {SKILLS.filter(sk => !sk.isPassive && hero.learned[sk.id] !== undefined).map(sk => (
              <Button
                key={`skill:${sk.id}`}
                label={`${sk.name} (MP ${sk.mp})`}
                dimColor={!canUse(battle, sk.id, hero.learned)}
                onPress={() => void command($, { kind: 'skill', id: sk.id })}
              />
            ))}
            <Button key="act:defend" label="防御 (MP 少し回復)" onPress={() => void command($, { kind: 'defend' })} />
            <Button key="act:flee" label="逃げる" dimColor={battle.enemy.isBoss} onPress={() => void command($, { kind: 'flee' })} />
          </Box>
        )}
        {tab === 'battle' && !isFighting && (
          <Box key="lobby" flexDirection="column">
            <Button
              key="find"
              label={`魔物を探す (気配 ${hero.encounters})`}
              variant="primary"
              dimColor={hero.encounters <= 0}
              onPress={() => void fight($, false)}
            />
            {level >= boss.level && (
              <Button
                key="boss"
                label={hero.bossSign > 0 ? `湧いたボスに挑む: ${boss.name} (経験値 1.5 倍)` : `ボスに挑む: ${boss.name}`}
                variant={hero.bossSign > 0 ? 'primary' : undefined}
                dimColor={hero.bossSign <= 0 && hero.encounters <= 0}
                onPress={() => void fight($, true)}
              />
            )}
            {battle && <Button key="close" label="戦いを終える" onPress={() => void closeBattle($)} />}
          </Box>
        )}
        {tab === 'growth' && (
          <Box key="growth" flexDirection="column">
            {STATS.map(k => (
              <Button key={`up:${k}`} label={`${STAT_LABEL[k]} +1 (${STAT_NOTE[k]})`} dimColor={sp.free < 1} onPress={() => void raise($, k)} />
            ))}
            {SKILLS.filter(sk => hero.learned[sk.id] === undefined && level >= sk.level).map(sk => (
              <Button key={`learn:${sk.id}`} label={`覚える: ${sk.name} (${sk.sp} SP)`} dimColor={sp.free < sk.sp} onPress={() => void learn($, sk.id)} />
            ))}
            {STATS.some(k => hero.alloc[k] > 0) && <Button key="respec" label="能力の振り分けを戻す" onPress={() => void unspend($)} />}
          </Box>
        )}
        {news !== '' && <Text color="yellow">{news}</Text>}
        <Box flexDirection="column">
          <Button
            key="battle"
            label={tab === 'battle' ? 'ステータスに戻る' : isFighting ? '戦う (戦闘中)' : `戦う (気配 ${hero.encounters}${hero.bossSign > 0 ? '・ボス出現' : ''})`}
            variant={tab === 'battle' ? undefined : 'primary'}
            onPress={() => toggle('battle')}
          />
          <Button key="growth" label={tab === 'growth' ? 'ステータスに戻る' : `成長 (SP ${sp.free})`} onPress={() => toggle('growth')} />
          <Button key="tab" label={tab === 'achievements' ? 'ステータスに戻る' : '実績を見る'} onPress={() => toggle('achievements')} />
          <Button key="gear" label={tab === 'gear' ? 'ステータスに戻る' : '装備'} onPress={() => toggle('gear')} />
          <Button
            key="reset"
            label={isConfirming ? '本当にやり直す(すべて消えます)' : '冒険をやり直す'}
            onPress={() => void (isConfirming ? reset($) : update($, CONFIRM, () => true))}
          />
          {isConfirming && <Button key="reset-cancel" label="やめる" onPress={() => void update($, CONFIRM, () => false)} />}
        </Box>
      </Box>
    )
  })
}
