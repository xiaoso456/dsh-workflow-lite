/**
 * dsh-workflow-lite — 实例视图里点开的三种查看框：文件查看框、展示卡上的文件夹、展示卡上的自定义文字。
 * 打开哪个由 `useDisplayCards` 记着；没打开的不渲染。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/runView/DisplayDialogs
 */

import type { ResourceItem } from '../../../../shared/types.ts'
import type { Desktop } from '../../../app/desktop.ts'
import { runFolderSource } from '../../../app/useBrowse.ts'
import type { T } from '../../../i18n.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { FileViewer } from '../../files/FileViewer.tsx'
import { FolderDialog } from '../../files/FolderDialog.tsx'
import { TextDialog } from '../../files/TextDialog.tsx'
import type { RunFolderView, RunViewer } from './useDisplayCards.ts'

export function DisplayDialogs({
  t,
  rpc,
  id,
  viewer,
  folderView,
  textView,
  stepNames,
  desktop,
  onCloseViewer,
  onCloseFolder,
  onCloseText,
}: {
  t: T
  rpc: WorkflowLiteRpc
  /** 实例 id。 */
  id: string
  viewer: RunViewer | null
  folderView: RunFolderView | null
  textView: ResourceItem | null
  /** 步骤 id → 名字。 */
  stepNames: Readonly<Record<string, string>>
  desktop: Desktop | undefined
  onCloseViewer(): void
  onCloseFolder(): void
  onCloseText(): void
}): React.JSX.Element {
  return (
    <>
      {viewer !== null && (
        <FileViewer
          t={t}
          rpc={rpc}
          instance={id}
          target={viewer.target}
          title={viewer.title}
          note={viewer.note}
          names={stepNames}
          filter={viewer.filter}
          desktop={desktop}
          onClose={onCloseViewer}
        />
      )}

      {folderView !== null && (
        <FolderDialog
          t={t}
          source={runFolderSource(rpc, id, folderView.node, folderView.item)}
          item={folderView.entry}
          initial={folderView.initial}
          desktop={desktop}
          onClose={onCloseFolder}
        />
      )}

      {textView !== null && (
        <TextDialog t={t} item={textView} desktop={desktop} onClose={onCloseText} />
      )}
    </>
  )
}
