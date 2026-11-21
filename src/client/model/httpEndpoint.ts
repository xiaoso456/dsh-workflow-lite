/**
 * dsh-workflow-lite — HTTP 触发的地址和令牌：都写在卡片的触发源里（随图保存、导出），这里拼成给人看、给人复制的样子。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/httpEndpoint
 */

import { hookPath } from '../../shared/triggerHttp.ts'
import type { TriggerSource } from '../../shared/types.ts'

/** 一张 HTTP 卡片的地址和令牌。 */
export interface Endpoint {
  /** 别人连的网址（地址里的中文等已转义）。 */
  url: string
  /** `/trigger/` 后面那一段（原样）。 */
  hook: string
  /** 令牌；不校验令牌时也留着（换回「需要」还是它）。 */
  token: string
  /** 不校验令牌：能连到这个地址的程序都能触发。 */
  noToken: boolean
}

/**
 * 触发源里的地址和令牌拼成网址；不是 HTTP、还没有地址或令牌时是 `undefined`。
 * @param origin - `http://地址:端口`（宿主按监听设置给的）。
 */
export function endpointOf(source: TriggerSource, origin: string): Endpoint | undefined {
  if (source.kind !== 'http' || source.hook === undefined || source.token === undefined) {
    return undefined
  }
  return {
    url: `${origin}${hookPath(source.hook)}`,
    hook: source.hook,
    token: source.token,
    noToken: source.noToken === true,
  }
}

/** 一个随机令牌（24 个随机字节，base64url，和宿主生成的一样长）。 */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}
