/**
 * dsh-workflow-lite — 触发卡片面板里「现在怎么样」的两块，只在模板视图里出现（实例里的卡片是快照，没有现场）：
 *
 * - {@link TriggerStatus}（面板最上面）：开关与状态、出了什么问题、「立即触发一次」。
 *   要在本机跑命令、还没确认过的卡片，打开前在开关旁边浮出确认卡，列出命令和工作区；
 * - {@link TriggerLog}（面板最下面）：最近几次触发记录（最近的输出在「触发方式」对话框里）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerStatus
 */

import { commandOf } from '../../../shared/trigger.ts'
import type { TriggerData } from '../../../shared/types.ts'
import { firesSignal, useFires } from '../../app/useFires.ts'
import type { T } from '../../i18n.ts'
import { stateText } from '../../model/triggerText.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { SwitchTrack } from '../motion/marks.tsx'
import ins from '../panel/panel.module.css'
import { useApproveConfirm } from './ApproveConfirm.tsx'
import { FireList } from './FireList.tsx'
import { FireNow } from './FireNow.tsx'
import css from './trigger.module.css'
import type { TriggerEnv } from './triggerEnv.ts'

/** 面板里列几条触发记录（全部的在工作流中心「触发」页）。 */
const SHOWN = 3

export function TriggerStatus(props: {
  t: T
  env: TriggerEnv
  node: string
  data: TriggerData
}): React.JSX.Element {
  const { t, env, node, data } = props
  const view = env.triggers.view(node)
  const on = view?.enabled === true
  const state = view?.state ?? 'off'
  const command = commandOf(data.source)
  const approve = useApproveConfirm<HTMLButtonElement>()

  /** 开关：要跑命令、还没确认的，在开关旁边问一句；别的直接开关。 */
  const onSwitch = (): void => {
    if (approve.open) {
      approve.hide()
      return
    }
    if (env.toggle(node, !on) === 'confirm') approve.show()
  }

  const problem =
    state === 'elsewhere' && env.triggers.owner !== undefined
      ? t('trigger.ownerOther').replace('{pid}', String(env.triggers.owner.pid))
      : state === 'stopped'
        ? `${view?.problem ?? ''} ${t('trigger.stoppedHint')}`
        : state === 'paused'
          ? t('trigger.pausedHint')
          : (view?.problem ?? '')
  const calm =
    state === 'elsewhere' || state === 'waiting' || state === 'listening' || state === 'paused'

  return (
    <section className={ins.field} data-testid="wl-trigger-status" data-state={state}>
      <button
        ref={approve.anchorRef}
        type="button"
        role="switch"
        aria-checked={on}
        className={ins.required}
        data-testid="wl-trigger-enable"
        onClick={onSwitch}
      >
        <SwitchTrack on={on} />
        <span className={ins.requiredText}>
          <span className={ins.requiredTitle}>{t('trigger.switch')}</span>
          <span className={ins.requiredDesc} data-testid="wl-trigger-state-text">
            {/* 定时规则下面已经写着下一次，这里不再说。 */}
            {stateText(t, view, data.source.kind, Date.now(), {
              next: data.source.kind !== 'schedule',
            })}
          </span>
        </span>
      </button>
      {command !== undefined &&
        approve.render({
          t,
          command,
          workspace: view?.workspace,
          noCwd: t('trigger.confirmNoCwd'),
          testId: 'wl-trigger-approve',
          onApprove: (approved) => env.approve(node, approved),
        })}
      {/* 一直挂着：没问题时是空的，出了问题只换字。 */}
      <p
        className={calm ? ins.help : ins.error}
        data-testid="wl-trigger-problem"
        hidden={problem.trim() === ''}
      >
        {problem}
      </p>
      {state === 'confirm' && (
        <button
          type="button"
          className={cx(ui.btn, ui.small, css.selfStart)}
          data-testid="wl-trigger-confirm-again"
          onClick={() => approve.show()}
        >
          {t('trigger.confirmAgain')}
        </button>
      )}
      <FireNow t={t} testId="wl-trigger" fire={(info) => env.triggers.fire(node, info)} />
    </section>
  )
}

/** 面板最下面：最近几次触发；「全部记录」到工作流中心「触发」页里这张卡片下面看。 */
export function TriggerLog(props: { t: T; env: TriggerEnv; node: string }): React.JSX.Element {
  const { t, env, node } = props
  const view = env.triggers.view(node)
  const fires = useFires(node, firesSignal(view?.last), () => env.triggers.history(node))
  return (
    <section className={ins.field} data-testid="wl-trigger-history">
      <div className={ins.label}>
        <span>{t('trigger.history')}</span>
        {fires !== null && fires.length > 0 && (
          <button
            type="button"
            className={cx(ui.btn, ui.small, css.historyAll)}
            data-testid="wl-trigger-history-all"
            onClick={() => env.openHistory(node)}
          >
            {t('trigger.historyAll')}
            <Icon name="arrowRight" size={13} />
          </button>
        )}
      </div>
      <FireList t={t} fires={fires?.slice(0, SHOWN) ?? null} onOpenRun={env.openRun} />
    </section>
  )
}
