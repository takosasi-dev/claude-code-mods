# Changelog

## [0.10.1] - 2026-10-23

全体を見直し、見つかったバグと脆弱性を直した。

### Security

- **release-draft 0.1.2**: `-` で始まるタグ名を git のオプション(`--output=<パス>`)として読み、リポジトリの外のファイルが書かれた。
  - そういうタグは無い物として扱う。
  - rev は `refs/tags/<tag>` で、`--end-of-options` の後に渡す。
- **ship-guard 0.2.2: 許可の判定**
  - 次のどちらかの時だけ許可にする(答えに断りの言葉が無いこと)。
    - 答え自体が公開すると言っている。
    - Claude 自身の AskUserQuestion で、問いが公開を聞いていて答えが肯定。
  - 前は「いいえ」や、公開と関係の無い問いの「はい」、ほかの mod の確認も許可に数えていた。
- **ship-guard 0.2.2: 見逃し**: 書き方の違いで外に出す操作を見逃していた。語に分けて読むようにし、次の書き方を見分ける。
  - 引用符の名前・`& '…git.exe'`
  - env / sudo / xargs の前置き
  - if / for の中
  - `bash -c` / `powershell -Command` / `iex` の中
  - `--git-dir`・`-C`・`-c alias`
  - `yarn npm publish`・`npx gh`
- **ship-guard 0.2.2: 公開前のチェックの範囲**: `<ref> --not --remotes=<リモート>` で見る。前は 2 つ目のリモートへの push で何も見ていなかった。
- **run-guard 0.1.1: `claude -p` の隔離の判定**
  - 値を見るようにした。本物の設定フォルダや本物の API の URL では「隔離済み」にしない。
  - `CLAUDE_CODE_PLUGIN_DIRS` を消しているかも見る。
  - echo の中は数えない。
  - if / xargs / npx / `-p"x"` の見逃しを直した。
- **run-guard 0.1.1: 窓と音の見逃し**: iex・`-EncodedCommand`・`Process::Start`・winsound・playwright の `--ui` / `codegen` / `open`・MessageBeep を足した。
- **canvas-pane 0.2.2**: SVG の検査を、制御文字や文字参照・CSS のエスケープですり抜けられた。
  - 先にほどいてから検査する。
  - `file:`・`image-set(`・`@import` も断る。
- **done-chime 0.2.2**: powershell を絶対パスで、mod のフォルダから起こす。
- **fail-log 0.1.2**: 失敗したコマンドとエラーの文の秘密らしい所を伏せてから残す(前の版が残した物も、読む時に伏せる)。
- **turn-haiku 0.3.2**: モデルへ渡す材料を囲み、指示として読まれないようにした。
- **git を読む mod**: `-c log.showSignature=false` を付けた。リポジトリの設定の gpg.program を走らせない。
  - 対象: release-draft・git-pane 0.2.2・edit-log 0.2.2・pre-check 0.2.1
- **project-board 0.2.2**: 本文に `file:` がありうるメモでは、どのリンクも押しても開かない。
- **公開前の検査(tools/sync_public.py)**
  - 次の物を見つけるようにした。
    - 日本語の直後のパス
    - Git Bash・WSL の書き方
    - 秘密の形(`ghp_`・`sk-ant-`・`AKIA` など)
    - UTF-16 のファイル
    - PNG の文字の札
  - 写し先にまだコミットしていない変更がある時は止める。origin は末尾で比べる。
- **tools/export_standalone.mts**
  - 作業ツリーではなく HEAD から写す。
  - 写す前に公開前の検査を通し、写し先がまだコミットしていない変更を持つ時は止める。
- 試験の題材から、作者の姓を消した。

### Fixed

- **記録が消える・増える**
  - dev-rpg 0.6.1
    - 2 つの窓でダンジョンの袋を何度も持ち帰れた。
    - 「やり直し」「控えから戻す」を、別の窓が次のターンで戻していた。
    - SP を二重に振れた。
  - 記録を読めなかった時に、手元の写しで上書きして記録が丸ごと消えることがあった。読めない時は書かない。
    - 対象: week-card 0.1.1・usage-history 0.2.1・trophy-shelf 0.2.1・fail-log・toast-inbox 0.3.0・mod-hub 0.5.5・cc-dash 0.3.2・code-omikuji 0.3.2
