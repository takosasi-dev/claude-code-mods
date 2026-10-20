// 実況の言い回し。口調 × 場面ごとに 5 個ずつ。{tool} {file} {n} {time} を差し込む
import type { LiveCommentaryKind } from '../types'

export const STYLES = ['熱血', '冷静', '関西'] as const
export type Style = (typeof STYLES)[number]

export type Scene =
  | 'start'
  | 'shell'
  | 'edit'
  | 'write'
  | 'read'
  | 'search'
  | 'web'
  | 'agent'
  | 'other'
  | 'error'
  | 'streak'
  | 'comeback'
  | 'ten'
  | 'end'
  | 'abort'
  | 'long'

export const SCENES: readonly Scene[] = ['start', 'shell', 'edit', 'write', 'read', 'search', 'web', 'agent', 'other', 'error', 'streak', 'comeback', 'ten', 'end', 'abort', 'long']

/** 場面ごとのログの色の種類 */
export const KIND: Record<Scene, LiveCommentaryKind> = {
  start: 'whistle',
  shell: 'play',
  edit: 'play',
  write: 'play',
  read: 'play',
  search: 'play',
  web: 'play',
  agent: 'play',
  other: 'play',
  error: 'error',
  streak: 'cheer',
  comeback: 'cheer',
  ten: 'cheer',
  end: 'whistle',
  abort: 'whistle',
  long: 'whistle',
}

