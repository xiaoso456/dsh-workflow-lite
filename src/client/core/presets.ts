/**
 * dsh-workflow-lite — 节点库的内容与折叠状态。
 *
 * 画布左边那栏有两个来源，**分节展示不混**：
 *
 * 1. **内置 node**（本文件）：开箱即用的提示词骨架。没有它，一张新图是空白的，
 *    而「新建节点」只能得到一个空 prompt —— 等于逼用户从零写一段契约。
 *    它们是**起点不是规范**：插进节点后随便改。**平铺列出**。
 * 2. **自定义 node**（`templates/nodes/<名>.json`）：用户自己的，**同样平铺**。
 *
 * 两节内部都只有一层，所以这里没有"分组"这件事：曾经按模板名前缀归并过（`exec-code` /
 * `exec-test` 一组、落单的进「其他」），用户看过之后明确说不需要二级分类——前缀是文件名的
 * 偶然形状，不是用户表达出来的分类。于是那一整套分组工具连同它的哨兵组名一起删掉了，
 * 面板那边只拿到一列条目。
 *
 * 折叠状态**按分节**记（`section:builtin` / `section:disk`），仍然是持久化偏好。
 *
 * 文案全部走 locale 词典（键名在这里，正文在 `locales.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/core/presets
 */

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

/* ── 折叠与筛选（纯函数，单测直接用）─────────────────────────── */

/** 节点库的两个来源。折叠键带来源前缀，两个来源因此区分得开。 */
export type PaletteSource = 'builtin' | 'disk'

/** 折叠状态在 `localStorage` 里的键：值是「已折叠键的 JSON 数组」。 */
export const PALETTE_COLLAPSED_KEY = 'workflow-lite.palette.collapsed'

/**
 * 分节键：`section:<来源>`，两个分节分别得到 `section:builtin` 与 `section:disk`。
 *
 * 带 `section:` 前缀而不是裸 `builtin` / `disk`，有两个理由：
 * 1. 折叠表是用户写在 `localStorage` 里的**持久化偏好**，会跨版本残留。上一版给二级分组
 *    写下的键形如 `disk:exec`、`builtin:plan`，裸来源名与那批键不共用命名空间，
 *    老偏好不会错位到分节上（对不上的键自然不生效）。
 * 2. 分节不是"某个来源下的某一项"：它需要自己的命名空间，将来若再有别的可折叠层，
 *    加一个前缀就够，不用挤进 `来源:名字` 这个二元格式里。
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
 * 某个折叠键此刻是否展开。
 *
 * 名字里的 "group" 是历史：这个判定原先服务于二级分组，二级分类去掉之后它只服务两个
 * 分节（`section:builtin` / `section:disk`），判定本身与键的含义无关——给一个键，
 * 回答它现在是不是展开的。
 *
 * 从前这里还有第三个参数 `filtering`（筛选态一律展开）。筛选框整个删掉之后，
 * "命中的必须当场可见"这条前提不存在了，展开与否只剩「用户折过没有」这一件事。
 */
export function isGroupExpanded(key: string, collapsed: readonly string[]): boolean {
  return !collapsed.includes(key)
}
