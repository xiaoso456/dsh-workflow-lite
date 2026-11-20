/**
 * dsh-workflow-lite — 本会话刚出现的新实例：提示条的状态、打开 tab 时看什么、定时刷新实例列表。
 *
 * 打开 tab 时按这个会话上次看的恢复（{@link restoredRun}）：上次在看的实例、在编辑的工作流还在就接着看，
 * 否则本会话有当前实例就直接看它。恢复完之前不记这个会话在看什么（`restored`），免得一进来的空白把上次的盖掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useFreshRun
 */

import { useEffect, useRef, useState } from 'react'
import { restoredRun, type SessionPick } from '../../../app/sessionPick.ts'
import type { Runs } from '../../../app/useRuns.ts'

/** 实例列表多久刷新一次（模型在会话里编译出新实例时，tab 里能看到提示）。 */
const RUNS_REFRESH_MS = 8000

export interface FreshRunInput {
  runs: Runs
  runId: string | null
  setRunId: React.Dispatch<React.SetStateAction<string | null>>
  /** 这个会话上次看的（没记过是 `null`）。 */
  pick: SessionPick | null
  /** 现有的工作流（目录还没回来是 `null`）。 */
  workflows: readonly string[] | null
  /** 视图被弹窗盖着：不定时刷新，揭开时补刷一次。 */
  quiet: boolean
}

export function useFreshRun({ runs, runId, setRunId, pick, workflows, quiet }: FreshRunInput): {
  freshRun: string | null
  setFreshRun: React.Dispatch<React.SetStateAction<string | null>>
  seenCurrent: React.MutableRefObject<string | undefined | null>
  /** 打开 tab 时该看的已经定下来了。 */
  restored: boolean
} {
  /** 本会话刚出现的新实例（模型编译了一次）：模板编辑时顶部提示一下。 */
  const [freshRun, setFreshRun] = useState<string | null>(null)
  const seenCurrent = useRef<string | undefined | null>(null)
  const [restored, setRestored] = useState(false)
  // 上次在编辑工作流：要等目录回来才知道那张还在不在。
  const waitCatalog = pick !== null && pick.run === undefined && pick.workflow !== undefined
  const catalogReady = !waitCatalog || workflows !== null
  useEffect(() => {
    if (!runs.loaded) return
    if (seenCurrent.current === null) {
      if (!catalogReady) return
      seenCurrent.current = runs.current
      const current = runs.current
      void (async () => {
        const run = pick?.run
        const found = {
          run: run !== undefined && (await runExists(runs, run)),
          workflow: pick?.workflow !== undefined && workflows?.includes(pick.workflow) === true,
        }
        const target = restoredRun(pick, found, current)
        // 等着查的时候用户已经自己点开了别的：不抢。
        if (target !== undefined) setRunId((now) => now ?? target)
        setRestored(true)
      })()
      return
    }
    if (runs.current !== undefined && runs.current !== seenCurrent.current) {
      if (runId === null) setFreshRun(runs.current)
    }
    seenCurrent.current = runs.current
  }, [runs, runId, setRunId, pick, workflows, catalogReady])
  const covered = useRef(quiet)
  useEffect(() => {
    if (quiet) {
      covered.current = true
      return
    }
    // 刚揭开：盖着的时候没刷，先补一次。
    if (covered.current) void runs.refresh()
    covered.current = false
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runs.refresh()
    }, RUNS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [runs.refresh, quiet])
  return { freshRun, setFreshRun, seenCurrent, restored }
}

/** 这个实例还在不在：先看本会话的，没有再看全部会话的（上次可能在工作流中心打开了别的会话的）。 */
async function runExists(runs: Runs, id: string): Promise<boolean> {
  if (runs.list.some((entry) => entry.id === id)) return true
  try {
    return (await runs.all()).some((entry) => entry.id === id)
  } catch {
    return false
  }
}
