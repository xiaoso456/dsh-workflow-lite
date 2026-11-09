/**
 * dsh-workflow-lite — 工作流视图的版面尺寸：窄视图断点、步骤库宽、属性面板宽、浮层间隙。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/geometry
 */

/** 与 CSS 里的 `@container (max-width: 760px)` 同一个断点。 */
export const NARROW = 760
export const LIBRARY_W = 216
/** 属性面板宽度：与 CSS 的 `clamp(300px, 30cqw, 360px)` 同一个式子。 */
export function inspectorWidth(viewWidth: number): number {
  return Math.min(360, Math.max(300, viewWidth * 0.3))
}
export const GAP = 12
