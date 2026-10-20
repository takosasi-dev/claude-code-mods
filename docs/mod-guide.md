# VS Code でも凝った見た目を出す mod の作り方

Claude Code の関数フック mod を、VS Code 拡張でもターミナルでも崩れずに描くための約束ごとです。
このリポジトリの mod はすべてこの約束で作っています。
2026-10 時点で、Claude Code 2.1.300(VS Code 拡張 2.1.300)を使って確かめた内容です。
API はまだ先行公開の段階で変わることがあります。最新の正確な形は、mod を読み込んだときにエンジンが置く `.claude-plugin/types/claude-code/index.d.ts` を見てください。

## 1. VS Code で使える部品

`$.ui.resolve(e)` が返す部品表は、描く画面(`e.surface`)によって違います。

| 部品 | terminal | vscode | 備考 |
|---|---|---|---|
| Box / Text / Button | ○ | ○ | |
| Input / Select | ○ | ○ | |
| Link / Code / Markdown | ○ | ○ | vscode の Link が開けるのは https: だけ |
| Svg | 名前はあるが描かれない | ○ | 下の 2 節を参照 |
| Raster / Image | ○ | × | |
| Client | × | × | |

- **terminal の部品表にも `Svg` の名前があります。** `'Svg' in t` だけで分けると、terminal でも SVG 側の枝に入って何も描かれません。必ず次の形で分けます。

  ```tsx
  const t = $.ui.resolve(e)
  const useSvg = e.surface !== 'terminal' && 'Svg' in t
  ```

- vscode ではキー操作(Button の `hotkey`)は当てにしないでください。操作はすべて Button / Select / Input にします。

## 2. Svg の性質(VS Code)

- Svg は `<img>` として読み込まれ、キャンバスにコマ送りで描かれます
- **SMIL(`<animate>`・`<animateMotion>` など)と CSS の `@keyframes` は動きます。** 画面に見えている間だけ動きます
- **hover・`<title>` のツールチップ・SVG の中のクリックは効きません。** `isInteractive` も効きません。押す物は Svg の外に Button で置きます
- `width` と `height` は付けず、`viewBox` だけにします。そうすると枠の幅いっぱいに伸びます
- ペインは狭いです(実測で 29 桁、約 380px)。縦長のレイアウトにし、文字は viewBox 上で 12 以上にします
- `font-family="sans-serif"` を付けます。日本語も描けます
- **source が変わるたびに、アニメは最初からやり直しになります。** 数字が毎秒変わる物と、ずっと流れていてほしいアニメは、別々の Svg に分けます
- source の上限は 131,072 字です

## 3. 入力欄の上の帯(AbovePrompt)の罠

VS Code は、帯を描くフックが無いという答えを 2 回受け取ると、それ以降は帯について聞きに来なくなります。
mod がセッションの途中で読み込まれた場合(ホットリロードなど)は、その mod の帯が出ないままになります。
`session.start` で描き直しを頼むと、この状態が解けます。

```ts
on('session.start', async ($, e, next) => {
  $.ui.invalidate('ui.render')
  return next(e)
})
```

型定義には「AbovePrompt は terminal と desktop だけ」と書かれていますが、VS Code 拡張 2.1.300 の画面には帯を描く処理があります。

## 4. 値の持ち方

- 描画が読む値は `$.state` に置きます(`atom` / `read` / `update` は `'claude-code'` から import)。モジュールの変数はリロードで消えます
- `$.state` に置く値は、`types/index.d.ts` の `interface PluginState` に書き、`plugin.json` の `"types"` で指します
- 描画フックの中では書き込みません。書くのは Button の `onPress` か、他のイベントの中です
- ファイルや外部コマンドを読むのも描画フックの外で行い、結果を `$.state` に置きます
- セッションをまたいで残す値は `$.store` に置きます
- タイマーは `session.start` で `$.clock.every` / `$.clock.after` を使います。1 秒未満にはしません。動きは SMIL に任せ、描き直しは数字が変わる時だけにします

## 5. ターンの数え方

- ターンの始まりは `prompt.submit` ではなく **`turn.start`** で取ります。`prompt.submit` はスラッシュコマンドでも発火し、その後に `turn.complete` が来ないので、「実行中」のまま残ってしまいます
- サブエージェントの分は `e.agentId` が付いています。メインのターンだけ数えるなら除きます
- 見ているだけの `tool.call` フックには `.catch(($, e, next) => next(e))` を付け、失敗してもツールを止めないようにします

## 6. 公開する mod の既定値

- `userConfig` の既定値に、作者の環境のパスや名前を入れません。既定値は空文字にします
- 空のときは画面に「未設定」と設定のしかた(`/config` でどの項目を入れるか)を出します
- **空を「今のフォルダ」と読みません。** `$.fs` は相対パスを今のフォルダから読むので、空文字のまま読みに行かないようにします
- 自分の環境の値は `~/.claude/settings.json` の `pluginConfigs` に入れます

  ```json
  "pluginConfigs": {
    "project-board": { "options": { "memoDir": "D:\\notes\\handoff" } }
  }
  ```

## 7. 色

SVG の地は自前で塗ります。このリポジトリでは GitHub Dark 系にそろえています。

| 用途 | 色 |
|---|---|
| 地 / 面 / 線 | `#0d1117` / `#161b22` / `#30363d` |
| 文字 / 弱い文字 | `#c9d1d9` / `#8b949e` |
| 青 / 緑 / 黄 / 赤 / 紫 / 橙 | `#58a6ff` / `#3fb950` / `#d29922` / `#f85149` / `#bc8cff` / `#f78166` |

画面のラベルやボタンに絵文字は使いません。

## 8. 確かめ方

```sh
claude plugin validate mods/<名前>   # マニフェストとフックの読み取り
claude plugin test mods/<名前>       # tests/*.test.tsx を走らせる
```

- テストは `vscode` と `terminal` の両方で mount し、主な要素が描かれることと、ボタンを押すと値が変わることを確かめます
- Windows では、エンジンが `/tmp/...` のようなパスを `<ドライブ>:\tmp\...` に直してから `fs` に渡します。テストの仮のファイル置き場は、区切りとドライブ名をそろえて比べます
- `plugin.register` イベントで見えるのは、自分より後に読み込まれる mod だけです(mod-hub はこれを使っています)
