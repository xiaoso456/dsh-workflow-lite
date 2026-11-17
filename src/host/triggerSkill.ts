/**
 * dsh-workflow-lite — 按需 skill `workflow-trigger`：怎么给工作流加触发卡片、写脚本、验证、排查，以及常见场景的写法。
 *
 * 用户在会话里说「日志里出现 ERROR 就跑这个工作流」，其余由模型做：挑触发方式、需要时写脚本放进工作流目录、
 * 用 `write_trigger` 加一张关着的卡片、用 `test_trigger` 试到对为止，最后请用户在画布上打开。开关只在用户手里——
 * 命令以 DSH 进程的身份运行，打开时插件会把命令给用户确认。
 *
 * 正文和参考文件随包发布在 `skills/workflow-trigger/`：正文 `SKILL.md` 是每次都要的（流程、选触发方式、
 * 背景信息、验证、排查、自检），各触发方式的细则、脚本写法、场景示例拆成同目录的文件，经 `resourceBase`
 * 交给 DSH，模型用到哪份读哪份。工具说明只讲参数怎么填。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggerSkill
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 只借类型：`ctx.skills` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-skill'
import { packageRoot } from './packageRoot.ts'

export const TRIGGER_SKILL = 'workflow-trigger'

/** 包里放这份 skill 的目录（相对包根）。 */
export const TRIGGER_SKILL_PATH = join('skills', TRIGGER_SKILL)

const DESCRIPTION = 'workflow-lite 工作流的触发卡片（定时、检查、监视、HTTP、接续）。'

const WHEN_TO_USE =
  '用户想让一个工作流自动执行（定时、文件夹里有新文件、日志出现关键字、网页内容变了、Git 有新提交、收到消息或 Webhook、另一个工作流跑完之后），要查看、修改触发卡片，或触发卡片没触发、出错、被自动停用时。'

/** 这份 skill 在磁盘上的目录；包不全时回 `null`。 */
export function triggerSkillDir(from?: string): string | null {
  const root = packageRoot(from)
  if (root === null) return null
  const dir = join(root.dir, TRIGGER_SKILL_PATH)
  return existsSync(join(dir, 'SKILL.md')) ? dir : null
}

/**
 * 注册 skill；`skills` 服务不在时由调用方跳过。
 * 找不到随包的目录时不注册，回一句原因（由调用方记日志）。
 * @returns 注销器，或找不到目录时的原因。
 */
export function registerTriggerSkill(ctx: Context): (() => void) | string {
  const dir = triggerSkillDir()
  if (dir === null)
    return `没找到随包的 ${TRIGGER_SKILL_PATH}/SKILL.md，skill ${TRIGGER_SKILL} 不注册`
  return ctx.skills.register({
    name: TRIGGER_SKILL,
    description: DESCRIPTION,
    whenToUse: WHEN_TO_USE,
    source: 'runtime',
    content: readFileSync(join(dir, 'SKILL.md'), 'utf8'),
    resourceBase: { kind: 'directory', path: dir },
  })
}
