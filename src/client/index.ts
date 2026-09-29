/**
 * dsh-workflow-lite — 浏览器半。
 *
 * 把画布挂到会话页的 tab 上（`conversation.view` 槽位），并接上共享 Connection 的
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
import { CanvasView, type CanvasViewInjected } from './components/CanvasView.tsx'
import { en, NS, zh } from './core/locales.ts'
import { createWorkflowLiteRpc, requireRpcCarrier } from './core/rpc.ts'

/** 画布需要的三个客户端服务。 */
export const inject = ['slots', 'locale', 'connection']

/**
 * 挂载画布。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  // e2e 探针：CDP 验收脚本据此确认客户端半真的加载并执行了（无断言、无副作用）。
  Object.assign(globalThis, { __WORKFLOW_LITE__: NS })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workflow-lite: dictionaries')

  const rpc = createWorkflowLiteRpc(requireRpcCarrier(ctx.get('connection')))

  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'workflow-lite',
        order: 20,
        // thunk：按活跃 locale 求值，切语言不用重新注册。
        label: () =>
          ctx.locale.getLocale().active.startsWith('zh') ? zh['tab.label'] : en['tab.label'],
        locale: NS,
        inject: (): CanvasViewInjected => ({ rpc }),
      },
      CanvasView,
    ),
  )
}
