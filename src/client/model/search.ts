/**
 * dsh-workflow-lite — 列表搜索：空格隔开的几个词都要在给出的文字里出现（不分大小写）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/search
 */

/** 搜索词拆成小写的词；空串或全是空白就是没有词（什么都不筛）。 */
export function searchWords(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== '')
}

/** 这些文字合起来是否满足搜索词（没有词就都满足）。 */
export function matchesWords(
  words: readonly string[],
  parts: readonly (string | undefined)[],
): boolean {
  if (words.length === 0) return true
  const haystack = parts
    .filter((part): part is string => part !== undefined && part !== '')
    .join('\n')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}
