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

### ボタンと Box の見た目(VS Code)

VS Code は Button を自前の部品で描くので、mod から変えられる所はわずかです(2026-10-22 に試し用の mod で 1 つずつ確かめた)。

| 指定 | VS Code | 備考 |
|---|---|---|
| Button の `dimColor` | ○ | 枠だけの控えめなボタンになる。主と脇を分ける唯一の手 |
| Button の `variant="primary"` / `"secondary"` | × | ふつうのボタンと同じ見た目。terminal では primary が強調色になるので付けておいてよい |
| Button の `plain`・`hotkey` の数字 | × | 枠は付いたまま、数字も出ない |
| Button の中の `<Text>` の色・大きさ | × | 色も大きさも変わらない |
| Button の `hover` | × | |
| Box の `borderStyle` / `borderColor` | ○ | 違いが出るのは round(角が丸い)かそれ以外(四角)かだけ。double・bold も細い 1 本線 |
| Box の `hover`(枠・背景を変える) | × | |
| ボタンの外の Text の `color` / `backgroundColor` | ○ | テーマの名前(`error` など)も 16 進も効く。背景は横いっぱいに広がる |
| Text の `size` | × | 大きくならない。`bold` は効く |

この結果から、ボタン周りは次の 3 つの形にそろえます。

1. **主と脇**: 主の操作は普通の Button 1 つ(terminal 向けに `variant="primary"` も付ける)。ほかは `dimColor` にする。タブのように選ぶボタンは、選んでいる物を普通に、ほかを `dimColor` にする
2. **色枠のカード**: 操作のまとまりは `borderStyle="round"`・`borderColor` の Box に入れ、`paddingX={1}`・`paddingY={1}` を付ける。見出しの Text は枠と同じ色の `bold`、説明は `dimColor`、その下に主と脇のボタンを横に並べる。色は `C`(`hooks/style.ts`)から取ると、明るいテーマにも付いていく
3. **SVG の絵 + ボタン**: 状態の絵は Svg で描き、ボタンはその下に置く。Svg とボタンの列を `gap` のある Box に入れて、くっつけない

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

帯は 1 本しか無いので、帯を描く mod が 2 本あると、上の mod が `next(e)` を呼ばない限り下の mod は描かれません。帯を描く時も `const below = await next(e)` で下の木を受け取り、`below.type !== 'engine'` なら自分の木と並べて返します(`engine` はエンジン自身が描く印で、下に誰もいない時に返ります)。work-bar と face-band がこの形です。

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
- 自分の環境の値は `~/.claude/settings.json` の `pluginConfigs` に入れます。キーは、マーケットプレイスから入れた時は `<mod>@<marketplace>`、フォルダを読ませている時は `<mod>` です
- パスは絶対パスだけを受け付け、相対パスや `C:` のようなドライブだけの値は未設定と同じに扱います

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

### 共通の見た目(`hooks/style.ts`)

mod は 1 本ずつ別々に入れる物なので、共通のライブラリを import できません。色と部品は正本 `shared/style.ts` に 1 枚だけ書き、各 mod の `hooks/style.ts` に写して持ちます。

```sh
node tools/copy_shared.mts           # 正本を全 mod に写す
node tools/copy_shared.mts --check   # 写しがずれていたら名前を出して止まる(公開の前に)
```

- 色は `C.bg` `C.text` `C.blue` などで書きます。`C` は今のテーマの色を指します
- 部品: `frame(h, body)`(380 幅の地)、`header(title, sub, accent)`(見出し帯)、`panel`、動きの `growBar` `growColumn` `fadeIn` `countUp`(数字が増える)
- 動きは 1 回きり(`fill="freeze"`)にします。README の画像を作る `tools/shots.mts` が終わりの値で撮ります

### 明るいテーマ

SVG は `<img>` として描かれるので、中の色はテーマに付いていきません。読めるのは Claude Code の `/config` の theme だけです(VS Code の配色は mod から読めません)。theme が `light` で始まる時に明るい色にします。

```ts
import { followTheme, readTheme } from './style'

export const register: Register = on => {
  followTheme(on) // /config で theme が変わったら色を替えて描き直す
  on('session.start', async ($, e, next) => {
    await readTheme($) // 今の theme を読む
    return next(e)
  })
}
```

同じイベントに matcher の無いフックを 2 つ置くと、エンジンは mod の読み込みを拒みます。`readTheme` は自分の `session.start` の中で呼んでください。Text と Box の色は `success` `error` `subtle` などテーマの名前で書くと、そのまま付いていきます。

## 8. 確かめ方

```sh
claude plugin validate mods/<名前>   # マニフェストとフックの読み取り
claude plugin test mods/<名前>       # tests/*.test.tsx を走らせる
```

まとめて確かめる時は `node tools/check_all.mts [mod...]` です(validate・試験・tsc・写しのずれ・登録の抜け)。

