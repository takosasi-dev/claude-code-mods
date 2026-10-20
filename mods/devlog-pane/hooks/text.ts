const MAX = 10000
export const HEAD = '…(前略)\n\n'

// 日本時間(UTC+9)の日付 YYYY-MM-DD
export const jstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)

// Markdown 要素に渡せる形にする: タブ・改行以外の制御文字を落とし、長ければ後ろ側を行頭から残す
export const fit = (text: string) => {
  const clean = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  if (clean.length <= MAX) return clean
  const from = clean.length - (MAX - HEAD.length)
  const nl = clean.indexOf('\n', from - 1)
  return HEAD + clean.slice(nl === -1 ? from : nl + 1)
}