- **古い版で書かない(共通の手)**
  - plugin.json の版だけでなく、hooks の中身の指紋で見る。
  - マーケットプレイスから入れた時は、`installed_plugins.json` の場所で見る。
  - これを入れていなかった次の mod にも入れた: prompt-book 0.2.2・rule-switch 0.2.3・code-omikuji・turn-haiku・focus-timer 0.2.3・cc-dash・face-band 0.4.1・live-commentary 0.2.2・toast-inbox・mod-hub・fail-log・trophy-shelf・done-chime。
- **新しい版の欄が消えないようにした**: 記録の要素を作り直す所で、知らない欄を残す。上限で切るのは、表示と足す時だけにした。
  - 対象: prompt-book・rule-switch・code-omikuji・turn-haiku・fail-log・toast-inbox・mod-hub・turn-gacha 0.4.1・aqua-pet 0.5.1・run-guard
- **控えのファイル**: 1 つ壊れていると「控えから戻す」の一覧が全部出なくなっていた。壊れた枠は飛ばし、上書きする。
- **画面が出なくなる制御文字**
  - 対象: aqua-pet の名前・todo-board 0.3.2(CR だけの改行)・release-draft のコミットの題・edit-log の label・reply-frame 0.2.2 の返事・test-runner 0.4.1・控えの日付
  - `clean` が C1 も落とす。
- **test-runner 0.4.1**: `npm test | tail` のようにパイプした時、失敗を通過と見ていた。
- **release-draft**
  - 差分を読む時に index を書いていた。
  - Claude のコミットのたびに、読み込みを待っていた。
- **予備名の横取り**: 本来の名前を持てた時は、予備名のコマンドを同じ名前の別のコマンドに回す。
  - 対象: 21 本と、tools/new_mod.mts の雛形
- **toast-inbox 0.3.0**: 実況のステータス行で受け箱が埋まっていた。既定ではトーストだけを残し、設定 `keepStatus` でステータス行も残せる。
- **日付と時刻を JST にそろえた**
  - 対象: dev-rpg・turn-gacha・focus-timer・turn-haiku・ship-guard・run-guard・test-runner・canvas-pane・release-draft
- **そのほか**
  - live-commentary: オフにする時の後始末
  - devlog-pane 0.3.1: 相対パスを未設定と同じに扱う
  - usage-pane 0.3.1: ペインが開いている時だけ読む
  - todo-board: 歩く読み方の締切
- **版を上げた物**
  - daily-quest 0.2.1・wait-games 0.3.1・agent-watch 0.2.2・session-timeline 0.1.2・token-meter 0.2.2・mod-check 0.2.1
- **道具**
  - check_all: 閉じた API の口で試験する。時間切れの時は子のプロセスごと止める。
  - new_mod
    - 書き換えは錨が全部見つかってから書く。
    - 説明の引用符をエスケープする。
    - `=>` を含む型を読む。
  - shots・gif: 窓を隠す。

## [0.10.0] - 2026-10-22

### Added

- run-guard 0.1.0(新しい mod、/runguard): Claude が確かめのために次のことをしようとした時に、実行の前に止めて直し方を返す
  - 窓のあるアプリを起動する: `-WindowStyle Hidden` の無い Start-Process・start・Invoke-Item・explorer・code、`--headless` の無い godot / chrome / msedge / chromium / firefox、playwright の `--headed` / `headless: false`
  - 音を鳴らす: [console]::Beep・SoundPlayer・SpeechSynthesizer・PlaySound・ffplay / afplay / aplay / paplay / say、`--no-audio` の無い mpv / vlc
  - `claude -p` を隔離なしで走らせる: 同じコマンドの中に CLAUDE_CONFIG_DIR と ANTHROPIC_BASE_URL の両方が無い
  - 設定: `mode` で 止める(既定)・聞く・伝えるだけ を選ぶ。`windowApps` に入れた名前は、いつも窓とみなす
  - 文字列・コメント・ヒアドキュメントの中は数えない
  - ペイン: 組ごとのオン/オフ・数・最近の記録
