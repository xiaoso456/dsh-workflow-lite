/**
 * dsh-workflow-lite — 节点库的内容与分组。
 *
 * 画布左边那栏有两个来源，**分节展示不混**：
 *
 * 1. **内置 node**（本文件）：开箱即用的提示词骨架。没有它，一张新图是空白的，
 *    而「新建节点」只能得到一个空 prompt —— 等于逼用户从零写一段契约。
 *    它们是**起点不是规范**：插进节点后随便改。
 *    **平铺列出，不再分组**：规划 / 执行 / 审查 / 修复 / 汇总 那五个角色名是内置节点
 *    自己的概念，拿它们给六个起点分堆只是把一条常见主线切碎，没有增益。
 * 2. **自定义 node**（`templates/nodes/<名>.json`，见 §3.2 / §6.4）：用户自己的。
 *    分组按**模板名首个 `-` 之前的前缀**归并；只有**同一个前缀有两个以上**模板时才成组，
 *    落单的进「其他」——这样 `exec-code` / `exec-test` 是一组，而 `my-thing` 不会被
 *    自作主张地归到一个叫 `my` 的组里。
 *    **组名就是前缀原文**，不翻译：那是用户自己起的名字，套内置的角色名是错的。
 *
 * 文案全部走 locale 词典（键名在这里，正文在 `locales.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/core/presets
 */

import type { TemplateEntry } from '../../shared/types.ts'
import type { LocaleKey } from './locales.ts'

/** 一个内置起点。 */
export interface NodePreset {
  /** 建议的节点 `id`（撞名由 `uniqueNodeId` 加序号，不静默覆盖）。 */
  id: string
  labelKey: LocaleKey
  promptKey: LocaleKey
  /** 产出契约；`false` = 显式声明不产出文件。 */
  output?: string | false
}

/** 内置起点的呈现顺序 = 图上一条常见主线的顺序。 */
export const NODE_PRESETS: readonly NodePreset[] = [
  {
    id: 'scan',
    labelKey: 'preset.scan.label',
    promptKey: 'preset.scan.prompt',
    output: 'scan-notes.md',
  },
  {
    id: 'plan',
    labelKey: 'preset.plan.label',
    promptKey: 'preset.plan.prompt',
    output: 'plan.md',
  },
  {
    id: 'implement',
    labelKey: 'preset.implement.label',
    promptKey: 'preset.implement.prompt',
    output: 'changes.md',
  },
  {
    id: 'review',
    labelKey: 'preset.review.label',
    promptKey: 'preset.review.prompt',
    output: 'review.md',
  },
  {
    id: 'fix',
    labelKey: 'preset.fix.label',
    promptKey: 'preset.fix.prompt',
    output: 'fix-notes.md',
  },
  {
    id: 'report',
    labelKey: 'preset.report.label',
    promptKey: 'preset.report.prompt',
    output: false,
  },
]

/**
 * 落单模板的组名（＝「其他」）。
 *
 * 用空串而不是 `'other'`：**前缀永远不可能是空串**（`templatePrefix` 对没有 `-`、
 * 前导 `-`、空名一律回 `null`），所以这个哨兵值跟前缀命名空间天然不重叠——
 * 不会出现「用户真有一个叫 other 的前缀」被吞掉的情形。
 */
export const OTHER_GROUP = ''

/** 一个分组（自定义节点按前缀分组；组名就是前缀原文）。 */
export interface PaletteGroup<T> {
  group: string
  items: T[]
}

/**
 * 组名给人看的样子。
 *
 * 只有「其他」（{@link OTHER_GROUP}）需要翻译；其余**原样返回**：组名是用户自己起的
 * 前缀（`exec`、`review`、任何字面量），拿内置节点那五个角色名去套它是错的，
 * 再给它做一层翻译更是错的。
 */
export function groupLabel(group: string, t: (key: LocaleKey) => string): string {
  return group === OTHER_GROUP ? t('preset.group.other') : group
}

/** 模板名的分组前缀：首个 `-` 之前的那一段；没有 `-` 就没有前缀。 */
export function templatePrefix(name: string): string | null {
  const at = name.indexOf('-')
  return at <= 0 ? null : name.slice(0, at)
}

/**
 * 把磁盘模板按前缀归组。
 *
 * 只有**同一前缀出现两次以上**才成组——单个模板跟着自己的前缀自成一组只是噪声，
 * 归进「其他」更好读。
 *
 * 顺序是**确定**的（同一份输入必然同一份输出）：先具名组，按组名码位序；「其他」永远
 * 垫底。不依赖 `Map` 的插入顺序，否则换个目录列举顺序、整栏就换了样子。
 *
 * @param entries - `graph/templates` 给的节点模板条目。
 */
export function groupNodeTemplates(
  entries: readonly TemplateEntry[],
): PaletteGroup<TemplateEntry>[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const prefix = templatePrefix(entry.name)
    if (prefix === null) continue
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  const buckets = new Map<string, TemplateEntry[]>()
  for (const entry of entries) {
    const prefix = templatePrefix(entry.name)
    // 前缀只出现一次就当没有：给它单开一组，组头是个只出现过一次的名字，纯噪声。
    const group = prefix !== null && (counts.get(prefix) ?? 0) > 1 ? prefix : OTHER_GROUP
    const bucket = buckets.get(group)
    if (bucket === undefined) buckets.set(group, [entry])
    else bucket.push(entry)
  }
  return [...buckets].map(([group, items]) => ({ group, items })).sort(byGroupName)
}

/** 具名组按组名码位序，「其他」垫底。 */
function byGroupName<T>(a: PaletteGroup<T>, b: PaletteGroup<T>): number {
  if (a.group === OTHER_GROUP) return b.group === OTHER_GROUP ? 0 : 1
  if (b.group === OTHER_GROUP) return -1
  return a.group < b.group ? -1 : a.group > b.group ? 1 : 0
}

