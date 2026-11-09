/**
 * dsh-workflow-lite — 第一次加载的遮罩：画布摆好视角、量完卡片之前先不显示，慢了再亮出加载中的样子。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useBooting
 */

import { useEffect, useState } from 'react'
import type { Runs } from '../../../app/useRuns.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'

/** 第一次加载最多藏多久（见 `booting`）。 */
const BOOT_VEIL_MS = 400

export interface BootingInput {
  state: Workflow['state']
  runs: Runs
}

export function useBooting({ state, runs }: BootingInput): {
  booting: boolean
  setBooting: React.Dispatch<React.SetStateAction<boolean>>
  setTemplateSettled: React.Dispatch<React.SetStateAction<boolean>>
} {
  /**
   * 第一次加载完成之前先不显示：切回这个标签页时视图整个重新挂载，头几十毫秒是「加载中」的空壳
   * （顶栏只有一半、画布是空的），一闪就变样。画布摆好视角、量完卡片（线跟着定下来）才淡入完整的界面；
   * 慢了（超过 {@link BOOT_VEIL_MS}）再把加载中的样子亮出来，不让人对着空白等。
   */
  const [booting, setBooting] = useState(true)
  useEffect(() => {
    if (state.phase === 'broken') setBooting(false)
  }, [state.phase])
  /** 模板画布摆好了。本会话有当前实例时，实例列表一到就会换成实例视图，这时得等实例的画布摆好才算数。 */
  const [templateSettled, setTemplateSettled] = useState(false)
  useEffect(() => {
    if (templateSettled && runs.loaded && runs.current === undefined) setBooting(false)
  }, [templateSettled, runs.loaded, runs.current])
  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), BOOT_VEIL_MS)
    return () => window.clearTimeout(timer)
  }, [])
  return { booting, setBooting, setTemplateSettled }
}
