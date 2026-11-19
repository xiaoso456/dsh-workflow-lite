/**
 * dsh-workflow-lite — 一段字换成另一段时，哪些部分原样留着、哪些换掉（{@link SwapText} 切换时只滚变了的那几个字）。
 *
 * 只在留着的部分不会挪位置时才逐段换：留着的字前面换掉的部分必须等宽（同样多的数字、同样多的全角字），
 * 否则留着的字会被挤着横移——一边换字一边横移不好看，整段换。相同的部分太少（两句不相干的话）也整段换。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/textDiff
 */

/** 一段：`was` 不在 = 原样留着；在 = 这一段从 `was` 换成 `text`（任一边可以是空的：新加的、去掉的）。 */
export interface TextPart {
  text: string
  was?: string
}

/** 相同的字至少占多少，才逐段换。 */
const SAME_AT_LEAST = 0.3

/** 切成词：英文单词一段，其余（数字、汉字、标点、空格）一字一段。 */
function tokens(text: string): string[] {
  return text.match(/[A-Za-z]+|./gsu) ?? []
}

/** 全角字：汉字、假名、谚文、全角标点——同一字体里一样宽。 */
const WIDE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿！-｠]$/u

/** 两个字一样宽吗：都是数字（换字时数字按等宽排）或都是全角字。 */
function sameWidth(a: string, b: string): boolean {
  return (/^\d$/.test(a) && /^\d$/.test(b)) || (WIDE.test(a) && WIDE.test(b))
}

/** 换掉的一段新旧一样宽吗（逐字一一对应）。 */
function steady(part: TextPart): boolean {
  const was = [...(part.was ?? '')]
  const now = [...part.text]
  return was.length === now.length && was.every((char, i) => sameWidth(char, now[i] ?? ''))
}

/** 相邻的同类段并成一段。 */
function merge(parts: readonly TextPart[]): TextPart[] {
  const out: TextPart[] = []
  for (const part of parts) {
    const last = out.at(-1)
    if (last !== undefined && (last.was === undefined) === (part.was === undefined)) {
      last.text += part.text
      if (part.was !== undefined) last.was = (last.was ?? '') + part.was
    } else out.push({ ...part })
  }
  return out
}

/** 逐词最长公共子序列，排成「留着 / 换掉」的段。 */
function align(a: readonly string[], b: readonly string[]): TextPart[] {
  const n = a.length
  const m = b.length
  // 从 (i, j) 往后的最长公共长度，按行摊平存。
  const longest = new Uint16Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => longest[i * (m + 1) + j] ?? 0
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      longest[i * (m + 1) + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const parts: TextPart[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    const old = a[i]
    const now = b[j]
    if (old !== undefined && old === now) {
      parts.push({ text: now })
      i++
      j++
    } else if (now !== undefined && (old === undefined || at(i, j + 1) >= at(i + 1, j))) {
      parts.push({ text: now, was: '' })
      j++
    } else {
      parts.push({ text: '', was: old ?? '' })
      i++
    }
  }
  return merge(parts)
}

/**
 * `was` 换成 `text`：能逐段换就回各段（留着的、换掉的），该整段换（或根本没变）回 `null`。
 * 夹在两段变化中间的单个字（数字、冒号除外）也算变化：不相干的两句话里偶然相同的一个字不留着。
 */
export function diffText(was: string, text: string): TextPart[] | null {
  if (was === text) return null
  const a = tokens(was)
  const b = tokens(text)
  // 一样长的（时刻、计数）逐位对：「02:00 → 04:30」是 2→4、0→3，不按公共子序列把 0 错位对上。
  const aligned =
    a.length === b.length
      ? merge(b.map((token, i) => (token === a[i] ? { text: token } : { text: token, was: a[i] })))
      : align(a, b)
  const loose = aligned.map((part, k) =>
    part.was === undefined &&
    [...part.text].length === 1 &&
    !/[\d:]/.test(part.text) &&
    aligned[k - 1]?.was !== undefined &&
    aligned[k + 1]?.was !== undefined
      ? { text: part.text, was: part.text }
      : part,
  )
  const parts = merge(loose)
  const same = parts.reduce(
    (sum, part) => sum + (part.was === undefined ? [...part.text].length : 0),
    0,
  )
  if (same / Math.max([...was].length, [...text].length) < SAME_AT_LEAST) return null
  // 留着的字前面换掉的部分不等宽：留着的字会挪位置，整段换。
  let lastKept = parts.length - 1
  while (lastKept >= 0 && parts[lastKept]?.was !== undefined) lastKept--
  if (parts.slice(0, lastKept).some((part) => part.was !== undefined && !steady(part))) return null
  return parts
}
