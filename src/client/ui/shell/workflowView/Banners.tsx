/**
 * dsh-workflow-lite — 画布顶上的三种提示条：有冲突、本会话出现了新实例、磁盘上的文件被外部改过。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/Banners
 */

import { SETTINGS_CONFLICT_ID } from '../../../../shared/model.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { T } from '../../../i18n.ts'
import css from '../../chrome/frame.module.css'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { ExitSeat } from '../../motion/exits.tsx'

export function Banners({
  t,
  wf,
  freshRun,
  openRun,
  setFreshRun,
}: {
  t: T
  wf: Workflow
  /** 本会话刚出现的新实例（没有就不提示）。 */
  freshRun: string | null
  openRun(id: string): void
  setFreshRun(value: null): void
}): React.JSX.Element {
  return (
    <>
      {wf.conflict !== null && (
        <ExitSeat className={css.bannerSeat} exit="up">
          <div className={cx(ui.panel, css.banner, css.bannerDanger, ui.rise)} role="alert">
            <Icon name="alert" size={15} />
            <span className={css.bannerText}>
              {t('banner.conflict')}
              {wf.conflict.length > 0 && (
                <span className={css.bannerIds}>
                  {' · '}
                  {wf.conflict
                    .map((id) => (id === SETTINGS_CONFLICT_ID ? t('settings.conflict') : id))
                    .join(', ')}
                </span>
              )}
            </span>
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.primary)}
              onClick={wf.keepMine}
            >
              {t('banner.keepMine')}
            </button>
            <button type="button" className={cx(ui.btn, ui.small, ui.soft)} onClick={wf.reload}>
              {t('banner.useDisk')}
            </button>
          </div>
        </ExitSeat>
      )}
      {wf.conflict === null && !wf.external && freshRun !== null && (
        <ExitSeat className={css.bannerSeat} exit="up">
          <div
            className={cx(ui.panel, css.banner, ui.rise)}
            role="status"
            data-testid="wl-fresh-run"
          >
            <Icon name="play" size={15} />
            <span className={css.bannerText}>{t('run.freshBanner')}</span>
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.primary)}
              onClick={() => openRun(freshRun)}
            >
              {t('run.freshOpen')}
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('common.close')}
              onClick={() => setFreshRun(null)}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </ExitSeat>
      )}
      {wf.conflict === null && wf.external && (
        <ExitSeat className={css.bannerSeat} exit="up">
          <div className={cx(ui.panel, css.banner, ui.rise)} role="status">
            <Icon name="info" size={15} />
            <span className={css.bannerText}>{t('banner.external')}</span>
            <button type="button" className={cx(ui.btn, ui.small, ui.soft)} onClick={wf.reload}>
              {t('banner.reload')}
            </button>
          </div>
        </ExitSeat>
      )}
    </>
  )
}