export const PHRASES: Record<Style, Record<Scene, readonly string[]>> = {
  熱血: {
    start: [
      'さあ試合開始のホイッスルが鳴りました!',
      'キックオフ!今日も熱い戦いが始まる!',
      'さあ始まりました!スタジアムのボルテージは最高潮!',
      '選手入場!注目の一戦がいま幕を開けます!',
      'プレイボール!この試合、目が離せません!',
      'ゴングが鳴った!さあ、どう攻めるのか!',
    ],
    shell: [
      'おーっと、ここで {tool} を繰り出した!',
      '{tool} で一気に勝負に出た!',
      'コマンド一閃!{tool} が火を噴く!',
      '強烈な {tool}!ターミナルが唸りを上げる!',
      'ここで {tool} を叩き込む!大胆な攻めだ!',
    ],
    edit: [
      '鮮やかなパスで {file} を書き換える!',
      '{file} にピンポイントの修正!見事なコントロール!',
      'ここで {file} に切り込んだ!一気に書き換える!',
      '{file} の守りを崩した!華麗な {tool}!',
      '狙いすました一撃!{file} を修正!',
    ],
    write: [
      '{file} に新しいファイルを叩き込んだ!',
      'ゼロから {file} を書き上げる!これは大技だ!',
      '一気呵成に {file} を書き下ろす!',
      '{file} が誕生!新たな布陣だ!',
      'ここで {file} を丸ごと書いた!思い切ったプレー!',
    ],
    read: [
      'じっくりと資料を読み込んでいる',
      '{file} に目を通す!相手の手の内を探っているぞ!',
      'ここは {file} を読み込んで様子見だ!',
      '冷静に {file} を分析!次の一手への布石か!',
      '{file} を読む!スカウティングに余念がない!',
    ],
    search: [
      'フィールドの隅々まで探し回る!',
      '{tool} で手がかりを追う!執念の捜索!',
      'どこだ、どこにある!{tool} が走る!',
      'ここで {tool}!獲物を探すハンターの目だ!',
      'コードの森をかき分けて {tool}!',
    ],
    web: [
      'ここで場外へ!{tool} で外の情報を取りに行く!',
      'ネットの海へ飛び込んだ!{tool}!',
      '{tool} で世界中から情報をかき集める!',
      'スタジアムの外まで手を伸ばす {tool}!',
      '最新の情報を求めて {tool}!',
    ],
    agent: [
      'ここで助っ人登場!サブエージェントを投入!',
      '選手交代!頼れる仲間をフィールドへ送り出す!',
      '{tool} で援軍を呼んだ!総力戦だ!',
      'ベンチから新戦力!これは大きな采配だ!',
      '仲間に託した!チームプレーで攻める!',
    ],
    other: [
      '{tool} を繰り出した!これは珍しい技だ!',
      'ここで {tool}!意表を突くプレー!',
      '{tool} で揺さぶりをかける!',
      'おーっと {tool} だ!変幻自在!',
      '秘密兵器 {tool} を投入!',
    ],
    error: [
      'ああーっと!ここでまさかのエラー!',
      'なんということだ!{tool} が失敗!',
      'これは痛い!{tool} でつまずいた!',
      'まさかの展開!{tool} がエラーを返した!',
      'ああっと、ここでミス!場内がどよめく!',
    ],
    streak: [
      'これで {n} 連続成功、止まらない!',
      '{n} 連続成功!手がつけられない!',
      '怒涛の {n} 連続成功!',
      'まだ続く!{n} 連続成功だ!',
      '{n} 連続!完全に流れを掴んだ!',
    ],
    comeback: [
      '見事に立て直した!さすがの修正力!',
      'エラーから即座に反撃!これぞ王者の貫禄!',
      '転んでもただでは起きない!見事なリカバリー!',
      '立ち上がった!エラーを乗り越えて前へ進む!',
      '不屈の闘志!ここで見事に持ち直した!',
    ],
    ten: [
      '{n} 連続成功!これはもう止められない!',
      'ついに {n} 連続!歴史に残る快進撃だ!',
      '大台の {n} 連続成功!スタジアム総立ち!',
      '{n} 連続成功達成!神がかっている!',
      'パーフェクトゲームの予感!{n} 連続成功!',
    ],
    end: [
      '試合終了!見事な {time}でした!',
      'ここで試合終了のホイッスル!{time}の熱戦!',
      'ゲームセット!{time}、見事な戦いぶりでした!',
      'やりきった!{time}の激闘に拍手を!',
      'フィニッシュ!{time}で決着です!',
    ],
    abort: [
      'ここで試合中断!一体何があったのか!',
      'おっと、中断です!作戦タイムか!',
      '試合が止められた!ベンチの指示だ!',
      'ここでストップ!{time}で一旦終了!',
      'まさかの打ち切り!仕切り直しだ!',
    ],
    long: [
      '{time}の長丁場、ついに決着!',
      '大熱戦に終止符!{time}の死闘でした!',
      '延長戦を制した!{time}の長い戦いが終わる!',
      '{time}に及ぶ激闘、ここに決着!',
      '長かった!{time}の大一番、決着です!',
    ],
  },
  冷静: {
    start: [
      'ターンが始まりました。',
      '試合開始です。落ち着いた立ち上がり。',
      'さて、始まりました。まずは様子を見ましょう。',
      '開始です。どう組み立ててくるか注目です。',
      '新しいターンに入りました。',
    ],
    shell: [
      '{tool} を実行しています。',
      'ここは {tool} を選びましたね。',
      '{tool} でコマンドを走らせます。',
      '手堅く {tool} を使ってきました。',
      '{tool} の出番です。',
    ],
    edit: [
      '{file} を修正しています。',
      '{file} の一部を書き換えています。',
      '{file} に手を入れます。的確ですね。',
      '必要な所だけ {file} を直しています。',
      '{file} を丁寧に編集中です。',
    ],
    write: [
      '{file} を新しく書いています。',
      '{file} を作成しています。',
      '{file} を一から書き起こします。',
      'ここで {file} を用意しました。',
      '{file} を書き出しています。',
    ],
    read: [
      '資料を読み込んでいます。',
      '{file} を読んでいます。',
      '{file} を確認中。慎重ですね。',
      'まずは {file} から情報を集めます。',
      '{file} に目を通しています。',
    ],
    search: [
      '{tool} で探しています。',
      '手がかりを {tool} で絞り込みます。',
      '{tool} を使って該当箇所を探しています。',
      '検索で全体を見渡しています。',
      '{tool} で対象を洗い出しています。',
    ],
    web: [
      '{tool} で外部の情報を確認しています。',
      'ウェブから資料を取り寄せます。',
      '{tool} を使いました。最新の情報が要るようです。',
      '外の情報を {tool} で参照中です。',
      '{tool} で調べものです。',
    ],
    agent: [
      'サブエージェントに作業を任せました。',
      '{tool} で分担に入ります。',
      '別の担当を立てましたね。合理的です。',
      '作業を切り分けて委ねています。',
      '{tool} を呼びました。並行して進めるようです。',
    ],
    other: [
      '{tool} を使っています。',
      'ここで {tool} です。',
      '{tool} を呼び出しました。',
      '{tool} の結果を待ちます。',
      '少し珍しい {tool} ですね。',
    ],
    error: [
      'エラーが出ました。',
      '{tool} が失敗しました。立て直しが必要です。',
      'ここでエラーです。原因を見たいところ。',
      '{tool} はうまくいきませんでした。',
      '失敗が返ってきました。次の対応に注目です。',
    ],
    streak: [
      '{n} 回続けて成功しています。',
      '{n} 連続成功。安定しています。',
      'これで {n} 回連続です。',
      '{n} 連続成功。順調な運びです。',
      '{n} 回ミスなく進んでいます。',
    ],
    comeback: [
      'エラーから立て直しました。',
      '失敗の後、きちんと持ち直しました。',
      '修正が効きました。順調に戻っています。',
      '落ち着いて立て直しましたね。',
      'エラーを踏まえて成功させました。',
    ],
    ten: [
      '{n} 連続成功です。見事な安定感です。',
      '{n} 回連続でミスがありません。',
      '{n} 連続成功に到達しました。',
      'これで {n} 連続。非常に安定しています。',
      '{n} 連続成功。崩れる気配がありません。',
    ],
    end: [
      'ターン終了。所要 {time}でした。',
      '試合終了です。{time}でした。',
      '終わりました。{time}、手堅い内容でした。',
      'ここで終了。{time}です。',
      '{time}で一区切りです。',
    ],
    abort: [
      '中断されました。',
      'ここで止まりました。{time}でした。',
      '途中で打ち切りです。',
      '中断です。仕切り直しでしょう。',
      '{time}で止められました。',
    ],
    long: [
      '{time}の長いターンが終わりました。',
      '{time}かかりましたが、完了です。',
      '長丁場でした。{time}で決着です。',
      '{time}の作業、お疲れさまでした。',
      'ようやく終了です。{time}でした。',
    ],
  },
  関西: {
    start: [
      'さあ始まったでー!',
      'ほな、いっちょやったろか!',
      'きたきた、試合開始や!',
      'よっしゃ、始めるでー!',
      'さあさあ、お立ち会い!始まるで!',
    ],
    shell: [
      'おっ、ここで {tool} かいな!',
      '{tool} ぶちかましたでー!',
      'ほれ出た、{tool} や!',
      '{tool} でガツンといったれ!',
      'ここは {tool} でいくんかい!',
    ],
    edit: [
      '{file} をちょちょいと書き換えよった!',
      'ええパスや!{file} をいじっとる!',
      '{file} に手ぇ入れたで!',
      'うまいこと {file} 直しよるなあ!',
      '{file} をシュッと修正や!',
    ],
    write: [
      '{file} を新しくこしらえたで!',
      'いきなり {file} 書いてもうた!',
      '{file} を一から作っとるがな!',
      'おお、{file} が生まれたで!',
      '{file} をドーンと書いたった!',
    ],
    read: [
      'じーっと資料読んどるなあ',
      '{file} を読み込んどるで',
      '{file} とにらめっこや',
      'まずは {file} 読んで作戦会議やな',
      '{file} を穴が開くほど見とる!',
    ],
    search: [
      'どこや、どこにあるんや!{tool} で探しとる!',
      '{tool} で草の根分けて探しとるで!',
      'あっちこっち探し回っとるがな!',
      '{tool} で宝探しや!',
      '探し物はなんですかー、{tool} やで!',
    ],
    web: [
      '{tool} でネットまで出張や!',
      '外の情報取りに行きよった!{tool}!',
      '{tool} でちょっと調べもんや!',
      'ネットの海に飛び込んだで!',
      '{tool} で世間様に聞いとる!',
    ],
    agent: [
      '助っ人呼んできよった!',
      '{tool} で応援頼んだで!',
      'ひとりで抱えへん、ええ判断や!',
      '仲間にパス出したで!',
      '選手交代や!頼んだでー!',
    ],
    other: [
      '{tool} やて?渋いとこ突くなあ!',
      'ここで {tool} かいな!',
      '{tool} 出してきよった!',
      'おもろい手ぇ使うやん、{tool}!',
      '{tool} でひと工夫や!',
    ],
    error: [
      'あかーん!ここでまさかのエラーや!',
      'なんでやねん!{tool} がこけたで!',
      'ああっ、{tool} しくじってもうた!',
      'ちょ、待って!エラー出てるやん!',
      'あちゃー、やってもうた!',
    ],
    streak: [
      '{n} 連続成功や、止まらへんで!',
      '{n} 連続!ノリノリやな!',
      'もう {n} 連続やで!どないなっとんねん!',
      '{n} 連続成功!絶好調や!',
      'まだまだいくで!{n} 連続!',
    ],
    comeback: [
      'よう立て直した!さすがやで!',
      '転んでもタダでは起きへん!',
      'エラーなんかなんのその!',
      '持ち直したで!やるやん!',
      'ほら見てみ、ちゃんと取り返したやろ!',
    ],
    ten: [
      '{n} 連続成功や!もう誰にも止められへん!',
      '{n} 連続!神がかっとるで!',
      'うそやろ、{n} 連続成功や!',
      '{n} 連続成功!拍手喝采や!',
      '{n} 連続やて!今日は冴えとるなあ!',
    ],
    end: [
      '試合終了や!{time}、ようやった!',
      'しまいや!{time}でキッチリ決めたで!',
      'おつかれさん!{time}の熱戦やったな!',
      'はい終わり!{time}、上出来や!',
      'ゲームセット!{time}で決着や!',
    ],
    abort: [
      'ちょ、止められてもうた!',
      'ここで中断かいな!',
      'あらら、打ち切りや!',
      '{time}でストップや!',
      'いったん休憩やな!',
    ],
    long: [
      '{time}も粘ったで!ようやく決着や!',
      '長かったなあ!{time}の大勝負や!',
      '{time}の大熱戦、お疲れさん!',
      'やっと終わったで!{time}もかかったがな!',
      '{time}の長丁場、見事に決着や!',
    ],
  },
}

