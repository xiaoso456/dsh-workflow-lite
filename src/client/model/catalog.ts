/**
 * dsh-workflow-lite — 前端手里那份工作流列表的就地更新。
 *
 * 列表按「最近修改」排。自动保存写完一张图，它在磁盘上就成了最新的；手里这份列表不跟着改的话，
 * 下次点开切换下拉、新列表一回来就要重排——React 把一行从中间挪到最前时会把它前面的每一行都挪一遍，
 * 行多时是一次整页重算样式，正落在下拉打开的那一下。存完就地记上，重排发生在下拉收着的时候（没有行挂着，不花钱）。
 *
 * 只动这一行：修改时间（浏览器的钟，下次整份列表回来时换成文件的）、步骤数；能存下来说明保存级没有问题，
 * 「坏了」的标记一并去掉。列表里没有这张（刚建、还没列到）就不动，等整份列表。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/catalog
 */

import type { GraphListResponse } from '../../shared/wire/graph.ts'

export interface SavedFacts {
  name: string
  nodeCount: number
  /** 存完的时刻（毫秒时间戳）。 */
  savedAt: number
}

export function recordSaved(
  catalog: GraphListResponse | null,
  saved: SavedFacts,
): GraphListResponse | null {
  if (catalog === null) return null
  const index = catalog.workflows.findIndex((entry) => entry.name === saved.name)
  if (index < 0) return catalog
  const entry = catalog.workflows[index]
  if (entry === undefined) return catalog
  const { invalid: _invalid, reason: _reason, ...rest } = entry
  // 浏览器的钟可能比文件的慢一点：至少比原来的新，排序不会往回走。
  const updatedAt = Math.max(saved.savedAt, entry.updatedAt)
  const workflows = catalog.workflows.slice()
  workflows[index] = { ...rest, nodeCount: saved.nodeCount, updatedAt }
  return { ...catalog, workflows }
}
