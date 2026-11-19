/**
 * dsh-workflow-lite — 工作流中心左栏换一项时，先把右栏要显示的读好再换（读好了、或等够了时限还没好，都照样换）：
 * 右栏不会先换成「读取中」、过一下再出内容。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/whenPrimed
 */

/** 最多等多久：再久就先换过去，读好了再补上。 */
export const PRIME_WAIT_MS = 160

/** `reading` 读完（或等了 `ms`）后调一次 `apply`；没有要读的（`null`）当场调。 */
export function whenPrimed(
  reading: Promise<unknown> | null,
  apply: () => void,
  ms = PRIME_WAIT_MS,
): void {
  if (reading === null) {
    apply()
    return
  }
  let pending = true
  const finish = (): void => {
    if (!pending) return
    pending = false
    window.clearTimeout(deadline)
    apply()
  }
  const deadline = window.setTimeout(finish, ms)
  void reading.then(finish, finish)
}
