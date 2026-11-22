/**
 * dsh-workflow-lite — 「触发」页右栏上面固定的一块（换页签不动）：
 *
 * - 头部：触发方式的图标块、名字（点名字或后面的铅笔就地改名，见 {@link TitleEdit}）、所在工作流和
 *   「方式 · 主动 / 被动」两枚小签，下面一句什么时候执行；
 *   右边开关（和左栏同一个）、在画布上打开；
 * - 状态条一行：状态 | 下一次（时刻 + 还有多久，「每隔」的底边一条倒计时）|（有排着的）排队 3 个 | 立即触发一次；
 *   刚触发的结果几秒内占「下一次」那一格；
 * - 出了要人处理的事，状态后面亮一枚小图标（不另起一行、不挤动版面）：悬停、聚焦、点它浮出一张小卡，
 *   写着怎么回事，带能直接做的事（重新打开、去打开「记录运行状态」、视为已结束）。全部暂停着也走这里（说明带「恢复」），
 *   不在头部插一条说明把下面整栏往下推。
 *
 * 会自己走的字（还有多久、已运行多久）每秒换一次，只在状态条这一小块里换，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TriggerHead
 */

import { useState } from 'react'
import { triggerIdLabel } from '../../../../shared/trigger.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { useNow } from '../../../app/useNow.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { T } from '../../../i18n.ts'
import { triggerMode } from '../../../model/triggerGlance.ts'
import { statusWhen } from '../../../model/triggerNow.ts'
import { type Problem, type ProblemFix, problemOf } from '../../../model/triggerProblem.ts'
import { sourceSay } from '../../../model/triggerSay.ts'
import {
  presentTriggerSource,
  sourceFace,
  stateBadge,
  stateTone,
} from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { useRowSlide } from '../../motion/exits.tsx'
import { MorphGlyph } from '../../motion/MorphGlyph.tsx'
import { MorphTag, TAG_MOTION_MS } from '../../motion/MorphTag.tsx'
import { SwitchTrack } from '../../motion/marks.tsx'
import { SwapText } from '../../motion/swapText.tsx'
import { CountdownLine } from '../../trigger/CountdownLine.tsx'
import { useFireNow } from '../../trigger/FireNow.tsx'
import { ProblemMark } from '../../trigger/ProblemMark.tsx'
import { QueueMark } from '../../trigger/QueueMark.tsx'
import tone from '../../trigger/stateTone.module.css'
import { TRIGGER_ICON, TriggerMark } from '../../trigger/TriggerMark.tsx'
import hub from '../hub.module.css'
import { TitleEdit } from '../TitleEdit.tsx'
import css from './head.module.css'
import { TRIGGER_GLYPH } from './triggerGlyphs.ts'
import { useCardSwitch } from './useCardSwitch.tsx'

export function TriggerHead(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  onOpenCard(): void
  onRename(name: string): Promise<boolean>
  onNotice(text: string, tone?: 'info' | 'error'): void
  /** 在这个工作流里开启「记录运行状态」；做不了回一句原因。 */
  onEnableRunState(workflow: string): Promise<string | null>
  /** 改图里的开关。 */
  onToggle(on: boolean): void
}): React.JSX.Element {
  const { t, entry } = props
  const source = presentTriggerSource(entry.data.source, entry.view.upstreamWorkflow)
  const kind = source.kind
  // 头部开关打不开（没开「记录运行状态」）：递给状态条，把问题小卡钉开。
  const [pin, setPin] = useState(0)
  const toggle = useCardSwitch<HTMLButtonElement>({
    t,
    hub: props.hub,
    entry,
    testId: 'wl-hub-trg-switch-ask',
    toggle: props.onToggle,
    onNotice: props.onNotice,
    enableRunState: props.onEnableRunState,
    onBlocked: () => setPin((count) => count + 1),
  })
  const on = entry.view.enabled
  const mode = t(triggerMode(kind) === 'active' ? 'trigger.mode.active' : 'trigger.mode.passive')
  const tags = useRowSlide(TAG_MOTION_MS, true)
  return (
    <div className={css.fixed}>
      <div className={css.head} data-swap-tier="0">
        <TriggerMark
          kind={kind}
          className={css.mark}
          glyph={
            <MorphGlyph
              icon={TRIGGER_ICON[kind]}
              clipPath={TRIGGER_GLYPH[kind]}
              testId="wl-hub-trg-morph-outline"
            />
          }
        />
        <div className={css.titles}>
          <div ref={tags} className={css.nameLine}>
            <TitleEdit
              t={t}
              value={entry.data.label ?? ''}
              display={entry.name}
              placeholder={triggerIdLabel(entry.view.node)}
              maxLength={80}
              label={t('wf.rename')}
              testId="wl-hub-trg-name"
              onCommit={props.onRename}
            />
            <MorphTag
              className={css.tag}
              text={entry.workflow}
              icon={<Icon name="hub" size={11} />}
              testId="wl-hub-trg-workflow-tag"
            />
            <MorphTag
              className={cx(css.tag, css.kindTag)}
              text={`${t(`trigger.source.${kind}`)} · ${mode}`}
              testId="wl-hub-trg-morph-tag"
            />
          </div>
          <p className={css.say} data-tip={sourceSay(t, source)}>
            <SwapText text={sourceSay(t, source)} />
          </p>
        </div>
        <div className={hub.headActions}>
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
            <span className={css.onoffText}>
              <SwapText text={t(on ? 'hub.trgIsOn' : 'hub.trgIsOff')} />
            </span>
            <SwitchTrack on={on} />
          </button>
          {toggle.confirm}
          <span className={hub.headDivider} aria-hidden="true" />
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            data-tip={t('hub.trgOpenTip')}
            data-testid="wl-hub-trg-open"
            onClick={props.onOpenCard}
          >
            <Icon name="external" size={14} />
            {t('hub.trgOpen')}
          </button>
        </div>
      </div>
      <StatusBar
        t={t}
        hub={props.hub}
        entry={entry}
        pin={pin}
        onNotice={props.onNotice}
        onEnableRunState={props.onEnableRunState}
        onToggle={props.onToggle}
      />
    </div>
  )
}

