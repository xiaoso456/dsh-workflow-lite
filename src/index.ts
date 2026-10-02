/**
 * dsh-workflow-lite — host 半。
 *
 * 三件事：把**文件仓储**（单文件 JSON、原子写、写前哈希 + 字段级合并）接到活配置上；
 * 注册**唯一的模型可见工具** `workflow_lite`（14 个 action，没有档位开关）；把**画布 RPC**
 * 挂到共享 Connection 的 `/api` 通道上（只在有 web 的 profile 里挂，缺它不影响工具可用）。
 *
 * 这个插件**不执行任何节点**：它只管理文件、渲染画布、把图编译成一份派发计划，
 * 拿到计划的模型自己决定怎么执行。插件不调度，就没有并发/超时/重试/锁/心跳/恢复。
 * 工作流开了「记录运行状态」时，编译会多建一个工作流实例：进度由主 agent 写进一份 YAML 状态文件，
 * 插件只负责建实例、把它画出来、把用户在画布上的改动写回并通知模型。
 *
 * @module @xiaoso/dsh-workflow-lite
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
// 只借类型：`ctx.tools` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-tools'
import {
  CONFIG_KEYS,
  Config,
  WORKFLOW_LITE_ROW_ID,
  type WorkflowLiteSettings,
} from './host/config.ts'
import { registerWorkflowLiteRpc } from './host/rpc.ts'
import { createNotify } from './host/runs/notice.ts'
import { RunService } from './host/runs/service.ts'
import { registerRunStateSkill, validatorPath } from './host/runs/skill.ts'
import { createRepository, type Repository, reportProblems } from './host/store/repository.ts'
import { registerWorkflowLiteTool } from './host/tool/tool.ts'
import { validateDocument } from './shared/validate.ts'

/** Host 插件名（也是 profile patch 那行的 id）。 */
export const name = WORKFLOW_LITE_ROW_ID

/** 插件的配置声明——Cordis 从入口模块的命名空间上读它。 */
export { Config }

/**
 * 硬依赖只有 `tools`（工具注册是插件的存在理由）。
 *
 * `connection` **刻意不在这里**：画布 RPC 走 `ctx.inject(['connection'])` 的子上下文注册，
 * 这样在没有 web 服务的 profile 里，插件照样只带工具起来，而不是整个 fiber 停在 pending。
 */
export const inject = ['tools']

/**
 * Host 插件体。
 * @param ctx - host 插件上下文。
 * @param config - 解析后的活配置（`Volatile` 引用，写入时就地更新）。
 */
export async function apply(ctx: Context, config: WorkflowLiteSettings): Promise<void> {
  const repository: Repository = createRepository({
    dataDir: config.dataDir.get(),
    // 仓储不认识 Config：`maxNodes` 这类活值由装配方闭包进来。
    validate: (document, workflow) =>
      reportProblems(
        validateDocument(document, {
          workflowName: workflow,
          maxNodes: config.maxNodes.get(),
        }),
      ),
  })

  // 首次启动按需建 `workflows/` 与 `templates/{workflows,nodes}`；**不建 `.dispatch/`**
  // （那是派生物，编译时才出现）。目录不可用只是警告——工具会把它翻成 `invalid_args`。
  const layout = await repository.ensureLayout()
  if (!layout.ok) {
    ctx.logger.warn(`[workflow-lite] 数据目录不可用：${layout.error.message}`)
  }

  // 工作流实例（开了「记录运行状态」的图才用得上）：建实例、读写状态文件、把用户的改动通知给模型。
  const runs = new RunService({
    dataDir: () => config.dataDir.get(),
    validator: validatorPath,
    notify: createNotify(ctx),
  })

  // 按需 skill：状态文件的完整格式与校验脚本。`skills` 服务不在时跳过，计划里的那段照写。
  ctx.inject(['skills'], (skillsCtx) => {
    if (!config.installSkill.get()) return
    skillsCtx.effect(
      () => registerRunStateSkill(skillsCtx),
      'workflow-lite: workflow-run-state skill',
    )
  })

  // 唯一的工具：**始终注册**，没有 `off`/`read`/`readwrite` 那套档位——
  // 装不装这个插件才是开关；要临时限制用 DSH 自己的工具过滤。
  ctx.effect(
    () =>
      registerWorkflowLiteTool(ctx, {
        repository,
        dataDir: () => config.dataDir.get(),
        maxResultBytes: () => config.maxResultBytes.get(),
        runs,
      }),
    'workflow-lite: workflow_lite tool',
  )

  // 画布 RPC：只在 connection 可用时挂。
  ctx.inject(['connection'], (connectionCtx) => {
    registerWorkflowLiteRpc(connectionCtx, {
      repository,
      dataDir: () => config.dataDir.get(),
      limits: () => ({
        maxNodes: config.maxNodes.get(),
        saveDebounceMs: config.saveDebounceMs.get(),
      }),
      runs,
    })
  })
}

/** 六个配置键（文档与测试用）。`dataDir` 改动需要重启——仓储在装配时定住数据根。 */
export { CONFIG_KEYS }
