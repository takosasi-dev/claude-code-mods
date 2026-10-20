# Changelog

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
