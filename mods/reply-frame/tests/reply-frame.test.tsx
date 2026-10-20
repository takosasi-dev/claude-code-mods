import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('返答が枠付きで描かれる（全画面種）', async $ => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'reply-frame',
      surface,
      component: 'AssistantMessage',
      props: { text: '**こんにちは**', isFirstOfReply: true },
    })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe('**こんにちは**')
    await ui.unmount()
  }
})

test('長すぎる返答は標準の描画に任せる', async ($, on) => {
  // 標準の描画の代役
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'reply-frame',
    surface: 'vscode',
    component: 'AssistantMessage',
    props: { text: 'a'.repeat(10001), isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Box' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

const OWN = { kind: 'composer' } as const
const NOTICE = { kind: 'task-notification' } as const

test('本人のプロンプトは標準の描画を青枠で包む（全画面種）', async ($, on) => {
  // 標準の描画の代役: core が返すのと同じ engine 要素
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'engine', ref: 0 }))
  for (const surface of SURFACES) {
    for (const isExpanded of [false, true]) {
      const ui = await $.ui.mount({
        plugin: 'reply-frame',
        surface,
        component: 'UserMessage',
        props: { text: 'やあ', origin: OWN, isExpanded },
      })
      expect(await ui.drawn()).toMatchObject({
        type: 'Box',
        props: { borderStyle: 'round', borderColor: '#6b9bd2' },
        children: [{ type: 'engine', ref: 0 }],
      })
      await ui.unmount()
    }
  }
})

test('通知など本人以外の行は標準のまま（全画面種）', async ($, on) => {
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'engine', ref: 0 }))
  for (const surface of SURFACES) {
    for (const origin of [NOTICE, { kind: 'peer' } as const, { kind: 'plugin', name: 'x' } as const]) {
      const ui = await $.ui.mount({
        plugin: 'reply-frame',
        surface,
        component: 'UserMessage',
        props: { text: '完了', origin, isExpanded: false },
      })
      expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
      await ui.unmount()
    }
  }
})