/* ── 折叠与筛选（纯函数，单测直接用）─────────────────────────── */

/** 节点库的两个来源。折叠键带来源前缀，两个来源的同名组（尤其空组）因此区分得开。 */
export type PaletteSource = 'builtin' | 'disk'

/** 折叠状态在 `localStorage` 里的键：值是「已折叠组键的 JSON 数组」。 */
export const PALETTE_COLLAPSED_KEY = 'workflow-lite.palette.collapsed'

/**
 * 组键：`<来源>:<组名>`；组名为空串时就是 `disk:`（内置那一节是平铺的，不产生组键）。
 *
 * 来源前缀**不删**：两个来源的「其他」（空组名）语义上仍是两回事，而且折叠表是用户
 * 写在 `localStorage` 里的偏好、会跨版本残留——键的形态一改，老偏好就错位到别的组上。
 * 留着前缀，语义与历史都稳。
 */
export function groupKey(source: PaletteSource, group: string): string {
  return `${source}:${group}`
}

/**
 * 分节键：`section:<来源>`，两个分节分别得到 `section:builtin` 与 `section:disk`。
 *
 * 为什么分节**不**跟自定义节点组共用 `builtin:` / `disk:` 那套键空间：那套的语义是
 * 「来源:组名」，冒号右边永远是一个**组名**（前缀原文或「其他」的空串哨兵）。分节不是组：
 * 硬塞进去就得借用某个组名（比如 `disk:section`），于是「有个模板前缀恰好叫 section」
 * 会和「自定义 node 这一节自己」塌成同一个键，收一个另一个跟着折，将来真出现这种前缀
 * 就是一个查不出来的 bug。分节另起 `section:` 前缀，两套命名空间互不重叠
 * （`section:disk` 与 `disk:section` 是两个不同的键）。
 */
export function sectionKey(source: PaletteSource): string {
  return `section:${source}`
}

/**
 * 解析 `localStorage` 里的折叠表。
 *
 * 任何读不懂的输入一律回落到**空数组 = 全展开**：`null`、非法 JSON、不是数组、
 * 数组里混了非字符串。折叠状态是**便利**不是**事实**——为它抛异常或半解析，
 * 只会让整栏打不开，而用户要的是「看节点库」，不是「看一个报错」。
 */
export function parseCollapsed(raw: string | null): string[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const keys: string[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'string') return []
    keys.push(entry)
  }
  return keys
}

/**
 * 从 storage 读折叠表。拿不到 storage（没有 `localStorage`）或读取本身抛异常
 * （隐私模式下 `getItem` 也会抛）都回落全展开——同样绝不抛异常。
 */
export function readCollapsed(
  storage: { getItem(key: string): string | null } | null | undefined,
): string[] {
  if (storage === null || storage === undefined) return []
  try {
    return parseCollapsed(storage.getItem(PALETTE_COLLAPSED_KEY))
  } catch {
    return []
  }
}

/** 把折叠表写回 storage。写不进去（配额、隐私模式）静默放弃：这是偏好，不是事实。 */
export function writeCollapsed(
  storage: { setItem(key: string, value: string): void } | null | undefined,
  collapsed: readonly string[],
): void {
  if (storage === null || storage === undefined) return
  try {
    storage.setItem(PALETTE_COLLAPSED_KEY, JSON.stringify(collapsed))
  } catch {
    return
  }
}

/**
 * 筛选框里算不算「正在筛」。两处判断（过滤条目、强制展开）共用这一条规则：
 * 只有空白不算筛——空词等于不筛，而不是「没有东西匹配」。
 */
export function isFiltering(filter: string): boolean {
  return filter.trim() !== ''
}

/** 名字是否命中筛选词：大小写不敏感的子串匹配；空筛选词一律命中。 */
export function matchesFilter(text: string, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  if (needle === '') return true
  return text.toLowerCase().includes(needle)
}

/**
 * 一个组在筛选后的呈现内容。
 *
 * `hits` 与 `total` 是组头上那对「命中数 / 总数」：`total` 是该组的**全部**条数，
 * 不受筛选影响——用户要能看出「这一组还有多少没显示出来」。
 */
export interface FilteredGroup<T> {
  group: string
  /** 命中项；不筛时就是全部（原顺序）。 */
  items: T[]
  /** 命中条数。 */
  hits: number
  /** 该组总条数。 */
  total: number
}

/**
 * 按筛选词过一遍每一组。
 *
 * 不筛时原样返回（顺序与空组都保留）；筛的时候**丢掉零命中的组**——零命中的组
 * 既没有可展示的条目，也没有「命中数」可讲，留着只是一块占位的空壳。
 */
export function filterGroups<T>(
  groups: readonly PaletteGroup<T>[],
  filter: string,
  textOf: (item: T) => string,
): FilteredGroup<T>[] {
  const active = isFiltering(filter)
  const result: FilteredGroup<T>[] = []
  for (const group of groups) {
    const items = active
      ? group.items.filter((item) => matchesFilter(textOf(item), filter))
      : group.items
    if (active && items.length === 0) continue
    result.push({ group: group.group, items, hits: items.length, total: group.items.length })
  }
  return result
}

/**
 * 某组此刻是否展开。
 *
 * 筛选中**一律展开**：输了筛选词却看到一片折起来的组，会让人以为筛坏了——
 * 命中的东西必须当场可见。`filtering` 由调用方按 {@link isFiltering} 给出。
 */
export function isGroupExpanded(
  key: string,
  collapsed: readonly string[],
  filtering: boolean,
): boolean {
  return filtering || !collapsed.includes(key)
}
