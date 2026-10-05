/**
 * dsh-workflow-lite — 一个工作流的版本：列、存、切、改说明、删，外加「切到这一版会变什么」。
 *
 * 编辑页的「版本」对话框和工作流中心的「工作流」页共用它。版本存的是**磁盘上**那份：
 * 动手之前先调 `before()`（编辑页正开着这张图时把还没写下去的改动存掉）；
 * 切换写回了工作流之后调 `onRestored()`（正开着就按磁盘重新加载）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useVersions
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { type GraphChange, graphChanges } from '../../shared/graphDiff.ts'
import { sameSettings } from '../../shared/model.ts'
import type { VersionEntry, WorkflowDocument } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

export interface VersionNotice {
  tone: 'ok' | 'error'
  text: string
  /** 每条提示一个新值：同样的字再出现一次也要重新淡入。 */
  seq: number
}

/** 切到某一版会变什么：`base` = 现在，`next` = 那一版。 */
export interface VersionDiff {
  changes: GraphChange[]
  settings: boolean
  base: WorkflowDocument
  next: WorkflowDocument
}

export interface Versions {
  /** `null` = 还在读。 */
  list: VersionEntry[] | null
  /** 正在做的那件事（按钮按住）。 */
  busy: boolean
  notice: VersionNotice | null
  refresh(): Promise<void>
  save(note: string): Promise<boolean>
  restore(n: number): Promise<boolean>
  setNote(n: number, note: string): Promise<boolean>
  remove(n: number): Promise<boolean>
  diff(n: number): Promise<VersionDiff | null>
}

export function useVersions(options: {
  t: T
  rpc: WorkflowLiteRpc
  name: string
  /** 动手前（存掉编辑页还没写下去的改动）；回 `false` 就不做了。 */
  before?: () => Promise<boolean>
  /** 切换写回了工作流之后。 */
  onRestored?: () => void
  /** 版本数变了（列表里的「N 个版本」跟上）。 */
  onChanged?: () => void
}): Versions {
  const { name } = options
  const [list, setList] = useState<VersionEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<VersionNotice | null>(null)
  const outer = useRef(options)
  outer.current = options
  /** 换了工作流之后，上一张的回包不要了。 */
  const ticket = useRef(0)
  const seq = useRef(0)

  const say = useCallback((tone: VersionNotice['tone'], text: string): void => {
    seq.current += 1
    setNotice({ tone, text, seq: seq.current })
  }, [])

  // 成功的那句过一会儿自己淡掉；出错的留着。
  useEffect(() => {
    if (notice?.tone !== 'ok') return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const refresh = useCallback(async (): Promise<void> => {
    const mine = ticket.current
    try {
      const result = await outer.current.rpc.call('graph/versions', { name })
      if (mine === ticket.current) setList(result.versions)
    } catch (error) {
      if (mine !== ticket.current) return
      setList([])
      say('error', errorMessage(error))
    }
  }, [name, say])

  useEffect(() => {
    ticket.current += 1
    setList(null)
    setNotice(null)
    void (async () => {
      // 先把编辑页的改动写下去，「当前」才比得准。
      await outer.current.before?.()
      await refresh()
    })()
  }, [refresh])

  /** 一件改动：按住按钮 → before → 做 → 重新列 → 报一句。 */
  const act = useCallback(
    async (task: () => Promise<string>): Promise<boolean> => {
      setBusy(true)
      try {
        if ((await outer.current.before?.()) === false) {
          say('error', outer.current.t('ver.flushFailed'))
          return false
        }
        const text = await task()
        await refresh()
        outer.current.onChanged?.()
        say('ok', text)
        return true
      } catch (error) {
        say('error', errorMessage(error))
        await refresh()
        return false
      } finally {
        setBusy(false)
      }
    },
    [refresh, say],
  )

  const { t } = options
  return {
    list,
    busy,
    notice,
    refresh,
    save: (note) =>
      act(async () => {
        const { version } = await outer.current.rpc.call('graph/versionSave', { name, note })
        return t('ver.saved').replace('{n}', String(version.n))
      }),
    restore: (n) =>
      act(async () => {
        const { saved } = await outer.current.rpc.call('graph/versionRestore', { name, n })
        outer.current.onRestored?.()
        return saved === null
          ? t('ver.restored').replace('{n}', String(n))
          : t('ver.restoredAuto').replace('{n}', String(n)).replace('{m}', String(saved.n))
      }),
    setNote: async (n, note) => {
      try {
        const { version } = await outer.current.rpc.call('graph/versionNote', { name, n, note })
        setList((current) => current?.map((entry) => (entry.n === n ? version : entry)) ?? null)
        return true
      } catch (error) {
        say('error', errorMessage(error))
        return false
      }
    },
    remove: (n) =>
      act(async () => {
        await outer.current.rpc.call('graph/versionDelete', { name, n })
        return t('ver.deleted').replace('{n}', String(n))
      }),
    diff: async (n) => {
      try {
        const [version, current] = await Promise.all([
          outer.current.rpc.call('graph/versionLoad', { name, n }),
          outer.current.rpc.call('graph/load', { name }),
        ])
        return {
          changes: graphChanges(current.document, version.document),
          settings: !sameSettings(current.document.settings, version.document.settings),
          base: current.document,
          next: version.document,
        }
      } catch (error) {
        say('error', errorMessage(error))
        return null
      }
    },
  }
}
