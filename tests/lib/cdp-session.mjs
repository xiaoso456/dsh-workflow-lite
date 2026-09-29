/**
 * 极小的 CDP 客户端：连到 headless Chrome 的一个 page target，发命令、求值、收控制台错误。
 *
 * 只用 Node 22 自带的全局 `WebSocket`，不引第三方依赖。
 */

import { CDP_HTTP } from './cdp-endpoint.mjs'

/** 打开一个 page target 的会话。 */
export async function openPage(cdpHttp = CDP_HTTP) {
  const targets = await fetch(`${cdpHttp}/json`).then((r) => r.json())
  const page = targets.find((target) => target.type === 'page')
  if (page === undefined) throw new Error('no page target in the CDP browser')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(undefined), { once: true })
    socket.addEventListener('error', () => reject(new Error('cdp socket failed')), { once: true })
  })

  let nextId = 0
  const pending = new Map()
  /** 页面侧捕获到的错误（控制台 error + 未捕获异常）。 */
  const errors = []
  /**
   * 事件订阅：`method` → 等待中的解析器队列（先进先出）。
   *
   * 为什么必须有这个口子：`Input.dragIntercepted` 是**事件**不是命令回执，而
   * `Input.setInterceptDrags` 只是让 Chrome 把拖拽数据转成事件——事件必须**先订阅再触发**，
   * 否则那一次拖拽的 `DragData` 就永远拿不到了（它不会重放）。
   */
  const waiters = new Map()
  /** 长期订阅者：`method` → 处理函数集合（与只兑现一次的 `once` 并存）。 */
  const subscribers = new Map()

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (typeof message.id === 'number' && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
      return
    }
    if (typeof message.method === 'string') {
      const listeners = subscribers.get(message.method)
      if (listeners !== undefined) {
        for (const listener of listeners) listener(message.params)
      }
      const queue = waiters.get(message.method)
      if (queue !== undefined && queue.length > 0) {
        const waiter = queue.shift()
        clearTimeout(waiter.timer)
        waiter.resolve(message.params)
      }
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      errors.push(
        (message.params.args ?? [])
          .map((arg) => (typeof arg.value === 'string' ? arg.value : arg.description ?? arg.type))
          .join(' '),
      )
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails
      errors.push(details?.exception?.description ?? details?.text ?? 'uncaught exception')
    }
  })

  /** 发一条 CDP 命令。 */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => reject(new Error(`cdp timeout: ${method}`)), 30_000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        if (message.error !== undefined) reject(new Error(`${method}: ${message.error.message}`))
        else resolve(message.result)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })

  await send('Runtime.enable')
  await send('Page.enable')

  /**
   * 等**一个** CDP 事件（只兑现订阅之后到来的第一条）。
   *
   * @param method - CDP 事件名，如 `Input.dragIntercepted`。
   * @param options - `timeoutMs` 超时（默认 5s）；超时**拒绝**而不是返回 `null`，
   *   免得调用方把"没等到"误当成"事件里没有数据"。
   */
  const once = (method, { timeoutMs = 5_000 } = {}) =>
    new Promise((resolve, reject) => {
      const queue = waiters.get(method) ?? []
      if (!waiters.has(method)) waiters.set(method, queue)
      const waiter = {
        resolve,
        timer: null,
      }
      waiter.timer = setTimeout(() => {
        const index = queue.indexOf(waiter)
        if (index !== -1) queue.splice(index, 1)
        reject(new Error(`cdp event timeout: ${method}`))
      }, timeoutMs)
      queue.push(waiter)
    })

  /** 长期订阅某类事件（如 `Network.requestWillBeSent`）；返回取消订阅的函数。 */
  const on = (method, handler) => {
    const listeners = subscribers.get(method) ?? new Set()
    if (!subscribers.has(method)) subscribers.set(method, listeners)
    listeners.add(handler)
    return () => listeners.delete(handler)
  }

  /** 在页面里求值（支持 await）。 */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(
        `evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      )
    }
    return result.result?.value
  }

  /** 导航并等页面加载完成。 */
  const navigate = async (url) => {
    await send('Page.navigate', { url })
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  return { send, once, on, evaluate, navigate, errors, close: () => socket.close() }
}

/** 轮询直到表达式返回真值（或超时）。 */
export async function waitFor(session, expression, { timeoutMs = 20_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    last = await session.evaluate(expression)
    if (last) return last
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${expression}\nlast=${JSON.stringify(last)}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
