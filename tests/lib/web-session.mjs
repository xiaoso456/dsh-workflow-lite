/**
 * CDP 会话引导（抄自同作者的 task-runner，改成 workflow-lite 的通道）。
 *
 * dsh 0.1.5 起浏览器侧路由都在 Connection 的 `/api` 载波上，而载波要求浏览器会话——
 * 所以脚本先用 `dsh web` 打印的 token 换一次 cookie，Node 侧 RPC 与页面导航共用它。
 *
 * `DSH_WEB_TOKEN` = `dsh web` 打印的 URL 里 `?token=` 的值；`DSH_BASE` 覆盖默认基址。
 */

/** 测试实例基址。 */
export const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3190'

/** 画布 RPC 的通道名。 */
const CHANNEL = 'workflow-lite'

function launchToken() {
  const value = process.env.DSH_WEB_TOKEN
  if (value === undefined || value.length === 0) {
    throw new Error('DSH_WEB_TOKEN is required: copy the ?token= value from the URL dsh web printed')
  }
  return value
}

/**
 * 已经存在的会话 cookie（`name=value`），没给就是 `undefined`。
 *
 * 为什么要这一支：`dsh web` 打印的那个 launch token **有寿命**（实测十几分钟就开始 401），
 * 而一轮验收要跑好几分钟、要发几十次 RPC（每次都要先换一次 cookie）。跑到一半 token
 * 过期，整轮就红了，而这件事与画布一个字节的关系都没有。给了 `DSH_AUTH_COOKIE` 就直接用它，
 * 跳过交换——浏览器里本来就存着同一条 cookie，页面导航也不再带 `?token=`。
 * 没给这个环境变量时行为与从前完全一致。
 */
function launchCookie() {
  const value = process.env.DSH_AUTH_COOKIE
  return value === undefined || value.length === 0 ? undefined : value
}

/**
 * 用 token 换浏览器会话 cookie。
 * @param {string} base - 实例基址。
 * @returns {Promise<string>} `name=value` 形式的 cookie 对。
 */
export async function authCookie(base = BASE) {
  const preset = launchCookie()
  if (preset !== undefined) return preset
  const response = await fetch(`${base}/?token=${encodeURIComponent(launchToken())}`, {
    redirect: 'manual',
  })
  const setCookie =
    response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? undefined
  if (setCookie === undefined) throw new Error(`token exchange failed: HTTP ${response.status}`)
  return setCookie.split(';', 1)[0]
}

/**
 * 一次导航既加载应用又完成鉴权的 URL。
 *
 * 给了 `DSH_AUTH_COOKIE` 就导航到裸基址：浏览器自己会把那条会话 cookie 带上
 *（它本来就是从这台机器上换来的），不再需要 `?token=`。
 * @param base - 实例基址。
 * @returns 页面 URL。
 */
export function authenticatedUrl(base = BASE) {
  if (launchCookie() !== undefined) return `${base}/`
  return `${base}/?token=${encodeURIComponent(launchToken())}`
}

/**
 * 向画布端点发一次已鉴权的 POST。
 * @param {string} method - 端点名，如 `graph/list`。
 * @param {unknown} payload - 端点载荷。
 * @param {string} base - 实例基址。
 * @returns {Promise<unknown>} 端点的成功值。
 */
export async function rpc(method, payload, base = BASE) {
  const cookie = await authCookie(base)
  const wireMethod = `${CHANNEL}/${method}`
  const response = await fetch(`${base}/api/${wireMethod}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `script-${method.replaceAll('/', '-')}-${Date.now()}`,
      method: wireMethod,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status}`)
  const body = await response.json()
  if (body?.result?.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(body)}`)
  return body.result.value
}
