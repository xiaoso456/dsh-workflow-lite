/**
 * dsh-workflow-lite — 组件里用的刷新器（见 `refresher.ts`）：依赖变了换一个新的，旧的关掉，
 * 它路上的结果不会落到新依赖的界面上（换了实例时上一个实例的读取回来就丢掉）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRefresher
 */

import { type DependencyList, useEffect, useMemo } from 'react'
import { type Refresher, type RefresherSpec, refresher } from './refresher.ts'

export function useRefresher<A, T>(spec: RefresherSpec<A, T>, deps: DependencyList): Refresher<A> {
  // 依赖由调用方给：`spec` 每次渲染都是新对象，按它重建就每次渲染都换一条队。
  const current = useMemo(() => refresher(spec), deps)
  useEffect(() => {
    current.open()
    return () => current.close()
  }, [current])
  return current
}
