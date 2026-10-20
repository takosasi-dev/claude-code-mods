import type { Register } from 'claude-code'

import { isDangerous } from './danger'

const SHELL_TOOLS = ['Bash', 'PowerShell']

export const register: Register = on => {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const command = (e.props.input as { command?: unknown } | null)?.command
    if (!SHELL_TOOLS.includes(e.props.tool) || typeof command !== 'string' || !isDangerous(command)) {
      return next(e)
    }

    // 標準の行（差分表示など）をそのまま赤枠で包む
    const inner = await next(e)
    const { Box } = $.ui.resolve(e)

    return (
      <Box borderStyle="round" borderColor="red">
        {inner}
      </Box>
    )
  })
}
