/**
 * dsh-workflow-lite — 工具写入的统一合并规则：新建 = 缺省值 + 给了的，修改 = 现在的 + 给了的。
 *
 * - 没给的（`undefined`）不动；
 * - 对象按字段合并，一层层往下；
 * - 数组、文字、数字、布尔整个换；
 * - `null` 恢复缺省：去掉这一项，由读入时的规范化补回缺省值；
 * - 带 `kind` 的对象（触发方式、定时规则这类几选一的）换了 `kind` 就从空的起，旧类型的字段不带过去。
 *
 * 纯函数，不改入参。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/patch
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把 `patch` 叠到 `current` 上；回 `undefined` 表示这一项去掉（恢复缺省）。 */
export function mergePatch(current: unknown, patch: unknown): unknown {
  if (patch === undefined) return current
  if (patch === null) return undefined
  if (!isPlainObject(patch)) return patch
  const switched = patch.kind !== undefined && isPlainObject(current) && current.kind !== patch.kind
  const out: Record<string, unknown> = isPlainObject(current) && !switched ? { ...current } : {}
  for (const [key, value] of Object.entries(patch)) {
    const next = mergePatch(out[key], value)
    if (next === undefined) delete out[key]
    else out[key] = next
  }
  return out
}
