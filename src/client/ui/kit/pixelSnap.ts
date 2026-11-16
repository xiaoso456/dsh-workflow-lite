/**
 * dsh-workflow-lite — 把一个元素挪到整的设备像素上。
 *
 * 居中的弹窗在剩下的宽（高）是奇数时落在半个像素上，里面的图标跟着落在半像素上：合成层里按原位画（发虚），
 * 不在合成层里时浏览器会把它们吸到整像素（一换层就整体跳半个到一个像素）。挪到整像素上，两种都没有。
 *
 * 挪多少写在 `translate` 属性上（和放进出场动画用的 `transform` 叠在一起、互不覆盖）；量位置时扣掉上次挪的，
 * 可以反复调用（窗口、弹窗大小变了再挪一次）。量的时候元素上不能有正在放的变换动画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/pixelSnap
 */

const applied = new WeakMap<HTMLElement, { x: number; y: number }>()

export function snapToPixels(element: HTMLElement): void {
  const last = applied.get(element) ?? { x: 0, y: 0 }
  const box = element.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  const x = box.left - last.x
  const y = box.top - last.y
  const next = { x: Math.round(x * ratio) / ratio - x, y: Math.round(y * ratio) / ratio - y }
  if (Math.abs(next.x - last.x) < 0.001 && Math.abs(next.y - last.y) < 0.001) return
  applied.set(element, next)
  element.style.translate = `${next.x}px ${next.y}px`
}
