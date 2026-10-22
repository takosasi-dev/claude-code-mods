# Changelog

## [0.9.0] - 2026-10-22

### Added

- rule-watch 0.1.0(新しい mod): Claude の返事が約束ごとから外れた時に入力欄の上の帯で知らせる。英語で答えた(コード・パス・URL を除いた地の文で判定)、AskUserQuestion を使わずに「〜しますか？」で終わった、コミットの後に引き継ぎメモ(`memoDir`)を書いていない、の 3 つ。`/rulewatch` で数と記録、「Claude に伝える」で入力欄に一言入れる(送信はしない)
- enc-guard 0.1.0(新しい mod): 文字コード・改行の罠を Claude が踏んだ時に、直し方を結果の後ろで Claude に伝える(`mode` を「止める」にすると実行の前に止める)。-Encoding の無い Set-Content / Add-Content、日本語入りで BOM の無い .ps1、ASCII 以外の字が入った .bat / .cmd、Windows で encoding= / newline= の無い Python の open と write_text。`/enc` で数と記録
- release-draft 0.1.0(新しい mod): 前のタグから今までのコミットと、版が上がった plugin.json / package.json(まだコミットしていない物も)を集めて、CHANGELOG の下書き(Added / Changed / Fixed)と次の版の候補を `/release` のペインに出す。「これで CHANGELOG を書いて」で Claude に頼む。Claude が最後にコミットした場所を読む。git は読むだけ
- ship-guard 0.2.0: git push の前に、どのリモートにもまだ無いコミットを読み、作者・コミッターのメールが noreply か、足した行に個人のメール・`C:\Users\<名前>` のようなユーザー名入りのパス・`privateWords` の言葉が無いかを確かめる。引っかかったら AskUserQuestion で確認済みでも聞き直し、断られたら中身ごと Claude に返す。`checkBeforePush`・`allowedEmails`・`privateWords` の設定

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