- week-card 0.1.0(新しい mod、/week): 1 週間をまとめて 1 枚のカードにする
  - 載せる物: 1 週間の使い方と、この 1 週間で増えた分(お題・ガチャの図鑑・冒険の書のレベルと一番深い階・水槽の魚)
  - 「週報に貼る文を入力欄に入れる」で、Markdown を入力欄に入れる(送信はしない)
- 記録の控え: 遊びの記録が消えた時に戻せるようにした
  - 対象: aqua-pet 0.5.0・dev-rpg 0.6.0・turn-gacha 0.4.0・daily-quest 0.2.0・wait-games 0.3.0・usage-history 0.2.0
  - 設定 `backupDir` を入れると、毎日 1 回、記録を知らない欄ごと 7 日分控える
  - ペインの「控えから戻す」で日を選び、確かめてから戻す
- 古い版で書かない: 記録を書く mod は、セッション中に新しい版が入ったと気づくと記録を書くのを止め、トーストで開き直しを頼む(共通の `rememberVersion` / `mayWrite`)
- dev-rpg 0.6.0: /rpg に「ダンジョン」
  - ターンごとに 1 歩進み、8 歩でその階の敵と自動で戦う。装備・SP・スキルが効く
  - 10 階ごとに番人、5 階ごとに休み場があり、休み場から潜り直せる
  - 勝った分は袋の経験値にたまり、「帰る」で持ち帰る。力尽きると半分だけ持ち帰る
  - 一番深い階を記録し、10 階ごとに SP +2
  - 実績「地下へ」「番人越え」
- aqua-pet 0.5.0: 水槽の「かざり」
  - turn-gacha のカードで 8 種(水草・石・流木・貝・つぼ・城・宝箱・沈没船)が手に入り、底の 5 つの置き場に置ける
  - 時刻と季節で色が変わる(夜は城の窓が灯り、冬は雪が積もる)
  - 城と沈没船の周りを、若い魚が回って泳ぐ
- trophy-shelf 0.2.0: ダンジョンのトロフィー 3 つ(番人越え・地下三十階・百階の主)
- rule-watch 0.2.0: 開発ログの見張り(設定 `logDir`)。次の 3 つを帯で知らせる
  - コミットの後に、今日の `YYYY-MM-DD.md` を書いていない
  - 開発ログを書いたのに、「📝」の 1 行が無い
  - 締めの言葉なのに、開発ログが無い
- mod-check 0.2.0
  - 隣の mod の版がセッション中に変わったら、帯とトーストで開き直しを頼む
  - 「点検表」タブ: 実画面で見てほしい 17 項目に よい・だめ・まだ を付け、結果を貼る文にする
- usage-history 0.2.0: 直近 7 日の数を `$.state` の `week` でほかの mod に見せる
- tools/new_mod.mts
  - 新しい mod の雛形を作り、mod-hub・mod-check・marketplace.json・README の表に登録する
  - `--sync`: mod-check の state の読みを、各 mod の types から作り直す
  - `--check`: 登録の抜けを見つける。check_all も呼ぶ

### Changed

- mod-hub 0.5.4: run-guard・week-card のアイコン
- mod-check の試験は、本数を表から数える(mod を足すたびに直さない)
- docs/mod-guide.md: 記録の控え・古い版で書かない・new_mod.mts の使い方

## [0.9.1] - 2026-10-22

### Changed

