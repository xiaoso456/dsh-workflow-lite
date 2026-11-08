/**
 * dsh-workflow-lite — 实例里的一张图：修改时间变了重读，存下的旧版图读过的直接用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/useDisplayImage
 */

import { useEffect, useState } from 'react'
import { errorMessage, type WorkflowLiteRpc } from '../../../rpc.ts'

/** 存下的旧版图不会再变：悬停扫过各轮时读过的直接用（base64 的，别存太多）。 */
const KEPT_IMAGES = 12
const keptImages = new Map<string, string>()

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
  const [state, setState] = useState<LoadedImage>({ url: null, error: null, at: null })
  useEffect(() => {
    if (signal === null) return
    const cacheKey = `${instance}|${node}#${item}@${kept}`
    const hit = kept === null ? undefined : keptImages.get(cacheKey)
    if (hit !== undefined) {
      setState({ url: hit, error: null, at: signal })
      return
    }
    let alive = true
    rpc
      .call('run/image', { id: instance, node, item, ...(kept === null ? {} : { version: kept }) })
      .then(({ mime, data }) => {
        const url = `data:${mime};base64,${data}`
        if (kept !== null) {
          keptImages.set(cacheKey, url)
          const oldest = keptImages.size > KEPT_IMAGES ? keptImages.keys().next().value : undefined
          if (oldest !== undefined) keptImages.delete(oldest)
        }
        if (alive) setState({ url, error: null, at: signal })
      })
      .catch((reason: unknown) => {
        if (alive) setState({ url: null, error: errorMessage(reason), at: signal })
      })
    return () => {
      alive = false
    }
  }, [rpc, instance, node, item, kept, signal])
  return state
}
