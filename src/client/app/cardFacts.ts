/**
 * dsh-workflow-lite — 展示卡读到的几件事（按 `displayKey`）：表格的列名、文件夹里有几张图几个文件。
 * 设置浮层要用（挑列、选排序列；「自动」现在是图片墙还是文件列表），这些只有读了才知道——
 * 卡片读到了记在这里，浮层从这里拿，不为了它们再读一次。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/cardFacts
 */

import { useSyncExternalStore } from 'react'

const heads = new Map<string, readonly string[]>()
/** 文件夹：图片几张、一共几项（只看筛过之后的）。 */
export interface FolderFacts {
  images: number
  entries: number
}
const folders = new Map<string, FolderFacts>()
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 卡片读到一份表头（和上次一样就不吵醒谁）。 */
export function publishTableHead(key: string, head: readonly string[]): void {
  const last = heads.get(key)
  if (last !== undefined && last.length === head.length && last.every((n, i) => n === head[i])) {
    return
  }
  heads.set(key, head)
  notify()
}

/** 这张卡读到的列名；还没读到是 `null`。 */
export function useTableHead(key: string): readonly string[] | null {
  return useSyncExternalStore(subscribe, () => heads.get(key) ?? null)
}

/** 卡片列出了文件夹（和上次一样就不吵醒谁）。 */
export function publishFolderFacts(key: string, facts: FolderFacts): void {
  const last = folders.get(key)
  if (last?.images === facts.images && last.entries === facts.entries) return
  folders.set(key, facts)
  notify()
}

/** 这张卡列出的文件夹；还没列出来是 `null`。 */
export function useFolderFacts(key: string): FolderFacts | null {
  return useSyncExternalStore(subscribe, () => folders.get(key) ?? null)
}
