// 危ないとみなすコマンド。引用符の中も区別しない（echo "rm -rf" も危ない扱い＝用心側）
// git / gh / rm は大文字小文字を区別（git branch -d と -D を分けるため）、Windows 系は区別しない
// [^;&|\n]* は「同じコマンドの中」だけを見るため（; や && の先の別コマンドの引数を拾わない）
export const DANGER_PATTERNS: readonly RegExp[] = [
  /\bgit\s+push\b/,
  /\bgit\s+reset\b[^;&|\n]*\s--hard\b/,
  /\bgit\s+clean\b[^;&|\n]*\s(-[a-zA-Z]*f|--force\b)/,
  /\bgit\s+branch\b[^;&|\n]*\s-[a-zA-Z]*D/,
  /\bgit\s+checkout\b[^;&|\n]*\s--(\s|$)/,
  /\bgit\s+restore\b/,
  /\brm\s+([^\s;&|]+\s+)*?(-[a-zA-Z]*[rRf]|--recursive\b|--force\b)/,
  /\bRemove-Item\b[^;&|\n]*\s-r[a-z]*\b/i,
  /\brobocopy\b[^;&|\n]*\s\/(mir|purge)\b/i,
  /\bgh\s+(repo|release)\s+delete\b/,
  /\bdel\b[^;&|\n]*\s\/s\b/i,
  /\b(rmdir|rd)\b[^;&|\n]*\s\/s\b/i,
  /\bformat\s+[a-z]:/i,
  /\bStop-Process\b/i,
]

export const isDangerous = (command: string): boolean =>
  DANGER_PATTERNS.some(p => p.test(command))
