/**
 * dsh-workflow-lite — 步骤卡的图标与颜色：图标库、色板，以及新步骤怎么挑一个不重样的。
 *
 * 图标与颜色只是认路的记号，**不进计划**。存在步骤的 `data.icon` / `data.color` 里；没存的老步骤
 * 按 id 猜（`review`、`review-2` 都是审查的样子，猜不中就是通用的样子）。
 *
 * 这里只有名字（host 与 client 都要用：校验、新建步骤时挑一个）；图标的笔画在 `client/ui/stepIcons.ts`。
 * 纯函数，不碰磁盘、不 import DSH 包。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/appearance
 */

import type { NodeData, WorkflowNode } from './types.ts'
import { NODE_TYPE } from './types.ts'

/**
 * 图标库。顺序就是新步骤挑图标的顺序：先挑通用的那些，内置步骤的六个放在最后
 * （它们代表固定的意思，空白步骤别一上来就撞上）。
 */
export const STEP_ICONS = [
  'idea',
  'target',
  'terminal',
  'bug',
  'test',
  'database',
  'chart',
  'globe',
  'chat',
  'mail',
  'rocket',
  'gear',
  'layers',
  'book',
  'checklist',
  'clipboard',
  'brush',
  'image',
  'translate',
  'branch',
  'package',
  'cloud',
  'lock',
  'flag',
  'sparkle',
  'scan',
  'plan',
  'implement',
  'review',
  'fix',
  'report',
  'blank',
] as const
export type StepIcon = (typeof STEP_ICONS)[number]

/** 色板。顺序就是新步骤挑颜色的顺序；中性的石板灰放最后。 */
export const STEP_COLORS = [
  'blue',
  'green',
  'amber',
  'coral',
  'teal',
  'pink',
  'olive',
  'violet',
  'slate',
] as const
export type StepColor = (typeof STEP_COLORS)[number]

export interface Appearance {
  icon: StepIcon
  color: StepColor
}

/** 内置步骤的样子（id 去掉 `-2` 这类序号后按它猜）。 */
const KIND_LOOK: Readonly<Record<string, Appearance>> = {
  scan: { icon: 'scan', color: 'blue' },
  plan: { icon: 'plan', color: 'violet' },
  implement: { icon: 'implement', color: 'green' },
  review: { icon: 'review', color: 'amber' },
  fix: { icon: 'fix', color: 'coral' },
  report: { icon: 'report', color: 'teal' },
}

const BLANK_LOOK: Appearance = { icon: 'blank', color: 'slate' }

export function isStepIcon(value: unknown): value is StepIcon {
  return typeof value === 'string' && (STEP_ICONS as readonly string[]).includes(value)
}

export function isStepColor(value: unknown): value is StepColor {
  return typeof value === 'string' && (STEP_COLORS as readonly string[]).includes(value)
}

/** 按 id 猜样子：`review`、`review-2` 都算审查；猜不中是通用的样子。 */
export function guessAppearance(id: string): Appearance {
  const base = id.toLowerCase().replace(/-\d+$/u, '')
  return KIND_LOOK[base] ?? BLANK_LOOK
}

/** 一个步骤卡的样子：存了就用存的，没存（或存的不认识）就按 id 猜。 */
export function appearanceOf(id: string, data: Pick<NodeData, 'icon' | 'color'>): Appearance {
  const guess = guessAppearance(id)
  return {
    icon: isStepIcon(data.icon) ? data.icon : guess.icon,
    color: isStepColor(data.color) ? data.color : guess.color,
  }
}

/** 挑用得最少的那个；一样少就按清单顺序取第一个。 */
function leastUsed<T extends string>(list: readonly T[], used: readonly T[]): T {
  const count = new Map<T, number>(list.map((item) => [item, 0]))
  for (const item of used) count.set(item, (count.get(item) ?? 0) + 1)
  let best = list[0] as T
  for (const item of list) {
    if ((count.get(item) ?? 0) < (count.get(best) ?? 0)) best = item
  }
  return best
}

/**
 * 给新步骤挑样子：给了的（来自模板 / 内置步骤）照用，缺的那一半挑图里用得最少的——
 * 尽量不和已有的步骤重样。
 */
export function pickAppearance(
  nodes: readonly WorkflowNode[],
  preferred: Pick<NodeData, 'icon' | 'color'> = {},
  /** 新步骤的 id：是内置步骤的名字（`review`、`review-2`）就照内置步骤的样子。 */
  id?: string,
): Appearance {
  const guess = id === undefined ? BLANK_LOOK : guessAppearance(id)
  if (guess !== BLANK_LOOK) {
    return {
      icon: isStepIcon(preferred.icon) ? preferred.icon : guess.icon,
      color: isStepColor(preferred.color) ? preferred.color : guess.color,
    }
  }
  const looks = nodes
    .filter((node) => node.type === NODE_TYPE)
    .map((node) => appearanceOf(node.id, node.data as NodeData))
  return freshAppearance(looks, preferred)
}

/**
 * 给新的「我的步骤」挑样子：避开内置步骤和已有的我的步骤用过的——步骤库里一眼扫过去尽量不重样。
 * 没存样子的老模板在库里显示的是书签，不算占用。
 */
export function pickTemplateAppearance(
  templates: readonly { name: string; icon?: string; color?: string }[],
): Appearance {
  const looks = [
    ...Object.values(KIND_LOOK),
    ...templates
      .filter((entry) => entry.icon !== undefined || entry.color !== undefined)
      .map((entry) => appearanceOf(entry.name, entry)),
  ]
  return freshAppearance(looks)
}

/** 给了的照用，缺的那一半挑 `looks` 里用得最少的（空白步骤的图标不挑）。 */
function freshAppearance(
  looks: readonly Appearance[],
  preferred: Pick<NodeData, 'icon' | 'color'> = {},
): Appearance {
  return {
    icon: isStepIcon(preferred.icon)
      ? preferred.icon
      : leastUsed(
          STEP_ICONS.filter((icon) => icon !== 'blank'),
          looks.map((look) => look.icon),
        ),
    color: isStepColor(preferred.color)
      ? preferred.color
      : leastUsed(
          STEP_COLORS,
          looks.map((look) => look.color),
        ),
  }
}

/** 内置步骤的样子（步骤库、示例流程用）。 */
export function presetAppearance(id: string): Appearance {
  return KIND_LOOK[id] ?? BLANK_LOOK
}
