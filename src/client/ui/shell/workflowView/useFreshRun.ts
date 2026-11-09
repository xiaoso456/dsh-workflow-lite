/**
 * dsh-workflow-lite — 本会话刚出现的新实例：提示条的状态、打开 tab 时直接看当前实例、定时刷新实例列表。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useFreshRun
 */

import { useEffect, useRef, useState } from 'react'
import type { Runs } from '../../../app/useRuns.ts'

/** 实例列表多久刷新一次（模型在会话里编译出新实例时，tab 里能看到提示）。 */
const RUNS_REFRESH_MS = 8000

export interface FreshRunInput {
  runs: Runs
  runId: string | null
  setRunId: React.Dispatch<React.SetStateAction<string | null>>
}

export function useFreshRun({ runs, runId, setRunId }: FreshRunInput): {
  freshRun: string | null
  setFreshRun: React.Dispatch<React.SetStateAction<string | null>>
  seenCurrent: React.MutableRefObject<string | undefined | null>
} {
  /** 本会话刚出现的新实例（模型编译了一次）：模板编辑时顶部提示一下。 */
  const [freshRun, setFreshRun] = useState<string | null>(null)
  const seenCurrent = useRef<string | undefined | null>(null)
  // 打开 tab：本会话有当前实例就直接看它（只在第一次拿到列表时做）。
  useEffect(() => {
    if (!runs.loaded) return
    if (seenCurrent.current === null) {
      seenCurrent.current = runs.current
      if (runs.current !== undefined) setRunId(runs.current)
      return
    }
    if (runs.current !== undefined && runs.current !== seenCurrent.current) {
      if (runId === null) setFreshRun(runs.current)
    }
    seenCurrent.current = runs.current
  }, [runs.loaded, runs.current, runId])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runs.refresh()
    }, RUNS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [runs.refresh])
  return { freshRun, setFreshRun, seenCurrent }
}
