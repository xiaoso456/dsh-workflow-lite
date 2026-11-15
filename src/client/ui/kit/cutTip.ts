/**
 * dsh-workflow-lite — 字被截成省略号时，悬停提示写全；没截断就不挂。
 *
 * 在指针进来的捕获阶段调（`onPointerOverCapture`）：悬停提示（shell/TipLayer）在冒泡阶段读 `data-tip`，
 * 这样赶在它前面写好。每次进来现量，栏宽、字变了都不用另外盯着。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/cutTip
 */

/**
 * `text`（一段，或几段里任一段）截断了就在 `host` 上挂 `full`（`host` 是指针进来的那个元素，可以就是 `text`），
 * 没截断就摘掉。`align: 'start'` 让提示和元素左边对齐往右展开（窄栏里用，见 TipLayer）。
 */
export function tipWhenCut(
  host: HTMLElement,
  text: HTMLElement | null | readonly (HTMLElement | null)[],
  full: string,
  align?: 'start',
): void {
  const texts = Array.isArray(text) ? text : [text]
  const cut = texts.some((one) => one !== null && one.scrollWidth > one.clientWidth)
  if (cut) {
    host.dataset.tip = full
    if (align === undefined) delete host.dataset.tipAlign
    else host.dataset.tipAlign = align
  } else {
    delete host.dataset.tip
    delete host.dataset.tipAlign
  }
}
