/**
 * dsh-workflow-lite — 「触发方式」对话框里定时检查、监视的设置草稿：脚本目录、shell。
 * 都写在图里的卡片上，跟着对话框「保存」一起写。会话工作区不在这里选（在面板「执行设置」里），
 * 这里只读存着的那个，试运行时交给脚本。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/runDraft
 */

import type { TriggerEnv } from '../triggerEnv.ts'

/** 一项设置的草稿：现在选的、存着的、改它。 */
export interface LocalDraft {
  value: string
  saved: string
  onChange(value: string): void
}

/** 存着的会话工作区（`''` 是还没选）、脚本目录（`''` 是卡片目录）、用哪个 shell 跑（`''` 是跟随默认）。 */
export interface RunDrafts {
  workspace: string
  cwd: LocalDraft
  shell: LocalDraft
}

/** 试运行时交给脚本的会话工作区：卡片上选了的那个，没选是当前会话的。 */
export function runWorkspace(env: TriggerEnv | null, workspace: string): string | undefined {
  if (env === null) return undefined
  return workspace === '' ? env.here.cwd : workspace
}
