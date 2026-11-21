/**
 * dsh-workflow-lite — 工作流目录里触发器那一块在本机的路径（布局见 `shared/triggerDirs.ts`）和交给脚本的环境变量。
 *
 * 整块在工作流目录里，跟着工作流改名、删除。插件只经环境变量把这几处告诉脚本，不读不写里面的东西。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/cardDirs
 */

import { join } from 'node:path'
import { CARD_AREAS, SCRIPTS_DIR } from '../../shared/triggerDirs.ts'

/** 运行时给命令的环境变量：卡片的数据目录。 */
export const CARD_DATA_ENV = 'TRIGGER_DATA_DIR'
/** 运行时给命令的环境变量：卡片的密钥目录。 */
export const CARD_SECRETS_ENV = 'TRIGGER_SECRETS_DIR'
/** 运行时给命令的环境变量：卡片上选的会话工作区（选了才有）。 */
export const CARD_WORKSPACE_ENV = 'TRIGGER_WORKSPACE'

/** `workflowDir/triggers/`。 */
export function scriptsDir(workflowDir: string): string {
  return join(workflowDir, SCRIPTS_DIR)
}

/** 一张卡片的目录 `triggers/<卡片>/`：脚本没另设工作目录时在这里跑。 */
export function cardDir(workflowDir: string, node: string): string {
  return join(scriptsDir(workflowDir), node)
}

/** 一张卡片的脚本自己记东西的目录；`trial` = 试运行用的那份。 */
export function cardDataDir(workflowDir: string, node: string, trial = false): string {
  return join(cardDir(workflowDir, node), trial ? CARD_AREAS.trial : CARD_AREAS.data)
}

/** 一张卡片的密钥目录。 */
export function cardSecretsDir(workflowDir: string, node: string): string {
  return join(cardDir(workflowDir, node), CARD_AREAS.secrets)
}
