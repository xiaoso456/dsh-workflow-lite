/**
 * dsh-workflow-lite — 展示区里文件夹的文件列表：文件夹在前，一行一项或排成格子。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/FolderList
 */

import type { GalleryView as FolderSettings } from '../../../../shared/types.ts'
import type { RunDirEntry } from '../../../../shared/wire.ts'
import type { T } from '../../../i18n.ts'
import { formatBytes } from '../../../model/fileKind.ts'
import { folderOrder } from '../../../model/folderView.ts'
import { shortTime } from '../../../model/time.ts'
import { FileTag } from '../../files/FileTag.tsx'
import { Icon } from '../../kit/Icon.tsx'
import css from '../display.module.css'
import { DisplayState } from './DisplayState.tsx'

/** 列表最多排几项（再多写「还有 N 项」）。 */
const FOLDER_ROWS = 40

/**
 * 文件夹按文件列出（没有图片、或设成「文件列表」）：文件夹在前，其余按设置排。
 * 一行一项（右边大小，可带修改时间），或排成格子（大一号的类型标记、名字两行、大小）。
 */
export function FolderList(props: {
  t: T
  entries: readonly RunDirEntry[]
  view: FolderSettings
}): React.JSX.Element {
  const { t, view } = props
  if (props.entries.length === 0) {
    return <DisplayState icon="folder" title={t('display.folderEmpty')} />
  }
  const order = folderOrder(view.order)
  const sorted = [...props.entries].sort((a, b) => (a.dir === b.dir ? order(a, b) : a.dir ? -1 : 1))
  const rest = sorted.length - FOLDER_ROWS
  const grid = view.list === 'grid'
  // 子文件夹写里面有几项（全是图时写几张图），文件写大小。
  const meta = (entry: RunDirEntry): string | null => {
    if (!entry.dir) return formatBytes(entry.size)
    if (entry.items === undefined) return null
    const images = entry.images ?? 0
    return images > 0 && images === entry.items
      ? t('display.folderImages').replace('{n}', images.toLocaleString())
      : t('display.folderItems').replace('{n}', entry.items.toLocaleString())
  }
  const mark = (entry: RunDirEntry, large: boolean): React.JSX.Element =>
    entry.dir ? (
      <Icon name="folder" size={large ? 16 : 12} />
    ) : (
      <FileTag path={entry.name} large={large} />
    )
  return (
    <div className={css.flowClip}>
      <ul
        className={grid ? css.folderGrid : css.folderList}
        data-testid="wl-display-folder"
        data-layout={grid ? 'grid' : 'rows'}
      >
        {sorted.slice(0, FOLDER_ROWS).map((entry) =>
          grid ? (
            <li key={entry.name} className={css.folderCell}>
              <span className={css.folderCellIcon}>{mark(entry, true)}</span>
              <span className={css.folderCellName}>{entry.name}</span>
              {meta(entry) !== null && <span className={css.folderCellMeta}>{meta(entry)}</span>}
              {view.time === true && (
                <span className={css.folderCellMeta}>{shortTime(entry.mtime)}</span>
              )}
            </li>
          ) : (
            <li key={entry.name} className={css.folderRow}>
              <span className={css.folderIcon}>{mark(entry, false)}</span>
              <span className={css.folderName}>{entry.name}</span>
              {view.time === true && (
                <span className={css.folderTime}>{shortTime(entry.mtime)}</span>
              )}
              {meta(entry) !== null && (
                <span className={entry.dir ? css.folderTime : css.folderSize}>{meta(entry)}</span>
              )}
            </li>
          ),
        )}
        {/* 列得下时末尾写一共几项，几行字下面不至于空着一大块没有交代。 */}
        <li className={css.folderMore}>
          {rest > 0
            ? t('display.folderMore').replace('{n}', rest.toLocaleString())
            : t('display.folderTotal').replace('{n}', sorted.length.toLocaleString())}
        </li>
      </ul>
    </div>
  )
}
