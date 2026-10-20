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
| aqua-pet | `/aquarium` | 作業に反応する水槽。ターンを重ねると魚が増え、エラーで赤く震える。えさ・名前・掃除のボタン。日本時間の時刻で水の色と光が、季節で飾り(花びら・泡・落ち葉・雪)が変わる |
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
| agent-watch | `/agent-watch` | 動いているサブエージェントの帯のタイムライン(経過・ツール回数・状態)。ボタンでその会話へ切り替え、メインへ戻る |
| canvas-pane | `/canvas` | Claude が呼べるツール `show` を足す。「売上をグラフにしてペインに出して」と頼むと、棒・折れ線・円・表・Markdown・SVG をペインに描く。直近 20 枚をめくれる |
| rule-switch | `/rules` | 「日本語で答える」「commit しない」などの約束ごとをボタンでオン/オフし、システムプロンプトに入れる。自分の約束も足せる |
| wait-games | `/games` | 長いターンの間に遊ぶ 2048 とマインスイーパー。ターンが終わったら知らせる |
| spec-board | `/specs` | [SpecStatus](https://github.com/takosasi-dev/spec-status) の確認待ち・途中の仕様書と次のおすすめ。押すと詳細(読むだけ) |
| ci-pane | `/ci` | 今のブランチの PR(状態・レビュー・チェックの丸)と GitHub Actions の結果。`gh` を使う。何かを起こす操作は無い |
| port-watch | `/ports` | 待ち受け中の TCP ポートと、セッション中に増えた物の印。URL を写すボタンと、開発用の実行環境だけ 2 回押しで止めるボタン |
| pre-check | `/precheck` | コミット前の確かめ。変更の要約・秘密情報らしい文字列(足した行だけ、伏せて表示)・衝突の印・1MB 超のファイル・テスト(ボタンで) |
| face-band | 入力欄の上に自動で出る / `/face` | 待ち・考え中・ツール実行中・答え終わり・エラーで変わる Claude の顔。work-bar と並べて出る |
| done-chime | `/chime` | 長いターン(既定 30 秒以上)が終わったら音を鳴らす。音の種類・しきい値・音量・試し鳴らし |
| turn-haiku | `/haiku` | ターンが終わるたびに、やった事を五七五の 1 句にして縦書きの短冊に。過去の句の一覧 |
| reply-frame | 常時 | 返答をオレンジ、自分の発言を青の角丸の枠で囲む |
| danger-frame | 常時 | 危ないシェルのコマンドの行を赤い枠で囲む |
| long-turn-toast | 常時 | 長くかかったターン(既定 120 秒超)をトーストで知らせる |
| usage-pane | `/usage-pane` | 使用量の JSON を 3 本のバーで表示 |
| devlog-pane | `/devlog` | フォルダにある今日の開発ログ(YYYY-MM-DD.md)を表示 |

reply-frame は [takosasi-dev/reply-frame](https://github.com/takosasi-dev/reply-frame) でも公開しています。ここに入っているのは、自分の発言の枠を足した新しい版です。

## 画面

VS Code のペインに描かれる SVG の部分です(架空のデータ。ボタンなどは省いています)。`node tools/shots.mts` で作り直せます。

<table>
<tr>
<td align="center" valign="top"><b>mod-hub</b><br><img src="docs/images/mod-hub.png" width="250" alt="mod-hub"></td>
<td align="center" valign="top"><b>cc-dash</b><br><img src="docs/images/cc-dash.png" width="250" alt="cc-dash"></td>
<td align="center" valign="top"><b>work-bar</b><br><img src="docs/images/work-bar.png" width="250" alt="work-bar"></td>
</tr>
<tr>
<td align="center" valign="top"><b>face-band</b><br><img src="docs/images/face-band.png" width="250" alt="face-band"></td>
<td align="center" valign="top"><b>aqua-pet</b><br><img src="docs/images/aqua-pet.png" width="250" alt="aqua-pet"></td>
<td align="center" valign="top"><b>project-board</b><br><img src="docs/images/project-board.png" width="250" alt="project-board"></td>
</tr>
<tr>
<td align="center" valign="top"><b>git-pane</b><br><img src="docs/images/git-pane.png" width="250" alt="git-pane"></td>
<td align="center" valign="top"><b>token-meter</b><br><img src="docs/images/token-meter.png" width="250" alt="token-meter"></td>
<td align="center" valign="top"><b>focus-timer</b><br><img src="docs/images/focus-timer.png" width="250" alt="focus-timer"></td>
</tr>
<tr>
<td align="center" valign="top"><b>session-recap</b><br><img src="docs/images/session-recap.png" width="250" alt="session-recap"></td>
<td align="center" valign="top"><b>edit-log</b><br><img src="docs/images/edit-log.png" width="250" alt="edit-log"></td>
<td align="center" valign="top"><b>todo-board</b><br><img src="docs/images/todo-board.png" width="250" alt="todo-board"></td>
</tr>
<tr>
<td align="center" valign="top"><b>test-runner</b><br><img src="docs/images/test-runner.png" width="250" alt="test-runner"></td>
<td align="center" valign="top"><b>pre-check</b><br><img src="docs/images/pre-check.png" width="250" alt="pre-check"></td>
<td align="center" valign="top"><b>ci-pane</b><br><img src="docs/images/ci-pane.png" width="250" alt="ci-pane"></td>
</tr>
<tr>
<td align="center" valign="top"><b>spec-board</b><br><img src="docs/images/spec-board.png" width="250" alt="spec-board"></td>
<td align="center" valign="top"><b>port-watch</b><br><img src="docs/images/port-watch.png" width="250" alt="port-watch"></td>
<td align="center" valign="top"><b>prompt-book</b><br><img src="docs/images/prompt-book.png" width="250" alt="prompt-book"></td>
</tr>
<tr>
<td align="center" valign="top"><b>agent-watch</b><br><img src="docs/images/agent-watch.png" width="250" alt="agent-watch"></td>
<td align="center" valign="top"><b>canvas-pane</b><br><img src="docs/images/canvas-pane.png" width="250" alt="canvas-pane"></td>
<td align="center" valign="top"><b>rule-switch</b><br><img src="docs/images/rule-switch.png" width="250" alt="rule-switch"></td>
</tr>
<tr>
<td align="center" valign="top"><b>live-commentary</b><br><img src="docs/images/live-commentary.png" width="250" alt="live-commentary"></td>
<td align="center" valign="top"><b>turn-gacha</b><br><img src="docs/images/turn-gacha.png" width="250" alt="turn-gacha"></td>
<td align="center" valign="top"><b>dev-rpg</b><br><img src="docs/images/dev-rpg.png" width="250" alt="dev-rpg"></td>
</tr>
<tr>
<td align="center" valign="top"><b>code-omikuji</b><br><img src="docs/images/code-omikuji.png" width="250" alt="code-omikuji"></td>
<td align="center" valign="top"><b>turn-haiku</b><br><img src="docs/images/turn-haiku.png" width="250" alt="turn-haiku"></td>
<td align="center" valign="top"><b>wait-games</b><br><img src="docs/images/wait-games.png" width="250" alt="wait-games"></td>
</tr>
<tr>
<td align="center" valign="top"><b>done-chime</b><br><img src="docs/images/done-chime.png" width="250" alt="done-chime"></td>
</tr>
</table>

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

コマンドの名前がほかのプラグインや組み込みと被った時は、`/edit-log`・`/todo-board`・`/test-runner`・`/prompt-book`・`/live-commentary`・`/turn-gacha`・`/dev-rpg`・`/code-omikuji`・`/gitpane`・`/token-meter`・`/mod-hub`・`/canvas-pane`・`/rule-switch`・`/wait-games`・`/spec-board`・`/ci-pane`・`/port-watch`・`/pre-check`・`/face-band`・`/done-chime`・`/turn-haiku` のように mod の名前のコマンドになります。

## 気を付けること

- rule-switch の約束ごとは、サブエージェントのシステムプロンプトにも入ります。また、組織が Claude Code を管理している環境では、利用者が入れたプラグインのシステムプロンプトのフックは動きません
- rule-switch を切り替えると、プロンプトのキャッシュが作り直されます
- canvas-pane のツールに渡された生の SVG は、スクリプト・イベント属性・外部の参照を含む物を断ります(ペインでは画像として描かれ、スクリプトは動きません)
- turn-haiku は、答えて終わったターンごと(ツールを使ったか 20 秒以上かかった時)に Haiku のモデルを 1 回呼び、トークンを使います。`/haiku` の「自動で詠む」で止められます
- port-watch の「止める」は子プロセスごと止めます(Windows は `taskkill /T /F`)。node で動く MCP サーバーも開発用に見えるので、止める前に名前とポートを確かめてください。macOS / Linux(`lsof`)の実機では未確認です
- pre-check の秘密情報の検出は手がかり程度です。見つからなくても安全とは限りません
- done-chime は Windows では PowerShell の SoundPlayer で鳴らします。それ以外は Claude Code の音の再生を使い、Linux のターミナルでは鳴らないことがあります
- spec-board の一覧は SpecStatus が GitHub の API を使うため、回数の上限に当たることがあります。読み直しは 5 分ごとです
- ci-pane と git を読む mod は、所有者の違うフォルダ(別ドライブなど)では git が止まります。`git config --global --add safe.directory <フォルダ>` を足してください
- aqua-pet の背景は 15 分ごとに描き直します。描き直すと泳ぎや泡のアニメが頭から始まります

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
| pre-check | `testCommand` / `timeoutSeconds` | test-runner と同じ。空ならテストの項目は飛ばす |
| spec-board | `pythonPath` | python の絶対パス(PATH にあれば `python` や `py` でも可) |
| spec-board | `specstatusScript` | SpecStatus の `specstatus.py` の絶対パス |

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
- VS Code 拡張 2.1.300 の実画面で、ペイン・ボタン・トースト・SVG のアニメと、0.4.0 までの mod の画面が開くこと、work-bar の帯が出ることを確かめています
- 0.5.0 で足した mod(spec-board・ci-pane・port-watch・pre-check・face-band・done-chime・turn-haiku)は、テストまでで、実画面での確認はこれからです
- 関数フックの API はまだ先行公開の段階で、Claude Code の版によって変わることがあります

## ライセンス

MIT
