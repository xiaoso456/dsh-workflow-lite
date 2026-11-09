/**
 * dsh-workflow-lite — 点开一个自定义文字资源的详情框：整段排版显示，可以复制。
 *
 * 框子是 {@link DocViewer} 的小号；这一项的说明收在标题行的「说明」开关里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/files/TextDialog
 */

import type { ResourceItem } from '../../../shared/types.ts'
import type { Desktop } from '../../app/desktop.ts'
import type { T } from '../../i18n.ts'
import { itemName, KIND_LABEL } from '../kit/resourceUi.ts'
import { Badge } from './Badge.tsx'
import { DocViewer } from './DocViewer.tsx'

/** 自定义文字：整段排版显示。 */
export function TextDialog(props: {
  t: T
  item: ResourceItem
  desktop: Desktop | undefined
  onClose(): void
}): React.JSX.Element {
  const { t, item } = props
  const text = item.value.trim()
  return (
    <DocViewer
      t={t}
      name={itemName(item) || t(KIND_LABEL.text)}
      badge={<Badge kind="text" />}
      meta={t('res.textChars').replace('{n}', String([...text].length))}
      body={{ kind: 'text', text, format: 'markdown' }}
      copyPath={text === '' ? null : text}
      copyLabel={t('res.copyText')}
      openPath={null}
      desktop={props.desktop}
      testId="wl-text-viewer"
      note={item.note ?? ''}
      onClose={props.onClose}
    />
  )
}
