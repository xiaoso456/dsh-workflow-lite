/**
 * dsh-workflow-lite — 读实例里的一份产出文件（文件面板的预览、查看框）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRunFile
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunDirResponse, RunFileResponse, RunHistoryResponse } from '../../shared/wire.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

/**
 * 要看哪份：快照里某个资源的第几项（文件夹项可以再带 `sub`：文件夹里的相对路径；文件项可以带 `version`：
 * 存下的第几版），或实例工作区里的相对路径。`tail`：太大时读最后一截（日志），不说「太大」。
 */
export type FileTarget =
  | { node: string; item: number; sub?: string; version?: number; tail?: boolean }
  | { path: string }

/** 存下的旧版不会再变：读过的留几份，来回切着看（画布上悬停扫过各轮）不用每次重读。 */
const VERSION_CACHE = 24
const versionCache = new Map<string, RunFileResponse>()

function cachedVersion(key: string): RunFileResponse | undefined {
  const hit = versionCache.get(key)
  if (hit !== undefined) {
    versionCache.delete(key)
    versionCache.set(key, hit)
  }
  return hit
}

function keepVersion(key: string, file: RunFileResponse): void {
  versionCache.set(key, file)
  if (versionCache.size > VERSION_CACHE) {
    const oldest = versionCache.keys().next().value
    if (oldest !== undefined) versionCache.delete(oldest)
  }
}

const isVersion = (target: FileTarget | null): boolean =>
  target !== null && 'node' in target && target.version !== undefined

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

  // 换了文件：先清掉上一份，别让它闪一下（放在读之前：读的是缓存里的旧版时立刻就有，不能再被清掉）。
  useEffect(() => {
    setFile(null)
  }, [instance, key])

  // `key` 就是 target 的身份；`version` / `tick` 只是重读的信号。
  useEffect(() => {
    if (target === null) {
      setFile(null)
      return
    }
    const cacheKey = `${instance}|${key}`
    const hit = isVersion(target) ? cachedVersion(cacheKey) : undefined
    if (hit !== undefined) {
      setFile(hit)
      setError(null)
      setLoading(false)
      setSettled(key)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    rpc
      .call('run/file', { id: instance, ...target })
      .then((value) => {
        if (isVersion(target)) keepVersion(cacheKey, value)
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

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { file, error, loading, settled, reload }
}

/** 一个读取目标的身份串（`useRunFile` 的 `settled` 就是它）。 */
export function fileTargetKey(target: FileTarget | null): string {
  if (target === null) return ''
  if (!('node' in target)) return `p:${target.path}`
  const kept = target.version === undefined ? '' : `@${target.version}`
  return `n:${target.node}#${target.item}/${target.sub ?? ''}${kept}${target.tail === true ? '~' : ''}`
}

/**
 * 一份产出存下的各版（`run/history`）。`revision` 是 `run/stat` 报的变化次数：变了才重问，`0`（一版都没有）就不问。
 * `null` = 还没问到（或一版都没有）。
 */
export function useRunHistory(
  rpc: WorkflowLiteRpc,
  instance: string,
  target: { node: string; item: number } | null,
  revision: number,
): RunHistoryResponse | null {
  const [state, setState] = useState<{ key: string; history: RunHistoryResponse } | null>(null)
  const key = target === null ? '' : `${instance}|${target.node}#${target.item}`
  useEffect(() => {
    if (target === null || revision === 0) return
    let alive = true
    rpc
      .call('run/history', { id: instance, node: target.node, item: target.item })
      .then((history) => {
        if (alive) setState({ key, history })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // `key` 就是 target 的身份。
  }, [rpc, instance, key, revision])
  if (target === null || revision === 0 || state?.key !== key) return null
  return state.history
}

/** 文件夹的一层（`useBrowseDir` 的结果）。 */
export interface RunDir {
  /** 最近一次读到的（换层时读回来之前还是上一层的，免得闪一下空）；还没读到过是 `null`。 */
  dir: RunDirResponse | null
  error: string | null
  /** 正在读 `sub` 这一层（`dir` 可能还是上一层的）。 */
  loading: boolean
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
