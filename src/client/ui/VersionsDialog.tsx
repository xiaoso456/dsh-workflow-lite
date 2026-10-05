/**
 * dsh-workflow-lite — 编辑页的「版本」对话框：正开着的这张工作流的版本（内容见 {@link VersionList}）。
 *
 * 动手之前先把还没写下去的改动存掉（版本存的是磁盘上那份）；切换写回之后按磁盘重新加载画布。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/VersionsDialog
 */

import type { T } from '../i18n.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { Icon } from './Icon.tsx'
import overlay from './overlay.module.css'
import { cx, Modal } from './primitives.tsx'
import ui from './ui.module.css'
import { VersionList } from './VersionList.tsx'
import v from './versions.module.css'

export function VersionsDialog(props: {
  t: T
  rpc: WorkflowLiteRpc
  name: string
  flush(): Promise<boolean>
  onRestored(): void
  onChanged(): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  return (
    <Modal
      label={t('ver.title')}
      onDismiss={props.onClose}
      className={cx(overlay.sheet, v.dialog)}
      testId="wl-versions-dialog"
    >
      <header className={overlay.sheetHead}>
        <span className={overlay.sheetIcon}>
          <Icon name="history" size={16} />
        </span>
        <div className={overlay.sheetTitles}>
          <p className={overlay.sheetTitle}>{t('ver.title')}</p>
          <p className={overlay.sheetSub}>{props.name}</p>
        </div>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={props.onClose}
        >
          <Icon name="x" size={15} />
        </button>
      </header>
      <div className={overlay.sheetBody}>
        <VersionList
          t={t}
          rpc={props.rpc}
          name={props.name}
          before={props.flush}
          onRestored={props.onRestored}
          onChanged={props.onChanged}
        />
      </div>
    </Modal>
  )
}
