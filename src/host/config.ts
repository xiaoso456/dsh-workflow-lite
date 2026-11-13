/**
 * dsh-workflow-lite — 配置面。
 *
 * 八个键，默认值全部写在 schema 里（**不硬编码在代码里**）。字段类型是
 * `Volatile`：设置表单投影的正是这些字段，写入落进当前 profile 的 Cordis patch，
 * 运行中的插件读的是**活引用**——一次配置写入就地更新它，不重挂插件。
 *
 * 部署相关的取值一律走这里：`dataDir`（数据根）、`maxNodes`、`maxResultBytes`
 * （单次返回字节上限）、`saveDebounceMs`、`routePrefix`、`installSkill`、`triggerPort` / `triggerHost`（HTTP 触发的端口与监听地址）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'

/** 插件在 profile 里的那一行的 id（`cordis.patch.yml` 的 `insert.id`）。 */
export const WORKFLOW_LITE_ROW_ID = 'workflow-lite'

/** 解析后的活配置。 */
export interface WorkflowLiteSettings {
  /** 数据根目录。`workflows/`、`templates/` 与 `.dispatch/` 都在它下面。 */
  dataDir: Volatile<string>
  /** 画布改动落盘的防抖毫秒数。**拖动过程中不写盘，指针停稳后才写一次。** */
  saveDebounceMs: Volatile<number>
  /** 单图节点数上限。超出：落盘允许、自动布局不跑、**编译挡住**。 */
  maxNodes: Volatile<number>
  /** 单次工具 / RPC 返回的字节上限。超限**报错而不截断**。 */
  maxResultBytes: Volatile<number>
  /** 画布 ↔ host 的同源路由前缀。插件不自开端口。 */
  routePrefix: Volatile<string>
  /**
   * 是否随插件注册按需 skill `workflow-authoring`（设计图）、`workflow-run-state`（运行状态）、
   * `workflow-board`（看板）与 `workflow-trigger`（触发卡片）。
   */
  installSkill: Volatile<boolean>
  /**
   * HTTP 触发卡片用的端口。没有开着的 HTTP 触发卡片时不开；改了下一轮（几秒内）换过去。
   * 这是插件**唯一**自己开的端口，画布仍走 DSH 的同源路由。
   */
  triggerPort: Volatile<number>
  /**
   * HTTP 触发的监听地址：`127.0.0.1`（缺省，只本机）、`0.0.0.0`（所有网卡）或某块网卡的 IPv4 地址。
   * 不是本机时请求是明文 HTTP，令牌在网上能被看到，只该用在信得过的网络里或放在 HTTPS 代理后面。
   */
  triggerHost: Volatile<string>
}

/**
 * 运行期 schema。字段一律 `volatile()`（只有这类字段设置表单才能编辑），
 * 并且都带**约束**——配错了要响亮失败，不要静默取一个坏值。
 */
export const Config = z.object({
  dataDir: z.string().default(dshHomePath('workflow-lite')).volatile(),
  saveDebounceMs: z.number().min(0).default(400).volatile(),
  maxNodes: z.number().min(1).default(400).volatile(),
  maxResultBytes: z.number().min(1024).default(262_144).volatile(),
  routePrefix: z.string().pattern(/^\//u).default('/workflow-lite').volatile(),
  installSkill: z.boolean().default(true).volatile(),
  triggerPort: z.number().min(1024).max(65535).default(3791).volatile(),
  triggerHost: z
    .string()
    .pattern(/^\d{1,3}(?:\.\d{1,3}){3}$/u)
    .default('127.0.0.1')
    .volatile(),
})

/** 八个键的名字（测试与文档用，避免两处各写一遍）。 */
export const CONFIG_KEYS = [
  'dataDir',
  'saveDebounceMs',
  'maxNodes',
  'maxResultBytes',
  'routePrefix',
  'installSkill',
  'triggerPort',
  'triggerHost',
] as const
