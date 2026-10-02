/**
 * dsh-workflow-lite — 浏览器半。
 *
 * 把工作流视图挂到会话页的 tab 上（`conversation.view` 槽位），并接上共享 Connection 的
 * `/api` 通道。UI 文案走本插件的 locale 词典（`workflow-lite`）。
 *
 * tab 的显示名用 **thunk**：槽位每次读取时重新求值，所以切语言不用重新注册。
 *
 * @module @xiaoso/dsh-workflow-lite/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 只借类型：把客户端 Context 上对应的服务与槽位声明合并进来（运行时会被擦除）。
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createDesktop, type SessionRemote } from './app/desktop.ts'
import {
  type ConversationService,
  createSessionBridge,
  type SessionsService,
  type UiWorkspaceService,
  type WorkspacesService,
} from './app/sessions.ts'
import { en, NS, zh } from './i18n.ts'
import { createWorkflowLiteRpc, requireRpcCarrier } from './rpc.ts'
import { WorkflowView, type WorkflowViewInjected } from './ui/WorkflowView.tsx'

/** 视图需要的三个客户端服务。 */
export const inject = ['slots', 'locale', 'connection']

/**
 * 挂载视图。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  // e2e 探针：验收脚本据此确认客户端半真的加载并执行了（无断言、无副作用）。
  Object.assign(globalThis, { __WORKFLOW_LITE__: NS })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workflow-lite: dictionaries')

  const rpc = createWorkflowLiteRpc(requireRpcCarrier(ctx.get('connection')))

  // 「执行」要的会话列表与发消息：两个服务可选，接上了才能用（缺了视图照常，只是「执行」灰掉）。
  const sessions = createSessionBridge()
  ctx.inject(['sessions', 'conversation'], (sub) => {
    sessions.attach(
      sub.get('sessions') as unknown as SessionsService,
      sub.get('conversation') as unknown as ConversationService,
    )
    sub.effect(() => () => sessions.detach(), 'workflow-lite: session bridge')
  })
  // 「新建会话执行」要知道本会话在哪个工作区，执行完跳到那个会话：两个服务同样可选。
  ctx.inject(['workspaces', 'uiWorkspace'], (sub) => {
    sessions.attachWorkspaces(
      sub.get('workspaces') as unknown as WorkspacesService | undefined,
      sub.get('uiWorkspace') as unknown as UiWorkspaceService | undefined,
    )
    sub.effect(
      () => () => sessions.attachWorkspaces(undefined, undefined),
      'workflow-lite: workspace navigation',
    )
  })

  // 「用其他程序打开」产出文件：借宿主的 Session Remote，可选。
  const desktop = createDesktop()
  ctx.inject(['remote', 'remote.session'], (sub) => {
    const remote = sub.get('remote') as unknown as { session?: SessionRemote } | undefined
    if (remote?.session === undefined) return
    desktop.attach(remote.session)
    sub.effect(() => () => desktop.detach(), 'workflow-lite: desktop bridge')
  })

  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'workflow-lite',
        order: 20,
        label: () =>
          ctx.locale.getLocale().active.startsWith('zh') ? zh['tab.label'] : en['tab.label'],
        locale: NS,
        // 会话页的 tab 拿得到当前会话：工作流实例按会话归属（打开 tab 时默认显示本会话的当前实例）。
        inject: (sessionId): WorkflowViewInjected => ({
          rpc,
          sessionId: String(sessionId),
          sessions,
          desktop,
        }),
      },
      WorkflowView,
    ),
  )
}
