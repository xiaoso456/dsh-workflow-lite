/**
 * dsh-workflow-lite — 文件夹展示的两件小事：按名字筛（「只看」）、按设置排。纯函数，展示卡和测试共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/folderView
 */

import type { GalleryView } from '../../shared/types.ts'

interface Entry {
  name: string
  dir: boolean
  size: number
  mtime: number
}

/**
 * 「只看」写的几个名字式子（逗号、空格隔开）：`*` 是任意几个字、`?` 是一个字，不分大小写；
 * 不带 `*`、`?` 的当「名字里有这几个字」。没写就是都要。
 */
export function nameMatcher(match: string | undefined): (name: string) => boolean {
  const parts = (match ?? '')
    .split(/[,，\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return () => true
  const tests = parts.map((part) => {
    if (!/[*?]/u.test(part)) {
      const needle = part.toLowerCase()
      return (name: string) => name.toLowerCase().includes(needle)
    }
    const source = part
      .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
      .replace(/\*/gu, '.*')
      .replace(/\?/gu, '.')
    const pattern = new RegExp(`^${source}$`, 'iu')
    return (name: string) => pattern.test(name)
  })
  return (name) => tests.some((test) => test(name))
}

const byName = (a: Entry, b: Entry): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true })

/** 按设置排：缺省最新在前，`name` 按名字（带数字的按大小），`size` 大的在前；一样的按名字。 */
export function folderOrder(order: GalleryView['order']): (a: Entry, b: Entry) => number {
  if (order === 'name') return byName
  if (order === 'size') return (a, b) => b.size - a.size || byName(a, b)
  return (a, b) => b.mtime - a.mtime || byName(a, b)
}
