/**
 * 连线上的牌子、光带挂到 React Flow 的标签层（`.react-flow__edgelabel-renderer`）。
 *
 * 和 `EdgeLabelRenderer` 一样是个 portal，区别是标签层由画布找一次、经 context 发下来：
 * `EdgeLabelRenderer` 每个实例都订阅 store，store 每变一次（拖卡片时一帧好几次）各自 `querySelector` 一遍，
 * 线一多就是一帧几百次查询。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/lines/LabelLayer
 */

import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

/** 画布找到的标签层；还没挂上时是 `null`（这时标签先不画，和 `EdgeLabelRenderer` 一样）。 */
export const LabelLayer = createContext<HTMLElement | null>(null)

export function OnLabels(props: { children: React.ReactNode }): React.ReactPortal | null {
  const layer = useContext(LabelLayer)
  return layer === null ? null : createPortal(props.children, layer)
}
