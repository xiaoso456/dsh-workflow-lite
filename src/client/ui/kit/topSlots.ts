/**
 * dsh-workflow-lite — 共用顶栏留给实例视图的三个位置。
 *
 * 顶栏（`shell/TopBar`）建这几个位置，实例视图（`run/RunView`、`run/RunTopBar`）往里填内容，
 * 类型单独放在这里，让实例视图不必回头 import 顶栏。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/topSlots
 */

/** 实例视图往共用顶栏里填东西的三个位置（元素挂上才有值；见 `RunTopBar`）。 */
export interface TopSlots {
  /** 名字下拉触发器里的内容。 */
  trigger: HTMLElement | null
  /** 左边药丸里、名字后面：状态小标与进度。 */
  left: HTMLElement | null
  /** 右边的按钮组。 */
  right: HTMLElement | null
}
