/**
 * dsh-workflow-lite — 列表里「改过名的行」沿用旧键。
 *
 * 行用名字当 React 的键（和动画的键）：改了名就成了新的一项，会被当成新挂上的、把入场动画再放一遍
 * （改完名字闪一下）。这里记「新名字 → 旧键」，改名的那一行仍是同一个元素：原位换回文字、顺着新排位滑过去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/rowKeys
 */

/** 新名字 → 这一行一直在用的键。 */
export type RowKeys = Map<string, string>

/**
 * 改名之前先记：目录一更新这一行就要拿新名字渲染，那时键已经得是旧的。
 * 返回有没有记（改名没成功时用 {@link forgetRowKey} 撤掉）。撞了现有名字的不记——重名那张已经有自己的键。
 */
export function claimRowKey(
  keys: RowKeys,
  names: readonly string[],
  from: string,
  to: string,
): boolean {
  const next = to.trim()
  if (next === '' || next === from || names.includes(next)) return false
  keys.set(next, keys.get(from) ?? from)
  return true
}

export function forgetRowKey(keys: RowKeys, to: string): void {
  keys.delete(to.trim())
}

/** 第 `index` 个名字的键：改过名的沿用旧键；万一和前面的撞了（旧名字又被新项占了），退回按名字。 */
export function rowKey(keys: RowKeys, names: readonly string[], index: number): string {
  const name = names[index]
  if (name === undefined) return ''
  const key = keys.get(name) ?? name
  for (let before = 0; before < index; before++) {
    const other = names[before]
    if (other !== undefined && (keys.get(other) ?? other) === key) return `${key}::${name}`
  }
  return key
}