function StatusBar(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  /** 头部开关打不开时递过来：把问题小卡钉开。 */
  pin: number
  onNotice(text: string, tone?: 'info' | 'error'): void
  onEnableRunState(workflow: string): Promise<string | null>
  onToggle(on: boolean): void
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
  // 问题条上的「重新打开」也打不开时，同样把小卡钉开（和头部开关递来的叠在一起）。
  const [ownPin, setPin] = useState(0)
  const fixer = useCardSwitch<HTMLButtonElement>({
    t,
    hub: props.hub,
    entry,
    testId: 'wl-hub-trg-fix',
    toggle: props.onToggle,
    onNotice: props.onNotice,
    enableRunState: props.onEnableRunState,
    onBlocked: () => setPin((count) => count + 1),
  })
  const fired = fireNow.result
  const when = statusWhen(t, entry, now)
  // 全部暂停着：这里说清楚停了哪些、恢复后补不补，带「恢复」（画布面板那句只说到哪里去恢复）。
  const found = problemOf(t, view, entry.data, props.hub.list?.owner?.pid, now)
  const problem: Problem | null =
    view.state === 'paused'
      ? {
          text: t('hub.trgPausedNote'),
          tone: 'calm',
          action: { label: 'hub.trgResume', run: 'resume' },
        }
      : found
  const onFix = (run: ProblemFix): void => {
    if (run === 'runState' || run === 'waive') {
      fixer.ask(run)
      return
    }
    if (run === 'reopen') {
      fixer.reopen()
      return
    }
    void props.hub.pause(false).then((failed) => {
      if (failed !== null) props.onNotice(failed, 'error')
    })
  }
  // 倒计时：只有「每隔多久」知道这一段多长（带不带检查都一样）。
  const span =
    source.kind === 'schedule' && source.schedule.kind === 'every' ? source.schedule.seconds : 0
  const face = sourceFace(source)
  const counting = (view.state === 'waiting' || view.state === 'elsewhere') && span > 0
  // 状态字换了长短、问题图标亮了 / 灭了：后面的时间或地址连同排队记号一起滑。
  const row = useRowSlide()
  return (
    <div className={css.status} data-swap-tier="1">
      <div ref={row} className={css.statusMain}>
        <span
          className={cx(css.state, tone.tone)}
          data-state={view.state}
          data-tone={stateTone(view.state, face)}
          data-testid="wl-hub-trg-detail-state"
        >
          <span className={cx(tone.dot, css.stateDot)} aria-hidden="true" />
          <SwapText text={stateBadge(t, view, face)} />
        </span>
        <ProblemMark
          t={t}
          problem={problem}
          testId="wl-hub-trg-problem"
          anchorRef={fixer.anchorRef}
          className={css.problemMark}
          pin={props.pin + ownPin}
          onAction={onFix}
        />
        {fixer.confirm}
        <span className={css.sep} aria-hidden="true" />
        <span className={css.statusInfo}>
          <span className={css.when} data-fired={fired?.tone} data-testid="wl-hub-trg-fire-result">
            {fired === null ? (
              <>
                <span className={css.whenMain}>
                  <SwapText text={when.main} quiet />
                </span>
                <span className={css.whenAside}>
                  <SwapText text={when.aside} quiet />
                </span>
              </>
            ) : (
              <span className={css.whenMain}>{fired.text}</span>
            )}
          </span>
          <QueueTag t={t} count={view.queued ?? 0} />
        </span>
        <span className={css.fire}>{fireNow.button}</span>
        <CountdownLine next={counting ? view.next : undefined} seconds={span} smooth />
      </div>
    </div>
  )
}

function QueueTag({ t, count }: { t: T; count: number }): React.JSX.Element {
  const [last, setLast] = useState(count)
  if (count > 0 && count !== last) setLast(count)
  return (
    <span className={css.queued} hidden={count === 0} aria-hidden={count === 0 || undefined}>
      <span className={css.sep} aria-hidden="true" />
      <QueueMark t={t} count={count || last} label testId="wl-hub-trg-queued" />
    </span>
  )
}
