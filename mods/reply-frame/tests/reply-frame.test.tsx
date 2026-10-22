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
    props: { text: 'a'.repeat(100001), isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Box' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

// 監査: 制御文字を含む返答を枠の Markdown に入れると、エンジンが木ごと拒んで返答が消えた
test('タブ・改行以外の制御文字を含む返答は標準の描画に任せる。タブ・改行だけなら枠で描く', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine', ref: 0 }))
  for (const text of ['色 \x1b[31m赤', 'ベル\x07', '改ページ\x0c', 'NEL\u0085', 'DEL\x7f', 'CRLF\r\nの行']) {
    const ui = await $.ui.mount({ plugin: 'reply-frame', surface: 'vscode', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    await ui.unmount()
  }
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'reply-frame', surface, component: 'AssistantMessage', props: { text: 'a\tb\nc\nd', isFirstOfReply: true } })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
    await ui.unmount()
  }
})

test('1 万字を超えても 10 万字までは枠で描く', async $ => {
  const ui = await $.ui.mount({
    plugin: 'reply-frame',
    surface: 'vscode',
    component: 'AssistantMessage',
    props: { text: 'a'.repeat(50000), isFirstOfReply: true },
  })
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
  await ui.unmount()
})

test('要約の行は標準の描画に任せる（全画面種）', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine', ref: 0 }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'reply-frame',
      surface,
      component: 'AssistantMessage',
      props: { text: 'ファイルを読みました', isFirstOfReply: false, isSummary: true },
    })
    expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
    await ui.unmount()
  }
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
