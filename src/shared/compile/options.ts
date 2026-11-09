/**
 * dsh-workflow-lite — 计划编译器的可选入参：警告与提示、运行状态、导出成 skill 的口径。
 *
 * {@link PlanOptions} 等由 `shared/compile.ts` 导出，调用方照旧从那里 import。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/compile/options
 */

import type { ValidationProblem } from '../types.ts'

/**
 * {@link buildPlan} / {@link buildFullText} 的**可选**入参（必填签名不变）。
 *
 * 「注意事项」逐字取自校验结论（`shared/validate.ts`），所以警告必须由调用方带进来；
 * 这里收**该图的全部** `ValidationProblem`——`warning` 进「注意事项」（`hint` 是给画图的人的，不进计划），
 * `compile` 级与内部判定合并后决定"是否拒绝出计划"（`plan` 为空串）。
 */
export interface PlanOptions {
  /** 该图本次校验出的全部问题。 */
  problems?: readonly ValidationProblem[]
  /**
   * 这次执行要记运行状态：计划末尾追加「运行状态」段。DSH 口径用插件的 `state` 动作（实例已建好）；
   * 导出成 skill 时实例 id 是 `{instance}`，模型自己建、自己改状态文件（见 `shared/dialect.ts`）。
   */
  runState?: RunStateSection
  /** 导出成 skill：没有插件、没有实例，计划按通用口径写（见 {@link SkillPlan}）。 */
  skill?: SkillPlan
}

/**
 * 导出成 skill：计划改用通用口径（{@link PORTABLE_DIALECT}，不点名任何工具）；「约定」里说清 `{skill}`、
 * `{instance}` 怎么换，「开始之前」先问用户、确认包里没带的依赖，打包的 skill 改成读包里的 SKILL.md。
 * 任务描述路径由调用方给成 `{skill}/steps/…`。
 */
export interface SkillPlan {
  /** 打进包里的 skill（`{skill}/skills/<名>/`）；其余由执行者自己加载。 */
  bundled: ReadonlySet<string>
  /** 不在包里、要在本机装好的 skill。 */
  needs: readonly string[]
  /** 按绝对路径引用、没打进包的文件和文件夹（含写到绝对路径的产出）。 */
  absolute: readonly string[]
}

/** 「运行状态」段要的东西（host 建好实例后给；预览时实例 id 是 `{instance}`）。 */
export interface RunStateSection {
  /** 实例 id：模型调用 `state` / `resume` 时带上它。 */
  instance: string
}
