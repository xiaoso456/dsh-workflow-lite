/**
 * dsh-workflow-lite — 工作流中心「触发」页的数据：所有工作流里的触发卡片、全部暂停，以及改开关、立即触发、读触发记录。
 *
 * 和画布上的 `useTriggers.ts` 是同一组开关：这里改了，画布那边下一轮轮询就跟上，反过来也一样。
 * 每隔几秒问一次（右栏对话框里要的现场也从这里读，不另起一路轮询）；页面不可见时停下，回来马上补问一次。读回来的内容没变就交回同一个对象。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useTriggerHub
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  FireRecord,
  TriggerActivitySlot,
  TriggerAllResponse,
  TriggerDetailResponse,
  TriggerPingResponse,
  TriggerTryRequest,
  TriggerTryResponse,
} from '../../shared/wire/trigger.ts'
import { shareSame } from '../model/samePlain.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { createOutputAccess, type OutputAccess } from './triggerOutput.ts'
import { useRefresher } from './useRefresher.ts'
import { TRIGGER_POLL_MS, type TriggerChange } from './useTriggers.ts'

export interface TriggerHub {
  /** 还没读到是 `null`。 */
  list: TriggerAllResponse | null
  /** 最近一次读失败的原因；读成功了就清掉。 */
  error: string | null
  /** 马上再读一次（改了图里的卡片之后）。 */
  refresh(): Promise<void>
  /** 改一张卡片的开关、确认命令。改不成回一句原因，改成了回 `null`。 */
  set(workflow: string, node: string, change: TriggerChange): Promise<string | null>
  /** 全部暂停（`true`）或恢复。改不成回一句原因。 */
  pause(paused: boolean): Promise<string | null>
  /** 立即触发一次：回这次的记录；请求本身失败回一句原因。 */
  fire(workflow: string, node: string, info: string): Promise<FireRecord | string>
  /** 一张卡片最近 `limit` 条触发记录，新的在前。 */
  history(workflow: string, node: string, limit: number): Promise<FireRecord[]>
  /** 一张卡片 `since` 以来每一小格各种结果几次；读不到是空的。 */
  activity(workflow: string, node: string, since: number): Promise<TriggerActivitySlot[]>
  /** 一次触发那一刻带的触发说明、背景信息；读不到是空的。 */
  detail(fire: string): Promise<TriggerDetailResponse>
  /** 一个工作流里轮询命令、监听程序最近的输出（同一个工作流回同一个对象）。 */
  output(workflow: string): OutputAccess
  /** 「试运行」还没保存的命令；请求本身失败回一句原因。 */
  tryCommand(request: TriggerTryRequest): Promise<TriggerTryResponse | string>
  /** HTTP 触发「发一条测试请求」；发不了回一句原因。 */
  ping(workflow: string, node: string): Promise<TriggerPingResponse | string>
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
    async (workflow: string, node: string, limit: number): Promise<FireRecord[]> => {
      try {
        return (await rpc.call('trigger/history', { workflow, node, limit })).fires
      } catch {
        return []
      }
    },
    [rpc],
  )

  const activity = useCallback(
    async (workflow: string, node: string, since: number): Promise<TriggerActivitySlot[]> => {
      try {
        return (await rpc.call('trigger/activity', { workflow, node, since })).slots
      } catch {
        return []
      }
    },
    [rpc],
  )

  const detail = useCallback(
    async (fire: string): Promise<TriggerDetailResponse> => {
      try {
        return await rpc.call('trigger/detail', { fire })
      } catch {
        return {}
      }
    },
    [rpc],
  )

  const refresh = useCallback((): Promise<void> => lister.run(undefined), [lister])

  const outputs = useMemo(() => new Map<string, OutputAccess>(), [rpc])
  const output = useCallback(
    (workflow: string): OutputAccess => {
      let access = outputs.get(workflow)
      if (access === undefined) {
        access = createOutputAccess(rpc, workflow)
        outputs.set(workflow, access)
      }
      return access
    },
    [rpc, outputs],
  )

  const tryCommand = useCallback(
    async (request: TriggerTryRequest): Promise<TriggerTryResponse | string> => {
      try {
        return await rpc.call('trigger/try', request)
      } catch (reason) {
        return errorMessage(reason)
      }
    },
    [rpc],
  )

  const ping = useCallback(
    async (workflow: string, node: string): Promise<TriggerPingResponse | string> => {
      try {
        const response = await rpc.call('trigger/ping', { workflow, node })
        // 收下了会马上记进触发记录：最近一次跟着变。
        await lister.run(undefined)
        return response
      } catch (reason) {
        return errorMessage(reason)
      }
    },
    [rpc, lister],
  )

  return useMemo(
    () => ({
      list,
      error,
      refresh,
      set,
      pause,
      fire,
      history,
      activity,
      detail,
      output,
      tryCommand,
      ping,
    }),
    [list, error, refresh, set, pause, fire, history, activity, detail, output, tryCommand, ping],
  )
}
