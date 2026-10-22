import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { mayWrite, rememberVersion } from '../hooks/style'

// 共通の手 (hooks/style.ts) の試験: マーケットプレイスから入れた形で、installed_plugins.json の場所が自分と違えば書かない。
// 試験のエンジンの $.plugin.root は動かせないので、偽の $ で呼ぶ。isStale は一度古いと分かると戻らないので、このファイルには 1 つだけ置く

const NOW = Date.parse('2026-10-22T03:00:00Z')
const PLUGINS = 'D:/home/.claude/plugins'
const ROOT = `${PLUGINS}/cache/demo-market/dev-rpg/0.6.1`

test('マーケットプレイスの installed_plugins.json に入っている場所が自分と違えば、書かずにトーストで 1 回だけ開き直しを頼む', async () => {
  let installPath = ROOT.replace(/\//g, '\\')
  const toasts: string[] = []
  const fake = {
    plugin: { name: 'dev-rpg', root: ROOT },
    fs: {
      read: async (p: string) => {
        const path = p.replace(/\\/g, '/')
        if (path === `${PLUGINS}/installed_plugins.json`) return JSON.stringify({ plugins: { 'dev-rpg@demo-market': [{ installPath }] } })
        if (path === `${ROOT}/.claude-plugin/plugin.json`) return JSON.stringify({ name: 'dev-rpg', version: '0.6.1' })
        throw new Error('ENOENT')
      },
      list: async () => [],
    },
    ui: { toast: (text: string) => void toasts.push(text) },
  } as unknown as EngineInterface
  await rememberVersion(fake)
  // 同じ場所 (区切りと大文字小文字の違いは同じに見る) なら書いてよい
  expect(await mayWrite(fake, NOW)).toBe(true)
  // 新しい版が別のフォルダに入った
  installPath = `${PLUGINS}/cache/demo-market/dev-rpg/0.6.2`
  // 読み直すのは 60 秒に 1 回まで
  expect(await mayWrite(fake, NOW + 30_000)).toBe(true)
  expect(await mayWrite(fake, NOW + 61_000)).toBe(false)
  expect(await mayWrite(fake, NOW + 200_000)).toBe(false)
  expect(toasts).toEqual(['dev-rpg: 新しい版が入りました。VS Code を開き直すまで記録は書きません'])
})