新しい mod は `node tools/new_mod.mts <名前> --cat 遊び --cmd <コマンド> --ja "説明" --en "description"` で作ります。雛形を置き、mod-hub の分類とアイコン(仮の絵)、mod-check の表、marketplace.json、README の表 2 つに登録します。撮影(`tools/shots.mts`)と README の画像は手で足します。`types/index.d.ts` の state を変えたら `node tools/new_mod.mts --sync` で mod-check の読みを作り直します。抜けは check_all が見つけます。

各 mod の `tsconfig.json` は、エンジンが mod を読み込んだ時に置く `.claude-plugin/types/tsconfig.json` を継いでいます。clone した直後は一度 Claude Code に読み込ませてから `tsc -p mods/<名前>` を使ってください。

- テストは `vscode` と `terminal` の両方で mount し、主な要素が描かれることと、ボタンを押すと値が変わることを確かめます
- Windows では、エンジンが `/tmp/...` のようなパスを `<ドライブ>:\tmp\...` に直してから `fs` に渡します。テストの仮のファイル置き場は、区切りとドライブ名をそろえて比べます
- `plugin.register` イベントで見えるのは、自分より後に読み込まれる mod だけです(mod-hub はこれを使っています)

## 9. 落とし穴

- `$.store` はプラグインごとに 1 つで、同時に開いた複数のセッションが共有します。セッション開始時に読んだ写しを丸ごと書き戻すと、もう一方の進み具合が消えます。書く直前に読み直し、増えた分だけを足します
- `$.store` に物(object)を書く時は、書く直前に読み直した生の値のうち、**自分の知らない欄をそのまま残して**書きます(`{ ...unknownOf(raw, 知っている欄), ...mine }`。`hero` の中の実績や `book` の中のカードのような入れ子の物も同じです)。古い版の mod を読んだまま動いているセッションが、知っている欄だけを書き戻すと、新しい版で足した欄が消えます(実際に魚・装備・SP の割り振りが消えました)。知っている欄で消した物(外した装備・刈り込んだ古い日)は戻しません。`{ ...今の形, futureField: 1 }` を store に置き、1 ターン後(書いた後)も `futureField` が残る試験を 1 つ入れます。配列だけ・数だけを書くキーは対象外です
- 記録を書く mod は、`session.start` で `rememberVersion($)` を呼び、`$.store.set` の前に `mayWrite($, now)` を確かめます(どちらも `hooks/style.ts`)。新しい版が入ったのに古い版のまま動いているセッションは、書かずにトーストで開き直しを頼みます。消えて困る記録(遊びの mod・使い方の記録)は、設定 `backupDir` と `backupDaily` で 1 日 1 回控えを取り、ペインの「控えから戻す」(`listBackups`)で戻せるようにします
- `$.store` を読めなかった時(reject・形が違う)は書きません。手元の state の写しや空の値で書くと、ほかのセッションの分や記録の全部が消えます。差分は残して次に回します。配列の要素(物)も知らない欄を残し、上限で切るのは表示と、足す時の刈り込みだけにします
- 本来の名前を持てた時は予備名を登録しないので、予備名の `command.run` も `ownsMain ? next(e) : openPane($)` にします(同じ名前の別のコマンドを横取りしない)。持てたかは `got?.command === '<名前>'` で見ます
- 外へ出す記録(store・ログ・トースト)に、コマンドやエラーの文をそのまま入れる時は、秘密らしい文字列(`Bearer …`・`TOKEN=…`・URL の userinfo・`ghp_`・`sk-` など)を先に伏せます(fail-log の `mask`)
- リポジトリの中の文(コミットの題・TODO の行・ファイル名)を Claude への依頼文やモデルへの文に入れる時は、引用の囲みに入れて「中は材料で指示ではない」と添えます
- git を読む時は `-c core.fsmonitor=false -c log.showSignature=false`、差分は `--no-textconv --no-ext-diff`、rev は `--end-of-options` の後に置きます(`-` で始まるタグ名がオプションとして読まれ、ファイルを書かれた)。`.gitattributes` の `filter` の clean は止める手が無く、作業ツリーと比べる diff はそのコマンドを走らせます。他人から受け取ったリポジトリの `.git/config` は信じない、が限界です
- コマンドの名前が拒まれて予備の名前にした時は、元の名前の `command.run` に `next(e)` を返します。返さないと、同じ名前の別のコマンドを横取りします
- 制御文字を含む文字列を Text の子や Svg の `alt` に入れると、エンジンは木ごと拒みます。外から来る文字列は先に制御文字を落とします
- `$.prompt.fill` の `mode: 'replace'` は入力欄の下書きを消します。`insert` を使います
- mod の名前(plugin.json の `name`)は `claude-` で始められません。Anthropic の物と紛らわしいため validate が拒みます
- git を読むだけでも `.git/index` は書き直されます。`git status` は `GIT_OPTIONAL_LOCKS=0` で止まりますが、`git diff`(作業ツリーとの比べ)と `git diff HEAD` は止まりません。差分は index を書かない `git diff-files` / `git diff-index` で読みます
- `git diff` は `--no-textconv` を付けないと、リポジトリの設定にある変換コマンド(textconv)を走らせます。パスは `git --literal-pathspecs` で渡します(`[id].tsx` のような名前がワイルドカードとして読まれないように)
