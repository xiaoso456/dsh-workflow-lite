/**
 * dsh-workflow-lite — 「触发」页右栏上面固定的一块（换页签不动）：
 *
 * - 头部：触发方式的图标块、名字、所在工作流和「方式 · 主动 / 被动」两枚小签，下面一句什么时候执行；
 *   右边开关（和左栏同一个）、在画布上打开；
 * - 全部暂停着时一条说明，带「恢复」；
 * - 状态条一行：状态 | 下一次（时刻 + 还有多久，定时 / 轮询底边一条倒计时）| 立即触发一次；
 *   刚触发的结果几秒内占「下一次」那一格；
 * - 出了要人处理的事，状态后面亮一枚小图标（不另起一行、不挤动版面）：悬停、聚焦、点它浮出一张小卡，
 *   写着怎么回事，带能直接做的事（确认并打开、确认命令、重新打开）。
 *
 * 会自己走的字（还有多久、已运行多久）每秒换一次，只在状态条这一小块里换，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TriggerHead
 */

import { useState } from 'react'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { useNow } from '../../../app/useNow.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { triggerMode } from '../../../model/triggerGlance.ts'
import { statusWhen } from '../../../model/triggerNow.ts'
import { problemOf } from '../../../model/triggerProblem.ts'
import { sourceSay } from '../../../model/triggerSay.ts'
import { stateBadge, stateTone } from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { SwitchTrack } from '../../motion/marks.tsx'
import { CountdownLine } from '../../trigger/CountdownLine.tsx'
import { useFireNow } from '../../trigger/FireNow.tsx'
import { ProblemMark } from '../../trigger/ProblemMark.tsx'
import tone from '../../trigger/stateTone.module.css'
import { TriggerMark } from '../../trigger/TriggerMark.tsx'
import css from './head.module.css'
import { useCardSwitch } from './useCardSwitch.tsx'

export function TriggerHead(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  /** 全部暂停着：从什么时候起。 */
  paused: number | undefined
  onOpenCard(): void
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, entry } = props
  const { source } = entry.data
  const kind = source.kind
  const toggle = useCardSwitch<HTMLButtonElement>({
    t,
    hub: props.hub,
    entry,
    testId: 'wl-hub-trg-approve',
    onNotice: props.onNotice,
  })
  const on = entry.view.enabled
  const mode = triggerMode(kind)
  return (
    <div className={css.fixed}>
      <div className={css.head}>
        <TriggerMark kind={kind} size={18} className={css.mark} />
        <div className={css.titles}>
          <div className={css.nameLine}>
            <span className={css.name} data-testid="wl-hub-trg-name">
              {entry.name}
            </span>
            <span className={css.tag}>
              <Icon name="hub" size={11} />
              {entry.workflow}
            </span>
            <span className={cx(css.tag, css.kindTag)}>
              {t(`trigger.source.${kind}` as LocaleKey)} ·{' '}
              {t(mode === 'active' ? 'trigger.mode.active' : 'trigger.mode.passive')}
            </span>
          </div>
          <p className={css.say} data-tip={sourceSay(t, source)}>
            {sourceSay(t, source)}
          </p>
        </div>
        <div className={css.actions}>
          <button
            ref={toggle.anchorRef}
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${t('trigger.switch')} ${entry.name}`}
            className={css.onoff}
            data-testid="wl-hub-trg-head-switch"
            onClick={toggle.flip}
          >
            <span className={css.onoffText}>{t(on ? 'hub.trgIsOn' : 'hub.trgIsOff')}</span>
            <SwitchTrack on={on} />
          </button>
          {toggle.confirm}
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t('hub.trgOpen')}
            data-tip={t('hub.trgOpenTip')}
            data-testid="wl-hub-trg-open"
            onClick={props.onOpenCard}
          >
            <Icon name="external" size={14} />
          </button>
        </div>
      </div>
      <PausedNote t={t} hub={props.hub} paused={props.paused} onNotice={props.onNotice} />
      <StatusBar t={t} hub={props.hub} entry={entry} onNotice={props.onNotice} />
    </div>
  )
}

/** 全部暂停着时的一条说明，带「恢复」。一直挂着，不暂停时收起。 */
function PausedNote(props: {
  t: T
  hub: TriggerHub
  paused: number | undefined
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t } = props
  const [busy, setBusy] = useState(false)
  const resume = async (): Promise<void> => {
    setBusy(true)
    const problem = await props.hub.pause(false)
    setBusy(false)
    if (problem !== null) props.onNotice(problem, 'error')
  }
  return (
    <div
      className={css.pausedNote}
      hidden={props.paused === undefined}
      data-testid="wl-hub-trg-paused"
    >
      <Icon name="pause" size={13} />
      <span className={css.pausedText}>{t('hub.trgPausedNote')}</span>
      <button
        type="button"
        className={cx(ui.btn, ui.small)}
        disabled={busy}
        onClick={() => void resume()}
      >
        {t('hub.trgResume')}
      </button>
    </div>
  )
}

function StatusBar(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, entry } = props
  const { view } = entry
  const { source } = entry.data
  const now = useNow(1000)
  const fireNow = useFireNow({
    t,
    testId: 'wl-hub-trg',
    fire: (info) => props.hub.fire(entry.workflow, view.node, info),
  })
  const fixer = useCardSwitch<HTMLButtonElement>({
    t,
    hub: props.hub,
    entry,
    testId: 'wl-hub-trg-fix-approve',
    onNotice: props.onNotice,
  })
  const fired = fireNow.result
  const when = statusWhen(t, entry, now)
  const problem = problemOf(t, view, source, props.hub.list?.owner?.pid)
  // 倒计时：轮询按间隔，定时只有「每隔多久」知道这一段多长。
  const span =
    source.kind === 'poll'
      ? source.seconds
      : source.kind === 'schedule' && source.schedule.kind === 'every'
        ? source.schedule.minutes * 60
        : 0
  const counting = (view.state === 'waiting' || view.state === 'elsewhere') && span > 0
  return (
    <div className={css.status}>
      <div className={css.statusMain}>
        <span
          className={cx(css.state, tone.tone)}
          data-state={view.state}
          data-tone={stateTone(view.state, source.kind)}
          data-testid="wl-hub-trg-detail-state"
        >
          <span className={cx(tone.dot, css.stateDot)} aria-hidden="true" />
          {stateBadge(t, view, source.kind)}
        </span>
        <ProblemMark
          t={t}
          problem={problem}
          testId="wl-hub-trg-problem"
          anchorRef={fixer.anchorRef}
          className={css.problemMark}
          onAction={fixer.turnOn}
        />
        {fixer.confirm}
        <span className={css.sep} aria-hidden="true" />
        <span className={css.when} data-fired={fired?.tone} data-testid="wl-hub-trg-fire-result">
          {fired === null ? (
            <>
              <span className={css.whenMain}>{when.main}</span>
              <span className={css.whenAside}>{when.aside}</span>
            </>
          ) : (
            <span className={css.whenMain}>{fired.text}</span>
          )}
        </span>
        <span className={css.fire}>{fireNow.button}</span>
        <CountdownLine next={counting ? view.next : undefined} seconds={span} />
      </div>
    </div>
  )
}
