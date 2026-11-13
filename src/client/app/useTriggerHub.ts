/**
 * dsh-workflow-lite — 工作流中心「触发」页的数据：所有工作流里的触发卡片、全部暂停，以及改开关、立即触发、读触发记录。
 *
 * 和画布上的 `useTriggers.ts` 是同一组开关：这里改了，画布那边下一轮轮询就跟上，反过来也一样。
 * 每隔几秒问一次；页面不可见时停下，回来马上补问一次。读回来的内容没变就交回同一个对象。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useTriggerHub
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FireRecord, TriggerAllResponse } from '../../shared/wire/trigger.ts'
import { shareSame } from '../model/samePlain.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { useRefresher } from './useRefresher.ts'
import { TRIGGER_POLL_MS, type TriggerChange } from './useTriggers.ts'

export interface TriggerHub {
  /** 还没读到是 `null`。 */
  list: TriggerAllResponse | null
  /** 最近一次读失败的原因；读成功了就清掉。 */
  error: string | null
  /** 改一张卡片的开关、确认命令。改不成回一句原因，改成了回 `null`。 */
  set(workflow: string, node: string, change: TriggerChange): Promise<string | null>
  /** 全部暂停（`true`）或恢复。改不成回一句原因。 */
  pause(paused: boolean): Promise<string | null>
  /** 立即触发一次：回这次的记录；请求本身失败回一句原因。 */
  fire(workflow: string, node: string, info: string): Promise<FireRecord | string>
  /** 一张卡片的触发记录，新的在前。 */
  history(workflow: string, node: string): Promise<FireRecord[]>
}

/**
 * @param flush - 编辑页正开着的那张先把没存的改动存下去（开关按磁盘上的图来）。
 */
export function useTriggerHub(rpc: WorkflowLiteRpc, flush: () => Promise<boolean>): TriggerHub {
  const [list, setList] = useState<TriggerAllResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lister = useRefresher(
    {
      fetch: () => rpc.call('trigger/all', {}),
      apply: (result) => {
        setError(null)
        setList((previous) => (previous === null ? result : shareSame(previous, result)))
      },
      fail: (reason) => setError(errorMessage(reason)),
    },
    [rpc],
  )

  useEffect(() => {
    const ask = (): void => {
      if (document.visibilityState !== 'hidden') void lister.run(undefined)
    }
    ask()
    const timer = window.setInterval(ask, TRIGGER_POLL_MS)
    document.addEventListener('visibilitychange', ask)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', ask)
    }
  }, [lister])

  const set = useCallback(
    async (workflow: string, node: string, change: TriggerChange): Promise<string | null> => {
      try {
        await flush()
        await rpc.call('trigger/set', { workflow, node, ...change })
        await lister.run(undefined)
        return null
      } catch (reason) {
        return errorMessage(reason)
      }
    },
    [rpc, flush, lister],
  )

  const pause = useCallback(
    async (paused: boolean): Promise<string | null> => {
      try {
        await rpc.call('trigger/pause', { paused })
        await lister.run(undefined)
        return null
      } catch (reason) {
        return errorMessage(reason)
      }
    },
    [rpc, lister],
  )

  const fire = useCallback(
    async (workflow: string, node: string, info: string): Promise<FireRecord | string> => {
      try {
        await flush()
        const record = await rpc.call('trigger/fire', {
          workflow,
          node,
          ...(info.trim() === '' ? {} : { info }),
        })
        await lister.run(undefined)
        return record
      } catch (reason) {
        return errorMessage(reason)
      }
    },
    [rpc, flush, lister],
  )

  const history = useCallback(
    async (workflow: string, node: string): Promise<FireRecord[]> => {
      try {
        return (await rpc.call('trigger/history', { workflow, node })).fires
      } catch {
        return []
      }
    },
    [rpc],
  )

  return useMemo(
    () => ({ list, error, set, pause, fire, history }),
    [list, error, set, pause, fire, history],
  )
}
