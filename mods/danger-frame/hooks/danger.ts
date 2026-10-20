// 危ないとみなすコマンド。引用符の中も区別しない（echo "rm -rf" も危ない扱い＝用心側）
// git / gh / rm は大文字小文字を区別（git branch -d と -D を分けるため）、Windows 系は区別しない
// [^;&|\n]* は「同じコマンドの中」だけを見るため（; や && や改行の先の別コマンドの引数を拾わない）

// git と、サブコマンドの前に来る全体オプション（-C <dir>・-c a=b・--no-pager・--git-dir=x など）
const GIT = String.raw`(?<![-\w])git(?:[ \t]+(?:-[Cc][ \t]+\S+|--[\w-]+(?:=\S+)?))*[ \t]+`
// 同じコマンドの中のどこか（区切りの手前まで）
const ARGS = String.raw`[^;&|\n]*`
const git = (rest: string) => new RegExp(GIT + rest)

export const DANGER_PATTERNS: readonly RegExp[] = [
  git(String.raw`push\b`),
  git(String.raw`reset\b${ARGS}\s--hard\b`),
  git(String.raw`clean\b${ARGS}\s(-[a-zA-Z]*f|--force\b)`),
  git(String.raw`branch\b${ARGS}\s-[a-zA-Z]*D`),
  // --delete と --force（-d と -f）がそろったら -D と同じ
  git(String.raw`branch\b(?=${ARGS}\s(?:--delete\b|-[a-zA-Z]*d))(?=${ARGS}\s(?:--force\b|-[a-zA-Z]*f))`),
  git(String.raw`checkout\b${ARGS}\s--(\s|$)`),
  git(String.raw`checkout\b${ARGS}[ \t]\.(?=[ \t;&|\n]|$)`),
  // --staged（-S）だけなら索引から外すだけ。--worktree（-W）があれば作業中の変更が消える
  git(String.raw`restore\b(?:(?!${ARGS}[ \t](?:--staged|-S)\b)|(?=${ARGS}[ \t](?:--worktree|-W)\b))`),
  git(String.raw`stash[ \t]+clear\b`),
  // rm（git rm も）。--rm は rm ではない。--cached はファイルを消さない。トークンの間は空白とタブだけ（改行をまたがない）
  /(?<![-\w])rm[ \t]+(?![^;&|\n]*[ \t]--cached\b)(?:[^\s;&|]+[ \t]+)*?(?:-[a-zA-Z]*[rRf]|--recursive\b|--force\b)/,
  /(?<![-\w])find\b[^;&|\n]*\s-delete\b/,
  /\bRemove-Item\b[^;&|\n]*\s-(?:r[a-z]*|fo[a-z]*)\b/i,
  /\brobocopy\b[^;&|\n]*\s\/(mir|purge)\b/i,
  /\bgh\s+(repo|release)\s+delete\b/,
  /\bdel\b[^;&|\n]*\s\/s\b/i,
  /\b(rmdir|rd)\b[^;&|\n]*\s\/s\b/i,
  /\bformat\s+[a-z]:/i,
  /\bStop-Process\b/i,
]

// 長い入力で判定が 2 乗の時間にならないよう、見るのは先頭だけ
export const MAX_CHECK_LENGTH = 10000

export const isDangerous = (command: string): boolean => {
  const head = command.slice(0, MAX_CHECK_LENGTH)
  return DANGER_PATTERNS.some(p => p.test(head))
}
