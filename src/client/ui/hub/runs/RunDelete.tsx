/**
 * dsh-workflow-lite — 删除一个实例：{@link DeleteButton}，确认卡里问要不要连工作区里的状态文件一起删。
 * 在右栏标题栏末尾。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/RunDelete
 */

import { useState } from 'react'
import type { InstanceSummary } from '../../../../shared/runState.ts'
import type { T } from '../../../i18n.ts'
import { Checkbox } from '../../motion/marks.tsx'
import { DeleteButton } from '../DeleteButton.tsx'

export function RunDelete(props: {
  t: T
  item: InstanceSummary
  className: string
  testId: string
  onDelete(withState: boolean): void
}): React.JSX.Element {
  const { t, item } = props
  const [withState, setWithState] = useState(false)
  return (
    <DeleteButton
      t={t}
      className={props.className}
      testId={props.testId}
      confirmTestId="wl-hub-delete-confirm"
      title={t('hub.deleteConfirm')}
      onOpen={() => setWithState(false)}
      onConfirm={() => props.onDelete(withState)}
    >
      {item.statePath !== undefined && (
        <label>
          <Checkbox
            checked={withState}
            data-testid="wl-hub-delete-state"
            onChange={(event) => setWithState(event.currentTarget.checked)}
          />
          {t('hub.deleteState')}
        </label>
      )}
    </DeleteButton>
  )
}
