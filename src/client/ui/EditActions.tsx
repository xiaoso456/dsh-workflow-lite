/**
 * dsh-workflow-lite — 原地改名输入框末尾的「确认」「取消」两个小按钮。
 *
 * 输入框一失焦就会提交，所以按钮按下时不能抢走输入框的焦点（`mousedown` 里 `preventDefault`），
 * 不然点「取消」会先因为失焦被当成提交。键盘仍是回车确认、Esc 取消，按钮给只用鼠标的人一条明路。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/EditActions
 */

import type { T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import ui from './ui.module.css'

export function EditActions(props: {
  t: T
  onConfirm(): void
  onCancel(): void
}): React.JSX.Element {
  const { t } = props
  return (
    <span className={ui.editActions}>
      <button
        type="button"
        className={ui.editAction}
        data-tone="confirm"
        data-tip={`${t('common.confirm')} · Enter`}
        aria-label={t('common.confirm')}
        data-testid="wl-edit-confirm"
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onConfirm}
      >
        <Icon name="check" size={13} />
      </button>
      <button
        type="button"
        className={ui.editAction}
        data-tip={`${t('common.cancel')} · Esc`}
        aria-label={t('common.cancel')}
        data-testid="wl-edit-cancel"
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onCancel}
      >
        <Icon name="x" size={13} />
      </button>
    </span>
  )
}
