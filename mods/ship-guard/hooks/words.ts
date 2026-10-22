// コマンドを語に分ける。run-guard の hooks/guard.ts の parse と同じ物 (mod ごとに単体で配るので写しを持つ。直す時は両方)

export type Shell = 'bash' | 'powershell' | 'cmd'

/** 1 語。text は引用符を外した中身、bare は引用符の中を Q にした物 (文字列の中の言葉を拾わない) */
export type Word = { text: string; bare: string }

/**
 * コマンドを区切り (; | & { } 改行) ごとの語の並びにする。引用符の中・ヒアドキュメント・here-string は 1 語の中身になり、
 * コメント (語の頭の #、PowerShell の <# #>) は落とす。( ) は語の切れ目だけにする (-ArgumentList @('a') -WindowStyle Hidden を 1 つに保つ)
 */
export function parse(command: string, shell: Shell): Word[][] {
  const segs: Word[][] = []
  let seg: Word[] = []
  let text = ''
  let bare = ''
  let inWord = false
  const heredocs: { tag: string; into: Word[] }[] = []
  const endWord = () => {
    if (inWord) seg.push({ text, bare })
    text = ''
    bare = ''
    inWord = false
  }
  const endSeg = () => {
    endWord()
    if (seg.length > 0) segs.push(seg)
    seg = []
  }
  const add = (t: string, b = t) => {
    text += t
    bare += b
    inWord = true
  }
  const s = command
  let i = 0
  while (i < s.length) {
    const c = s[i] ?? ''
    const next = s[i + 1] ?? ''
    // PowerShell の here-string (@' から行頭の '@ まで)
    if (shell === 'powershell' && c === '@' && (next === "'" || next === '"') && !inWord && /^[ \t]*\r?\n/.test(s.slice(i + 2))) {
      const end = s.indexOf(`\n${next}@`, i + 2)
      const stop = end < 0 ? s.length : end + 3
      add(s.slice(s.indexOf('\n', i) + 1, end < 0 ? s.length : end), 'Q')
      i = stop
      continue
    }
    if (c === "'" && shell !== 'cmd') {
      let j = i + 1
      let body = ''
      for (; j < s.length; j++) {
        if (s[j] === "'") {
          if (shell === 'powershell' && s[j + 1] === "'") {
            body += "'"
            j++
            continue
          }
          break
        }
        body += s[j]
      }
      add(body, 'Q')
      i = j + 1
      continue
    }
    if (c === '"') {
      const esc = shell === 'bash' ? '\\' : shell === 'powershell' ? '`' : ''
      let j = i + 1
      let body = ''
      for (; j < s.length && s[j] !== '"'; j++) {
        if (esc !== '' && s[j] === esc && j + 1 < s.length) {
          const e2 = s[j + 1] ?? ''
          body += shell === 'bash' && !'"\\$`\n'.includes(e2) ? `\\${e2}` : e2
          j++
          continue
        }
        body += s[j]
      }
      add(body, 'Q')
      i = j + 1
      continue
    }
    // ${VAR} は 1 語の中
    if (c === '$' && next === '{') {
      const end = s.indexOf('}', i)
      add(s.slice(i, end < 0 ? s.length : end + 1))
      i = end < 0 ? s.length : end + 1
      continue
    }
    if (c === '#' && !inWord && shell !== 'cmd') {
      const nl = s.indexOf('\n', i)
      i = nl < 0 ? s.length : nl
      continue
    }
    if (shell === 'powershell' && c === '<' && next === '#') {
      const end = s.indexOf('#>', i + 2)
      i = end < 0 ? s.length : end + 2
      continue
    }
    // bash のヒアドキュメント (<<EOF・<<-'EOF')。本文は次の改行の後で読む
    if (shell === 'bash' && c === '<' && next === '<' && s[i + 2] !== '<') {
      const m = /^<<-?\s*(['"]?)([\w.-]+)\1/.exec(s.slice(i))
      if (m) {
        endWord()
        heredocs.push({ tag: m[2] ?? '', into: seg })
        i += m[0].length
        continue
      }
    }
    if (c === '\n') {
      endSeg()
      i++
      for (const h of heredocs.splice(0)) {
        let body = ''
        while (i < s.length) {
          const nl = s.indexOf('\n', i)
          const line = s.slice(i, nl < 0 ? s.length : nl)
          i = nl < 0 ? s.length : nl + 1
          if (line.trim() === h.tag) break
          body += `${line}\n`
        }
        h.into.push({ text: body, bare: 'Q' })
      }
      continue
    }
    if (c === '`') {
      if (shell === 'powershell') {
        if (next === '\n' || next === '\r') endWord()
        else add(next)
        i += 2
        continue
      }
      if (shell === 'bash') {
        endSeg()
        i++
        continue
      }
    }
    if (c === '\\' && shell === 'bash' && ' \n"\'`$\\;&|()'.includes(next) && next !== '') {
      if (next === '\n') endWord()
      else add(next)
      i += 2
      continue
    }
    // $( ... ) は中身を別の区切りとして読み、外の語は 1 語のまま (X=$(mktemp -d) claude -p を切らない)
    if (c === '$' && next === '(') {
      let depth = 1
      let j = i + 2
      for (; j < s.length && depth > 0; j++) {
        if (s[j] === '(') depth++
        else if (s[j] === ')') depth--
      }
      segs.push(...parse(s.slice(i + 2, depth === 0 ? j - 1 : j), shell))
      add(s.slice(i, j), '$Q')
      i = j
      continue
    }
    if (';|&{}\n'.includes(c)) {
      endSeg()
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '(' || c === ')' || c === ',') {
      endWord()
      i++
      continue
    }
    add(c)
    i++
  }
  endSeg()
  return segs
}

/** 名前の頭 (パスと .exe などを落として小文字) */
export const baseName = (s: string) =>
  s
    .replace(/^.*[\\/]/, '')
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat|com|ps1)$/, '')