- test-runner 0.4.0: 操作の欄を色枠のカードにした。枠と見出しの色が状態で変わり(落ちたら赤・通ったら緑・走っている間は青・まだなら灰)、見出しに件数、その下にコマンドとかかった時間。落ちている時は「この失敗を直して」を主にし、走らせ直しは「もう一度走らせる」の脇のボタンにした
- ボタンを「主と脇」にそろえた: 主の操作のボタンは 1 つにして、ほかは `dimColor`(VS Code では枠だけの控えめなボタン)にした。タブ・絞り込み・オン/オフのように選ぶボタンは、選んでいる物だけをふつうに描く。agent-watch 0.2.1・aqua-pet 0.4.1・canvas-pane 0.2.1・cc-dash 0.3.1・code-omikuji 0.3.1・done-chime 0.2.1・edit-log 0.2.1・fail-log 0.1.1・file-map 0.1.1・focus-timer 0.2.2・git-pane 0.2.1・live-commentary 0.2.1・mod-hub 0.5.3・port-watch 0.2.2・project-board 0.2.1・prompt-book 0.2.1・release-draft 0.1.1・rule-switch 0.2.2・session-recap 0.2.1・session-timeline 0.1.1・ship-guard 0.2.1・spec-board 0.2.1・toast-inbox 0.2.1・todo-board 0.3.1・token-meter 0.2.1・turn-gacha 0.3.2・turn-haiku 0.3.1・usage-history 0.1.2・work-bar 0.2.1
- docs/mod-guide.md: VS Code でボタンと Box の見た目のうち効く物・効かない物の表と、ボタン周りの 3 つの形(主と脇・色枠のカード・SVG の絵 + ボタン)を足した

## [0.9.0] - 2026-10-22

### Added

- rule-watch 0.1.0(新しい mod): Claude の返事が約束ごとから外れた時に入力欄の上の帯で知らせる。英語で答えた(コード・パス・URL を除いた地の文で判定)、AskUserQuestion を使わずに「〜しますか？」で終わった、コミットの後に引き継ぎメモ(`memoDir`)を書いていない、の 3 つ。`/rulewatch` で数と記録、「Claude に伝える」で入力欄に一言入れる(送信はしない)
- enc-guard 0.1.0(新しい mod): 文字コード・改行の罠を Claude が踏んだ時に、直し方を結果の後ろで Claude に伝える(`mode` を「止める」にすると実行の前に止める)。-Encoding の無い Set-Content / Add-Content、日本語入りで BOM の無い .ps1、ASCII 以外の字が入った .bat / .cmd、Windows で encoding= / newline= の無い Python の open と write_text。`/enc` で数と記録
- release-draft 0.1.0(新しい mod): 前のタグから今までのコミットと、版が上がった plugin.json / package.json(まだコミットしていない物も)を集めて、CHANGELOG の下書き(Added / Changed / Fixed)と次の版の候補を `/release` のペインに出す。「これで CHANGELOG を書いて」で Claude に頼む。Claude が最後にコミットした場所を読む。git は読むだけ
- ship-guard 0.2.0: git push の前に、どのリモートにもまだ無いコミットを読み、作者・コミッターのメールが noreply か、足した行に個人のメール・`<ドライブ>:\Users\<名前>` のようなユーザー名入りのパス・`privateWords` の言葉が無いかを確かめる。引っかかったら AskUserQuestion で確認済みでも聞き直し、断られたら中身ごと Claude に返す。`checkBeforePush`・`allowedEmails`・`privateWords` の設定

### Changed

- mod-hub 0.5.2・mod-check 0.1.2: 新しい 3 本のカテゴリー・アイコン・確かめる表を足した(全 46 本)

## [0.8.0] - 2026-10-22

### Added

- compact-cue 0.1.0(新しい mod): コンテキストの使用量が `notifyPercent`(既定 50%)を超えた時、テストが通った・コミットした・引き継ぎメモ(`memoDir`)を書いた直後なら「今が /compact のよい時です」、編集の途中なら「区切りまで待って」と入力欄の上の帯に出す。区切りに入った時はトーストでも 1 回知らせ、`urgentPercent`(既定 75%)を超えたら急ぎの言葉にする。`/cue` で使用量のリングと作業の様子。知らせるだけで compact はしない
- ship-guard 0.1.0(新しい mod): Claude が git push・gh release(create/upload/edit/delete)・gh repo create・npm/pnpm/yarn publish を打つ時、そのターンか前のターンに AskUserQuestion で公開してよいと答えていなければ、その場で「実行しますか？」と聞く。断られた・聞けない時は止めて、理由を Claude に返す。`/guard` で記録とオン/オフ
- test-runner 0.3.0: Claude が Bash / PowerShell で走らせたテストも拾って履歴に入れる。最後のテストが落ちている間は入力欄の上に 1 行出し、落ちたままコミットしようとしたらトーストで知らせる(止めない)

