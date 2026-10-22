# claude-code-mods

[English](README.en.md)

Claude Code の関数フック mod を集めたリポジトリです。
ペイン・入力欄の上の帯・枠・トーストを使い、VS Code 拡張でもターミナルでも見た目が崩れないように作っています。
VS Code では SVG のグラフやアニメ(SMIL / CSS)も描けます。

Anthropic とは関係のない、個人が作った非公式の mod です。

## 入っている mod

| mod | 呼び方 | 何をするか |
|---|---|---|
| mod-hub | `/mod` | 画面のある mod(ペインや帯を出す物)をアイコン付きで並べる。名前・説明で絞る、固定して上に置く、カテゴリー別(開発・状況・道具・遊び)・名前順・最近開いた順。見出しに季節の小さな飾り |
| cc-dash | `/dash` | セッションの計器盤。経過・ターン・ツール・エラーのタイル、ターンの所要時間の棒グラフ、ツールのタイムライン、使用量のリング型ゲージ。「自分の並び」で出す枠と順を自分で決められる |
| work-bar | 入力欄の上に自動で出る | 作業中は経過時間・今のツール・流れる光の帯。待ち中は前のターンのまとめと定型文のボタン |
| aqua-pet | `/aquarium` | 作業に反応する水槽。魚は 1 匹ずつターンで 稚魚 → 若魚 → 成魚 → 大物 と育ち、節目で新しい魚(全 10 種、後ほど珍しい)が来る。エラーで赤く震える。えさ・名前・掃除・魚の一覧のボタン。日本時間の時刻で水の色と光が(夕は橙で沈む日、夜は月と星)、季節で飾り(花びら・泡・落ち葉・雪)が変わる |
| project-board | `/projects` | フォルダに並んだ引き継ぎメモ(*.md)の鮮度グラフと一覧・詳細 |
| git-pane | `/git` | 今のフォルダの git の様子。ブランチ・変更行数の差分バー・直近コミット。git には書き込まない |
| token-meter | `/tokens` | ターンごとのトークンの積み上げ棒とキャッシュの当たり率 |
| focus-timer | `/focus-timer` | ポモドーロ。減っていくリングと今日の本数 |
| session-recap | `/session-recap` | セッションのふりかえり。ターンの帯のタイムラインと、押した時だけ作る要約 |
| edit-log | `/edits` | このセッションで Claude が Edit / Write などの編集ツールで変えたファイルの時系列。押すと git の差分(HEAD と比べる)と「レビューして」 |
| todo-board | `/todos` | 今のフォルダの TODO / FIXME / HACK / XXX の件数・推移・一覧。git の外はフォルダを歩いて読む。種類のボタンで絞り、押すと「片付けて」 |
| test-runner | `/testrun` | 設定したテストのコマンドをボタンで走らせる。信号と直近 20 回の結果、失敗したら「直して」。Claude が走らせたテストも拾い、落ちている間は入力欄の上に 1 行出す。落ちたままコミットしようとしたらトーストで知らせる |
| prompt-book | `/prompts` | よく使う依頼文を保存して、ボタンで入力欄へ。タグ・使った回数・並び替え |
| live-commentary | `/jikkyo` | Claude の動きをスポーツ実況風にステータス行へ。口調は熱血・冷静・関西 |
| turn-gacha | `/gacha` | ターンが終わるたびにガチャ。N / R / SR / SSR のカード 60 種と図鑑、集まり具合の実績 6 個。出たカードは dev-rpg で装備にできる。daily-quest のお題をこなすと、おまけで引ける |
| dev-rpg | `/rpg` | 作業すると経験値がたまる RPG。レベル・称号・実績 22 個。ターンを終えるとたまる「魔物の気配」で魔物 8 種・ボス 3 体とボタンで戦う。ボスは時々湧き、湧いたボスは気配を使わずに挑めて経験値 1.5 倍。戦いで減った HP は 15 分休むか新しいセッションで戻る。レベル・実績・勝利・ボスで入る SP を能力(力・体力・知恵・敏捷)に振り、スキル 10 種を覚える。turn-gacha のカードを武器・防具・お守りに装備して能力が上がる。daily-quest のお題をこなすと経験値が入る |
| code-omikuji | `/omikuji` | 今日のコード運勢。筒を振ると棒の番号が回って止まり、和紙のおみくじが開く。文は 238 通りと、その季節の日だけ出る一言 |
| agent-watch | `/agent-watch` | 動いているサブエージェントの帯のタイムライン(経過・ツール回数・状態)。ボタンでその会話へ切り替え、メインへ戻る |
| canvas-pane | `/canvas` | Claude が呼べるツール `show` を足す。「売上をグラフにしてペインに出して」と頼むと、棒・折れ線・円・表・Markdown・SVG をペインに描く。直近 20 枚をめくれる |
| rule-switch | `/rules` | 「日本語で答える」「commit しない」などの約束ごとをボタンでオン/オフし、システムプロンプトに入れる。自分の約束も足せる |
| wait-games | `/games` | 長いターンの間に遊ぶ 2048・マインスイーパー・15 パズル・ライツアウト・数独(4x4 / 9x9)・神経衰弱。ゲームごとに勝ち数・最短手数・最速を残す。ターンが終わったら知らせる |
| spec-board | `/specs` | [SpecStatus](https://github.com/takosasi-dev/spec-status) の確認待ち・途中の仕様書と次のおすすめ。押すと詳細(読むだけ) |
| ci-pane | `/ci` | 今のブランチの PR(状態・レビュー・チェックの丸)と GitHub Actions の結果。`gh` を使う。何かを起こす操作は無い |
| port-watch | `/ports` | 待ち受け中の TCP ポートと、セッション中に増えた物の印。URL を写すボタンと、開発用の実行環境だけ 2 回押しで止めるボタン |
| pre-check | `/precheck` | コミット前の確かめ。変更の要約・秘密情報らしい文字列(足した行だけ、伏せて表示)・衝突の印・1MB 超のファイル・テスト(ボタンで) |
| face-band | `/face` で出す / 隠す | 待ち・考え中・ツール実行中・答え終わり・エラーで変わる Claude の顔。日本時間の時間帯と季節で小物が変わる(夜は眠そうにナイトキャップ、夏は麦わら帽子、冬はマフラーなど)。入れただけでは出ない(最初はオフ)。work-bar と並べて出る |
| done-chime | `/chime` | 長いターン(既定 30 秒以上)が終わったら音を鳴らす。音の種類・しきい値・音量・試し鳴らし |
| turn-haiku | `/haiku` | ターンが終わるたびに、やった事を五七五の 1 句にして縦書きの短冊に。季節の季語の候補を添えて詠む。過去の句の一覧 |
| session-timeline | `/timeline` | このセッションのターンとツール呼び出しを横の帯の年表で。ツールの種類で色分け、失敗は赤い印、サブエージェントは細い帯、1 分以上のターンは黄の縁 |
| file-map | `/filemap` | このセッションで読んだ・書いたファイルを、フォルダごとの四角(ツリーマップ)で。大きいほど多く触った所、橙は書いた物、青は読んだだけ |
| toast-inbox | `/inbox` | ほかの mod が出したトーストとステータス行を 100 件まで残す受け箱。未読の数・mod ごとの件数・mod で絞る・全部既読・空にする。通知の行を押すと、それを出した mod のペインを開く |
| usage-history | `/history` | 日をまたいだ使い方の記録。日ごとのターン数か出力トークンの棒(7 日 / 30 日)、合計と 1 日平均、曜日と時間帯のヒートマップ |
| fail-log | `/errors` | ツールが失敗した記録を 200 件まで残す。似た失敗をまとめた「よく落ちる物」の棒、最近の一覧、今日・通算の数。サブエージェントの分は紫で分ける |
| daily-quest | `/quest` | 日替わりのお題 3 つ(ターン・ファイルを直す・テスト・コミットなど 8 種から)。進みの棒・ごほうび・連続日数・直近 7 日。ごほうびは dev-rpg が経験値、turn-gacha がおまけの抽選で受け取る |
| trophy-shelf | `/trophies` | dev-rpg・turn-gacha・aqua-pet・wait-games・daily-quest の記録を 1 枚の棚にまとめ、トロフィーを初めて取った日付つきで集める |
| mod-check | `/mod-check` | mod がちゃんと動いているかを 1 回で確かめる。入っている・コマンドあり・予備名・見つからないの数と、mod ごとの判定(本来の名前か予備名か、本来の名前を使っている相手)、画面・テーマ・Claude Code の版をペインに出し、同じ結果を 1 行 1 mod の貼れる文で返す |
| compact-cue | 入力欄の上に自動で出る・`/cue` | コンテキストの使用量が多くなった時、テストが通った・コミットした・引き継ぎメモを書いた直後なら「今が /compact のよい時」、編集の途中なら「区切りまで待って」と帯とトーストで知らせる。ペインは使用量のリングと作業の様子。知らせるだけで compact はしない |
| ship-guard | 常時・`/guard` | Claude が git push・gh release・gh repo create・npm publish を打つ時、直前に AskUserQuestion で公開してよいと答えていなければ、その場で「実行しますか？」と聞き、断られたら止める。ペインは記録とオン/オフ。git push の前は、送るコミットの作者が noreply か、足した行に個人のメール・ユーザー名入りのパスが無いかも確かめ、引っかかったら確認済みでも聞き直す |
| rule-watch | 入力欄の上に自動で出る・`/rulewatch` | Claude の返事が約束ごとから外れた時に帯で知らせる。英語で答えた・AskUserQuestion を使わずに「〜しますか？」で終わった・コミットの後に引き継ぎメモを書いていない、の 3 つ。ペインは数と記録、「Claude に伝える」で入力欄に一言入れる |
| enc-guard | 常時・`/enc` | 文字コード・改行の罠を Claude が踏んだ時に、直し方を Claude に伝える(設定で止めるにもできる)。-Encoding の無い Set-Content / Add-Content、日本語入りで BOM の無い .ps1、ASCII 以外の字が入った .bat / .cmd、Windows で encoding= / newline= の無い Python の open |
| release-draft | `/release` | 前のタグから今までのコミットと、版が上がった plugin.json / package.json を集めて、CHANGELOG の下書き(Added / Changed / Fixed)と次の版の候補を出す。「これで CHANGELOG を書いて」で Claude に頼む。git は読むだけ |
| reply-frame | 常時 | 返答をオレンジ、自分の発言を青の角丸の枠で囲む |
| danger-frame | 常時 | 危ないシェルのコマンドの行を赤い枠で囲む |
| long-turn-toast | 常時 | 長くかかったターン(既定 120 秒超)をトーストで知らせる |
| usage-pane | `/usage-pane` | 使用量の JSON を 3 本のバーで表示 |
| devlog-pane | `/devlog` | フォルダにある今日の開発ログ(YYYY-MM-DD.md)を表示 |

reply-frame は [takosasi-dev/reply-frame](https://github.com/takosasi-dev/reply-frame) でも公開しています。ここに入っているのは、自分の発言の枠を足した新しい版です。

## 画面

VS Code のペインに描かれる SVG の部分です(架空のデータ。ボタンなどは省いています)。`node tools/shots.mts` で作り直せます(`--light` で明るいテーマ)。

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
<td align="center" valign="top"><b>session-timeline</b><br><img src="docs/images/session-timeline.png" width="250" alt="session-timeline"></td>
<td align="center" valign="top"><b>file-map</b><br><img src="docs/images/file-map.png" width="250" alt="file-map"></td>
<td align="center" valign="top"><b>usage-history</b><br><img src="docs/images/usage-history.png" width="250" alt="usage-history"></td>
</tr>
<tr>
<td align="center" valign="top"><b>toast-inbox</b><br><img src="docs/images/toast-inbox.png" width="250" alt="toast-inbox"></td>
<td align="center" valign="top"><b>done-chime</b><br><img src="docs/images/done-chime.png" width="250" alt="done-chime"></td>
<td align="center" valign="top"><b>fail-log</b><br><img src="docs/images/fail-log.png" width="250" alt="fail-log"></td>
</tr>
<tr>
<td align="center" valign="top"><b>daily-quest</b><br><img src="docs/images/daily-quest.png" width="250" alt="daily-quest"></td>
<td align="center" valign="top"><b>trophy-shelf</b><br><img src="docs/images/trophy-shelf.png" width="250" alt="trophy-shelf"></td>
<td align="center" valign="top"><b>mod-check</b><br><img src="docs/images/mod-check.png" width="250" alt="mod-check"></td>
</tr>
<tr>
<td align="center" valign="top"><b>compact-cue</b><br><img src="docs/images/compact-cue.png" width="250" alt="compact-cue"></td>
<td align="center" valign="top"><b>ship-guard</b><br><img src="docs/images/ship-guard.png" width="250" alt="ship-guard"></td>
<td align="center" valign="top"><b>rule-watch</b><br><img src="docs/images/rule-watch.png" width="250" alt="rule-watch"></td>
</tr>
<tr>
<td align="center" valign="top"><b>enc-guard</b><br><img src="docs/images/enc-guard.png" width="250" alt="enc-guard"></td>
<td align="center" valign="top"><b>release-draft</b><br><img src="docs/images/release-draft.png" width="250" alt="release-draft"></td>
</tr>
</table>

### 動く絵

ペインの絵は開いた時に 1 回動きます(数字が増える・棒が伸びる・おみくじが開く)。`node tools/gif.mts <mod>` で作り直せます。

<table>
<tr>
<td align="center" valign="top"><b>mod-hub</b><br><img src="docs/images/mod-hub.gif" width="250" alt="mod-hub(動く絵)"></td>
<td align="center" valign="top"><b>cc-dash</b><br><img src="docs/images/cc-dash.gif" width="250" alt="cc-dash(動く絵)"></td>
</tr>
<tr>
<td align="center" valign="top"><b>usage-history</b><br><img src="docs/images/usage-history.gif" width="250" alt="usage-history(動く絵)"></td>
<td align="center" valign="top"><b>code-omikuji</b><br><img src="docs/images/code-omikuji.gif" width="250" alt="code-omikuji(動く絵)"></td>
</tr>
</table>

### 明るいテーマ

Claude Code の `/config` で theme を明るい物(light で始まる物)にすると、SVG も明るい色で描きます(VS Code の配色は mod から読めないので、Claude Code の theme に合わせます)。

<table>
<tr>
<td align="center" valign="top"><b>mod-hub</b><br><img src="docs/images/mod-hub-light.png" width="250" alt="mod-hub(明るいテーマ)"></td>
<td align="center" valign="top"><b>git-pane</b><br><img src="docs/images/git-pane-light.png" width="250" alt="git-pane(明るいテーマ)"></td>
<td align="center" valign="top"><b>usage-history</b><br><img src="docs/images/usage-history-light.png" width="250" alt="usage-history(明るいテーマ)"></td>
</tr>
</table>

## 動作環境

- Claude Code 2.1.300 以降(関数フックの mod を読み込める版)
- VS Code で描くには、VS Code 拡張 2.1.300 以降が要ります。2.1.288 までの拡張は mod の描画に対応していません
- ターミナル・デスクトップアプリでも動きます。ターミナルでは SVG の代わりに文字だけの表示になります

## 入れ方

好きな mod だけ入れられます。冒険の書(dev-rpg)とガチャ(turn-gacha)の 2 本だけが欲しい時は、単体版の [claude-code-dev-rpg](https://github.com/takosasi-dev/claude-code-dev-rpg) からも入れられます(中身は同じなので、どちらか片方から入れてください)。ターミナルの Claude Code の入力欄で:

```
/plugin install cc-dash --marketplace takosasi-dev/claude-code-mods
```

`y` でマーケットプレイスを足し、スコープを選ぶと入ります。シェルからは:

```sh
claude plugin install cc-dash --marketplace takosasi-dev/claude-code-mods
```

デスクトップアプリでは、入力欄の横の + → Plugins → Add marketplace に `takosasi-dev/claude-code-mods` を入れ、Add plugin で選びます。

mod-hub に並ぶのは、mod-hub より後に読み込まれる mod だけです。mod-hub を最初に入れてください。カテゴリーとアイコンはこのリポジトリの mod だけに付いていて、ほかの mod は「その他」に入ります。toast-inbox と mod-check も、ほかの mod より後から読み込まれる物を見るので、mod-hub の次に入れるのがおすすめです。

コマンドの名前がほかのプラグインや組み込みと被った時は、`/edit-log`・`/todo-board`・`/test-runner`・`/prompt-book`・`/live-commentary`・`/turn-gacha`・`/dev-rpg`・`/code-omikuji`・`/gitpane`・`/token-meter`・`/mod-hub`・`/canvas-pane`・`/rule-switch`・`/wait-games`・`/spec-board`・`/ci-pane`・`/port-watch`・`/pre-check`・`/face-band`・`/done-chime`・`/turn-haiku`・`/session-timeline`・`/file-map`・`/toast-inbox`・`/usage-history`・`/fail-log`・`/compact-cue`・`/ship-guard`・`/rule-watch`・`/enc-guard`・`/release-draft`・`/daily-quest`・`/trophy-shelf`・`/modcheck` のように mod の名前のコマンドになります。

### まとめて入れる

`claude plugin install` は 1 回に 1 本だけ受け取ります。まとめて入れる時は、下の行のかたまりをシェル(bash・zsh・PowerShell のどれでも)にそのまま貼ってください。最初の 1 本でマーケットプレイスが足され、2 本目からはそれを使います。スコープは既定で user(全プロジェクト)で、`-s project` を付けると今のプロジェクトだけに入ります。mod-hub・toast-inbox・mod-check を先に入れてから、ほしいカテゴリーを開いて貼ります。

**最初に**(mod-hub・toast-inbox・mod-check)

```sh
claude plugin install mod-hub --marketplace takosasi-dev/claude-code-mods
claude plugin install toast-inbox --marketplace takosasi-dev/claude-code-mods
claude plugin install mod-check --marketplace takosasi-dev/claude-code-mods
```

<details><summary>開発(14 本): project-board・git-pane・edit-log・todo-board・test-runner・spec-board・ci-pane・port-watch・pre-check・fail-log・ship-guard・rule-watch・enc-guard・release-draft</summary>

```sh
claude plugin install project-board --marketplace takosasi-dev/claude-code-mods
claude plugin install git-pane --marketplace takosasi-dev/claude-code-mods
claude plugin install edit-log --marketplace takosasi-dev/claude-code-mods
claude plugin install todo-board --marketplace takosasi-dev/claude-code-mods
claude plugin install test-runner --marketplace takosasi-dev/claude-code-mods
claude plugin install spec-board --marketplace takosasi-dev/claude-code-mods
claude plugin install ci-pane --marketplace takosasi-dev/claude-code-mods
claude plugin install port-watch --marketplace takosasi-dev/claude-code-mods
claude plugin install pre-check --marketplace takosasi-dev/claude-code-mods
claude plugin install fail-log --marketplace takosasi-dev/claude-code-mods
claude plugin install ship-guard --marketplace takosasi-dev/claude-code-mods
claude plugin install rule-watch --marketplace takosasi-dev/claude-code-mods
claude plugin install enc-guard --marketplace takosasi-dev/claude-code-mods
claude plugin install release-draft --marketplace takosasi-dev/claude-code-mods
```

</details>

<details><summary>状況(11 本): cc-dash・work-bar・token-meter・session-recap・agent-watch・session-timeline・file-map・usage-history・usage-pane・devlog-pane・compact-cue</summary>

```sh
claude plugin install cc-dash --marketplace takosasi-dev/claude-code-mods
claude plugin install work-bar --marketplace takosasi-dev/claude-code-mods
claude plugin install token-meter --marketplace takosasi-dev/claude-code-mods
claude plugin install session-recap --marketplace takosasi-dev/claude-code-mods
claude plugin install agent-watch --marketplace takosasi-dev/claude-code-mods
claude plugin install session-timeline --marketplace takosasi-dev/claude-code-mods
claude plugin install file-map --marketplace takosasi-dev/claude-code-mods
claude plugin install usage-history --marketplace takosasi-dev/claude-code-mods
claude plugin install usage-pane --marketplace takosasi-dev/claude-code-mods
claude plugin install devlog-pane --marketplace takosasi-dev/claude-code-mods
claude plugin install compact-cue --marketplace takosasi-dev/claude-code-mods
```

</details>

<details><summary>道具(5 本): focus-timer・prompt-book・canvas-pane・rule-switch・done-chime</summary>

```sh
claude plugin install focus-timer --marketplace takosasi-dev/claude-code-mods
claude plugin install prompt-book --marketplace takosasi-dev/claude-code-mods
claude plugin install canvas-pane --marketplace takosasi-dev/claude-code-mods
claude plugin install rule-switch --marketplace takosasi-dev/claude-code-mods
claude plugin install done-chime --marketplace takosasi-dev/claude-code-mods
```

</details>

<details><summary>遊び(10 本): aqua-pet・live-commentary・turn-gacha・dev-rpg・code-omikuji・wait-games・face-band・turn-haiku・daily-quest・trophy-shelf</summary>

```sh
claude plugin install aqua-pet --marketplace takosasi-dev/claude-code-mods
claude plugin install live-commentary --marketplace takosasi-dev/claude-code-mods
claude plugin install turn-gacha --marketplace takosasi-dev/claude-code-mods
claude plugin install dev-rpg --marketplace takosasi-dev/claude-code-mods
claude plugin install code-omikuji --marketplace takosasi-dev/claude-code-mods
claude plugin install wait-games --marketplace takosasi-dev/claude-code-mods
claude plugin install face-band --marketplace takosasi-dev/claude-code-mods
claude plugin install turn-haiku --marketplace takosasi-dev/claude-code-mods
claude plugin install daily-quest --marketplace takosasi-dev/claude-code-mods
claude plugin install trophy-shelf --marketplace takosasi-dev/claude-code-mods
```

</details>

<details><summary>常時(3 本): reply-frame・danger-frame・long-turn-toast</summary>

```sh
claude plugin install reply-frame --marketplace takosasi-dev/claude-code-mods
claude plugin install danger-frame --marketplace takosasi-dev/claude-code-mods
claude plugin install long-turn-toast --marketplace takosasi-dev/claude-code-mods
```

</details>

全部(46 本)をまとめて(bash / zsh):

```sh
for m in mod-hub toast-inbox mod-check cc-dash work-bar aqua-pet project-board git-pane token-meter focus-timer session-recap edit-log todo-board test-runner prompt-book live-commentary turn-gacha dev-rpg code-omikuji agent-watch canvas-pane rule-switch wait-games spec-board ci-pane port-watch pre-check face-band done-chime turn-haiku session-timeline file-map usage-history compact-cue fail-log ship-guard rule-watch enc-guard release-draft daily-quest trophy-shelf reply-frame danger-frame long-turn-toast usage-pane devlog-pane; do claude plugin install "$m" --marketplace takosasi-dev/claude-code-mods; done
```

PowerShell:

```powershell
foreach ($m in 'mod-hub','toast-inbox','mod-check','cc-dash','work-bar','aqua-pet','project-board','git-pane','token-meter','focus-timer','session-recap','edit-log','todo-board','test-runner','prompt-book','live-commentary','turn-gacha','dev-rpg','code-omikuji','agent-watch','canvas-pane','rule-switch','wait-games','spec-board','ci-pane','port-watch','pre-check','face-band','done-chime','turn-haiku','session-timeline','file-map','usage-history','compact-cue','fail-log','ship-guard','rule-watch','enc-guard','release-draft','daily-quest','trophy-shelf','reply-frame','danger-frame','long-turn-toast','usage-pane','devlog-pane') { claude plugin install $m --marketplace takosasi-dev/claude-code-mods }
```

この一覧は `node tools/plugin_dirs.mts --readme` で作り直せます(`--en` で英語版)。

### clone したフォルダから読ませる

リポジトリを clone して、そのフォルダから読ませることもできます。

- フォルダをマーケットプレイスとして足す: 上の行の `takosasi-dev/claude-code-mods` を clone 先のパス(例 `D:\work\claude-code-mods`)に変えて入れます。mod はそのフォルダから直接読まれるので、`git pull` の後に `/reload-plugins` で新しい版になります
- `CLAUDE_CODE_PLUGIN_DIRS` で読ませる: 入れずに、セッションを始める時に毎回フォルダから読みます。値は clone 先で `node tools/plugin_dirs.mts` を走らせると出ます(別の場所を指すなら `node tools/plugin_dirs.mts D:\work\claude-code-mods`)。mod-hub・toast-inbox・mod-check を先頭に、全 mod のフォルダを Windows は `;`、ほかは `:` でつないだ 1 行です。これを環境変数か、`~/.claude/settings.json` の `env` の `CLAUDE_CODE_PLUGIN_DIRS` に入れます(道具は settings.json を書き換えません)。要らない mod はその行から消してください

```
D:\work\claude-code-mods\mods\mod-hub;D:\work\claude-code-mods\mods\toast-inbox;D:\work\claude-code-mods\mods\cc-dash;...
```

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
- aqua-pet 0.2 の記録は、開いた時に今の匹数の魚を作って引き継ぎます。0.2 と 0.3 のセッションを同時に開いていると、魚の来た日が作り直されることがあります
- dev-rpg の装備は turn-gacha 0.2.0 以降と一緒に入れた時だけ使えます。ガチャの図鑑から消えたカードは外れた扱いになりますが、記録は残ります
- toast-inbox が拾うのは、ほかの mod が `$.ui.toast` / `$.ui.status` を呼んだ時だけです。「空にする」はほかのセッションの記録も消します
- usage-history は入れた後のターンから数えます。日付・曜日・時刻は日本時間です
- file-map は失敗した呼び出しを数えません。Grep と Glob は path を渡した時だけ数えます
- 明るいテーマでも、水槽・俳句の短冊・おみくじの紙・実況のスタジアム・RPG の窓は絵の色のままです
- mod の版を上げたら、開いているほかのセッションも開き直してください。0.7.0 から記録は知らない欄を残して書くので、新しい版の記録は消えなくなりましたが、0.6 以前の mod を読んだまま動いているセッションは、新しい版で増えた欄(魚の種類・装備・SP の割り振りなど)を消して書き戻します
- fail-log の記録は、同時に開いた全セッションで共有します。「今日」は日本時間の日付で、残している 200 件から数えます
- todo-board は git の中では `git grep` で読みます(.gitignore の物は読みません)。git の外では作業フォルダを歩いて読み(2000 ファイル・5000 件・8 秒で止め、1 MiB を超えるファイルと `.` で始まるフォルダ・node_modules・dist などは読みません)、この時はファイルを変えても自動では読み直さないので「再読込」を押してください
- daily-quest のお題は日本時間の日付だけで決まります。数えるのはメインのターンだけで、「テスト」はコマンドの名前の形(`npm test`・`pytest` など)で見ます。ごほうびは dev-rpg と turn-gacha がターンの終わりに 1 回だけ受け取ります
- trophy-shelf はほかの mod の記録を読むだけです。入っていない mod の棚は「入っていません」と出ます。一度取ったトロフィーは、その mod を外しても残ります
- cc-dash の「自分の並び」は記録に残るので、全セッションで共有されます
- mod-check が版と「読み込みを拒まれた」を出せるのは、mod-check より後に読み込まれた mod だけです。「state まだ」は壊れているという意味ではありません(開いた時にしか値を書かない mod があります)。reply-frame・danger-frame・long-turn-toast はコマンドも state も持たないので「確かめられない」と出ます
- compact-cue は Claude の返事のたびに使用量を読み、自動 compact が走る位置を 100% として数えます(位置が分からない時はモデルの窓に対する割合)。最初の返事の前は「─」、compact の直後は compact 後の数を出します。区切りはコマンドの形(`git commit`・`npm test`・`pytest` など)と、`memoDir` の下へ書いたかで見分けます
- ship-guard が見るのは Bash と PowerShell のツールだけです。引用符で囲んだパスから呼ぶ git(`& "C:\...\git.exe" push`)や、スクリプトの中の push は見分けられません。確認として数えるのは、問いか答えが公開の話(push・公開・リリースなど)で、答えが断り(やめる・しない など)でない時だけで、そのターンと次のターンまで効きます。`claude -p` のように聞けない場では止めます
- ship-guard の公開前のチェックは、どのリモートにもまだ無いコミット(最大 200)を `git log -p` で読みます。読む場所は push の前の `cd` か `git -C` の先です。メールは noreply・example.com などを気にせず、`allowedEmails` に入れた物も気にしません。`C:\Users\<名前>` の `<名前>` が 1 字や見本の名前(user・runner など)なら気にしません
- rule-watch が見るのは、メインの返事の最後の文(ツールの間に書いた文は見ません)です。英語かどうかは、コード・パス・URL を除いた地の文の字で決めます。メモの見張りは `memoDir` を入れた時だけで、そのフォルダへの Write / Edit と、そのフォルダを指すシェルのコマンドを「書いた」とみなします
- enc-guard の .ps1 の BOM は、Write なら書く前に、Edit なら書いた後にファイルを読んで確かめます。Out-File と `>` は見ません(この環境の PowerShell では UTF-8 の BOM 付きになるため)
- release-draft は、Claude が最後に `git commit` した場所(`cd` の先)を読みます。コミットがまだ無ければセッションの場所です。版は、タグの時の中身と今の作業ツリーを比べます(まだコミットしていない版上げも出ます)
- test-runner が拾うのは、コマンドの形がテスト(`npm test`・`pytest`・`cargo test`・`node --test`・`claude plugin test` など)か、`testCommand` と同じ頭の物です。裏で走らせた物(`run_in_background`)は数えません

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
| compact-cue | `notifyPercent` / `urgentPercent` | 合図を出し始める使用量と、急ぎにする使用量(%、既定 50 / 75) |
| compact-cue | `memoDir` | 引き継ぎメモのフォルダ。入れると、ここへ書いた時も区切りとみなす(空でも動く) |
| ship-guard | `checkBeforePush` | push の前に中身を確かめる(既定 オン) |
| ship-guard | `allowedEmails` / `privateWords` | 気にしないメール(カンマ区切り、`@example.org` でドメインごと)と、足した行や作者名に入っていたら知らせる言葉 |
| rule-watch | `checkEnglish` / `checkQuestion` | 英語の返事・文での質問を見るか(既定 オン) |
| rule-watch | `memoDir` / `memoGraceTurns` | 引き継ぎメモのフォルダ(空ならメモは見ない)と、コミットの後に待つターン数(既定 0) |
| enc-guard | `mode` / `checkPython` | 見つけた時に「知らせる」か「止める」か(既定 知らせる)と、Python の open を見るか(既定 オン、Windows だけ) |
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

[docs/mod-guide.md](docs/mod-guide.md) に、VS Code でも凝った見た目を出すための約束ごとをまとめています。VS Code で使える部品と Svg の性質(アニメは動くが hover とクリックは効かない)、入力欄の上の帯の罠、値の持ち方、共通の見た目と明るいテーマ、テストの書き方などです。

全 mod で共通の色・見出し・動きは `shared/style.ts` に 1 枚だけあり、各 mod の `hooks/style.ts` はその写しです。直したら `node tools/copy_shared.mts` で写します。

dev-rpg と turn-gacha は単体版のリポジトリにも写しています。リリースの時に `node tools/export_standalone.mts` で隣のフォルダの claude-code-dev-rpg へ写し、`--check` でずれていないかを確かめます。

各 mod のフォルダで確かめられます。全 mod の validate・テスト・型をまとめて確かめるのは `node tools/check_all.mts`、mod の重さを測るのは `node tools/perf.mts`(結果は [docs/dev/perf.md](docs/dev/perf.md))です。

```sh
claude plugin validate mods/cc-dash
claude plugin test mods/cc-dash
```

## 開発状況

- テストは全 mod で通っています(`claude plugin test`)
- VS Code 拡張 2.1.300 の実画面で、ペイン・ボタン・トースト・SVG のアニメと、0.4.0 までの mod の画面が開くこと、work-bar の帯が出ることを確かめています
- 0.5.0 で足した mod(spec-board・ci-pane・port-watch・pre-check・face-band・done-chime・turn-haiku)は、テストまでで、実画面での確認はこれからです
- 0.6.0 で足した mod(session-timeline・file-map・toast-inbox・usage-history)と、共通の見た目・明るいテーマも、テストと窓の無い Chrome で撮った絵までで、実画面での確認はこれからです
- 0.7.0 で足した mod(fail-log・daily-quest・trophy-shelf・mod-check)と、時間と季節の見た目、/dash の並べ替えも、テストと窓の無い Chrome で撮った絵までです
- 0.8.0 で足した mod(compact-cue・ship-guard)と test-runner の見張りも、テストと窓の無い Chrome で撮った絵までです
- 0.9.0 で足した mod(rule-watch・enc-guard・release-draft)と ship-guard の公開前のチェックも、テストと窓の無い Chrome で撮った絵までです
- 関数フックの API はまだ先行公開の段階で、Claude Code の版によって変わることがあります

## ライセンス

MIT