export const toStyle = (v: unknown): Style => (STYLES.includes(v as Style) ? (v as Style) : '熱血')

const SHELL = new Set(['Bash', 'PowerShell'])
const EDIT = new Set(['Edit', 'MultiEdit', 'NotebookEdit'])
const SEARCH = new Set(['Grep', 'Glob', 'LS', 'ToolSearch'])
const WEB = new Set(['WebFetch', 'WebSearch'])
const AGENT = new Set(['Agent', 'Task'])

/** ツールの名前から場面を決める */
export function sceneOf(tool: string): Scene {
  if (SHELL.has(tool)) return 'shell'
  if (EDIT.has(tool)) return 'edit'
  if (tool === 'Write') return 'write'
  if (tool === 'Read') return 'read'
  if (SEARCH.has(tool)) return 'search'
  if (WEB.has(tool)) return 'web'
  if (AGENT.has(tool)) return 'agent'
  return 'other'
}

/** ツールの入力から、触っているファイルの名前 (フォルダは落とす)。無ければ「ファイル」 */
export function fileOf(input: Record<string, unknown>): string {
  for (const k of ['file_path', 'notebook_path', 'path']) {
    const v = input[k]
    if (typeof v === 'string' && v.trim() !== '') return v.split(/[\\/]/).filter(Boolean).pop() ?? v
  }
  return 'ファイル'
}

/** 42 秒 / 3 分 12 秒 / 5 分 */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  return s % 60 === 0 ? `${m} 分` : `${m} 分 ${s % 60} 秒`
}

/** 0〜len-1 を選ぶ。last と同じにはしない (len が 2 以上の時) */
export function pickIndex(len: number, last: number, rng: () => number): number {
  if (len <= 1) return 0
  const i = Math.min(len - 1, Math.floor(rng() * len))
  if (i !== last) return i
  return (i + 1 + Math.min(len - 2, Math.floor(rng() * (len - 1)))) % len
}

export const fill = (template: string, vars: Readonly<Record<string, string | number>>) =>
  template.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all))
