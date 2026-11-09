/**
 * dsh-workflow-lite — 点开一个文件夹资源的详情框：左边浏览（搜索、进子目录），右边预览选中的文件。
 *
 * 框子是 {@link DocViewer} 的小号：标题行有复制路径、用其他程序打开、关闭；这一项的说明收在「说明」开关里。
 * 可以复制路径、用其他程序打开或在文件管理器里显示；实例视图、记忆库、版本对话框等处都用它。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/files/FolderDialog
 */

import type { ResourceItem } from '../../../shared/types.ts'
import type { Desktop } from '../../app/desktop.ts'
import { type BrowseSource, browseKey, useBrowseFile } from '../../app/useBrowse.ts'
import type { T } from '../../i18n.ts'
import { fileBaseName } from '../../model/fileKind.ts'
import { shortTime } from '../../model/time.ts'
import { itemName } from '../kit/resourceUi.ts'
import { Badge } from './Badge.tsx'
import { type DocBody, DocViewer } from './DocViewer.tsx'
import { FolderBrowser } from './FolderBrowser.tsx'
import folderCss from './folder.module.css'

/**
 * 文件夹：左边浏览（搜索、进子目录、面包屑），右边预览选中的文件，见 {@link FolderBrowser}。
 * 这一项的说明（要求写在这里的东西）收在标题行的「说明」开关里，不占正文。
 * 从哪读由 `source` 定：实例里的资源（`runFolderSource`），或记忆库里的一条（`MemoryStore.source`）。
 */
export function FolderDialog(props: {
  t: T
  source: BrowseSource
  item: ResourceItem
  desktop: Desktop | undefined
  /** 文件夹还不存在时的说法（缺省「文件夹不存在」）。 */
  missing?: string
  /** 一打开先看里面的哪一份（画布图墙上点的那张）。 */
  initial?: string | undefined
  onClose(): void
}): React.JSX.Element {
  const { t, source } = props
  // 文件夹本身（`sub` 为空）：在不在、绝对路径、修改时间。
  const root = useBrowseFile(source, '')
  const settled = root.settled === browseKey(source, '')
  const file = settled ? root.file : null
  const error = settled ? root.error : null
  const folder = file?.kind === 'folder' ? file.path : null
  const display = file?.display ?? props.item.value
  const name = fileBaseName(display) || itemName(props.item)

  let body: DocBody
  if (error !== null) body = { kind: 'state', icon: 'alert', text: error }
  else if (file === null) body = { kind: 'loading' }
  else if (folder === null) {
    body = { kind: 'state', icon: 'folder', text: props.missing ?? t('res.folderMissing') }
  } else {
    body = {
      kind: 'node',
      node: (
        <FolderBrowser
          t={t}
          source={source}
          rootName={name}
          desktop={props.desktop}
          {...(props.initial === undefined ? {} : { initial: props.initial })}
        />
      ),
    }
  }

  return (
    <DocViewer
      t={t}
      name={name}
      badge={<Badge kind="folder" />}
      meta={
        <>
          <code>{display}</code>
          {folder !== null && file !== null && ` · ${t('file.modified')} ${shortTime(file.mtime)}`}
        </>
      }
      body={body}
      copyPath={file?.path ?? null}
      openPath={folder}
      desktop={props.desktop}
      testId="wl-folder-viewer"
      note={props.item.note ?? ''}
      className={folderCss.dialog}
      onClose={props.onClose}
    />
  )
}
