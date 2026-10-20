/**
 * dsh-workflow-lite — 文件夹浏览（{@link FolderBrowser}）从哪读：实例里的文件夹资源，或导出成 skill 前暂存的整个包。
 *
 * 两边长得一样：列一层、读一份、读一张图，路径都是相对根的 `sub`（`/` 分隔）。浏览框只认 {@link BrowseSource}，
 * 不管背后是哪条 RPC。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useBrowse
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SkillFileResponse, SkillMeta } from '../../shared/skillPack.ts'
import type { RunDirResponse, RunImageResponse } from '../../shared/wire.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import type { RunDir, RunImage } from './useRunFile.ts'

/** 一份文件读回来的样子（同 `run/file`；Markdown 带 YAML 头部时另有解析好的头部与正文）。 */
export type BrowseFile = SkillFileResponse

export interface BrowseSource {
  /** 身份：换了就重读。 */
  key: string
  dir(sub: string): Promise<RunDirResponse>
  file(sub: string): Promise<BrowseFile>
  /** `src` 不给：`sub` 自己就是那张图；给了：`sub` 这份文档里引用的相对路径图片。 */
  image(sub: string, src?: string): Promise<RunImageResponse>
}

/** 实例里一个文件夹资源（快照里 `node` 的第 `item` 项）。 */
export function runFolderSource(
  rpc: WorkflowLiteRpc,
  instance: string,
  node: string,
  item: number,
): BrowseSource {
  const at = (sub: string) => ({ id: instance, node, item, ...(sub === '' ? {} : { sub }) })
  return {
    key: `run:${instance}:${node}#${item}`,
    dir: (sub) => rpc.call('run/dir', at(sub)),
    file: (sub) => rpc.call('run/file', at(sub)),
    image: (sub, src) =>
      rpc.call('run/image', { ...at(sub), ...(src === undefined ? {} : { src }) }),
  }
}

/** 导出成 skill 前暂存的包（`pack/skillPreview` 回的 `browse`）；SKILL.md 的头部按 `meta` 现拼。 */
export function skillPackSource(
  rpc: WorkflowLiteRpc,
  token: string,
  meta: SkillMeta,
): BrowseSource {
  const at = (sub: string) => ({ token, meta, ...(sub === '' ? {} : { sub }) })
  return {
    key: `skill:${token}:${JSON.stringify(meta)}`,
    dir: (sub) => rpc.call('pack/skillDir', at(sub)),
    file: (sub) => rpc.call('pack/skillFile', at(sub)),
    image: (sub, src) =>
      rpc.call('pack/skillImage', { ...at(sub), ...(src === undefined ? {} : { src }) }),
  }
}

/** 一个读取目标的身份串：哪个来源的哪一份。 */
export function browseKey(source: BrowseSource, sub: string): string {
  return `${source.key}\n${sub}`
}

/** 列 `sub` 这一层（换层时读回来之前 `dir` 还是上一层的，免得闪一下空）。 */
export function useBrowseDir(source: BrowseSource, sub: string): RunDir {
  const [dir, setDir] = useState<RunDirResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // `source.key` 就是来源的身份：对象每次渲染都可能是新的，不拿它当依赖。
  useEffect(() => {
    let alive = true
    setLoading(true)
    source
      .dir(sub)
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
  }, [source.key, sub])
  return { dir, error, loading }
}

export interface BrowsedFile {
  file: BrowseFile | null
  error: string | null
  /** 最近读完（成功或失败）的是哪一份（{@link browseKey}）：和现在要看的对得上，`file` / `error` 才是它的。 */
  settled: string
}

/** 读 `sub` 这一份。 */
export function useBrowseFile(source: BrowseSource, sub: string): BrowsedFile {
  const [state, setState] = useState<BrowsedFile>({ file: null, error: null, settled: '' })
  const key = browseKey(source, sub)
  // `key` 就是来源 + 路径的身份。
  useEffect(() => {
    let alive = true
    source
      .file(sub)
      .then((file) => {
        if (alive) setState({ file, error: null, settled: key })
      })
      .catch((reason: unknown) => {
        if (alive) setState({ file: null, error: errorMessage(reason), settled: key })
      })
    return () => {
      alive = false
    }
  }, [key])
  return state
}

/** 缓存几张图：来回切着看时不用每次重读（图是 base64 的，别存太多）。 */
const IMAGE_CACHE = 8

/** 把 `sub` 自己当图读；换目标时先清成"读取中"，不让上一张闪一下。 */
export function useBrowseImage(source: BrowseSource, sub: string): RunImage {
  const cache = useRef(new Map<string, string>())
  const [state, setState] = useState<RunImage & { key: string }>({
    url: null,
    error: null,
    key: '',
  })
  const key = browseKey(source, sub)
  // `key` 就是来源 + 路径的身份。
  useEffect(() => {
    const hit = cache.current.get(key)
    if (hit !== undefined) {
      setState({ url: hit, error: null, key })
      return
    }
    let alive = true
    source
      .image(sub)
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
  }, [key])
  return state.key === key ? { url: state.url, error: state.error } : { url: null, error: null }
}

/** `sub` 这份文档里相对路径的图片怎么读（交给 Markdown）；同一份文档里同一张图只读一次。 */
export function useBrowseImages(
  source: BrowseSource,
  sub: string,
): (src: string) => Promise<string> {
  const key = browseKey(source, sub)
  // `key` 就是来源 + 路径的身份。
  return useMemo(() => {
    const cache = new Map<string, Promise<string>>()
    return (src: string) => {
      let pending = cache.get(src)
      if (pending === undefined) {
        pending = source.image(sub, src).then(({ mime, data }) => `data:${mime};base64,${data}`)
        cache.set(src, pending)
      }
      return pending
    }
  }, [key])
}
