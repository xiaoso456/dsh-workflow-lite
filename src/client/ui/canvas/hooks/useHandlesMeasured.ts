/**
 * dsh-workflow-lite — 卡片的连接点量好了没有：量好之前不放入场动画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/hooks/useHandlesMeasured
 */

import { useStore } from '@xyflow/react'

/**
 * React Flow 在卡片挂上时量一次连接点（位置取 `getBoundingClientRect`，含 transform），之后只在卡片尺寸变了才重量。
 * 卡片的入场动画（`cardIn`）从 0.9 倍放大：要是缩着的时候量，点都往卡片中心偏了近 10px，
 * 线头扎进卡里、箭头指不到点上，要等尺寸再变才对上。
 * 所以入场动画等这张卡的连接点量完才放：卡片根元素带上 `data-measured`，样式表据此起动画，
 * 量之前不露出来（`visibility`，不影响量）。量完的那次更新落在同一帧里，看不出先后。
 * 只订阅一个布尔值：拖动、挪位置不会让卡片重画。
 */
export function useHandlesMeasured(id: string): true | undefined {
  const measured = useStore(
    (store) => store.nodeLookup.get(id)?.internals.handleBounds !== undefined,
  )
  return measured || undefined
}
