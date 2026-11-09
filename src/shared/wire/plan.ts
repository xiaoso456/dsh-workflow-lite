/**
 * dsh-workflow-lite — 线格式：`plan/*` 端点形状：画布上的编译预览。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/plan
 */

import type { PlanId, ValidationProblem } from '../types.ts'
import type { WireWarning } from './common.ts'

/** `plan/build` —— 画布上的编译预览（两个 tab）。 */
export interface PlanBuildRequest {
  name: string
  /** true = 整卷版（内联正文）；缺省 = 派发版。 */
  full?: boolean
  goal?: string
  /** 执行者的工作区根（进 ⑤ 动态尾）；缺省时渲染「工作区路径：未指定」。 */
  cwd?: string
}
export interface PlanBuildResponse {
  plan: string
  planId: PlanId
  /** 只装编译级问题。 */
  problems: ValidationProblem[]
  warnings: WireWarning[]
}
