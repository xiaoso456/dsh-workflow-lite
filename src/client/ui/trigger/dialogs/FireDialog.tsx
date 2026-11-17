/**
 * dsh-workflow-lite — 一次触发的详情：结果、时刻与渠道，跳过 / 失败 / 不需要的原因全文，
 * 那一刻带的触发条件、触发说明、背景信息，记到了实例上的可以点过去看。
 *
 * 原因在记录里就有，打开就显示；触发说明这些要另读一次，读到了再接在下面。
 *
 * 排着的：标题写「排队中」，时刻写「收到」，第一行写排第几、在等的上次执行现在怎样（后面「打开会话 ↗」），
 * 底下左边「取消这一次」（浮出确认卡再取消，记成跳过），右边「上次执行视为已结束」（同样先问）。
 * 排过队才发出去的多一行「排队 4 分钟后发出（时刻）」。
 * 详情开着时这一次轮到了，外面换上新的记录，这里跟着变成「已发出」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/FireDialog
 */

import { useEffect, useRef, useState } from 'react'
import type { FireRecord, TriggerDetailResponse } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import {
  FIRE_CHANNEL_TEXT,
  FIRE_KIND_TEXT,
  fireKind,
  fireWhy,
  waited,
} from '../../../model/fireView.ts'
import { durationText, fullTime } from '../../../model/time.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Modal } from '../../kit/Modal.tsx'
import overlay from '../../kit/overlay.module.css'
import ui from '../../kit/ui.module.css'
import ins from '../../panel/panel.module.css'
import css from '../fires.module.css'
import { PrevRunNote } from '../PrevRunNote.tsx'
import type { PrevRunView } from '../triggerEnv.ts'
import { WaiveButton } from '../WaiveButton.tsx'

export function FireDialog(props: {
  t: T
  record: FireRecord
  detail(fire: string): Promise<TriggerDetailResponse>
  /** 打开它建出的实例；不给就不放这个按钮（已经在看这个实例了）。 */
  onOpenRun?(instance: string): void
  /** 排着的：排第几个（从 1 数）。 */
  place?: number | undefined
  /** 排着的在等的上次执行（还没结束时才有）。 */
  waiting?: PrevRunView | undefined
  /** 取消排着的这一次；取消不了回一句原因。不给就不放这个按钮。 */
  onCancel?(fire: string): Promise<string | null>
  /** 把上次执行视为已结束；做不了回一句原因。不给（或上次已经结束）就不放这个按钮。 */
  onWaive?(): Promise<string | null>
  onClose(): void
}): React.JSX.Element {
  const { t, record } = props
  const kind = fireKind(record)
  const why = fireWhy(record)
  const queued = kind === 'queued'
  const wait = waited(record)
  const cancel = useConfirm<HTMLButtonElement>()
  const [cancelling, setCancelling] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
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
            {record.name} · {t(FIRE_CHANNEL_TEXT[record.channel])} ·{' '}
            {queued
              ? t('trigger.fire.received').replace('{time}', fullTime(record.at))
              : fullTime(record.at)}
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
        {queued && (
          <p className={css.queueLine} data-testid="wl-trigger-fire-queue">
            {props.place !== undefined && (
              <span className={css.queuePlace}>
                {t('trigger.fire.place').replace('{n}', String(props.place))}
              </span>
            )}
            <span>{t('trigger.fire.waitPrev')}</span>
            {props.waiting !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <PrevRunNote
                  t={t}
                  prev={props.waiting}
                  testId="wl-trigger-fire-prev"
                  sessionTestId="wl-trigger-fire-session"
                />
              </>
            )}
          </p>
        )}
        {wait !== undefined && record.sentAt !== undefined && (
          <p className={ins.help} data-testid="wl-trigger-fire-waited">
            {t('trigger.fire.waited')
              .replace('{span}', durationText(t, wait))
              .replace('{time}', fullTime(record.sentAt))}
          </p>
        )}
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
      {queued && props.onCancel !== undefined && (
        <footer className={overlay.sheetFoot}>
          <button
            ref={cancel.anchorRef}
            type="button"
            className={cx(ui.btn, ui.small, ui.danger)}
            aria-expanded={cancel.open}
            disabled={cancelling}
            data-testid="wl-trigger-fire-cancel"
            onClick={cancel.toggle}
          >
            {t('trigger.fire.cancel')}
          </button>
          {cancel.render({
            t,
            title: t('trigger.fire.cancelTitle'),
            desc: t('trigger.fire.cancelDesc'),
            confirmText: t('trigger.fire.cancel'),
            testId: 'wl-trigger-fire-cancel-ok',
            onConfirm: () => {
              const run = props.onCancel
              if (run === undefined) return
              setCancelling(true)
              setProblem(null)
              void run(record.id).then((reason) => {
                setCancelling(false)
                if (reason === null) props.onClose()
                else setProblem(reason)
              })
            },
          })}
          {problem !== null && <span className={css.footProblem}>{problem}</span>}
          <span className={ui.grow} />
          {props.waiting !== undefined && props.onWaive !== undefined && (
            <WaiveButton
              t={t}
              long
              queued
              testId="wl-trigger-fire-waive"
              onWaive={props.onWaive}
              onProblem={setProblem}
            />
          )}
        </footer>
      )}
      {!queued && instance !== undefined && openRun !== undefined && (
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
