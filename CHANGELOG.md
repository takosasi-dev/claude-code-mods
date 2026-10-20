# Changelog

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
