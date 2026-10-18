/**
 * dsh-workflow-lite — 读实例里的一份产出文件（文件面板的预览、查看框）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRunFile
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunDirResponse, RunFileResponse } from '../../shared/wire.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

/**
 * 要看哪份：快照里某个资源的第几项（文件夹项可以再带 `sub`：文件夹里的相对路径），或实例工作区里的相对路径。
 */
export type FileTarget = { node: string; item: number; sub?: string } | { path: string }

export interface RunFile {
  file: RunFileResponse | null
  error: string | null
  loading: boolean
  /** 最近读完（成功或失败）的是哪个目标（{@link fileTargetKey}）：和现在要看的对得上，`file` / `error` 才是它的。 */
  settled: string
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
  const [settled, setSettled] = useState('')
  const key = fileTargetKey(target)

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
        if (!alive) return
        setFile(value)
        setSettled(key)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setError(errorMessage(reason))
        setSettled(key)
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
  return { file, error, loading, settled, reload }
}

/** 一个读取目标的身份串（`useRunFile` 的 `settled` 就是它）。 */
export function fileTargetKey(target: FileTarget | null): string {
  if (target === null) return ''
  return 'node' in target
    ? `n:${target.node}#${target.item}/${target.sub ?? ''}`
    : `p:${target.path}`
}

/** 文件夹资源的一层：{@link useRunDir} 的结果。 */
export interface RunDir {
  /** 最近一次读到的（换层时读回来之前还是上一层的，免得闪一下空）；还没读到过是 `null`。 */
  dir: RunDirResponse | null
  error: string | null
  /** 正在读 `sub` 这一层（`dir` 可能还是上一层的）。 */
  loading: boolean
}

/** 读文件夹资源（第 `item` 项）下 `sub` 这一层有什么。 */
export function useRunDir(
  rpc: WorkflowLiteRpc,
  instance: string,
  node: string,
  item: number,
  sub: string,
): RunDir {
  const [dir, setDir] = useState<RunDirResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    rpc
      .call('run/dir', { id: instance, node, item, ...(sub === '' ? {} : { sub }) })
      .then((value) => {
        if (!alive) return
        setDir(value)
        setError(null)
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
  }, [rpc, instance, node, item, sub])
  return { dir, error, loading }
}

/** 一张图读回来的样子：`url` 是 data URL。 */
export interface RunImage {
  url: string | null
  error: string | null
}

/** 缓存几张图：来回切着看时不用每次重读（图是 base64 的，别存太多）。 */
const IMAGE_CACHE = 8

/**
 * 把目标文件当图片读（`run/image` 不带 `src`）。同一个目标读过的先用缓存；
 * 换目标时先清成"读取中"，不让上一张闪一下。`target` 为 `null` 就什么也不读。
 */
export function useRunImage(
  rpc: WorkflowLiteRpc,
  instance: string,
  target: FileTarget | null,
): RunImage {
  const cache = useRef(new Map<string, string>())
  const [state, setState] = useState<RunImage & { key: string }>({
    url: null,
    error: null,
    key: '',
  })
  const key = fileTargetKey(target)
  useEffect(() => {
    if (target === null) return
    const hit = cache.current.get(key)
    if (hit !== undefined) {
      setState({ url: hit, error: null, key })
      return
    }
    let alive = true
    rpc
      .call('run/image', { id: instance, ...target })
      .then(({ mime, data }) => {
        const url = `data:${mime};base64,${data}`
        cache.current.set(key, url)
        if (cache.current.size > IMAGE_CACHE) {
          const oldest = cache.current.keys().next().value
          if (oldest !== undefined) cache.current.delete(oldest)
        }
        if (alive) setState({ url, error: null, key })
      })
      .catch((reason: unknown) => {
        if (alive) setState({ url: null, error: errorMessage(reason), key })
      })
    return () => {
      alive = false
    }
    // `key` 就是 target 的身份。
  }, [rpc, instance, key])
  // 还没读到这一个：不把上一张的结果当成它的。
  return state.key === key ? { url: state.url, error: state.error } : { url: null, error: null }
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
  const key = fileTargetKey(target)
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
