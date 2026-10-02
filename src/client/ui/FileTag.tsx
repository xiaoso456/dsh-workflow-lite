/**
 * dsh-workflow-lite — 文件的类型签：印扩展名，按类型配色（Markdown 蓝、代码绿、数据琥珀…）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FileTag
 */

import { extensionOf, fileKindOf } from '../model/fileKind.ts'
import css from './files.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'

export function FileTag(props: { path: string; large?: boolean }): React.JSX.Element {
  const ext = extensionOf(props.path)
  return (
    <span
      className={cx(css.tag, props.large === true && css.tagLarge)}
      data-file-kind={fileKindOf(props.path)}
      aria-hidden="true"
    >
      {ext === '' ? (
        <Icon name="file" size={props.large === true ? 14 : 12} />
      ) : (
        ext.toUpperCase().slice(0, 4)
      )}
    </span>
  )
}
