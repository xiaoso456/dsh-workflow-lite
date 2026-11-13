/**
 * dsh-workflow-lite — 一张触发卡片的触发记录：读回来留一份，换卡片再换回来时先拿留下的显示，不先闪「还没有触发过」。
 *
 * 画布上的面板和工作流中心「触发」页共用。什么时候重读看 `signal`（最近一次触发的编号、它对上的实例、
 * 模型的判断）：和留下的那份一样就不再问。还没读到时是 `null`——界面上什么都不说，读到了再说有几条、或者一条都没有。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useFires
 */

import { useEffect, useRef, useState } from 'react'
import type { FireRecord } from '../../shared/wire/trigger.ts'
import { readCache } from './readCache.ts'

/** 留下的记录不过期（`signal` 自己带着），缓存里的信号用一个常量。 */
const KEPT = 'fires'
const kept = readCache<{ signal: string; fires: FireRecord[] }>({ entries: 64 })

/**
 * @param key - 哪一张卡片（工作流 + 卡片 id）。
 * @param signal - 记录变没变的记号；变了就重读。
 * @param read - 读一次（读不到回空列表）。
 */
export function useFires(
  key: string,
  signal: string,
  read: () => Promise<FireRecord[]>,
): FireRecord[] | null {
  const [state, setState] = useState(() => ({ key, fires: kept.get(key, KEPT)?.fires ?? null }))
  const reader = useRef(read)
  reader.current = read

  useEffect(() => {
    const hit = kept.get(key, KEPT)
    if (hit !== undefined)
      setState((now) =>
        now.key === key && now.fires === hit.fires ? now : { key, fires: hit.fires },
      )
    if (hit?.signal === signal) return
    let alive = true
    void reader.current().then((fires) => {
      if (!alive) return
      kept.put(key, KEPT, { signal, fires })
      setState({ key, fires })
    })
    return () => {
      alive = false
    }
  }, [key, signal])

  // 换了卡片、新的还没读到：先用留下的那份（没有就是 `null`），不拿上一张的冒充。
  return state.key === key ? state.fires : (kept.get(key, KEPT)?.fires ?? null)
}

/** 最近一次触发的记号：编号、对上的实例、模型的判断，任一样变了记录就要重读。 */
export function firesSignal(
  last: { id?: string; instance?: string; declined?: string } | undefined,
): string {
  return `${last?.id ?? ''}|${last?.instance ?? ''}|${last?.declined ?? ''}`
}
