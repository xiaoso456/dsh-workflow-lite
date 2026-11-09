/**
 * dsh-workflow-lite — 实例视图的两个量：画布与右栏之间的间隙、改状态小菜单的宽度。
 * 拆出来是因为实例视图本体和它的几块逻辑（`buildRunDecor`、`useGraphEdit`）都要用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/runView/geometry
 */

export const GAP = 12
/** 改状态小菜单的宽度（与 run.module.css 的 `.menu` 一致）。 */
export const MENU_W = 220