### Changed

- mod-hub 0.5.1・mod-check 0.1.1: 新しい 2 本のカテゴリー・アイコン・確かめる表を足した(全 43 本)

## [0.7.0] - 2026-10-21

### Added

- fail-log 0.1.0(新しい mod): `/errors` でツールが失敗した記録を 200 件まで残し、似た失敗をまとめた「よく落ちる物」の棒、最近の一覧、今日・通算の数を出す。サブエージェントの分は紫で分ける
- daily-quest 0.1.0(新しい mod): `/quest` で日替わりのお題 3 つ(8 種から日付で選ぶ)。進みの棒・ごほうび・連続日数・直近 7 日。こなすと知らせが出て、ごほうびは dev-rpg が経験値、turn-gacha がおまけの抽選で受け取る
- mod-check 0.1.0(新しい mod): `/mod-check` で全 41 本の mod が入っているか・本来のコマンド名か予備名か(本来の名前を使っている相手も)・state が書かれているかを調べ、画面・テーマ・Claude Code の版と一緒にペインに出す。同じ結果を 1 行 1 mod の貼れる文でも返す
- trophy-shelf 0.1.0(新しい mod): `/trophies` で dev-rpg・turn-gacha・aqua-pet・wait-games・daily-quest の記録を 1 枚の棚にまとめ、トロフィー 20 個を初めて取った日付つきで集める
- dev-rpg 0.5.0・turn-gacha 0.3.0: daily-quest でこなしたお題のごほうびを 1 回だけ受け取り、一言で知らせる
- turn-gacha 0.3.0: カードを 40 種から 60 種にした(レア度の割合はそのまま)。図鑑の実績の数はカードの表から数える
- toast-inbox 0.2.0: 通知の行を押すと、その通知を出した mod のコマンドを開く(コマンドの分からない mod と本体の行は押せない)
- cc-dash 0.3.0: 「自分の並び」タブ。出す枠を選んで「上へ」「下へ」で並べ、記録に残す
- aqua-pet 0.4.0: 魚の種類を 6 から 10 に増やした(ほし魚・つの魚・にじ魚・りゅうぐう)。8 匹目で全種が出る。まだ来ていない 5 匹目以降の種類は 0.3 の時と変わることがある(もう来た魚は変わらない)
- aqua-pet 0.4.0: 夕方の水を橙にして沈む日を描いた。夜の月と星が見えるようにした(上の帯に隠れていた)
- face-band 0.4.0: 日本時間の時間帯と季節で顔の小物が変わる(朝は日・夕は沈む日・夜は月とナイトキャップ。夜の待ちは目を閉じて眠そう。春は花びら、夏は麦わら帽子と夜の蛍、秋は落ち葉、冬はマフラーと雪)
- mod-hub 0.5.0: 見出しに季節の小さな飾り(桜・日・もみじ・雪の結晶)。新しい mod のカテゴリーとアイコンを足した
- turn-haiku 0.3.0: 季節ごとの季語 72 語から 3 つを候補として渡す。月は日本時間で決める
- code-omikuji 0.3.0: 文を 117 から 238 に増やし、その季節の日だけ出る一言を 40 足した
- 共通: `shared/style.ts` に日本時間の `dayPart(now)`(朝・昼・夕・夜)と `season(now)`(春夏秋冬)を足した
- 道具: `tools/check_all.mts`(全 mod の validate・テスト・型をまとめて)、`tools/perf.mts`(mod の重さ。結果は `docs/dev/perf.md`)、`tools/gif.mts`(動く絵の GIF)。README に動く絵を 4 枚載せた
- 道具: `tools/plugin_dirs.mts`(カテゴリーごとの install の行・全部入れるループ・`CLAUDE_CODE_PLUGIN_DIRS` の値を marketplace.json と mod-hub の表から作る。何も書き換えない)
- README に「まとめて入れる」(カテゴリーごとの行と、bash・PowerShell で全部入れるループ)と「clone したフォルダから読ませる」を足した。英語の README.en.md を作った

