/**
 * dsh-workflow-lite — host 半。
 *
 * 三件事：把**文件仓储**（单文件 JSON、原子写、写前哈希 + 字段级合并）接到活配置上；
 * 注册**唯一的模型可见工具** `workflow_lite`（19 个 action，没有档位开关）；把**画布 RPC**
 * 挂到共享 Connection 的 `/api` 通道上（只在有 web 的 profile 里挂，缺它不影响工具可用）。
 *
 * 这个插件**不执行任何节点**：它只管理文件、渲染画布、把图编译成一份派发计划，
 * 拿到计划的模型自己决定怎么执行。插件不调度，就没有并发/超时/重试/锁/心跳/恢复。
 * 每次执行都是一个工作流实例：图的快照 + 工作区里的实例目录（任务描述、默认产出）。开了「记录运行状态」
 * 的图还带一份状态：主 agent 经工具的 `state` 动作记进度，用户在画布上看、改，改动通知回模型。
 *
 * @module @xiaoso/dsh-workflow-lite
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
// 只借类型：`ctx.settings` 的 Context 合并（服务本身是可选的）。
import type {} from '@deepseek-ai/dsh-settings'
// 只借类型：`ctx.tools` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-tools'
import { registerAuthoringSkill } from './host/authoringSkill.ts'
import { registerBoardSkill } from './host/boardSkill.ts'
import {
  CONFIG_KEYS,
  Config,
  WORKFLOW_LITE_ROW_ID,
  type WorkflowLiteSettings,
} from './host/config.ts'
import type { SkillLister } from './host/hostFs.ts'
import type { SettingsPort } from './host/pluginConfig.ts'
import { registerWorkflowLiteRpc } from './host/rpc.ts'
import { createNotify } from './host/runs/notice.ts'
import { RunService } from './host/runs/service.ts'
import { registerRunStateSkill } from './host/runs/skill.ts'
import { createSkillViewer } from './host/skillView.ts'
import { DATABASE_FILE, PluginDatabase } from './host/store/database.ts'
import { memoryMetaFile } from './host/store/paths.ts'
import { createRepository, type Repository, reportProblems } from './host/store/repository.ts'
import { registerWorkflowLiteTool } from './host/tool/tool.ts'
import { registerTriggerSkill } from './host/triggerSkill.ts'
import { createFireClaims } from './host/triggers/claims.ts'
import { createTriggerGraphs, followWorkflows } from './host/triggers/graphs.ts'
import { TriggerService } from './host/triggers/service.ts'
import { createSessionPort } from './host/triggers/sessions.ts'
import { TriggerStore } from './host/triggers/store.ts'
import { pluginVersion } from './host/version.ts'
import type { WorkflowDocument } from './shared/types.ts'
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
  // 仓储不认识 Config：`maxNodes` 这类活值由装配方闭包进来。
  // 数据根在装配时定住：仓储、实例、工具、画布都用这同一个，改了设置要重启才换（设置页会这么说）。
  // 要是各处各读活值，改到一半就会出现「图在旧目录、实例在新目录」。
  const dataDirAtStart = config.dataDir.get()
  const validate = (document: WorkflowDocument, workflow: string) =>
    reportProblems(
      validateDocument(document, {
        workflowName: workflow,
        maxNodes: config.maxNodes.get(),
        // 记忆卡引用的不在库里：给警告（id 已经过了名字规矩，拼不出别处的路径）。
        hasMemory: (id) => existsSync(memoryMetaFile(dataDirAtStart, id)),
      }),
    )
  const dataDir = (): string => dataDirAtStart
  // 插件共用的 SQLite 数据库（各功能自己建表；第一次用到时才打开），插件停下时关掉。
  const database = new PluginDatabase(() => join(dataDirAtStart, DATABASE_FILE))
  ctx.effect(() => () => database.close(), 'workflow-lite: database')
  // 触发卡片在这台机器上的状态（开关、工作区、触发记录）；工作流改名时跟着走。
  const triggerStore = new TriggerStore(dataDir, database)
  const repository: Repository = followWorkflows(
    createRepository({ dataDir: dataDirAtStart, validate }),
    triggerStore,
  )

  // 首次启动按需建 `workflows/` 与 `templates/nodes/`；**不建 `.dispatch/`**
  // （那是派生物，编译时才出现）。目录不可用只是警告——工具会把它翻成 `invalid_args`。
  const layout = await repository.ensureLayout()
  if (!layout.ok) {
    ctx.logger.warn(`[workflow-lite] 数据目录不可用：${layout.error.message}`)
  }

  // 工作流实例：建实例、出计划、读写运行状态、把用户的改动通知给模型。
  const runs = new RunService({
    dataDir,
    validate,
    notify: createNotify(ctx),
    origins: createFireClaims(triggerStore),
  })

  // 触发卡片：到点、条件满足、收到通知时在会话里发起一次执行。
  // 同一个数据目录只有一个 DSH 进程负责（命令、端口都在它那里），它退出后别的接手。
  // 进会话（新建、发消息、预设与模型）：触发器和画布「执行」共用这一个。
  const sessions = createSessionPort(ctx)
  const triggers = new TriggerService({
    dataDir,
    store: triggerStore,
    graphs: createTriggerGraphs(repository),
    sessions,
    listen: () => ({ host: config.triggerHost.get(), port: config.triggerPort.get() }),
    defaultShell: () => config.triggerShell.get(),
    outputLines: () => config.triggerOutputLines.get(),
    runs,
    warn: (message) => ctx.logger.warn(`[workflow-lite] ${message}`),
  })
  ctx.effect(() => triggers.start(), 'workflow-lite: triggers')

  // 按需 skill：怎么设计一张图（workflow-authoring），运行状态的字段与 `state` 动作的用法（workflow-run-state），
  // 画布上的看板怎么写（workflow-board），触发卡片和触发脚本怎么写（workflow-trigger）。
  // `skills` 服务不在时跳过，计划里的那段照写。
  // 顺手记下 skill 服务：画布上给资源选 Skill 时列出会话里的 agent 能用的那些（见 host/skillView）。
  let skills: SkillLister | undefined
  ctx.inject(['skills'], (skillsCtx) => {
    skills = skillsCtx.skills
    skillsCtx.effect(
      () => () => {
        skills = undefined
      },
      'workflow-lite: skill catalog',
    )
    if (!config.installSkill.get()) return
    skillsCtx.effect(
      () => registerAuthoringSkill(skillsCtx),
      'workflow-lite: workflow-authoring skill',
    )
    skillsCtx.effect(
      () => registerRunStateSkill(skillsCtx),
      'workflow-lite: workflow-run-state skill',
    )
    skillsCtx.effect(() => registerBoardSkill(skillsCtx), 'workflow-lite: workflow-board skill')
    skillsCtx.effect(() => {
      const registered = registerTriggerSkill(skillsCtx)
      if (typeof registered === 'function') return registered
      ctx.logger.warn(`[workflow-lite] ${registered}`)
      return () => {}
    }, 'workflow-lite: workflow-trigger skill')
  })

  // 唯一的工具：**始终注册**，没有 `off`/`read`/`readwrite` 那套档位——
  // 装不装这个插件才是开关；要临时限制用 DSH 自己的工具过滤。
  ctx.effect(
    () =>
      registerWorkflowLiteTool(ctx, {
        repository,
        dataDir,
        maxResultBytes: () => config.maxResultBytes.get(),
        runs,
        triggers,
      }),
    'workflow-lite: workflow_lite tool',
  )

  // DSH 的设置服务（可选）：工作流中心「设置」页经它读写本插件那一行配置。
  // 这个插件有自己的设置页，所以告诉它别再按 schema 自动生成一页。
  let settings: SettingsPort | undefined
  ctx.inject(['settings'], (settingsCtx) => {
    settings = settingsCtx.settings
    settingsCtx.effect(
      () => () => {
        settings = undefined
      },
      'workflow-lite: settings forms',
    )
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'workflow-lite: own settings page',
    )
  })
  const liveConfig = () => ({
    dataDir: config.dataDir.get(),
    maxNodes: config.maxNodes.get(),
    saveDebounceMs: config.saveDebounceMs.get(),
    maxResultBytes: config.maxResultBytes.get(),
    installSkill: config.installSkill.get(),
    triggerPort: config.triggerPort.get(),
    triggerHost: config.triggerHost.get(),
    triggerShell: config.triggerShell.get(),
    triggerOutputLines: config.triggerOutputLines.get(),
  })

  // 画布 RPC：只在 connection 可用时挂。
  ctx.inject(['connection'], (connectionCtx) => {
    registerWorkflowLiteRpc(connectionCtx, {
      repository,
      dataDir,
      limits: () => ({
        maxNodes: config.maxNodes.get(),
        saveDebounceMs: config.saveDebounceMs.get(),
      }),
      runs,
      triggers,
      sessions,
      skills: createSkillViewer(ctx, () => skills),
      config: { port: () => settings, live: liveConfig },
      // 导入的 skill 装进各家 agent 通用的那个目录（DSH 也从这里发现 skill）。
      pack: {
        skillsRoot: join(homedir(), '.agents', 'skills'),
        plugin: pluginVersion(),
        validate,
      },
    })
  })
}

/** 七个配置键（文档与测试用）。`dataDir` 改动需要重启——仓储在装配时定住数据根。 */
export { CONFIG_KEYS }
