/**
 * dsh-workflow-lite — 标签的颜色怎么交给样式（{@link tagStyle}），和带颜色的标签图标（{@link TagMark}，菜单项、组标题前面）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/TagMark
 */

import type { TagColor } from '../../../../shared/tags.ts'
import { Icon } from '../../kit/Icon.tsx'
import css from './tags.module.css'

/** 挑过颜色的标签（标签 → 颜色）。 */
export type TagColors = Readonly<Record<string, TagColor>>

/** 标签的颜色交给 CSS 变量 `--wl-tag`（色值在主题里）。 */
export function tagStyle(color: TagColor): React.CSSProperties {
  return { '--wl-tag': `var(--wl-c-${color})` } as React.CSSProperties
}

export function TagMark(props: { color: TagColor; size?: number }): React.JSX.Element {
  return (
    <span className={css.mark} style={tagStyle(props.color)} aria-hidden="true">
      <Icon name="tag" size={props.size ?? 14} />
    </span>
  )
}
