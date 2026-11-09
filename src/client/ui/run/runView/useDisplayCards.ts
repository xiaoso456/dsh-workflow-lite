/**
 * dsh-workflow-lite — 实例画布上的展示卡：点开文件、文字、文件夹时用的三份「正在看什么」，
 * 以及交给画布的 `display`（展示卡读文件状态、各轮的步骤名、点开的入口都在里面）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/runView/useDisplayCards
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { isResource, isStep } from '../../../../shared/model.ts'
import type {
  LineFilter,
  ResourceItem,
  ResourceNode,
  WorkflowDocument,
} from '../../../../shared/types.ts'
import { useDisplayStats } from '../../../app/useDisplayStats.ts'
import type { FileTarget } from '../../../app/useRunFile.ts'
import { type Run, runPollMs } from '../../../app/useRuns.ts'
import { fileBaseName } from '../../../model/fileKind.ts'
import { nodeTitle } from '../../../model/nodeName.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'

/** 查看框里打开着的文件。 */
export interface RunViewer {
  target: FileTarget
  title: string
  note?: string | undefined
  /** 从展示卡打开：卡片上「只看」的筛选。 */
  filter?: LineFilter | undefined
}

/** 展示卡上打开的文件夹（图墙里点了一张就先看那一张）。 */
export interface RunFolderView {
  node: string
  item: number
  entry: ResourceItem
  initial?: string | undefined
}

export interface DisplayCardsInput {
  rpc: WorkflowLiteRpc
  id: string
  doc: WorkflowDocument | null
  current: Run
}

export function useDisplayCards({ rpc, id, doc, current }: DisplayCardsInput) {
  const [viewer, setViewer] = useState<RunViewer | null>(null)
  /** 展示卡上打开的自定义文字（文件走上面的查看框）。 */
  const [textView, setTextView] = useState<ResourceItem | null>(null)
  const [folderView, setFolderView] = useState<RunFolderView | null>(null)
  /** 画布上展示着的文件：隔一会儿看一眼在不在、改没改。 */
  const displayStats = useDisplayStats(rpc, id, doc, runPollMs(current.view))
  /** 步骤 id → 名字：展示卡上各轮的点写「改稿 · 第 2 轮」。 */
  const stepNames = useMemo(
    () =>
      Object.fromEntries(
        (doc?.nodes ?? []).filter(isStep).map((node) => [node.id, nodeTitle(node)]),
      ),
    [doc],
  )
  const displayRun = useMemo(
    () => ({ rpc, instance: id, stats: displayStats, names: stepNames }),
    [rpc, id, displayStats, stepNames],
  )
  const docRef = useRef(doc)
  docRef.current = doc
  const openDisplay = useCallback((node: string, item: number, sub?: string): void => {
    const found = docRef.current?.nodes.find(
      (candidate): candidate is ResourceNode => candidate.id === node && isResource(candidate),
    )
    const entry = found?.data.items[item]
    if (entry === undefined) return
    if (entry.kind === 'text') setTextView(entry)
    else if (entry.kind === 'folder') setFolderView({ node, item, entry, initial: sub })
    else {
      setViewer({
        target: { node, item },
        title: fileBaseName(entry.value),
        note: entry.note,
        filter: found?.data.view?.lines?.filter,
      })
    }
  }, [])
  const display = useMemo(() => ({ run: displayRun, open: openDisplay }), [displayRun, openDisplay])
  return { viewer, setViewer, textView, setTextView, folderView, setFolderView, stepNames, display }
}
