import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { followTheme, readTheme } from './style'
import { barSvg, clean, clock, flowColor, flowSvg, lastSvg, parsePresets, short } from './svg'

const run = atom({ plugin: 'work-bar', key: 'run' } as const, null)
const last = atom({ plugin: 'work-bar', key: 'last' } as const, null)
const isHidden = atom({ plugin: 'work-bar', key: 'isHidden' } as const, false)
const pick = atom({ plugin: 'work-bar', key: 'pick' } as const, '0')

// これより多いと Select + 「入れる」に切り替える
const MAX_BUTTONS = 4

// 実行中だけ回す 1 秒タイマー。リロードで消えるので、session.start で run が残っていれば作り直す
let tick: Timer | undefined
function startTick($: EngineInterface) {
  tick?.cancel()
  tick = $.clock.every(1000, () => {
    void (async () => {
      const now = await $.clock.now()
      await update($, run, r => (r ? { ...r, elapsed: Math.floor((now - r.startedAt) / 1000) } : r))
    })()
  })
}

export const register: Register = (on, options) => {
  const presets = parsePresets(String(options.presets ?? ''))
  followTheme(on)

  on('session.start', async ($, e, next) => {
    await readTheme($)
    await $.command.register({ name: 'work-bar', description: '作業バーの表示を切り替える' }).catch(() => {})
    // VS Code は帯を「フック無し」と 2 回見ると聞きに来なくなる。後から読み込まれた時のために描き直しを頼む
    $.ui.invalidate('ui.render')
    // ターンの途中でリロードされた: 経過時間を止めないようタイマーを作り直す
    if ((await read($, run)) !== null) startTick($)

    return next(e)
  })

  on('command.run', { command: 'work-bar' }, async $ => {
    const hidden = await update($, isHidden, v => !v)

    return { text: hidden ? '作業バーを隠しました。' : '作業バーを表示しました。' }
  })

  // サブエージェントのターン (agentId あり) は数えない
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const startedAt = await $.clock.now()
      await update($, run, () => ({ startedAt, elapsed: 0, calls: 0, errors: 0, active: [], lastError: false }))
      $.ui.invalidate('ui.render')
      startTick($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const name = clean(String(e.tool))
    await update($, run, r => (r ? { ...r, calls: r.calls + 1, active: [...r.active, name] } : r))
    let isError = false
    try {
      const ran = await next(e)
      isError = ran.isError === true

      return ran
    } finally {
      await update($, run, r => {
        if (!r) return r
        const i = r.active.lastIndexOf(name)
        const active = i < 0 ? r.active : [...r.active.slice(0, i), ...r.active.slice(i + 1)]
        return { ...r, active, lastError: isError, errors: r.errors + (isError ? 1 : 0) }
      })
    }
  }).catch(($, e, next) => next(e)) // 見ているだけなので、失敗してもツールは止めない

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      tick?.cancel()
      tick = undefined
      const r = await read($, run)
      await update($, last, () => ({
        seconds: Math.round(e.durationMs / 1000),
        calls: r?.calls ?? 0,
        errors: r?.errors ?? 0,
      }))
      await update($, run, () => null)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    // face-band など、帯を描く他の mod がこの下にいればその木が返る。自分の帯の下に並べる
    const below = await next(e)
    const own = await drawOwn()
    if (below.type === 'engine') return own
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box key="own">{own}</Box>
        <Box key="below">{below}</Box>
      </Box>
    )

    async function drawOwn() {
      const r = await read($, run)
      const l = await read($, last)
      // 定型を減らして選んでいた番号が範囲外になったら 0 番に戻す
      const stored = await read($, pick)
      const picked = presets[Number(stored)] ? stored : '0'
      const t = $.ui.resolve(e)
      const { Box, Text, Button } = t

      const fill = (text: string) => void $.prompt.fill({ text, mode: 'insert' })
      const hide = () => update($, isHidden, () => true)

      // 待機中: 定型ボタン列 (多ければ Select) と「隠す」
      const controls = (
        <Box key="controls" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {presets.length > MAX_BUTTONS && 'Select' in t
            ? [
                <t.Select
                  key="pick"
                  label="定型"
                  value={picked}
                  options={presets.map((p, i) => ({ label: p.label, value: String(i) }))}
                  onSelect={v => update($, pick, () => v)}
                />,
                <Button
                  key="fill"
                  label="入れる"
                  onPress={() => {
                    const text = presets[Number(picked)]?.text ?? ''
                    if (text !== '') fill(text)
                  }}
                />,
              ]
            : presets.map((p, i) => <Button key={`preset-${i}`} label={p.label} onPress={() => fill(p.text)} />)}
          <Button key="hide" label="隠す" onPress={hide} />
        </Box>
      )

      // terminal の表にも Svg の名前はある (テストキットで確認) ので、surface でも分ける
      if (e.surface === 'terminal' || !('Svg' in t)) {
        // terminal: Text 1 行の簡易表示
        const line = r
          ? `${r.lastError ? '● ' : ''}${clock(r.elapsed)}  ${r.active.length ? short(r.active[r.active.length - 1] ?? '') : '考え中'}  ツール ${r.calls}回`
          : l
            ? `前のターン ${clock(l.seconds)} / ツール ${l.calls}回 / エラー ${l.errors}件`
            : ''
        return (
          <Box flexDirection="column">
            {line !== '' && (
              <Text color={r?.lastError ? 'red' : undefined} dimColor={!r}>
                {line}
              </Text>
            )}
            {!r && controls}
          </Box>
        )
      }

      const { Svg } = t
      if (r) {
        const tool = r.active[r.active.length - 1] ?? null
        return (
          <Box flexDirection="column">
            <Svg
              source={barSvg({ elapsed: r.elapsed, tool, calls: r.calls, lastError: r.lastError })}
              alt={`経過 ${clock(r.elapsed)} / ${tool ?? '考え中'} / ツール ${r.calls}回`}
            />
            <Svg source={flowSvg(flowColor(r.elapsed))} alt="実行中" />
          </Box>
        )
      }

      return (
        <Box flexDirection="column" rowGap={0}>
          {l && <Svg source={lastSvg(l)} alt={`前のターン ${clock(l.seconds)} / ツール ${l.calls}回 / エラー ${l.errors}件`} />}
          {controls}
        </Box>
      )
    }
  })
}
