/**
 * dsh-workflow-lite — 读写线挂在哪两个连接点上：步骤与文件卡之间的线从哪个点出、落到哪个点上。
 *
 * 画布的版式语法是「左右走流程，上下走文件」：步骤左右两侧只接步骤之间的线，读写线一律挂在
 * 步骤的上下边。每条线**都落在一个真实的连接点上**（点画在哪，线就接在哪），只是按两张卡
 * 当下的位置挑用哪一个：
 * - 写：文件在下方 = 步骤底边 `file` → 文件上沿 `in`；文件在上方 = 步骤上边 `fileUp` → 文件下沿 `inBottom`；
 * - 读：文件朝着步骤那一侧出发（右 `out` / 左 `outLeft`），步骤在上方落到它底边的 `read`，
 *   在下方落到上边的 `readTop`。
 *
 * 连接点在卡片边上的位置也定在这里（`STEP_SPOTS` / `FILE_SPOTS`），卡片组件照着摆，
 * 拖线预览照着算，三处永远一致。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/route
 */

export type Side = 'top' | 'right' | 'bottom' | 'left'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Anchor {
  x: number
  y: number
  side: Side
}

/** 一个连接点在卡片上的位置：在哪条边上、沿这条边走到几成处。 */
export interface Spot {
  side: Side
  at: number
}

/** 步骤上挂读写线的连接点（左 `in` / 右 `out` 是流程线的，不在这里）。 */
export type StepFileHandle = 'file' | 'fileUp' | 'read' | 'readTop'
/** 文件卡上的连接点。 */
export type FileHandle = 'in' | 'inBottom' | 'out' | 'outLeft'

/**
 * 写的点在偏右（正对挂在步骤右下方的文件卡），读的点在偏左（读的文件多半来自左边的上游）。
 */
export const STEP_SPOTS: Record<StepFileHandle, Spot> = {
  file: { side: 'bottom', at: 0.62 },
  fileUp: { side: 'top', at: 0.62 },
  read: { side: 'bottom', at: 0.22 },
  readTop: { side: 'top', at: 0.22 },
}

export const FILE_SPOTS: Record<FileHandle, Spot> = {
  in: { side: 'top', at: 0.5 },
  inBottom: { side: 'bottom', at: 0.5 },
  out: { side: 'right', at: 0.5 },
  outLeft: { side: 'left', at: 0.5 },
}

/** 两张卡上下"挨着"的容差：差这么点也算上下关系。 */
const TOUCH = 6

/** 连接点在画布上的坐标。 */
export function spotOf(rect: Rect, spot: Spot): Anchor {
  switch (spot.side) {
    case 'top':
      return { x: rect.x + rect.w * spot.at, y: rect.y, side: 'top' }
    case 'bottom':
      return { x: rect.x + rect.w * spot.at, y: rect.y + rect.h, side: 'bottom' }
    case 'left':
      return { x: rect.x, y: rect.y + rect.h * spot.at, side: 'left' }
    case 'right':
      return { x: rect.x + rect.w, y: rect.y + rect.h * spot.at, side: 'right' }
  }
}

/** 文件在步骤下方（含并排时文件偏下）。 */
function fileIsBelow(step: Rect, file: Rect): boolean {
  if (file.y >= step.y + step.h - TOUCH) return true
  if (file.y + file.h <= step.y + TOUCH) return false
  return file.y + file.h / 2 >= step.y + step.h / 2
}

/**
 * 一条读写线挂在哪两个连接点上。
 * @param kind `'write'` 步骤 → 文件；`'read'` 文件 → 步骤。
 */
export function routeFileLink(
  kind: 'write' | 'read',
  step: Rect,
  file: Rect,
): { step: StepFileHandle; file: FileHandle } {
  const below = fileIsBelow(step, file)
  if (kind === 'write')
    return below ? { step: 'file', file: 'in' } : { step: 'fileUp', file: 'inBottom' }
  const toRight = step.x + step.w / 2 >= file.x + file.w / 2
  return { step: below ? 'read' : 'readTop', file: toRight ? 'out' : 'outLeft' }
}

/** 读写线两头的坐标（`from` 是线的起点：写 = 步骤，读 = 文件卡）——拖线预览用。 */
export function fileLinkEnds(
  kind: 'write' | 'read',
  step: Rect,
  file: Rect,
): { from: Anchor; to: Anchor } {
  const route = routeFileLink(kind, step, file)
  const stepEnd = spotOf(step, STEP_SPOTS[route.step])
  const fileEnd = spotOf(file, FILE_SPOTS[route.file])
  return kind === 'write' ? { from: stepEnd, to: fileEnd } : { from: fileEnd, to: stepEnd }
}
