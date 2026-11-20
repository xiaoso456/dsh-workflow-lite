/**
 * dsh-workflow-lite — 一条记忆的版本：列、存、切、改说明、删（底子和工作流的版本同一套，见 {@link useVersionCore}）。
 *
 * 编辑页「版本」框的「记忆」一栏与工作流中心「记忆」页共用。版本是整个文件夹的拷贝；
 * 内容和某一版一样时存不了（按钮按住），切换前主机先把现在的内容自动存一份（内容一样就不存）。
 * 记忆会被执行中的模型改，所以开着的时候隔几秒、窗口重新获得焦点时悄悄重读一遍，「当前」跟着磁盘走。
 * 读回来的按「记忆 + 信号」留一份（同工作流的版本）：「记忆」页换到读过的那条直接用，换之前也能先读好
 * （{@link primeMemoryVersions}），右栏不先空一下再出来。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useMemoryVersions
 */

import { useCallback, useEffect, useRef } from 'react'
import type { MemoryVersionEntry } from '../../shared/memoryLib.ts'
import type { T } from '../i18n.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { type ReadSignal, readCache } from './readCache.ts'
import { useVersionCore, type VersionActions } from './useVersions.ts'

/** 开着的时候多久悄悄重读一次。 */
const POLL_MS = 5000

const memoryVersionsRead = readCache<MemoryVersionEntry[]>({ entries: 40 })

/** 换到这条记忆之前先把版本读好；已经有了回 `null`。读不出来也算读完（换过去照常读、报错）。 */
export function primeMemoryVersions(
  rpc: WorkflowLiteRpc,
  id: string,
  signal: ReadSignal,
): Promise<void> | null {
  if (memoryVersionsRead.get(id, signal) !== undefined) return null
  return rpc.call('memory/versions', { id }).then(
    (result) => memoryVersionsRead.put(id, signal, result.versions),
    () => undefined,
  )
}

export interface MemoryVersions extends VersionActions<MemoryVersionEntry> {
  save(note: string): Promise<boolean>
}

export function useMemoryVersions(options: {
  t: T
  rpc: WorkflowLiteRpc
  id: string
  /** 这条记忆的信号（修改时间、版本数）：给了，读过的那份先拿来用。 */
  signal?: ReadSignal
  /** 版本数、内容变了（记忆库那一行的「N 个版本」、大小跟上）。 */
  onChanged?: () => void
}): MemoryVersions {
  const { id, t } = options
  const outer = useRef(options)
  outer.current = options
  const load = useCallback(async () => {
    const { versions } = await outer.current.rpc.call('memory/versions', { id })
    const { signal } = outer.current
    if (signal !== undefined) memoryVersionsRead.put(id, signal, versions)
    return versions
  }, [id])
  const { list, setList, busy, notice, say, refresh, act } = useVersionCore({
    t,
    load,
    subject: id,
    initial: options.signal === undefined ? undefined : memoryVersionsRead.get(id, options.signal),
    onChanged: () => outer.current.onChanged?.(),
  })
  const rpc = (): WorkflowLiteRpc => outer.current.rpc
  const busyRef = useRef(busy)
  busyRef.current = busy
  useEffect(() => {
    let live = true
    const poll = async (): Promise<void> => {
      if (document.hidden || busyRef.current) return
      try {
        const next = await load()
        // 重读的路上用户点了按钮：那一边自己会重列，这一份是旧的。
        if (live && !busyRef.current) setList(next)
      } catch {
        // 悄悄重读，读不出来就留着现在的，不打扰。
      }
    }
    const timer = window.setInterval(() => void poll(), POLL_MS)
    window.addEventListener('focus', poll)
    return () => {
      live = false
      window.clearInterval(timer)
      window.removeEventListener('focus', poll)
    }
  }, [load, setList])
  return {
    list,
    busy,
    notice,
    refresh,
    save: (note) =>
      act(async () => {
        const { version } = await rpc().call('memory/versionSave', { id, note })
        return t('ver.saved').replace('{n}', String(version.n))
      }),
    restore: (n) =>
      act(async () => {
        const { saved } = await rpc().call('memory/versionRestore', { id, n })
        return saved === null
          ? t('ver.restored').replace('{n}', String(n))
          : t('ver.restoredAuto').replace('{n}', String(n)).replace('{m}', String(saved.n))
      }),
    setNote: async (n, note) => {
      try {
        const { version } = await rpc().call('memory/versionNote', { id, n, note })
        setList((current) => current?.map((entry) => (entry.n === n ? version : entry)) ?? null)
        return true
      } catch (error) {
        say('error', errorMessage(error))
        return false
      }
    },
    remove: (n) =>
      act(async () => {
        await rpc().call('memory/versionDelete', { id, n })
        return t('ver.deleted').replace('{n}', String(n))
      }),
  }
}
