/**
 * dsh-workflow-lite — 画布看 DSH 里能选的 agent 预设、模型、权限（`host/agents`），以及给刚建好的会话装上模型、设好权限（`host/prepareSession`）。
 *
 * 清单按「会话」记一份，一页里只问一次：工作流设置、触发卡片、「执行」的小箭头都要读它，
 * 模型列表要问各服务商，不该每打开一次都等一趟。失败了不记，下次再问。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/agents
 */

import { useEffect, useState } from 'react'
import { hasSessionChoice, sessionAgent } from '../../shared/sessionChoice.ts'
import type { ModelChoice, SessionAgent, SessionChoice } from '../../shared/types.ts'
import type { ChoiceFallback, HostAgentsResponse } from '../../shared/wire/host.ts'
import { choiceIssues } from '../model/sessionChoice.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'

const cache = new Map<string, Promise<HostAgentsResponse>>()

/** 能选的预设、模型；`session` 是画布所在的会话（拿它试一下这个 DSH 能不能只给一个会话换模型）。 */
export function agentCatalog(
  rpc: WorkflowLiteRpc,
  session: string | undefined,
): Promise<HostAgentsResponse> {
  const key = session ?? ''
  let pending = cache.get(key)
  if (pending === undefined) {
    pending = rpc.call('host/agents', session === undefined ? {} : { session })
    pending.catch(() => cache.delete(key))
    cache.set(key, pending)
  }
  return pending
}

/**
 * 读清单（`read` 换了才重读，调用方要给稳定的函数）；读到之前、读不出来、没给 `read` 都是 `null`
 * （下拉里只列「跟随」和已经设了的那一项）。
 */
export function useAgentCatalog(
  read: (() => Promise<HostAgentsResponse>) | undefined,
): HostAgentsResponse | null {
  const [catalog, setCatalog] = useState<HostAgentsResponse | null>(null)
  useEffect(() => {
    if (read === undefined) return
    let alive = true
    read().then(
      (found) => {
        if (alive) setCatalog(found)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [read])
  return catalog
}

/**
 * 给刚建好、还没发消息的会话装上模型、设好权限；回没用上的那几项。
 * 调用本身出错（插件旧、连接断了）也不挡发消息：当作没装上，照默认发。
 */
export async function prepareSession(
  rpc: WorkflowLiteRpc,
  session: string,
  choice: { model?: ModelChoice; permission?: string },
): Promise<ChoiceFallback[]> {
  const { model, permission } = choice
  if (model === undefined && permission === undefined) return []
  try {
    return (await rpc.call('host/prepareSession', { session, ...choice })).fallbacks
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [
      ...(model === undefined ? [] : [{ kind: 'failed' as const, message }]),
      ...(permission === undefined ? [] : [{ kind: 'permission' as const, permission }]),
    ]
  }
}

/**
 * 「执行」新建会话：带上工作流设的预设建会话（这台机器上用不了就不带、记一条），建好后、发消息前装上模型、设好权限。
 * 回新会话、没用上的那几项、要记进实例来源的那份（什么都没设时没有），和读到的清单（拼提示时写名字用；
 * 没读到是 `null`）。什么都没设时不读清单。
 */
export async function openChosenSession(
  rpc: WorkflowLiteRpc,
  here: string | undefined,
  choice: SessionChoice,
  create: (preset: string | undefined) => Promise<string>,
): Promise<{
  session: string
  fallbacks: ChoiceFallback[]
  agent: SessionAgent | undefined
  catalog: HostAgentsResponse | null
}> {
  const catalog = hasSessionChoice(choice) ? await agentCatalog(rpc, here).catch(() => null) : null
  const fallbacks: ChoiceFallback[] = []
  let preset = choice.preset
  if (preset !== undefined && choiceIssues(catalog, { preset }).length > 0) {
    fallbacks.push({ kind: 'preset', preset })
    preset = undefined
  }
  const session = await create(preset)
  fallbacks.push(
    ...(await prepareSession(rpc, session, {
      ...(choice.model === undefined ? {} : { model: choice.model }),
      ...(choice.permission === undefined ? {} : { permission: choice.permission }),
    })),
  )
  return { session, fallbacks, agent: sessionAgent(choice, fallbacks), catalog }
}
