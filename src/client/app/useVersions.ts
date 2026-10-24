/**
 * dsh-workflow-lite — 一个工作流的版本：列、存、切、改说明、删，外加「切到这一版会变什么」。
 *
 * 编辑页的「版本」对话框和工作流中心的「工作流」页共用它。版本存的是**磁盘上**那份：
 * 动手之前先调 `before()`（编辑页正开着这张图时把还没写下去的改动存掉）；
 * 切换写回了工作流之后调 `onRestored()`（正开着就按磁盘重新加载）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useVersions
 */

import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'
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

/** 一列版本共有的那几件事：列、存、切、改说明、删（工作流的、记忆的都是这一套）。 */
export interface VersionActions<E> {
  /** `null` = 还在读。 */
  list: E[] | null
  /** 正在做的那件事（按钮按住）。 */
  busy: boolean
  notice: VersionNotice | null
  refresh(): Promise<void>
  restore(n: number): Promise<boolean>
  setNote(n: number, note: string): Promise<boolean>
  remove(n: number): Promise<boolean>
}

export interface Versions extends VersionActions<VersionEntry> {
  /** `memories` = 连同这张引用的记忆一起存一版。 */
  save(note: string, memories?: boolean): Promise<boolean>
  diff(n: number): Promise<VersionDiff | null>
}

/** {@link useVersionCore} 拿回来的：列表、提示，和「一件改动」的做法。 */
export interface VersionCore<E> {
  list: E[] | null
  setList: Dispatch<SetStateAction<E[] | null>>
  busy: boolean
  notice: VersionNotice | null
  say(tone: VersionNotice['tone'], text: string): void
  refresh(): Promise<void>
  /** 一件改动：按住按钮 → before → 做 → 重新列 → 报一句。 */
  act(task: () => Promise<string>): Promise<boolean>
}

/**
 * 版本列表的底子：`load` 换了（换了一张工作流、一条记忆）就清空重读，上一份的回包不要；
 * 成功的提示过一会儿自己淡掉，出错的留着。
 */
export function useVersionCore<E>(options: {
  t: T
  load: () => Promise<E[]>
  before?: (() => Promise<boolean>) | undefined
  onChanged?: (() => void) | undefined
}): VersionCore<E> {
  const { load } = options
  const [list, setList] = useState<E[] | null>(null)
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
      const result = await load()
      if (mine === ticket.current) setList(result)
    } catch (error) {
      if (mine !== ticket.current) return
      setList([])
      say('error', errorMessage(error))
    }
  }, [load, say])

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

  return { list, setList, busy, notice, say, refresh, act }
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
  /** 连同记忆存了版本（记忆那边的列表跟上）。 */
  onMemoriesSaved?: () => void
}): Versions {
  const { name } = options
  const outer = useRef(options)
  outer.current = options
  const load = useCallback(
    async () => (await outer.current.rpc.call('graph/versions', { name })).versions,
    [name],
  )
  const { list, setList, busy, notice, say, refresh, act } = useVersionCore({
    t: options.t,
    load,
    before: options.before,
    onChanged: options.onChanged,
  })

  const { t } = options
  return {
    list,
    busy,
    notice,
    refresh,
    save: (note, memories) =>
      act(async () => {
        const result = await outer.current.rpc.call('graph/versionSave', {
          name,
          note,
          ...(memories === true ? { memories: true } : {}),
        })
        const text =
          result.version === null
            ? t('ver.sameKept').replace('{n}', String(result.same ?? ''))
            : t('ver.saved').replace('{n}', String(result.version.n))
        if (result.memories === undefined) return text
        outer.current.onMemoriesSaved?.()
        return `${text}${memoriesSavedText(t, result.memories)}`
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

/** 连同记忆存版本之后补的那半句：存了几条、几条没变、几条没存成。 */
function memoriesSavedText(t: T, rows: readonly { version: unknown; error?: string }[]): string {
  const saved = rows.filter((row) => row.version !== null).length
  const failed = rows.filter((row) => row.error !== undefined).length
  const same = rows.length - saved - failed
  const parts = [
    saved > 0 ? t('ver.memSaved').replace('{n}', String(saved)) : null,
    same > 0 ? t('ver.memSame').replace('{n}', String(same)) : null,
    failed > 0 ? t('ver.memFailed').replace('{n}', String(failed)) : null,
  ].filter((part) => part !== null)
  return parts.length === 0 ? '' : `${t('ver.memJoin')}${parts.join(t('ver.memJoin'))}`
}
