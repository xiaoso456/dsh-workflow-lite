/**
 * dsh-workflow-lite — HTTP 触发的地址与令牌、监听地址怎么写才算数（宿主和画布共用）。
 *
 * - 地址是 `/trigger/<这一段>`：字母（含中文等各国文字）、数字、`-`、`_`，最长 64 个字；
 *   新卡片缺省用工作流名（别的字换成 `-`），重了接 `-2`、`-3`。早先随机生成的地址照样能用。
 * - 令牌至少 16 个字，只用字母、数字和 `-` `_` `.` `~`（放进请求头、查询串都不用转义）。
 * - 监听地址：`127.0.0.1`（只本机）、`0.0.0.0`（所有网卡）或本机某块网卡的 IPv4 地址。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/triggerHttp
 */

export const HOOK_MAX_LENGTH = 64
export const TOKEN_MIN_LENGTH = 16
export const TOKEN_MAX_LENGTH = 256

/** 只本机、所有网卡这两个监听地址。 */
export const LOCAL_HOST = '127.0.0.1'
export const ANY_HOST = '0.0.0.0'

const HOOK_CHARS = /^[\p{L}\p{M}\p{N}_-]+$/u
const TOKEN_CHARS = /^[A-Za-z0-9._~-]+$/u

export type HookIssue = 'empty' | 'chars' | 'long'
export type TokenIssue = 'short' | 'chars' | 'long'

/** 地址这一段哪里不对；能用是 `null`。 */
export function hookIssue(hook: string): HookIssue | null {
  if (hook === '') return 'empty'
  if ([...hook].length > HOOK_MAX_LENGTH) return 'long'
  return HOOK_CHARS.test(hook) ? null : 'chars'
}

/** 令牌哪里不对；能用是 `null`。 */
export function tokenIssue(token: string): TokenIssue | null {
  if (token.length < TOKEN_MIN_LENGTH) return 'short'
  if (token.length > TOKEN_MAX_LENGTH) return 'long'
  return TOKEN_CHARS.test(token) ? null : 'chars'
}

/**
 * 从工作流名拼一个缺省地址：别的字换成 `-`，重了接 `-2`、`-3`……
 * @param taken - 已经被占的地址（所有工作流的 HTTP 卡片）。
 * @returns 拼不出来（名字里没有能用的字）时是 `undefined`，调用方退回随机的。
 */
export function hookFromName(name: string, taken: ReadonlySet<string>): string | undefined {
  const base = [
    ...name
      .normalize('NFC')
      .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
      .replace(/-{2,}/gu, '-')
      .replace(/^-|-$/gu, ''),
  ]
    .slice(0, HOOK_MAX_LENGTH - 4)
    .join('')
  if (base === '' || hookIssue(base) !== null) return undefined
  if (!taken.has(base)) return base
  for (let index = 2; index < 1000; index += 1) {
    const next = `${base}-${String(index)}`
    if (!taken.has(next)) return next
  }
  return undefined
}

/** 是不是一个能写进设置的监听地址（IPv4 点分十进制；网卡在不在由宿主开端口时说）。 */
export function isListenHost(value: string): boolean {
  const parts = value.split('.')
  return (
    parts.length === 4 &&
    parts.every((part) => /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) <= 255)
  )
}

/** 监听地址是不是只有本机连得上（127.x.x.x）。 */
export function isLoopbackHost(value: string): boolean {
  return value.startsWith('127.')
}

/** 网址里 `/trigger/` 后面那一段的写法（中文等按 UTF-8 转义）。 */
export function hookPath(hook: string): string {
  return `/trigger/${encodeURIComponent(hook)}`
}
