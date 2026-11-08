/**
 * dsh-workflow-lite — 仓储各部分共用的结果与问题小工具：`Outcome`、失败构造、保存级问题、写失败翻译。
 *
 * 仓储拆成核心（`repoCore`）和几个按职责分的部分（工作流、列举、版本、节点与边、模板），
 * 它们都用同一种返回形状；这些小函数放在这里，各部分直接引用，谁也不必依赖外层的 `repository`。
 * @module @xiaoso/dsh-workflow-lite/host/store/repoResult
 */

import type { ErrorCode, ToolError, ToolWarning, ValidationProblem } from '../../shared/types.ts'
import { errnoCode } from './paths.ts'

/** 仓储的统一返回：成功 `{ ok: true, result }`，失败 `{ ok: false, error }`（就是 `ToolError` 的字段）。 */
export type Outcome<T> = { ok: true; result: T } | { ok: false; error: ToolError['error'] }

export type Failure = { ok: false; error: ToolError['error'] }

export function fail(code: ErrorCode, message: string, detail?: Record<string, unknown>): Failure {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } }
}

/** 某件事做到一半 IO 出错：`<what>失败：<原因>`。 */
export function ioError(what: string, error: unknown): Failure {
  return fail('io_error', `${what}失败：${error instanceof Error ? error.message : String(error)}`)
}

export function ok<T>(result: T): { ok: true; result: T } {
  return { ok: true, result }
}

export function saveProblem(code: ValidationProblem['code'], message: string): ValidationProblem {
  return { level: 'save', code, message }
}

export function hasLevel(
  problems: readonly ValidationProblem[],
  level: ValidationProblem['level'],
): boolean {
  return problems.some((problem) => problem.level === level)
}

export function onlyLevel(
  problems: readonly ValidationProblem[],
  level: ValidationProblem['level'],
): ValidationProblem[] {
  return problems.filter((problem) => problem.level === level)
}

/** 把非阻塞问题（警告 / 提示）转成工具线格式的 `warnings`。 */
export function problemsToWarnings(problems: readonly ValidationProblem[]): ToolWarning[] {
  const warnings: ToolWarning[] = []
  for (const problem of problems) {
    if (problem.level !== 'warning' && problem.level !== 'hint') continue
    warnings.push({
      level: problem.level,
      code: problem.code,
      message: problem.message,
      ...(problem.node === undefined ? {} : { nodes: [problem.node] }),
    })
  }
  return warnings
}

export function describeProblems(problems: readonly ValidationProblem[]): string {
  return problems.map((problem) => problem.message).join('；')
}

/** errno → 工具失败码：`dataDir` 不可写 / 不可用 ⇒ `invalid_args`，其余 IO 失败 ⇒ `io_error`。 */
export function mapWriteFailure(error: unknown, target: string): Failure {
  const code = errnoCode(error) ?? 'unknown'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOTDIR') {
    return fail('invalid_args', `数据目录不可写或不可用（${code}）：${target}`, {
      errno: code,
      path: target,
    })
  }
  if (code === 'ENOENT' || code === 'EEXIST') {
    return fail(
      'invalid_args',
      `数据目录结构不可用（${code}）：${target}——dataDir 必须是一个可写的目录`,
      {
        errno: code,
        path: target,
      },
    )
  }
  return fail('io_error', `写入失败（${code}）：${target}`, { errno: code, path: target })
}
