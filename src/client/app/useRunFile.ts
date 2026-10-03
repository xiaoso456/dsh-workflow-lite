/**
 * dsh-workflow-lite — 读实例里的一份产出文件（文件面板的预览、查看框）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRunFile
 */

import { useCallback, useEffect, useState } from 'react'
import type { RunFileResponse } from '../../shared/wire.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

/** 要看哪份：快照里某个资源的第几项，或实例工作区里的相对路径。 */
export type FileTarget = { node: string; item: number } | { path: string }

export interface RunFile {
  file: RunFileResponse | null
  error: string | null
  loading: boolean
  reload(): void
}

/**
 * @param version - 变了就重读（文件面板拿"文件在不在 + 状态文件修改时间"当版本：模型写完文件通常也会更新状态）。
 */
export function useRunFile(
  rpc: WorkflowLiteRpc,
  instance: string,
  target: FileTarget | null,
  version: string | number = 0,
): RunFile {
  const [file, setFile] = useState<RunFileResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const key =
    target === null ? '' : 'node' in target ? `n:${target.node}#${target.item}` : `p:${target.path}`

  // `key` 就是 target 的身份；`version` / `tick` 只是重读的信号。
  useEffect(() => {
    if (target === null) {
      setFile(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    rpc
      .call('run/file', { id: instance, ...target })
      .then((value) => {
        if (alive) setFile(value)
      })
      .catch((reason: unknown) => {
        if (alive) setError(errorMessage(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [rpc, instance, key, version, tick])

  // 换了文件：先清掉上一份，别让它闪一下。
  useEffect(() => {
    setFile(null)
  }, [instance, key])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { file, error, loading, reload }
}
