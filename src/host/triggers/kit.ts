/**
 * dsh-workflow-lite — 监视的底子：skill `workflow-trigger` 随附的 `kit/watch.mjs`。
 *
 * 由插件放进工作流目录的 `triggers/watch.mjs`，模型写的脚本直接 `import { … } from './watch.mjs'`，不用自己抄一遍。
 * 写要跑命令的触发卡片时、每次跑命令前都对一下：不在、或和随包的不一样（插件升级了、被手改了）就换成随包的。
 * 它随工作流导出；导到别的机器上，那边的插件下次跑命令时同样换成它自己的那份。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/kit
 */

import { join } from 'node:path'
import { ensureDir, readFileText, writeFileAtomic } from '../store/atomic.ts'
import { triggerSkillDir } from '../triggerSkill.ts'
import { SCRIPTS_DIR } from './scriptAge.ts'

/** 放进 `triggers/` 的文件名（脚本里 `import './watch.mjs'`）。 */
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
 * 让 `workflowDir/triggers/watch.mjs` 和随包的一样；本来就一样时不写（不动修改时刻，「改过要再试」不会误报）。
 * @returns 这次写了没有。
 */
export async function placeKit(workflowDir: string): Promise<boolean> {
  const text = await kitSource()
  if (text === null) return false
  const target = join(workflowDir, SCRIPTS_DIR, KIT_FILE)
  if ((await readFileText(target)) === text) return false
  await ensureDir(join(workflowDir, SCRIPTS_DIR))
  await writeFileAtomic(target, text)
  return true
}
