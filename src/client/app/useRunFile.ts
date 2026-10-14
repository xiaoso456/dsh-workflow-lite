/**
 * dsh-workflow-lite — 读实例里的一份产出文件（文件面板的预览、查看框）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRunFile
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const key = targetKey(target)

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

function targetKey(target: FileTarget | null): string {
  if (target === null) return ''
  return 'node' in target ? `n:${target.node}#${target.item}` : `p:${target.path}`
}

/**
 * 这份文档里相对路径的图片怎么读（交给 Markdown）：按文档所在目录去实例里读，读回来是 data URL。
 * 同一份文档里同一张图只读一次；换了文档就换一份缓存。
 */
export function useRunImages(
  rpc: WorkflowLiteRpc,
  instance: string,
  target: FileTarget,
): (src: string) => Promise<string> {
  const key = targetKey(target)
  // `key` 就是 target 的身份：target 对象每次渲染都可能是新的，不拿它当依赖。
  return useMemo(() => {
    const cache = new Map<string, Promise<string>>()
    return (src: string) => {
      let pending = cache.get(src)
      if (pending === undefined) {
        pending = rpc
          .call('run/image', { id: instance, ...target, src })
          .then(({ mime, data }) => `data:${mime};base64,${data}`)
        cache.set(src, pending)
      }
      return pending
    }
  }, [rpc, instance, key])
}
