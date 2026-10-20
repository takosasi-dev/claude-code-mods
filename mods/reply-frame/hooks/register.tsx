import type { Register } from 'claude-code'

// 枠の色。書き換えて保存すればその場で読み直される
const FRAME_COLOR = '#d97757'
const USER_FRAME_COLOR = '#6b9bd2'

// 1 回の描画で Markdown が描ける上限（全体で 10 万字）。超える返答は標準の描画に任せる
const MARKDOWN_LIMIT = 100000

// 本人の入力: ターミナル、Remote Control、VS Code/デスクトップ(SDK 経由)
const OWN_PROMPT = new Set(['composer', 'bridge', 'sdk'])

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    // 要約の行は標準の描画（印付き）に任せる
    if (e.props.isSummary || e.props.text.length > MARKDOWN_LIMIT) {
      return next(e)
    }

    const { Box, Markdown } = $.ui.resolve(e)

    return (
      <Box borderStyle="round" borderColor={FRAME_COLOR} paddingX={1}>
        <Markdown text={e.props.text} />
      </Box>
    )
  })

  // 標準の描画をそのまま枠で包む
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!OWN_PROMPT.has(e.props.origin.kind)) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)

    return (
      <Box borderStyle="round" borderColor={USER_FRAME_COLOR} paddingX={1}>
        {await next(e)}
      </Box>
    )
  })
}
