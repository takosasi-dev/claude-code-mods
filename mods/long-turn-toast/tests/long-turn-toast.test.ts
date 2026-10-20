import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'
import { register } from '../hooks/register'

// 下の代役を置き、出たトーストを集める
const setup = (on: On) => {
  const toasts: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

const finish = ($: Engine, durationMs: number, extra: Partial<TurnCompleteInput> = {}) =>
  $.turn.complete({
    answer: 'ok',
    durationMs,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    ...extra,
  } as TurnCompleteInput)

test('しきい値未満は出ない', async ($, on) => {
  const toasts = setup(on)
  await finish($, 119_000)
  expect(toasts).toEqual([])
})

test('しきい値を超えたら所要時間つきで出る', async ($, on) => {
  const toasts = setup(on)
  await finish($, 192_000)
  expect(toasts).toEqual(['応答が終わりました(3分12秒)'])
})

test('中断とサブエージェントのターンは出ない', async ($, on) => {
  const toasts = setup(on)
  await finish($, 300_000, { isAborted: true, reason: 'aborted' })
  await finish($, 300_000, { agentId: 'sub-1' })
  expect(toasts).toEqual([])
})

// 2.1.280 のキットは test(name, { options }) を register に渡さないため、
// register を直接呼び、取り出したフックを偽の $ で動かす
test('userConfig でしきい値を変えられる', async () => {
  type Hook = (...args: unknown[]) => unknown
  let hook: Hook | undefined
  const fakeOn = ((_event: string, h: Hook) => {
    hook = h
  }) as unknown as On
  register(fakeOn, { thresholdSeconds: 10 })

  const toasts: string[] = []
  const fake$ = { ui: { toast: (text: string) => toasts.push(text) } }
  const next = () => ({ text: '' })
  for (const durationMs of [9_000, 45_000]) {
    await hook?.(fake$, { durationMs, isAborted: false }, next)
  }
  expect(toasts).toEqual(['応答が終わりました(45秒)'])
})
