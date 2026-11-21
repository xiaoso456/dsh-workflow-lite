/**
 * dsh-workflow-lite — 监视的底子：skill `workflow-trigger` 随附的 `kit/watch.mjs`。
 *
 * 模型写第一张要跑命令的触发卡片时，插件放一份到工作流目录的 `triggers/watch.mjs`，
 * 各卡片目录里的脚本 `import { … } from '../watch.mjs'`。放下之后归工作流自己管：
 * 已经有了就不动（不检查、不换回，插件升级也不动），随工作流导出、导入。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/kit
 */

import { join } from 'node:path'
import { ensureDir, readFileText, writeFileAtomic } from '../store/atomic.ts'
import { pathKind } from '../store/paths.ts'
import { triggerSkillDir } from '../triggerSkill.ts'
import { scriptsDir } from './cardDirs.ts'

/** 放进 `triggers/` 的文件名。 */
export const KIT_FILE = 'watch.mjs'

let source: Promise<string | null> | undefined

/** 随包的那份（读一次）；包不全时是 `null`。 */
function kitSource(): Promise<string | null> {
  source ??= (async () => {
    const dir = triggerSkillDir()
    return dir === null ? null : readFileText(join(dir, 'kit', KIT_FILE))
  })()
  return source
}

/**
 * `workflowDir/triggers/watch.mjs` 还没有就放一份随包的；已经有了不动。
 * @returns 这次放了没有。
 */
export async function placeKit(workflowDir: string): Promise<boolean> {
  const target = join(scriptsDir(workflowDir), KIT_FILE)
  if ((await pathKind(target)) !== 'missing') return false
  const text = await kitSource()
  if (text === null) return false
  await ensureDir(scriptsDir(workflowDir))
  await writeFileAtomic(target, text)
  return true
}
