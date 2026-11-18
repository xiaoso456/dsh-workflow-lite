type Point = readonly [number, number]
type Quad = readonly [Point, Point, Point, Point]

const THICKNESS = 1.8
const ARC = 0.55228475

const coordinates = (point: Point): string => point.map((value) => +value.toFixed(3)).join(' ')

function mix(from: Point, to: Point, fraction: number): Point {
  return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction]
}

function trim(from: Point, towards: Point, radius: number): Point {
  const length = Math.hypot(towards[0] - from[0], towards[1] - from[1])
  return mix(from, towards, length === 0 ? 0 : Math.min(radius / length, 0.5))
}

/** 四角轮廓总是八段三次曲线，直边和缩到一点的轮廓也保留相同的命令。 */
function loop(corners: Quad, radius: number): string {
  const points = corners.map((corner, index) => ({
    corner,
    entry: trim(corner, corners[(index + 3) % 4], radius),
    exit: trim(corner, corners[(index + 1) % 4], radius),
  }))
  const start = coordinates(points[3].exit)
  const curves = points.map(({ corner, entry, exit }, index) => {
    const previous = coordinates(points[(index + 3) % 4].exit)
    const next = coordinates(entry)
    return `C${previous} ${next} ${next}C${coordinates(mix(entry, corner, ARC))} ${coordinates(mix(exit, corner, ARC))} ${coordinates(exit)}`
  })
  return `M${start}${curves.join('')}Z`
}

function box(left: number, top: number, right: number, bottom: number): Quad {
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]
}

export function ring(outer: Quad, inner: Quad, radius: number): string {
  const [first, second, third, fourth] = inner
  return loop(outer, radius) + loop([second, first, fourth, third], Math.max(0, radius - THICKNESS))
}

export function ringBox(
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius = Infinity,
): string {
  const inset = Math.min(THICKNESS, (right - left) / 2, (bottom - top) / 2)
  return ring(
    box(left, top, right, bottom),
    box(left + inset, top + inset, right - inset, bottom - inset),
    radius,
  )
}

/** 开放的笔画是一枚有圆头的胶囊；收起时保留同一笔画的命令，面积为零。 */
export function ink(from: Point, to: Point = from, thickness = THICKNESS): string {
  const deltaX = to[0] - from[0]
  const deltaY = to[1] - from[1]
  const length = Math.hypot(deltaX, deltaY)
  if (length === 0) return loop([from, from, from, from], 0)
  const radius = thickness / 2
  const position = (along: number, across: number): Point => [
    from[0] + (along * deltaX - across * deltaY) / length,
    from[1] + (along * deltaY + across * deltaX) / length,
  ]
  return loop(
    [
      position(-radius, -radius),
      position(length + radius, -radius),
      position(length + radius, radius),
      position(-radius, radius),
    ],
    radius,
  )
}

export function polygon(points: readonly Point[]): string {
  return `M${points.map(coordinates).join('L')}Z`
}

export function glyphPath(...paths: string[]): string {
  return `path('${paths.join('')}')`
}
