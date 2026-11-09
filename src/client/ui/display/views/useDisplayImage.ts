/**
 * dsh-workflow-lite — 实例里的一张图：修改时间变了重读，存下的旧版图读过的直接用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/useDisplayImage
 */

import { useEffect, useState } from 'react'
import { readCache } from '../../../app/readCache.ts'
import { errorMessage, type WorkflowLiteRpc } from '../../../rpc.ts'

/**
 * 读过的图（base64 的，按字符数封顶）：存下的旧版不会再变，悬停扫过各轮时直接用；
 * 现在的图按修改时间记，展示卡被摘下再挂回来（大图平移）时直接用。
 */
const images = readCache<string>({ entries: 24, budget: 24_000_000, weigh: (url) => url.length })

/** 读回来的一张图，连同它是哪一次读的（`at`：换一版就换一层、淡入）。 */
interface LoadedImage {
  url: string | null
  error: string | null
  at: string | number | null
}

/**
 * 实例里的一张图：`signal` 变了重读（现在的文件拿修改时间，`null` 不读）；`kept` 给了就读存下的那一版。
 */
export function useDisplayImage(
  rpc: WorkflowLiteRpc,
  instance: string,
  node: string,
  item: number,
  kept: number | null,
  signal: string | number | null,
): LoadedImage {
  const cacheKey = `${instance}|${node}#${item}@${kept}`
  // 旧版不会再变；现在的图按修改时间认。
  const version = kept === null ? signal : 'kept'
  const [state, setState] = useState<LoadedImage>(() => {
    const hit = version === null ? undefined : images.get(cacheKey, version)
    return { url: hit ?? null, error: null, at: hit === undefined ? null : signal }
  })
  useEffect(() => {
    if (signal === null || version === null) return
    const hit = images.get(cacheKey, version)
    if (hit !== undefined) {
      setState((last) =>
        last.url === hit && last.at === signal ? last : { url: hit, error: null, at: signal },
      )
      return
    }
    let alive = true
    rpc
      .call('run/image', { id: instance, node, item, ...(kept === null ? {} : { version: kept }) })
      .then(({ mime, data }) => {
        const url = `data:${mime};base64,${data}`
        images.put(cacheKey, version, url)
        if (alive) setState({ url, error: null, at: signal })
      })
      .catch((reason: unknown) => {
        if (alive) setState({ url: null, error: errorMessage(reason), at: signal })
      })
    return () => {
      alive = false
    }
  }, [rpc, instance, node, item, kept, signal, cacheKey, version])
  return state
}
