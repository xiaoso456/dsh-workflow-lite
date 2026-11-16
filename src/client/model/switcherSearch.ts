/**
 * dsh-workflow-lite — 顶栏下拉里的搜索与分组：一个搜索框同时过滤「实例」和「工作流」，
 * 实例默认只露出最近几个，其余折在「显示全部」后面。纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/switcherSearch
 */

/** 实例默认露出几个（其余折叠）。 */
export const RUNS_SHOWN = 3

/** 搜索词归一：去首尾空白、不分大小写。 */
export function normalizeNeedle(query: string): string {
  return query.trim().toLowerCase()
}

/** `needle`（已归一）在 `text` 里第一次出现的区间；没有 = `null`。空搜索词不命中任何字。 */
export function matchRange(text: string, needle: string): readonly [number, number] | null {
  if (needle === '') return null
  const at = text.toLowerCase().indexOf(needle)
  return at < 0 ? null : [at, at + needle.length]
}

/**
 * 开着的下拉里，各张的修改时间按打开那一刻的算（打开之后才有的照实）：开着时存盘、换图（换之前先存上一张）
 * 改了修改时间，按最近修改排的列表也不在用户手底下挪，选中块不追着跑；收起再打开才按新的排。
 */
export function holdTimes<T extends { name: string; updatedAt: number }>(
  list: readonly T[],
  seen: ReadonlyMap<string, number> | null,
): readonly T[] {
  if (seen === null) return list
  return list.map((entry) => {
    const at = seen.get(entry.name)
    return at === undefined || at === entry.updatedAt ? entry : { ...entry, updatedAt: at }
  })
}

/** 工作流按名字过滤（保持传入顺序）。 */
export function filterWorkflows<T extends { name: string }>(
  list: readonly T[],
  needle: string,
): T[] {
  return needle === ''
    ? [...list]
    : list.filter((entry) => entry.name.toLowerCase().includes(needle))
}

/**
 * 实例过滤：`haystacks` 给出一个实例上可以搜的几段文字（工作流名、状态文字、时间……），任一段含搜索词就算命中。
 */
export function filterRuns<T>(
  list: readonly T[],
  needle: string,
  haystacks: (item: T) => readonly string[],
): T[] {
  if (needle === '') return [...list]
  return list.filter((item) => haystacks(item).some((text) => text.toLowerCase().includes(needle)))
}

/** 本会话的当前实例排最前，其余保持原来的顺序（新的在前）。 */
export function currentFirst<T extends { id: string }>(
  list: readonly T[],
  current: string | undefined,
): T[] {
  const head = list.filter((item) => item.id === current)
  return [...head, ...list.filter((item) => item.id !== current)]
}

/**
 * 实例这一组此刻露出哪几个。
 *
 * - 展开了、或者搜索中（`expanded`）：全部；
 * - 否则最前 {@link RUNS_SHOWN} 个，再加上正在看的那个（它藏在折叠里会让人找不到选中项）；
 * - 只多出一个时直接露出：「显示全部」那一行本身就占一行，不如直接放它。
 */
export function visibleRuns<T extends { id: string }>(
  list: readonly T[],
  options: { expanded: boolean; active: string | null; limit?: number },
): { shown: T[]; hidden: number } {
  const limit = options.limit ?? RUNS_SHOWN
  if (options.expanded || list.length <= limit + 1) return { shown: [...list], hidden: 0 }
  const shown = list.filter((item, index) => index < limit || item.id === options.active)
  return { shown, hidden: list.length - shown.length }
}
