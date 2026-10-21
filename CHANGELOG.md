# Changelog

## [Unreleased]

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
