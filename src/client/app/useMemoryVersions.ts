/**
 * dsh-workflow-lite — 一条记忆的版本：列、存、切、改说明、删（底子和工作流的版本同一套，见 {@link useVersionCore}）。
 *
 * 编辑页「版本」框的「记忆」一栏与工作流中心「记忆」页共用。版本是整个文件夹的拷贝；
 * 内容和某一版一样时存不了（按钮按住），切换前主机先把现在的内容自动存一份（内容一样就不存）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useMemoryVersions
 */

import { useCallback, useRef } from 'react'
import type { MemoryVersionEntry } from '../../shared/memoryLib.ts'
import type { T } from '../i18n.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { useVersionCore, type VersionActions } from './useVersions.ts'

export interface MemoryVersions extends VersionActions<MemoryVersionEntry> {
  save(note: string): Promise<boolean>
}

export function useMemoryVersions(options: {
  t: T
  rpc: WorkflowLiteRpc
  id: string
  /** 版本数、内容变了（记忆库那一行的「N 个版本」、大小跟上）。 */
  onChanged?: () => void
}): MemoryVersions {
  const { id, t } = options
  const outer = useRef(options)
  outer.current = options
  const load = useCallback(
    async () => (await outer.current.rpc.call('memory/versions', { id })).versions,
    [id],
  )
  const { list, setList, busy, notice, say, refresh, act } = useVersionCore({
    t,
    load,
    onChanged: () => outer.current.onChanged?.(),
  })
  const rpc = (): WorkflowLiteRpc => outer.current.rpc
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
