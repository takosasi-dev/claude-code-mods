import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { FaceBandMood, FaceBandNow } from '../types'
import { FACE_TEXT, IDLE, clean, endWord, faceAlt, faceSvg, subLine } from './face'

const NOW = atom({ plugin: 'face-band', key: 'now' } as const, IDLE)
const HIDDEN = atom({ plugin: 'face-band', key: 'isHidden' } as const, false)
const STORE_KEY = 'isHidden'
const DESCRIPTION = '入力欄の上の顔の帯をオン/オフする'
/** にっこり/しょんぼりを見せる長さ */
const SHOW_MS = 3000

type $ = EngineInterface

// /face を自分で取れたか (取れなければ /face-band にして、/face は横取りしない)
let ownsMain = false

/** 顔を変える。番号を 1 つ進める */
const moved = (n: FaceBandNow, mood: FaceBandMood, word: string, more: Partial<FaceBandNow> = {}): FaceBandNow => ({ ...n, ...more, mood, word, seq: n.seq + 1 })

const toggle = async ($: $) => {
  const hidden = await update($, HIDDEN, v => !v)
  // 残すのは「隠したか」だけ。他のセッションの値と混ぜる物は無いので、この 1 キーを書く
  const saved = await $.store.set(STORE_KEY, hidden).then(
    () => '',
    () => '(設定は残せませんでした)',
  )
  $.ui.invalidate('ui.render')
  return { text: `${hidden ? '顔の帯を隠しました。' : '顔の帯を出しました。'}${saved}` }
}

/** 下の mod の木が何かを描いているか (何も描かなければエンジンの物の印が返る) */
const drawsSomething = (tree: RenderElement) => tree.type !== 'engine'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const got = await $.command.register({ name: 'face', description: DESCRIPTION }).catch(() => undefined)
    ownsMain = got?.command === 'face'
    if (!ownsMain) await $.command.register({ name: 'face-band', description: DESCRIPTION }).catch(() => {})
    const stored = await $.store.get(STORE_KEY).catch(() => undefined)
    await update($, HIDDEN, () => stored === true)
    // リロードがにっこり/しょんぼりの途中だったら、戻す時計は消えているので待ちに戻す
    await update($, NOW, n => (n.mood === 'happy' || n.mood === 'sad' ? { ...IDLE, tool: n.tool, seq: n.seq + 1 } : n))
    // VS Code は帯を「フック無し」と 2 回見ると聞きに来なくなる。後から読み込まれた時のために描き直しを頼む
    $.ui.invalidate('ui.render')
    return started
  })

  on('command.run', { command: 'face' }, ($, e, next) => (ownsMain ? toggle($) : next(e))).catch(($, e, next) => next(e))
  on('command.run', { command: 'face-band' }, toggle)

  // メインのターンだけ (サブエージェントは agentId 付き)
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, NOW, n => moved(n, 'think', '考え中', { active: 0 }))
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const tool = clean(String(e.tool))
    await update($, NOW, n => moved(n, 'tool', 'ツール実行中', { tool, active: n.active + 1 }))
    try {
      return await next(e)
    } finally {
      // 全部終わったら考え中に戻す (その間にターンが終わっていたらそのまま)
      await update($, NOW, n => {
        const active = Math.max(0, n.active - 1)
        return active === 0 && n.mood === 'tool' ? moved(n, 'think', '考え中', { active }) : { ...n, active }
      })
    }
  }).catch(($, e, next) => next(e)) // 見ているだけなので、失敗してもツールは止めない

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const n = await update($, NOW, m => moved(m, e.reason === 'answer' ? 'happy' : 'sad', endWord(e.reason)))
      const seq = n.seq
      // 3 秒たって他の変化が来ていなければ待ちに戻す
      $.clock.after(SHOW_MS, () => {
        void update($, NOW, m => (m.seq === seq ? moved(m, 'idle', IDLE.word, { active: 0 }) : m)).catch(() => {})
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, HIDDEN))) return next(e)

    // work-bar など、帯を描く他の mod がこの下にいれば、その木が返る。顔を左に置き、その木を右に並べる
    const below = await next(e)
    const now = await read($, NOW)
    const sub = subLine(now)
    const t = $.ui.resolve(e)
    const { Box, Text } = t

    // terminal の表にも Svg の名前があるので、画面の種類でも分ける
    const face =
      e.surface !== 'terminal' && 'Svg' in t ? (
        <Box key="face" flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          <Box width={8} flexShrink={0}>
            <t.Svg source={faceSvg(now.mood)} alt={faceAlt(now)} width={60} />
          </Box>
          <Box flexDirection="column">
            <Text bold>{now.word}</Text>
            {sub !== '' && <Text dimColor>{sub}</Text>}
          </Box>
        </Box>
      ) : (
        <Box key="face" flexDirection="column" flexShrink={0}>
          <Text>
            <Text bold>{FACE_TEXT[now.mood]}</Text> {now.word}
          </Text>
          {sub !== '' && <Text dimColor>{sub}</Text>}
        </Box>
      )

    if (!drawsSomething(below)) return face
    return (
      <Box flexDirection="row" columnGap={2}>
        {face}
        <Box key="below" flexGrow={1} flexShrink={1}>
          {below}
        </Box>
      </Box>
    )
  })
}
