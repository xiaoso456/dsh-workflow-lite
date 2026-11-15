/**
 * dsh-workflow-lite — 触发卡片面板里「现在怎么样」的两块，只在模板视图里出现（实例里的卡片是快照，没有现场）：
 *
 * - {@link TriggerStatus}（面板最上面）：一个框里左边是开关和状态（色点和画布卡片、「触发」页同一套），
 *   右边是「立即触发一次」；刚发出去的那句话几秒内写在状态行上。出了要人处理的事（没发出去、出错、待确认……）
 *   在按钮前面亮一枚图标（{@link ProblemMark}），悬停看说明、点小卡里的按钮处理——不在框下面另起一段字，不挤动下面的东西。
 *   要在本机跑命令、还没确认过的卡片，打开前在开关旁边浮出确认卡，列出命令和工作区；
 * - {@link TriggerLog}（面板最下面）：最近几次触发记录，在自己的框里滚（最近的输出在「触发方式」对话框里）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerStatus
 */

import { commandOf } from '../../../shared/trigger.ts'
import type { TriggerData } from '../../../shared/types.ts'
import { firesSignal, useFires } from '../../app/useFires.ts'
import type { T } from '../../i18n.ts'
import { type Problem, problemOf } from '../../model/triggerProblem.ts'
import { stateText, stateTone } from '../../model/triggerText.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { SwitchTrack } from '../motion/marks.tsx'
import ins from '../panel/panel.module.css'
import { useApproveConfirm } from './ApproveConfirm.tsx'
import { FireList } from './FireList.tsx'
import { useFireNow } from './FireNow.tsx'
import { ProblemMark } from './ProblemMark.tsx'
import tone from './stateTone.module.css'
import css from './trigger.module.css'
import type { TriggerEnv } from './triggerEnv.ts'

/** 面板里列最近几条触发记录（全部的在工作流中心「触发」页），框里露出几行。 */
const SHOWN = 20
const ROWS = 5

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
  const fireNow = useFireNow({
    t,
    testId: 'wl-trigger',
    fire: (info) => env.triggers.fire(node, info),
  })
  const fired = fireNow.result

  /** 开关：要跑命令、还没确认的，在开关旁边问一句；别的直接开关。 */
  const onSwitch = (): void => {
    if (approve.open) {
      approve.hide()
      return
    }
    if (env.toggle(node, !on) === 'confirm') approve.show()
  }

  /** 小卡里的按钮：确认命令就在开关旁边问；重新打开同点开关（要确认的照样先问）。 */
  const onFix = (run: 'approve' | 'reopen'): void => {
    if (run === 'approve' || env.toggle(node, true) === 'confirm') approve.show()
  }

  // 「立即触发一次」没发出去的原因最要紧（刚点的），留到下一次；全部暂停着时说一句为什么不触发。
  const problem: Problem | null =
    fired?.tone === 'bad'
      ? { text: fired.text, tone: 'bad' }
      : state === 'paused'
        ? { text: t('trigger.pausedHint'), tone: 'calm' }
        : view === undefined
          ? null
          : problemOf(t, view, data.source, env.triggers.owner?.pid)

  return (
    <section className={ins.field} data-testid="wl-trigger-status" data-state={state}>
      <div className={css.statusCard}>
        <button
          ref={approve.anchorRef}
          type="button"
          role="switch"
          aria-checked={on}
          className={css.statusSwitch}
          data-testid="wl-trigger-enable"
          onClick={onSwitch}
        >
          <SwitchTrack on={on} />
          <span className={ins.requiredText}>
            <span className={ins.requiredTitle}>{t('trigger.switch')}</span>
            <span
              className={cx(css.statusLine, tone.tone)}
              data-tone={stateTone(state, data.source.kind)}
            >
              <span className={tone.dot} aria-hidden="true" />
              {/* 一直挂着，只换字：刚触发的那句话（正在发 / 已发进会话）先占这一行，过后回到状态。 */}
              <span className={css.statusText} data-testid="wl-trigger-state-text">
                {fired !== null && fired.tone !== 'bad'
                  ? fired.text
                  : // 定时规则下面已经写着下一次，这里不再说。
                    stateText(t, view, data.source.kind, Date.now(), {
                      next: data.source.kind !== 'schedule',
                    })}
              </span>
            </span>
          </span>
        </button>
        <span className={css.statusAction}>
          <ProblemMark t={t} problem={problem} testId="wl-trigger-problem" onAction={onFix} />
          {fireNow.button}
        </span>
      </div>
      {command !== undefined &&
        approve.render({
          t,
          command,
          workspace: view?.workspace,
          shell: view?.runShell,
          noCwd: t('trigger.confirmNoCwd'),
          testId: 'wl-trigger-approve',
          onApprove: (approved) => env.approve(node, approved),
        })}
    </section>
  )
}

/** 面板最下面：最近几次触发；「全部记录」到工作流中心「触发」页里这张卡片下面看。 */
export function TriggerLog(props: { t: T; env: TriggerEnv; node: string }): React.JSX.Element {
  const { t, env, node } = props
  const view = env.triggers.view(node)
  const fires = useFires(node, firesSignal(view?.last), () => env.triggers.history(node, SHOWN))
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
      <FireList
        t={t}
        fires={fires?.slice(0, SHOWN) ?? null}
        rows={ROWS}
        detail={env.triggers.detail}
        onOpenRun={env.openRun}
      />
    </section>
  )
}
