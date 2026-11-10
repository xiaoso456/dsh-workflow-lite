/**
 * dsh-workflow-lite — 刷新器：把「去后台读一份最新的、读回来放进界面」排成一条队。
 *
 * 轮询、改完东西后的刷新、用户手点的刷新会叠在一起发。不排队的话，慢的旧请求可能比新的晚回来，
 * 把新读到的盖掉；后台读得比轮询间隔还慢时，请求还会越堆越多。刷新器保证：
 *
 * - 同一时刻最多一个请求在路上；路上有请求时再要刷新，只记一笔，等它回来再发**一次**
 *   （期间要了几次都并成这一次，参数用 `merge` 合起来）；
 * - 结果按发出的先后生效，后发的总是最后落下；
 * - 每次 `run` 返回的 Promise 在「它之后发出的那次」读完并生效后才兑现：改完东西 `await run()`，
 *   拿到的一定是改完之后读的；
 * - `close` 之后回来的结果一律丢掉（换了实例、视图卸掉了），`open` 再接着用。
 *
 * 只管排队，不认识 React：组件里按依赖建一个，effect 里 `open` / `close`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/refresher
 */

export interface RefresherSpec<A, T> {
  /** 去读一份。 */
  fetch(arg: A): Promise<T>
  /** 读回来了，放进界面。 */
  apply(value: T, arg: A): void
  /** 读失败了。 */
  fail(reason: unknown, arg: A): void
  /** 路上有请求时又来了几次：参数怎么合起来（不给就用最后一次的）。 */
  merge?(queued: A, next: A): A
}

export interface Refresher<A> {
  run(arg: A): Promise<void>
  /** 开始收结果（建好就是开着的）。 */
  open(): void
  /** 不再收结果：路上的、排着的回来都丢掉。 */
  close(): void
}

export function refresher<A, T>(spec: RefresherSpec<A, T>): Refresher<A> {
  let busy = false
  let open = true
  /** 排着的下一次：参数，和等它的人。 */
  let queued: { arg: A; done: Promise<void>; resolve: () => void } | null = null

  const start = (arg: A): Promise<void> => {
    busy = true
    const own = (async () => {
      try {
        const value = await spec.fetch(arg)
        if (open) spec.apply(value, arg)
      } catch (reason) {
        if (open) spec.fail(reason, arg)
      }
    })()
    return own.finally(() => {
      busy = false
      const next = queued
      queued = null
      if (next === null) return
      if (open) void start(next.arg).then(next.resolve)
      else next.resolve()
    })
  }

  return {
    run(arg) {
      if (!open) return Promise.resolve()
      if (!busy) return start(arg)
      if (queued === null) {
        let resolve = (): void => undefined
        const done = new Promise<void>((r) => {
          resolve = r
        })
        queued = { arg, done, resolve }
      } else {
        queued.arg = spec.merge === undefined ? arg : spec.merge(queued.arg, arg)
      }
      return queued.done
    },
    open() {
      open = true
    },
    close() {
      open = false
    },
  }
}