### Changed

- todo-board 0.3.0: TODO を集める新しい mod を作りかけたが、ほぼ同じだったので todo-board にまとめた。git の外でもフォルダを歩いて読む(上限付き)。種類で絞るのをボタンにした。ペインを先に開き、読むのは裏で。git は index を書かない読み方にした
- port-watch 0.2.1: `/ports` が netstat と tasklist を待たずにペインを開く(開くまでの遅れ +790 ms → +230 ms)
- wait-games 0.2.1: 9x9 の数独を作るのを速くした(約 58 ms → 約 2 ms、出る盤は同じ)

### Fixed

- 記録を書く時に、知らない欄(新しい版が足した物)を残して書くようにした。古い版の mod を読んだまま動いているセッションが、新しい版の記録(魚・装備・SP の割り振り・新しいカードやトロフィーの記録など)を消していた。直したのは dev-rpg 0.5.1・turn-gacha 0.3.1・daily-quest 0.1.1・trophy-shelf 0.1.2・usage-history 0.1.1・rule-switch 0.2.1・focus-timer 0.2.1・wait-games 0.2.1・aqua-pet 0.4.0・cc-dash 0.3.0・turn-haiku 0.3.0・code-omikuji 0.3.0。aqua-pet は知らない種類の魚も消さず、まる魚の形で「なぞの魚」として描く。作り方の約束(`docs/mod-guide.md` の 9 節)にも足した

## [0.6.4] - 2026-10-21

### Changed

- dev-rpg 0.4.0: ボスが時々湧くようにした。次のボスのレベルに届いていると、ターンを終えるたびに 5%、それと 20 ターンごとに必ず「ボスの気配」が出る。気配が出ている間は、魔物の気配を使わずにボスに挑めて、勝つと経験値が 1.5 倍。気配は 1 つまでで、次のセッションにも残る。今まで通り、魔物の気配を 1 つ使っていつでもボスに挑むこともできる

### Added

