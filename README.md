# claude-code-mods

Claude Code の関数フック mod を集めたリポジトリです。
ペイン・入力欄の上の帯・枠・トーストを使い、VS Code 拡張でもターミナルでも見た目が崩れないように作っています。
VS Code では SVG のグラフやアニメ(SMIL / CSS)も描けます。

Anthropic とは関係のない、個人が作った非公式の mod です。

## 入っている mod

| mod | 呼び方 | 何をするか |
|---|---|---|
| mod-hub | `/mod` | 画面のある mod(ペインや帯を出す物)を開くボタンを並べる |
| cc-dash | `/dash` | セッションの計器盤。経過・ターン・ツール・エラーのタイル、ターンの所要時間の棒グラフ、ツールのタイムライン、使用量のリング型ゲージ |
| work-bar | 入力欄の上に自動で出る | 作業中は経過時間・今のツール・流れる光の帯。待ち中は前のターンのまとめと定型文のボタン |
| aqua-pet | `/aquarium` | 作業に反応する水槽。ターンを重ねると魚が増え、エラーで赤く震える。えさ・名前・掃除のボタン。水の色は日本時間の朝・昼・夕・夜で変わる |
| project-board | `/projects` | フォルダに並んだ引き継ぎメモ(*.md)の鮮度グラフと一覧・詳細 |
| git-pane | `/git` | 今のフォルダの git の様子。ブランチ・変更行数の差分バー・直近コミット。git には書き込まない |
| token-meter | `/tokens` | ターンごとのトークンの積み上げ棒とキャッシュの当たり率 |
| focus-timer | `/focus-timer` | ポモドーロ。減っていくリングと今日の本数 |
| session-recap | `/session-recap` | セッションのふりかえり。ターンの帯のタイムラインと、押した時だけ作る要約 |
| edit-log | `/edits` | このセッションで Claude が Edit / Write などの編集ツールで変えたファイルの時系列。押すと git の差分(HEAD と比べる)と「レビューして」 |
| todo-board | `/todos` | 今のフォルダの TODO / FIXME / HACK / XXX の件数・推移・一覧。押すと「片付けて」 |
| test-runner | `/testrun` | 設定したテストのコマンドをボタンで走らせる。信号と直近 20 回の結果、失敗したら「直して」 |
| prompt-book | `/prompts` | よく使う依頼文を保存して、ボタンで入力欄へ。タグ・使った回数・並び替え |
| live-commentary | `/jikkyo` | Claude の動きをスポーツ実況風にステータス行へ。口調は熱血・冷静・関西 |
| turn-gacha | `/gacha` | ターンが終わるたびにガチャ。N / R / SR / SSR のカード 40 種と図鑑 |
| dev-rpg | `/rpg` | 作業すると経験値がたまる RPG。レベル・称号・実績 |
| code-omikuji | `/omikuji` | 今日のコード運勢。筒を振るアニメと和紙のおみくじ |
| reply-frame | 常時 | 返答をオレンジ、自分の発言を青の角丸の枠で囲む |
| danger-frame | 常時 | 危ないシェルのコマンドの行を赤い枠で囲む |
| long-turn-toast | 常時 | 長くかかったターン(既定 120 秒超)をトーストで知らせる |
| usage-pane | `/usage-pane` | 使用量の JSON を 3 本のバーで表示 |
| devlog-pane | `/devlog` | フォルダにある今日の開発ログ(YYYY-MM-DD.md)を表示 |

