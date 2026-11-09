/**
 * dsh-workflow-lite — RPC 分派共用的东西：活依赖、结果构造、入参读取。
 *
 * 入参一律**从原始记录里逐字段读**（不做类型断言）；图文档走 `normalizeDocument`
 * 做形状归一，坏形状在这里就被挡成 `invalid_args`，不会渗进仓储。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/shared
 */

import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type { SkillViewer } from '../hostFs.ts'
import type { LiveValues, SettingsPort } from '../pluginConfig.ts'
import type { RunService } from '../runs/service.ts'
import type { DocumentValidator } from '../store/repoCore.ts'
import type { Repository } from '../store/repository.ts'

/** 路由需要的活依赖。 */
export interface RpcDeps {
  repository: Repository
  dataDir: () => string
  /** 画布要用的两个活配置值（`graph/list` 一并回给它，见 `GraphListResponse`）。 */
  limits: () => { maxNodes: number; saveDebounceMs: number }
  /** 工作流实例（`run/*`）。 */
  runs: RunService
  /** 看 DSH 的 skill（选 Skill、预览 SKILL.md 用）；没给就当没装 skill 服务。 */
  skills?: SkillViewer
  /** 「设置」页：DSH 的设置服务（不在时回 `undefined`，页面只读）与活配置的现值。 */
  config: { port: () => SettingsPort | undefined; live: LiveValues }
  /** 导入导出：skill 装到哪（`~/.agents/skills`）、插件版本（写进清单）、文档级校验（导出成 skill 时用）。 */
  pack: { skillsRoot: string; plugin: string; validate?: DocumentValidator }
}

export type RpcResult<T> = ConnectionRpcResult<T>

/** 仓储 / 校验层回告的错误形状（`detail` 是可选的结构化补充）。 */
export interface DomainError {
  code: string
  message: string
  detail?: Record<string, unknown>
}

export function ok(value: unknown): RpcResult<unknown> {
  return { ok: true, value }
}

/** 失败结果——信封要求 `details` 在场，所以这里补齐。 */
export function fail(
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): RpcResult<unknown> {
  return { ok: false, error: { code, message, details: detail ?? {} } }
}

/** 把仓储 / 校验层的失败转成线信封。 */
export function failFrom(error: DomainError): RpcResult<unknown> {
  return fail(error.code, error.message, error.detail)
}

// ─────────────────────────────────────────────────────────────
// 入参读取（不做断言）
// ─────────────────────────────────────────────────────────────

export function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object')
  }
  return payload as Record<string, unknown>
}

export function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value === '') throw new Error(`missing ${field}`)
  return value
}

/** 版本号：正整数。 */
export function requireVersion(input: Record<string, unknown>): number {
  const value = input.n
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('n must be a positive integer')
  }
  return value
}

export function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}
