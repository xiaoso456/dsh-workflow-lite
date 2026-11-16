/**
 * dsh-workflow-lite — 一次触发的详情（只读）：结果、时刻与渠道，跳过 / 失败 / 不需要的原因全文，
 * 那一刻带的触发条件、触发说明、背景信息，记到了实例上的可以点过去看。
 *
 * 原因在记录里就有，打开就显示；触发说明这些要另读一次，读到了再接在下面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/FireDialog
 */

import { useEffect, useRef, useState } from 'react'
import type { FireRecord, TriggerDetailResponse } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { FIRE_CHANNEL_TEXT, FIRE_KIND_TEXT, fireKind, fireWhy } from '../../../model/fireView.ts'
import { fullTime } from '../../../model/time.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Modal } from '../../kit/Modal.tsx'
import overlay from '../../kit/overlay.module.css'
import ui from '../../kit/ui.module.css'
import ins from '../../panel/panel.module.css'
import css from '../fires.module.css'

export function FireDialog(props: {
  t: T
  record: FireRecord
  detail(fire: string): Promise<TriggerDetailResponse>
  /** 打开它建出的实例；不给就不放这个按钮（已经在看这个实例了）。 */
  onOpenRun?(instance: string): void
  onClose(): void
}): React.JSX.Element {
  const { t, record } = props
  const kind = fireKind(record)
  const why = fireWhy(record)
  const [detail, setDetail] = useState<TriggerDetailResponse | null>(null)
  const read = useRef(props.detail)
  read.current = props.detail
  useEffect(() => {
    let alive = true
    void read.current(record.id).then((found) => {
      if (alive) setDetail(found)
    })
    return () => {
      alive = false
    }
  }, [record.id])

  const { instance } = record
  const openRun = props.onOpenRun
  const plain =
    detail !== null &&
    detail.note === undefined &&
    detail.condition === undefined &&
    detail.info === undefined
  return (
    <Modal
      label={t('trigger.fireDetail')}
      testId="wl-trigger-fire-dialog"
      className={overlay.sheet}
      onDismiss={props.onClose}
    >
      <header className={overlay.sheetHead}>
        <div className={overlay.sheetTitles}>
          <p className={cx(overlay.sheetTitle, css.dialogTitle)} data-outcome={kind}>
            <span className={css.dot} aria-hidden="true" />
            <span data-testid="wl-trigger-fire-outcome">{t(FIRE_KIND_TEXT[kind])}</span>
          </p>
          <p className={overlay.sheetSub}>
            {record.name} · {t(FIRE_CHANNEL_TEXT[record.channel])} · {fullTime(record.at)}
          </p>
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
        {why !== undefined && (
          <Block
            title={t(kind === 'declined' ? 'trigger.fire.declinedReason' : 'trigger.fire.reason')}
            text={why}
            testId="wl-trigger-fire-why"
          />
        )}
        {detail?.merged !== undefined && (
          <p className={ins.help}>
            {t('trigger.fire.merged').replace('{count}', String(detail.merged))}
          </p>
        )}
        {detail?.condition !== undefined && (
          <Block title={t('trigger.condition')} text={detail.condition} />
        )}
        {detail?.note !== undefined && (
          <Block title={t('origin.note')} text={detail.note} testId="wl-trigger-fire-note" />
        )}
        {detail?.info !== undefined && (
          <Block
            title={t('origin.info')}
            text={detail.info}
            hint={detail.infoClipped === true ? t('trigger.fire.infoClipped') : undefined}
            testId="wl-trigger-fire-info"
          />
        )}
        {plain && why === undefined && <p className={ins.help}>{t('trigger.fire.plain')}</p>}
      </div>
      {instance !== undefined && openRun !== undefined && (
        <footer className={overlay.sheetFoot}>
          <span className={ui.grow} />
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            data-testid="wl-trigger-fire-open-run"
            onClick={() => {
              props.onClose()
              openRun(instance)
            }}
          >
            {t('trigger.openRun')}
            <Icon name="arrowRight" size={13} />
          </button>
        </footer>
      )}
    </Modal>
  )
}

/** 详情里的一段：小标题 + 原样分行的文字，太长了自己滚。 */
function Block(props: {
  title: string
  text: string
  hint?: string | undefined
  testId?: string
}): React.JSX.Element {
  return (
    <section className={css.block}>
      <p className={css.blockTitle}>{props.title}</p>
      <p className={css.blockText} data-testid={props.testId}>
        {props.text}
      </p>
      {props.hint !== undefined && <p className={ins.help}>{props.hint}</p>}
    </section>
  )
}
