/**
 * dsh-workflow-lite — 触发卡片的状态：每隔几秒问一次这个工作流里各张卡片现在的样子，
 * 以及「重新启用」、「立即触发一次」、读触发记录和最近的输出、试运行命令与 HTTP 测试请求、HTTP 的缺省地址和令牌。
 * 开关和设置都在图里，由调用方改图（见 `ui/trigger/triggerEnv.ts` 的 `patch`）。
 *
 * 只在图里有触发卡片时才问（没有就一次都不发）；页面不可见时停下，回来马上补问一次。
 * 读回来的内容没变就交回同一个对象，画布上的卡片不会跟着每次轮询重画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useTriggers
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { idKey } from '../../shared/model.ts'
import type {
  FireRecord,
  TriggerDetailResponse,
  TriggerEndpointResponse,
  TriggerListResponse,
  TriggerOwner,
  TriggerPingResponse,
  TriggerTryRequest,
  TriggerTryResponse,
  TriggerView,
} from '../../shared/wire/trigger.ts'
import { shareSame } from '../model/samePlain.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { createOutputAccess, type OutputAccess } from './triggerOutput.ts'
import { useRefresher } from './useRefresher.ts'

/** 多久问一次。 */
export const TRIGGER_POLL_MS = 5000

export interface Triggers {
  /** 一张卡片现在的样子；还没读到（或卡片还没保存）是 `undefined`。 */
  view(node: string): TriggerView | undefined
  /** 现在由哪个 DSH 进程负责触发。 */
  owner: TriggerOwner | undefined
  /** HTTP 触发别人连的网址开头（`http://地址:端口`）；还没读到是空串。 */
  hookOrigin: string
  /** 「重新启用」自动停用了的卡片。做不了回一句原因。 */
  reopen(node: string): Promise<string | null>
  /** HTTP 触发：一个没被用的地址和一个随机令牌（连同已经被用了的地址）；问不到回一句原因。 */
  endpoint(node: string): Promise<TriggerEndpointResponse | string>
  /** 立即触发一次：回这次的记录；请求本身失败回一句原因。 */
  fire(node: string, info?: string): Promise<FireRecord | string>
  /** 这张卡片最近 `limit` 条触发记录，新的在前。 */
  history(node: string, limit: number): Promise<FireRecord[]>
  /** 一次触发那一刻带的触发说明、背景信息；读不到是空的。 */
  detail(fire: string): Promise<TriggerDetailResponse>
  /** 取消排着的一次（记成跳过）。取消不了回一句原因。 */
  cancel(fire: string): Promise<string | null>
  /** 把这张卡片上一次发起的执行视为已结束（跳过的照常触发、排着的放行下一个）。做不了回一句原因。 */
  waive(node: string): Promise<string | null>
  /** 定时检查命令、监听程序最近的输出。 */
  output: OutputAccess
  /** 「试运行」还没保存的命令；请求本身失败回一句原因。 */
  tryCommand(request: Omit<TriggerTryRequest, 'workflow'>): Promise<TriggerTryResponse | string>
  /** HTTP 触发「发一条测试请求」；发不了回一句原因。 */
  ping(node: string): Promise<TriggerPingResponse | string>
}

const EMPTY: TriggerListResponse = { triggers: [], hookOrigin: '' }

/**
 * @param workflow - 正在编辑的工作流；`null` = 没打开。
 * @param active - 图里有没有触发卡片（没有就不问）。
 * @param flush - 把没存的改动先存下去（开关、触发都按磁盘上的图来）。
 * @param revision - 磁盘上这张图的版本记号：变了（刚存过盘）就马上再问一次，卡片上的下一次跟着新规则走。
 */
