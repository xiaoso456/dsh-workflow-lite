/**
 * dsh-workflow-lite — 工作流中心各页左栏的「视图选项」：按什么分组、组里按什么排、只看哪些。纯计算，不碰界面。
 *
 * 每页给一份 {@link ListSpec}（有哪几种分法、排法、筛法，各自怎么算），{@link arrangeList} 照它筛、排、分组。
 * 一项可以落进几组（工作流打了几个标签就在几组里各出现一次）；`none` 是「不分组」，只有一组、键是空串。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/listView
 */

/** 一页的视图选择。 */
export interface ListView<G extends string, S extends string, F extends string> {
  group: G | 'none'
  sort: S
  show: F
}

/** 一页的选择怎么记：localStorage 的键、默认值、每一项有哪几个取值（读回来不在里面的按默认）。 */
export interface StoredView<V extends Record<keyof V, string>> {
  key: string
  defaults: V
  choices: { [K in keyof V]: readonly V[K][] }
}

/** 左栏的一组；不分组时只有一组，`by` 是 `none`、`key` 是空串。 */
export interface ListGroup<E, G extends string = string> {
  by: G | 'none'
  key: string
  entries: E[]
}

export interface ArrangedList<E, G extends string, F extends string> {
  groups: ListGroup<E, G>[]
  /** 每种筛法各有几项（菜单里写在每项后面）。 */
  counts: Record<F, number>
  /** 筛完还剩几项（一项在几组里出现只算一次）。 */
  shown: number
}

/** 一页怎么筛、排、分组。 */
export interface ListSpec<E, G extends string, S extends string, F extends string> {
  /** 每种筛法留下哪些。 */
  keep: Record<F, (entry: E) => boolean>
  /** 每种排法的比较（组里按它排）。 */
  sort: Record<S, (a: E, b: E) => number>
  /** 每种分法下一项归到哪几组（至少一组）。 */
  keys: Record<G, (entry: E) => readonly string[]>
  /** 组的先后：给这一分法下出现过的键，回排好的；缺省按键名。 */
  order?: Partial<Record<G, (keys: readonly string[]) => string[]>>
}

/** 筛、排、分组。空组不出现。 */
export function arrangeList<E, G extends string, S extends string, F extends string>(
  entries: readonly E[],
  view: ListView<G, S, F>,
  spec: ListSpec<E, G, S, F>,
): ArrangedList<E, G, F> {
  const counts = Object.fromEntries(
    Object.entries(spec.keep).map(([show, keep]) => [
      show,
      entries.filter(keep as (entry: E) => boolean).length,
    ]),
  ) as Record<F, number>
  const sorted = entries.filter(spec.keep[view.show]).sort(spec.sort[view.sort])
  return { groups: groupList(sorted, view.group, spec), counts, shown: sorted.length }
}

function groupList<E, G extends string, S extends string, F extends string>(
  sorted: readonly E[],
  by: G | 'none',
  spec: ListSpec<E, G, S, F>,
): ListGroup<E, G>[] {
  if (by === 'none') return sorted.length === 0 ? [] : [{ by, key: '', entries: [...sorted] }]
  const keysOf = spec.keys[by]
  const buckets = new Map<string, E[]>()
  for (const entry of sorted) {
    for (const key of new Set(keysOf(entry))) {
      const bucket = buckets.get(key)
      if (bucket === undefined) buckets.set(key, [entry])
      else bucket.push(entry)
    }
  }
  const order = spec.order?.[by] ?? ((keys) => [...keys].sort((a, b) => a.localeCompare(b)))
  return order([...buckets.keys()]).flatMap((key) => {
    const entries = buckets.get(key)
    return entries === undefined ? [] : [{ by, key, entries }]
  })
}

/** 一组折叠记号：分法 + 组的键（不同分法下同名的组各记各的）。 */
export function groupId(group: { by: string; key: string }): string {
  return `${group.by}:${group.key}`
}

/** 按固定的先后排（不在表里的排在最后，按名称）。 */
export function fixedOrder(list: readonly string[]): (keys: readonly string[]) => string[] {
  const rank = (key: string): number => {
    const at = list.indexOf(key)
    return at < 0 ? list.length : at
  }
  return (keys) => [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** 没有值的排在最后，同值用 `tie` 分先后；`direction` 为 -1 时大的在前。 */
export function byValue<E>(
  of: (entry: E) => number | undefined,
  direction: 1 | -1,
  tie: (a: E, b: E) => number,
): (a: E, b: E) => number {
  return (a, b) => {
    const x = of(a)
    const y = of(b)
    if (x === undefined || y === undefined) {
      return x === y ? tie(a, b) : x === undefined ? 1 : -1
    }
    return (x - y) * direction || tie(a, b)
  }
}
