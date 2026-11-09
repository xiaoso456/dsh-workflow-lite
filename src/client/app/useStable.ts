/**
 * dsh-workflow-lite — 「判成一样就沿用上一份」：配 `model/docShape.ts` 的判断，让下游按对象身份记的 `useMemo` 不重算。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useStable
 */

import { useRef } from 'react'

/**
 * `same(上一份, 这一份)` 为真就交回上一份，否则换成这一份。只是缓存：渲染被丢弃时多算一次，结果不会错。
 * `null` 原样交回（还没读到文档的时候）。
 */
export function useStable<V extends object>(value: V, same: (a: V, b: V) => boolean): V
export function useStable<V extends object>(
  value: V | null,
  same: (a: V, b: V) => boolean,
): V | null
export function useStable<V extends object>(
  value: V | null,
  same: (a: V, b: V) => boolean,
): V | null {
  const kept = useRef(value)
  const last = kept.current
  if (value === null || last === null || (last !== value && !same(last, value)))
    kept.current = value
  return kept.current
}
