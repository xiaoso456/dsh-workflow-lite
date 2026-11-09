/**
 * dsh-workflow-lite — 两份普通数据（对象、数组、字符串、数字……）内容是否相同，可以跳过某些键。
 *
 * 画布每帧都要判断「这张卡、这条线的对象和上一帧比变了没有」。以前是两边各 `JSON.stringify` 一遍再比字符串，
 * 每次都整份序列化、生成一串新字符串；这里逐项比，遇到第一处不同就停，同一个对象直接算相同。
 * 口径和 JSON 一致：值为 `undefined` 的键等于没有这个键；函数只认同一个（要忽略的回调放进 `skip`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/samePlain
 */

/** `a`、`b` 内容相同吗：`skip` 里的键在任何一层都不比。 */
export function samePlain(a: unknown, b: unknown, skip?: ReadonlySet<string>): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!samePlain(a[i], b[i], skip)) return false
    return true
  }
  if (Array.isArray(b)) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  let shared = 0
  for (const key in x) {
    if (skip?.has(key) === true) continue
    const value = x[key]
    if (value === undefined) continue
    if (!samePlain(value, y[key], skip)) return false
    shared += 1
  }
  // `x` 里有值的键都在 `y` 里对上了；`y` 再多出有值的键就不同。
  for (const key in y) {
    if (skip?.has(key) === true || y[key] === undefined) continue
    shared -= 1
  }
  return shared === 0
}

/**
 * 结构共享：交回 `next` 的内容，但其中和 `prev` 相同的部分（任何一层）换成 `prev` 里的那个对象；
 * 整份都相同就交回 `prev` 本身。轮询读回来的数据每次都是新对象，这样按对象身份记的下游（`useMemo`、
 * 画布的卡片缓存）只在真变了的那一支上重算。只用于 JSON 读回来的普通数据。
 */
export function shareSame<V>(prev: unknown, next: V): V {
  if (Object.is(prev, next)) return next
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) {
    return next
  }
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next
    let same = prev.length === next.length
    const out = next.map((item: unknown, i) => {
      const kept = shareSame(prev[i], item)
      if (kept !== prev[i]) same = false
      return kept
    })
    return (same ? prev : out) as V
  }
  if (Array.isArray(prev)) return next
  const before = prev as Record<string, unknown>
  const after = next as Record<string, unknown>
  const keys = Object.keys(after)
  let same = keys.length === Object.keys(before).length
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const kept = shareSame(before[key], after[key])
    if (kept !== before[key] || !(key in before)) same = false
    out[key] = kept
  }
  return (same ? before : out) as V
}
