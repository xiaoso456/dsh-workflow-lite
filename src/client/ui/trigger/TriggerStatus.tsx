/**
 * dsh-workflow-lite — 触发卡片面板里「现在怎么样」的两块，只在模板视图里出现（实例里的卡片是快照，没有现场）：
 *
 * - {@link TriggerStatus}（面板最上面）：开关与状态、出了什么问题、「立即触发一次」。
 *   要在本机跑命令、还没确认过的卡片，打开前在开关旁边浮出确认卡，列出命令和工作区；
 * - {@link TriggerLog}（面板最下面）：最近的输出（轮询、监听）和最近的触发记录。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerStatus
 */

import { useEffect, useState } from 'react'
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

/** 面板里列几条触发记录。 */
const SHOWN = 8

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

/** 面板最下面：最近的输出（要跑命令的才有）和最近的触发记录。 */
export function TriggerLog(props: {
  t: T
  env: TriggerEnv
  node: string
  data: TriggerData
}): React.JSX.Element {
  const { t, env, node } = props
  const view = env.triggers.view(node)
  const fires = useFires(node, firesSignal(view?.last), () => env.triggers.history(node))
  return (
    <>
      {commandOf(props.data.source) !== undefined && <RecentOutput t={t} env={env} node={node} />}
      <section className={ins.field} data-testid="wl-trigger-history">
        <div className={ins.label}>
          <span>{t('trigger.history')}</span>
          <span className={ins.count}>
            {fires === null || fires.length === 0 ? '' : Math.min(fires.length, SHOWN)}
          </span>
        </div>
        <FireList t={t} fires={fires?.slice(0, SHOWN) ?? null} onOpenRun={env.openRun} />
      </section>
    </>
  )
}

/**
 * 轮询命令、监听程序最近的输出：点开才读；开着时卡片状态一变（又检查了一次、程序重启了）就再读一次。
 * 只换文字，不插拔元素。
 */
function RecentOutput(props: { t: T; env: TriggerEnv; node: string }): React.JSX.Element {
  const { t, env, node } = props
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const view = env.triggers.view(node)
  const stamp = `${view?.state ?? ''}|${String(view?.checked?.at ?? '')}|${String(view?.since ?? '')}|${String(view?.next ?? '')}`
  useEffect(() => {
    if (!open) return
    let alive = true
    void env.triggers.output(node).then((value) => {
      if (alive) setText(value)
    })
    return () => {
      alive = false
    }
  }, [open, env.triggers.output, node, stamp])
  return (
    <section className={ins.field} data-testid="wl-trigger-output">
      <div className={ins.label}>
        <span>{t('trigger.output')}</span>
      </div>
      <button
        type="button"
        className={cx(ui.btn, ui.small, css.selfStart)}
        aria-expanded={open}
        data-testid="wl-trigger-output-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} />
        {t(open ? 'trigger.outputHide' : 'trigger.outputShow')}
      </button>
      {open && (
        <pre className={css.output} data-testid="wl-trigger-output-text">
          {text === '' ? t('trigger.outputEmpty') : text}
        </pre>
      )}
    </section>
  )
}
