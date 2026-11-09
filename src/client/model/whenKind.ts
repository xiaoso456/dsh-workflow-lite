/**
 * dsh-workflow-lite — 一条步骤间的线的条件属于哪一类：总是 / 通过 / 未通过 / 自定义条件。
 *
 * 画布上的线（颜色、分组）、属性面板的「什么时候走这条线」、连接清单里的标签都按它分。纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/whenKind
 */

/** 步骤之间的线按条件分四种：总是 / 通过 / 未通过 / 自定义条件。 */
export type WhenKind = 'always' | 'pass' | 'fail' | 'custom'

export function whenKind(when: string | undefined): WhenKind {
  if (when === undefined) return 'always'
  return when === 'pass' || when === 'fail' ? when : 'custom'
}
