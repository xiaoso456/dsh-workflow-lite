/**
 * dsh-workflow-lite — 工作流标签的规矩：一个标签长什么样、一个工作流最多几个。宿主存、界面建都按这里。
 *
 * 标签是本机的整理用法：存在 `<数据目录>/tags.json`（工作流名 → 标签），不写进工作流文件、不进版本，
 * 导出包里带着、导入时打回去。没有工作流用着的标签就不存在了（没有单独的「标签库」）。
 *
 * 每个标签有一种颜色（步骤的色板）：没挑过的按名字算（{@link autoTagColor}），挑过的和标签存在同一个文件里，
 * 标签没人用了颜色也一起去掉。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/tags
 */

import { isStepColor, STEP_COLORS, type StepColor } from './appearance.ts'

/** 一个标签最多几个字。 */
export const TAG_MAX_LENGTH = 24
/** 一个工作流最多几个标签。 */
export const TAGS_PER_WORKFLOW = 12

/** 一个标签：去掉首尾空白、连续空白压成一个、截到上限；空的是 `null`。 */
export function normalizeTag(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = [...value.trim().replace(/\s+/g, ' ')].slice(0, TAG_MAX_LENGTH).join('').trim()
  return text === '' ? null : text
}

/** 两个标签算不算同一个（不分大小写）。 */
export function sameTag(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase()
}

/** 一组标签：逐个归一、去掉空的和重复的（先出现的留下）、截到上限。不是数组当空的。 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  for (const raw of value) {
    const tag = normalizeTag(raw)
    if (tag === null || tags.some((known) => sameTag(known, tag))) continue
    tags.push(tag)
    if (tags.length === TAGS_PER_WORKFLOW) break
  }
  return tags
}

// ── 颜色 ─────────────────────

/** 标签的颜色：和步骤图标同一套色板。 */
export type TagColor = StepColor

/** 没挑过颜色的标签按名字从这几种里取（中性的石板灰只能手挑）。 */
const AUTO_COLORS: readonly TagColor[] = STEP_COLORS.filter((color) => color !== 'slate')

/** 按名字算出来的颜色：同一个名字（不分大小写）总是同一种。 */
export function autoTagColor(tag: string): TagColor {
  let hash = 2166136261
  for (const char of tag.toLocaleLowerCase()) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619) >>> 0
  }
  return AUTO_COLORS[hash % AUTO_COLORS.length] ?? 'blue'
}

/** 挑过的颜色（标签 → 颜色）里这个标签的那一种；没挑过按名字算。 */
export function tagColorOf(colors: Readonly<Record<string, TagColor>>, tag: string): TagColor {
  for (const [known, color] of Object.entries(colors)) if (sameTag(known, tag)) return color
  return autoTagColor(tag)
}

/** 读进来的颜色表：键按标签归一、值不是色板里的丢掉；不是对象当空的。 */
export function normalizeTagColors(value: unknown): Record<string, TagColor> {
  const colors: Record<string, TagColor> = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return colors
  for (const [raw, color] of Object.entries(value)) {
    const tag = normalizeTag(raw)
    if (tag === null || !isStepColor(color)) continue
    if (Object.keys(colors).some((known) => sameTag(known, tag))) continue
    colors[tag] = color
  }
  return colors
}
