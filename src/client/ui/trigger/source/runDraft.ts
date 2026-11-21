/**
 * dsh-workflow-lite — 「触发方式」对话框里轮询、监听的设置草稿：会话工作区、脚本目录、shell。
 * 都写在图里的卡片上（工作区和面板上的是同一项），跟着对话框「保存」一起写。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/runDraft
 */

/** 一项设置的草稿：现在选的、存着的、改它。 */
export interface LocalDraft {
  value: string
  saved: string
  onChange(value: string): void
}

/** 会话工作区（`''` 是还没选）、脚本目录（`''` 是卡片目录）、用哪个 shell 跑（`''` 是跟随默认）。 */
export interface RunDrafts {
  workspace: LocalDraft
  cwd: LocalDraft
  shell: LocalDraft
}
