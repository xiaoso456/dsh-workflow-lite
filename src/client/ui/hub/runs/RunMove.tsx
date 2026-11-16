/**
 * dsh-workflow-lite — 把一个实例移到本会话：图标按钮，点了在旁边浮出确认卡（说清原会话下就没有它了），确认了才移。
 * 在「信息」页签「会话与工作区」卡片的右上角。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/RunMove
 */

import type { T } from '../../../i18n.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'

export function RunMove(props: { t: T; onMove(): void }): React.JSX.Element {
  const { t } = props
  const confirm = useConfirm<HTMLButtonElement>()
  return (
    <>
      <button
        ref={confirm.anchorRef}
        type="button"
        className={cx(ui.btn, ui.icon, ui.small)}
        aria-label={t('hub.move')}
        aria-expanded={confirm.open}
        data-tip={confirm.open ? undefined : `${t('hub.move')}\n${t('hub.moveHint')}`}
        data-testid="wl-hub-move"
        onClick={confirm.toggle}
      >
        <Icon name="moveIn" size={14} />
      </button>
      {confirm.render({
        t,
        title: t('hub.moveConfirm'),
        desc: t('hub.moveHint'),
        confirmText: t('hub.moveDo'),
        danger: false,
        testId: 'wl-hub-move-confirm',
        onConfirm: props.onMove,
      })}
    </>
  )
}