reply-frame は [takosasi-dev/reply-frame](https://github.com/takosasi-dev/reply-frame) でも公開しています。ここに入っているのは、自分の発言の枠を足した新しい版です。

## 動作環境

- Claude Code 2.1.300 以降(関数フックの mod を読み込める版)
- VS Code で描くには、VS Code 拡張 2.1.300 以降が要ります。2.1.288 までの拡張は mod の描画に対応していません
- ターミナル・デスクトップアプリでも動きます。ターミナルでは SVG の代わりに文字だけの表示になります

## 入れ方

好きな mod だけ入れられます。ターミナルの Claude Code の入力欄で:

```
/plugin install cc-dash --marketplace takosasi-dev/claude-code-mods
```

`y` でマーケットプレイスを足し、スコープを選ぶと入ります。シェルからは:

```sh
claude plugin install cc-dash --marketplace takosasi-dev/claude-code-mods
```

デスクトップアプリでは、入力欄の横の + → Plugins → Add marketplace に `takosasi-dev/claude-code-mods` を入れ、Add plugin で選びます。

mod-hub に並ぶのは、mod-hub より後に読み込まれる mod だけです。mod-hub を最初に入れてください。

コマンドの名前がほかのプラグインや組み込みと被った時は、`/edit-log`・`/todo-board`・`/test-runner`・`/prompt-book`・`/live-commentary`・`/turn-gacha`・`/dev-rpg`・`/code-omikuji`・`/gitpane`・`/token-meter`・`/mod-hub` のように mod の名前のコマンドになります。

## 設定が要る mod

次の mod は、読むファイルやフォルダを設定するまで「未設定」と表示します。`/config` で入れるか、`~/.claude/settings.json` の `pluginConfigs` に書きます。

| mod | 項目 | 中身 |
|---|---|---|
| cc-dash / usage-pane | `usageFile` | 使用量の JSON の絶対パス(形は下を参照) |
| project-board | `memoDir` | 引き継ぎメモ(*.md)が並ぶフォルダ |
| project-board | `vaultRoot` / `vaultName` | Obsidian の vault の根と名前(入れると「Obsidian で開く」が出る) |
| devlog-pane | `logDir` | YYYY-MM-DD.md(日付は日本時間)が並ぶフォルダ |
| test-runner | `testCommand` | テストのコマンド(例 `npm test`。シェルを通さず空白で区切る) |
| test-runner | `timeoutSeconds` | 時間の上限(秒、既定 300) |

```json
"pluginConfigs": {
  "project-board@claude-code-mods": {
    "options": { "memoDir": "D:\\notes\\handoff" }
  }
}
```

キーは入れ方で変わります。マーケットプレイスから入れた時は `<mod>@claude-code-mods`、`--plugin-dir` や `CLAUDE_CODE_PLUGIN_DIRS` でフォルダを読ませている時は `<mod>` です。パスは絶対パスで書いてください(相対パスは未設定と同じ扱いです)。

使用量の JSON はほかのツールで書き出す前提です。形は次のとおりです(`model*` は無くても動きます)。

```json
{ "sessionPct": 9, "weeklyPct": 2, "sessionResetAt": "2026-10-20T03:00:00+00:00",
  "weeklyResetAt": "2026-10-26T19:00:00+00:00", "modelName": "Opus", "modelPct": 0,
  "modelResetAt": "2026-10-26T19:00:00+00:00", "fetchedAt": 1792462154448 }
```

## 自分で作るとき

[docs/mod-guide.md](docs/mod-guide.md) に、VS Code でも凝った見た目を出すための約束ごとをまとめています。VS Code で使える部品と Svg の性質(アニメは動くが hover とクリックは効かない)、入力欄の上の帯の罠、値の持ち方、テストの書き方などです。

各 mod のフォルダで確かめられます。

```sh
claude plugin validate mods/cc-dash
claude plugin test mods/cc-dash
```

## 開発状況

- テストは全 mod で通っています(`claude plugin test`)
- VS Code 拡張 2.1.300 の実画面で確かめたのは、ペイン・ボタン・トースト・SVG のアニメ、cc-dash・aqua-pet・project-board の表示までです
- work-bar(入力欄の上の帯)は、VS Code ではセッションの途中に読み込んだときに出ないことがあり、0.1.1 で手当てしました。実画面での確認はこれからです
- 関数フックの API はまだ先行公開の段階で、Claude Code の版によって変わることがあります

## ライセンス

MIT
