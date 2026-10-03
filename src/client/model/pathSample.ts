/**
 * dsh-workflow-lite — 沿一条 SVG 路径等距取点（纯计算，不碰 DOM）。
 *
 * 光带（FlowStreaks）每次线变了都要沿线重新取点；拖卡片时线每帧都在变。以前是把路径塞进一个
 * 隐形的 `<path>` 再调 `getTotalLength` / `getPointAtLength`，每次都要浏览器重新解析、量一遍，
 * 是拖动时主线程上最大的开销之一。这里直接按画布自己生成的路径算：把曲线压成细折线，按弧长取点。
 *
 * 只认画布会生成的绝对坐标命令：`M` `L` `H` `V` `Q` `C` `Z`（React Flow 的贝塞尔用逗号分隔，也认）。
 * 碰到别的命令返回 `null`，调用方自己退回 DOM 测量。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/pathSample
 */

export interface MeasuredPath {
  /** 整条路径的长度。 */
  length: number
  /** 从起点到终点等距取 `count` 个点（含两头），每个点带它离起点的弧长。 */
  sample(count: number): { x: number; y: number; at: number }[]
}

/** 一段曲线最少、最多压成几小段；按控制多边形的长度每这么多像素一段。 */
const MIN_PARTS = 4
const MAX_PARTS = 96
const PART_PX = 5

const TOKEN = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

function partsFor(polygon: number): number {
  return Math.max(MIN_PARTS, Math.min(MAX_PARTS, Math.ceil(polygon / PART_PX)))
}

/** 把路径压成折线（相邻的重复点去掉）。不认识的命令 → `null`。 */
export function flattenPath(d: string): [number, number][] | null {
  const tokens = d.match(TOKEN) ?? []
  const out: [number, number][] = []
  let index = 0
  let command = ''
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  const push = (px: number, py: number): void => {
    const last = out[out.length - 1]
    if (last !== undefined && last[0] === px && last[1] === py) return
    out.push([px, py])
  }
  const num = (): number => {
    const token = tokens[index]
    index += 1
    const value = token === undefined ? Number.NaN : Number(token)
    if (!Number.isFinite(value)) throw new Error('bad number')
    return value
  }
  try {
    while (index < tokens.length) {
      const token = tokens[index] as string
      if (/[A-Za-z]/.test(token)) {
        command = token
        index += 1
        if (command === 'Z' || command === 'z') {
          push(startX, startY)
          x = startX
          y = startY
        }
        continue
      }
      switch (command) {
        case 'M': {
          x = num()
          y = num()
          startX = x
          startY = y
          push(x, y)
          // M 后面跟着的坐标对按 L 处理（SVG 的规矩）。
          command = 'L'
          break
        }
        case 'L': {
          x = num()
          y = num()
          push(x, y)
          break
        }
        case 'H': {
          x = num()
          push(x, y)
          break
        }
        case 'V': {
          y = num()
          push(x, y)
          break
        }
        case 'Q': {
          const cx = num()
          const cy = num()
          const ex = num()
          const ey = num()
          const parts = partsFor(Math.hypot(cx - x, cy - y) + Math.hypot(ex - cx, ey - cy))
          for (let step = 1; step <= parts; step += 1) {
            const t = step / parts
            const u = 1 - t
            push(u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey)
          }
          x = ex
          y = ey
          break
        }
        case 'C': {
          const c1x = num()
          const c1y = num()
          const c2x = num()
          const c2y = num()
          const ex = num()
          const ey = num()
          const parts = partsFor(
            Math.hypot(c1x - x, c1y - y) +
              Math.hypot(c2x - c1x, c2y - c1y) +
              Math.hypot(ex - c2x, ey - c2y),
          )
          for (let step = 1; step <= parts; step += 1) {
            const t = step / parts
            const u = 1 - t
            const a = u * u * u
            const b = 3 * u * u * t
            const c = 3 * u * t * t
            const e = t * t * t
            push(a * x + b * c1x + c * c2x + e * ex, a * y + b * c1y + c * c2y + e * ey)
          }
          x = ex
          y = ey
          break
        }
        default:
          return null
      }
    }
  } catch {
    return null
  }
  return out
}

/** 量一条路径。路径为空、长度为零或认不出来时返回 `null`。 */
export function measurePath(d: string): MeasuredPath | null {
  const line = flattenPath(d)
  if (line === null || line.length < 2) return null
  const lengths = [0]
  for (let index = 1; index < line.length; index += 1) {
    const [ax, ay] = line[index - 1] as [number, number]
    const [bx, by] = line[index] as [number, number]
    lengths.push((lengths[index - 1] as number) + Math.hypot(bx - ax, by - ay))
  }
  const length = lengths[lengths.length - 1] as number
  if (!(length > 0)) return null
  const sample = (count: number): { x: number; y: number; at: number }[] => {
    const total = Math.max(2, Math.round(count))
    const points: { x: number; y: number; at: number }[] = []
    // 取的点是递增的：沿折线往前走一个游标就够，不用每次二分。
    let segment = 1
    for (let index = 0; index < total; index += 1) {
      const at = (length * index) / (total - 1)
      while (segment < line.length - 1 && (lengths[segment] as number) < at) segment += 1
      const from = lengths[segment - 1] as number
      const span = (lengths[segment] as number) - from
      const t = span > 0 ? Math.min(1, Math.max(0, (at - from) / span)) : 0
      const [ax, ay] = line[segment - 1] as [number, number]
      const [bx, by] = line[segment] as [number, number]
      points.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, at })
    }
    return points
  }
  return { length, sample }
}
