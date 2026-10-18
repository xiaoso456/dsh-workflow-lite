/**
 * dsh-workflow-lite — 文件夹浏览（实例里点开一个文件夹资源）用到的几个纯函数：
 * 相对路径怎么拼、面包屑怎么折、筛选与命中的字、键盘上下选。
 *
 * `sub` 都是相对那个文件夹的路径：`/` 分隔、没有首尾斜杠，文件夹本身是空串（和 `run/dir` 回的一致）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/folderBrowse
 */

/** 文件夹 `sub` 下面叫 `name` 的那一项的 `sub`。 */
export function joinSub(sub: string, name: string): string {
  return sub === '' ? name : `${sub}/${name}`
}

/** 上一层；已经是文件夹本身就还是空串。 */
export function parentSub(sub: string): string {
  const cut = sub.lastIndexOf('/')
  return cut < 0 ? '' : sub.slice(0, cut)
}

/** 面包屑的一段：`sub` 是点它去哪儿；`null` 是被折起来的省略号（不能点）。 */
export interface Crumb {
  label: string
  sub: string | null
}

/** 面包屑最多几段（含根）：再深就把中间折成一个「…」，留根和最后两层。 */
const CRUMBS_MAX = 4

/** 从文件夹本身（叫 `root`）一路到 `sub` 的每一层。 */
export function crumbsOf(root: string, sub: string): Crumb[] {
  const parts = sub === '' ? [] : sub.split('/')
  const all: Crumb[] = [
    { label: root, sub: '' },
    ...parts.map((label, index) => ({ label, sub: parts.slice(0, index + 1).join('/') })),
  ]
  if (all.length <= CRUMBS_MAX) return all
  const first = all[0] as Crumb
  return [first, { label: '…', sub: null }, ...all.slice(-2)]
}

/**
 * `name` 里命中 `query` 的几段（按字符位置、合并重叠、从前到后）。
 * `query` 按空白拆成几个词，每个词都要出现（不分大小写）才算命中，否则是 `null`；`query` 为空命中一切、没有高亮。
 */
export function matchRanges(name: string, query: string): [number, number][] | null {
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== '')
  if (words.length === 0) return []
  const lower = name.toLowerCase()
  const found: [number, number][] = []
  for (const word of words) {
    const at = lower.indexOf(word)
    if (at < 0) return null
    found.push([at, at + word.length])
  }
  // 个别字符变小写后长度会变（比如带点的大写 İ）：位置对不上，命中照算，就不画高亮了。
  if (lower.length !== name.length) return []
  found.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of found) {
    const last = merged[merged.length - 1]
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

/** 留下命中的项（次序不变），连同要高亮的几段。 */
export function filterEntries<E extends { name: string }>(
  entries: readonly E[],
  query: string,
): { entry: E; ranges: [number, number][] }[] {
  const out: { entry: E; ranges: [number, number][] }[] = []
  for (const entry of entries) {
    const ranges = matchRanges(entry.name, query)
    if (ranges !== null) out.push({ entry, ranges })
  }
  return out
}

/** 把名字按命中的几段切开：`hit` 为真的那几块要高亮。 */
export function splitByRanges(
  name: string,
  ranges: readonly [number, number][],
): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = []
  let at = 0
  for (const [from, to] of ranges) {
    if (from > at) parts.push({ text: name.slice(at, from), hit: false })
    parts.push({ text: name.slice(from, to), hit: true })
    at = to
  }
  if (at < name.length) parts.push({ text: name.slice(at), hit: false })
  return parts
}

/**
 * 键盘上下选：从 `current` 往前 / 往后一项（到头就停在头，不绕回去）；还没选过时下键选第一项、上键选最后一项。
 * `names` 是此刻看得见的几项（筛选之后）。
 */
export function stepCursor(
  names: readonly string[],
  current: string | null,
  move: 'next' | 'prev' | 'first' | 'last',
): string | null {
  if (names.length === 0) return null
  if (move === 'first') return names[0] ?? null
  if (move === 'last') return names[names.length - 1] ?? null
  const at = current === null ? -1 : names.indexOf(current)
  if (at < 0) return (move === 'next' ? names[0] : names[names.length - 1]) ?? null
  const to = Math.min(names.length - 1, Math.max(0, at + (move === 'next' ? 1 : -1)))
  return names[to] ?? null
}
