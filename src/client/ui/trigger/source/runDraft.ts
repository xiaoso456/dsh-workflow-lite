/**
 * dsh-workflow-lite — 「触发方式」对话框里轮询、监听的本机设置草稿：工作区、shell。
 * 和面板上的是同一项（本机状态，不进图），跟着对话框「保存」一起写。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/runDraft
 */

/** 一项本机设置的草稿：现在选的、存着的、改它。 */
export interface LocalDraft {
  value: string
  saved: string
  onChange(value: string): void
}

/** 命令在哪跑（`''` 是还没选）、用哪个 shell 跑（`''` 是跟随默认）。 */
export interface RunDrafts {
  workspace: LocalDraft
  shell: LocalDraft
}
