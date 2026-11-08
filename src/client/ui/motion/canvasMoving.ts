/**
 * dsh-workflow-lite — 画布视口「正在动」的登记：平移、缩放、定位时置位，别处据此停掉自己的动画或延后收尾。
 *
 * 模块级状态（正在动的标记、监听者、等停下来的队列）整个应用只此一份。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/canvasMoving
 */

import { useSyncExternalStore } from 'react'

/** 画布视口正在动（平移、缩放、定位）。 */
let canvasMoving = false
let stillQueue: (() => void)[] = []
const movingListeners = new Set<() => void>()

/** {@link expectCanvasMove} 的兜底定时器。 */
let expectTimer: ReturnType<typeof setTimeout> | undefined

/** 画布在视口开始动、停下来（或卸载）时报一声。 */
export function setCanvasMoving(moving: boolean): void {
  clearTimeout(expectTimer)
  if (canvasMoving === moving) return
  canvasMoving = moving
  for (const listener of movingListeners) listener()
  if (moving) return
  const queue = stillQueue
  stillQueue = []
  for (const task of queue) task()
}

/**
 * 程序要挪视口了：马上就算"在动"。React Flow 要等视口动画走第一帧才报 onMoveStart，点卡片那一帧很重时
 * 这段空当能有一两百毫秒，光带正好插在起步那一下。之后照常由 React Flow 报起止；动画没起步就被别的操作
 * 打断时它一声不吭，`ms` 内什么都没等到就当没动。
 */
export function expectCanvasMove(ms = 1000): void {
  setCanvasMoving(true)
  expectTimer = setTimeout(() => setCanvasMoving(false), ms)
}

function onMovingChange(listener: () => void): () => void {
  movingListeners.add(listener)
  return () => movingListeners.delete(listener)
}

/**
 * 画布视口是不是正在动。只有订它的组件跟着重渲染：要是放进画布的状态里，
 * 每次平移起止都要把整张画布连同每张卡、每条线的外壳重渲染一遍。
 */
export function useCanvasMoving(): boolean {
  return useSyncExternalStore(onMovingChange, () => canvasMoving)
}

/**
 * 能等的插拔（摘掉已经淡完的影子之类）等画布停下来再做：宿主页面上有带 `:has()` 的规则，
 * 视图里插、摘一个元素就要把整页样式重算一遍，落在视口动画中间就是一次明显的卡顿。画布没在动就立刻做。
 */
export function whenStill(task: () => void): void {
  if (canvasMoving) stillQueue.push(task)
  else task()
}
