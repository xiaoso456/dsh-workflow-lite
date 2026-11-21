/**
 * dsh-workflow-lite — 工作流目录里触发器那一块的名字（`triggers/`）和一个相对路径落在哪：纯函数，宿主、导出导入共用。
 *
 * ```
 * triggers/
 *   watch.mjs        共用的监视底子
 *   <卡片 id>/       每张卡片一个目录，脚本缺省在这里跑
 *     *.mjs、samples/  脚本、试的时候投的样本
 *     secrets/       用户放的令牌、密钥
 *     data/          脚本自己记的东西（真打开用）
 *     data-test/     同上，试运行用
 * ```
 *
 * @module @xiaoso/dsh-workflow-lite/shared/triggerDirs
 */

/** 工作流目录里放触发脚本的那一层。 */
export const SCRIPTS_DIR = 'triggers'

/** 卡片目录里不算脚本的几处。 */
export const CARD_AREAS = {
  data: 'data',
  trial: 'data-test',
  secrets: 'secrets',
} as const

export type CardArea = keyof typeof CARD_AREAS

/**
 * 工作流目录里的一个相对路径（`/` 分隔）落在触发器那一块的哪里：
 * 不在 `triggers/` 下是 `null`；`triggers/` 根上的、卡片目录里的脚本和样本是 `script`；
 * 卡片目录里的数据、试运行数据、密钥给出是哪张卡片的哪一处。
 */
export function triggerArea(
  rel: string,
): null | { area: 'script'; node?: string } | { area: CardArea; node: string } {
  const parts = rel.split('/')
  if (parts[0] !== SCRIPTS_DIR || parts.length < 2) return null
  if (parts.length === 2) return { area: 'script' }
  const node = parts[1] as string
  const sub = parts[2]
  for (const [area, dir] of Object.entries(CARD_AREAS) as [CardArea, string][]) {
    if (sub === dir && parts.length > 3) return { area, node }
  }
  return { area: 'script', node }
}