- 冒険の書(dev-rpg)とガチャ(turn-gacha)だけを入れた単体版のリポジトリ [claude-code-dev-rpg](https://github.com/takosasi-dev/claude-code-dev-rpg) を作った。写すのは `tools/export_standalone.mts`

## [0.6.3] - 2026-10-21

### Changed

- face-band 0.3.0: 入れただけでは顔の帯を出さないようにした(最初はオフ)。`/face` で出すと、次のセッションからも出る。前に `/face` で出し直した人はそのまま出る

## [0.6.2] - 2026-10-21

### Changed

- dev-rpg 0.3.1: 戦いで減った HP が、戦いの後も残るようにした(勝っても負けても)。15 分休むか、新しいセッションで戻る。負けると HP は 10% まで減る
- dev-rpg 0.3.1: HP が満タンの時は、デバッグの光とロールバックを使えないようにした(MP もロールバックの権利も減らない)

### Fixed

- dev-rpg 0.3.1: 「魔物を探す」を素早く 2 回押すと、魔物の気配が 2 つ減っていた
- dev-rpg 0.3.1: とどめの「攻撃」を素早く 2 回押すと、1 回の勝ちで経験値と勝ち数が 2 回分入っていた
- dev-rpg 0.3.1: テストの盾が、敵が先に動く時は 2 回分しか効いていなかった(いつも 3 回分に)
- dev-rpg 0.3.1: ボスから逃げようとすると、逃げられないのにラウンドが進んで敵の攻撃を受けていた

## [0.6.1] - 2026-10-21

### Changed

- dev-rpg 0.3.0: 魔物と戦えるようにした。ターンを終えるたびに「魔物の気配」が 1 つたまり(5 つまで)、「戦う」で魔物 8 種と戦う。攻撃・スキル・防御・逃げるをボタンで選ぶ 1 ラウンドずつの戦いで、勝つと経験値。ボス 3 体(Lv 10・25・45)は逃げられない
- dev-rpg 0.3.0: スキルポイント(SP)を足した。レベル 1 つで 2、実績 1 つで 1、3 勝ごとに 1、ボスを初めて倒すと 3。「成長」で力・体力・知恵・敏捷に振るか、スキル 10 種(攻撃・回復・盾・常に効く物)を覚える。能力の振り分けは戻せる
- dev-rpg 0.3.0: 攻撃力・魔力・素早さを、Lv・振った SP・装備・このセッションの作業(10 まで)の合計にした。防御力と会心の確率を足した。実績を 22 個にした
- 0.2 までの記録はそのまま読める。SP はレベルと実績からさかのぼって入り、魔物の気配は 3 つ持って始まる

## [0.6.0] - 2026-10-21

### Added

- session-timeline(`/timeline`): このセッションのターンとツール呼び出しを横の帯の年表で
- file-map(`/filemap`): 読んだ・書いたファイルをフォルダごとのツリーマップで
- toast-inbox(`/inbox`): ほかの mod のトーストとステータス行を残す受け箱
- usage-history(`/history`): 日ごとのターン数・トークンの棒グラフと、曜日と時間帯のヒートマップ
- 共通の見た目 `shared/style.ts` と、各 mod に写す `tools/copy_shared.mts`(`--check` でずれを見つける)
- 明るいテーマ: `/config` の theme が light 系なら、全 mod の SVG を明るい色で描く。切り替えにも付いていく
- `tools/shots.mts --light` で明るいテーマの画像を撮る

### Changed

- 全 mod の SVG を共通の見出し・色・幅 380 にそろえ、数字が増える・棒が伸びる・行がふわっと出る動きを足した
- mod-hub 0.4.0: mod ごとのアイコンとカテゴリーの色の帯、検索欄、固定、最近開いた順
- aqua-pet 0.3.0: 魚が 1 匹ずつターンで育ち、節目で新しい種類(全 6 種)が来る。魚の一覧
- wait-games 0.2.0: 15 パズル・ライツアウト・数独(4x4 / 9x9)・神経衰弱を足した
- turn-gacha 0.2.0: カードに装備の枠、図鑑の実績 6 個。図鑑を他の mod が読めるようにした
- dev-rpg 0.2.0: turn-gacha のカードを装備して能力が上がる。実績を 16 個にし、称号と実績のページを作り直した
- code-omikuji: 紙が開いてから 7 日の丸が出るようにした(振っている間に今日の運勢が見えていた)

### Fixed

- turn-haiku: 墨のにじみの丸が、アニメの後も字の後ろに薄く残っていた

## [0.5.1] - 2026-10-20

### Changed

- mod-hub 0.3.0: `/mod` の一覧をカテゴリー別(開発・状況・道具・遊び・その他)と名前順で切り替えられる。選んだ並びは次のセッションにも残る

## [0.5.0] - 2026-10-20

### Added

- spec-board(`/specs`): SpecStatus の確認待ち・途中の仕様書と次のおすすめ
- ci-pane(`/ci`): 今のブランチの PR と GitHub Actions の結果
- port-watch(`/ports`): 待ち受け中のポートと、開発サーバーを 2 回押しで止めるボタン
- pre-check(`/precheck`): コミット前に差分・秘密情報・衝突の印・大きいファイル・テストを確かめる
- face-band: 入力欄の上に状態で変わる Claude の顔(`/face` でオン/オフ)
- done-chime(`/chime`): 長いターンが終わったら音で知らせる
- turn-haiku(`/haiku`): ターンでやった事を五七五の短冊に
- README に各 mod の画面の画像と、それを作る `tools/shots.mts`

### Changed

- aqua-pet 0.2.0: 背景が時刻(光の筋・月)と季節(花びら・泡・落ち葉・雪)で変わる
- work-bar 0.1.3: 帯を描く別の mod(face-band など)が一緒にいる時は、その帯も並べて出す

## [0.4.0] - 2026-10-20

### Added

- agent-watch(`/agent-watch`): サブエージェントの監視と会話への切り替え
- canvas-pane(`/canvas`): Claude がグラフ・表・図をペインに描けるツール `mcp__canvas-pane__show`
- rule-switch(`/rules`): 約束ごとをボタンでオン/オフしてシステムプロンプトに入れる
- wait-games(`/games`): 2048 とマインスイーパー

## [0.3.1] - 2026-10-20

レビューで見つかった不具合と安全面の直し。

### Fixed

- 複数のセッションを同時に開いた時に、記録を上書きして消さないようにした(dev-rpg・prompt-book・turn-gacha・focus-timer・aqua-pet)。書く直前に読み直し、増えた分だけを足す
- コマンドの名前が取れずに予備の名前にした時、元の名前のコマンドを横取りしないようにした
- 外から来る文字列の制御文字でペインが閉じないようにした(git-pane・session-recap・edit-log・todo-board ほか)
- git-pane・edit-log: `.git/index` を書き直さない読み方にした(`diff-files` / `diff-index`、`GIT_OPTIONAL_LOCKS=0`)。edit-log は `--no-textconv` と `--literal-pathspecs` を付け、ファイルのあるフォルダで git を走らせる
- danger-frame: `git -C <パス> push --force` などのすり抜け、改行をまたぐ誤検知、`docker run --rm` の誤検知を直した。判定する物を足した
- project-board: メモが多い時にペインが出ない不具合。設定のパスは絶対パスだけ受け付ける
- code-omikuji: 日付をまたいでも昨日の運勢のままだった
- session-recap: コマンドの後の依頼にコマンド名が付く、リロードで要約できなくなる
- todo-board: 読み込みが重なると古い件数が残る。追跡していないファイルの TODO も数える
- 入力欄に文を入れるボタンが下書きを消さないようにした(`insert`)
- エラーや拒否で終わったターンを、正常に終わったターンとして数えないようにした(dev-rpg・turn-gacha・live-commentary)
- cc-dash・usage-pane: 描画の中でファイルを読まないようにした
- test-runner: 出力によって集計が長く止まる不具合。時間の上限は 3600 秒まで

## [0.3.0] - 2026-10-20

### Added

- 開発支援: edit-log(`/edits`)・todo-board(`/todos`)・test-runner(`/testrun`)・prompt-book(`/prompts`)
- ネタ系: live-commentary(`/jikkyo`)・turn-gacha(`/gacha`)・dev-rpg(`/rpg`)・code-omikuji(`/omikuji`)

## [0.2.0] - 2026-10-20

### Changed

- mod-hub: 画面のある mod(ペインを開くか何かを描き、コマンドを持つ物)を開くボタンだけを並べる形にした。オン/オフ・絞り込み・並び替え・組み込みの表示はやめた

## [0.1.0] - 2026-10-20

最初の公開です。

### Added

- mod-hub: `/mod` で mod の一覧・コマンドの起動・オン/オフ(0.2.0 で起動のボタンだけにした)
- cc-dash: `/dash` でセッションの計器盤(概要・ツール・使用量の 3 タブ)
- work-bar: 入力欄の上の作業バー(経過時間・今のツール・定型文のボタン)
- aqua-pet: `/aquarium` で作業に反応する水槽
- project-board: `/projects` で引き継ぎメモの一覧
- git-pane: `/git` で git の様子
- token-meter: `/tokens` でトークンとキャッシュの当たり率
- focus-timer: `/focus-timer` でポモドーロ
- session-recap: `/session-recap` でセッションのふりかえり
- reply-frame(0.2.0)・danger-frame・long-turn-toast・usage-pane・devlog-pane を同じリポジトリにまとめた
- docs/mod-guide.md: VS Code でも凝った見た目を出す mod の作り方

### Changed

- usage-pane・devlog-pane: 読むファイルとフォルダの既定値を空にし、未設定のときは設定のしかたを出すようにした