export function useTriggers(
  rpc: WorkflowLiteRpc,
  workflow: string | null,
  active: boolean,
  flush: () => Promise<boolean>,
  revision: string | null,
): Triggers {
  const [list, setList] = useState<TriggerListResponse>(EMPTY)

  const lister = useRefresher(
    {
      fetch: (name: string) => rpc.call('trigger/list', { workflow: name }),
      apply: (result) => setList((previous) => shareSame(previous, result)),
      // 读不到就留着上一次的样子：下一轮再问。
      fail: () => {},
    },
    // 换了工作流：上一个路上的结果丢掉。
    [rpc, workflow],
  )

  useEffect(() => {
    setList(EMPTY)
  }, [workflow])

  useEffect(() => {
    if (workflow === null || !active) return
    const ask = (): void => {
      if (document.visibilityState !== 'hidden') void lister.run(workflow)
    }
    ask()
    const timer = window.setInterval(ask, TRIGGER_POLL_MS)
    document.addEventListener('visibilitychange', ask)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', ask)
    }
    // `revision` 不在函数体里用：它一变就重来一遍，等于马上再问一次。
  }, [lister, workflow, active, revision])

  const views = useMemo(
    () => new Map(list.triggers.map((trigger) => [idKey(trigger.node), trigger])),
    [list.triggers],
  )
  const view = useCallback((node: string) => views.get(idKey(node)), [views])

  const reopen = useCallback(
    async (node: string): Promise<string | null> => {
      if (workflow === null) return null
      try {
        const result = await rpc.call('trigger/reopen', { workflow, node })
        setList((previous) => shareSame(previous, result))
        return null
      } catch (error) {
        return errorMessage(error)
      }
    },
    [rpc, workflow],
  )

  const endpoint = useCallback(
    async (node: string): Promise<TriggerEndpointResponse | string> => {
      if (workflow === null) return ''
      try {
        return await rpc.call('trigger/endpoint', { workflow, node })
      } catch (error) {
        return errorMessage(error)
      }
    },
    [rpc, workflow],
  )

  const fire = useCallback(
    async (node: string, info?: string): Promise<FireRecord | string> => {
      if (workflow === null) return ''
      try {
        await flush()
        const record = await rpc.call('trigger/fire', {
          workflow,
          node,
          ...(info === undefined || info.trim() === '' ? {} : { info }),
        })
        await lister.run(workflow)
        return record
      } catch (error) {
        return errorMessage(error)
      }
    },
    [rpc, workflow, flush, lister],
  )

  const history = useCallback(
    async (node: string, limit: number): Promise<FireRecord[]> => {
      if (workflow === null) return []
      try {
        return (await rpc.call('trigger/history', { workflow, node, limit })).fires
      } catch {
        return []
      }
    },
    [rpc, workflow],
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

  const cancel = useCallback(
    async (fire: string): Promise<string | null> => {
      try {
        await rpc.call('trigger/cancel', { fire })
        if (workflow !== null) await lister.run(workflow)
        return null
      } catch (error) {
        return errorMessage(error)
      }
    },
    [rpc, workflow, lister],
  )

  const waive = useCallback(
    async (node: string): Promise<string | null> => {
      if (workflow === null) return null
      try {
        await rpc.call('trigger/waive', { workflow, node })
        await lister.run(workflow)
        return null
      } catch (error) {
        return errorMessage(error)
      }
    },
    [rpc, workflow, lister],
  )

  const output = useMemo(() => createOutputAccess(rpc, workflow), [rpc, workflow])

  const tryCommand = useCallback(
    async (request: Omit<TriggerTryRequest, 'workflow'>): Promise<TriggerTryResponse | string> => {
      if (workflow === null) return ''
      try {
        return await rpc.call('trigger/try', { workflow, ...request })
      } catch (error) {
        return errorMessage(error)
      }
    },
    [rpc, workflow],
  )

  const ping = useCallback(
    async (node: string): Promise<TriggerPingResponse | string> => {
      if (workflow === null) return ''
      try {
        const response = await rpc.call('trigger/ping', { workflow, node })
        // 收下了会马上记进触发记录：卡片上的「最近一次」跟着变。
        await lister.run(workflow)
        return response
      } catch (error) {
        return errorMessage(error)
      }
    },
    [rpc, workflow, lister],
  )

  return useMemo(
    () => ({
      view,
      owner: list.owner,
      hookOrigin: list.hookOrigin,
      reopen,
      endpoint,
      fire,
      history,
      detail,
      cancel,
      waive,
      output,
      tryCommand,
      ping,
    }),
    [
      view,
      list.owner,
      list.hookOrigin,
      reopen,
      endpoint,
      fire,
      history,
      detail,
      cancel,
      waive,
      output,
      tryCommand,
      ping,
    ],
  )
}
