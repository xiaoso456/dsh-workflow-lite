/**
 * dsh-workflow-lite — 「触发」页右栏上面固定的一块（换页签不动）：
 *
 * - 头部：触发方式的图标块、名字（点名字或后面的铅笔就地改名，见 {@link TitleEdit}）、所在工作流和
 *   「方式 · 主动 / 被动」两枚小签，下面一句什么时候执行；
 *   右边开关（和左栏同一个）、在画布上打开；
 * - 状态条一行：状态 | 下一次（时刻 + 还有多久，定时 / 轮询底边一条倒计时）| 立即触发一次；
 *   刚触发的结果几秒内占「下一次」那一格；
 * - 出了要人处理的事，状态后面亮一枚小图标（不另起一行、不挤动版面）：悬停、聚焦、点它浮出一张小卡，
 *   写着怎么回事，带能直接做的事（确认并打开、确认命令、重新打开）。全部暂停着也走这里（说明带「恢复」），
 *   不在头部插一条说明把下面整栏往下推。
 *
 * 会自己走的字（还有多久、已运行多久）每秒换一次，只在状态条这一小块里换，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TriggerHead
 */

import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { useNow } from '../../../app/useNow.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { triggerMode } from '../../../model/triggerGlance.ts'
import { statusWhen } from '../../../model/triggerNow.ts'
import { type Problem, type ProblemFix, problemOf } from '../../../model/triggerProblem.ts'
import { sourceSay } from '../../../model/triggerSay.ts'
import { stateBadge, stateTone } from '../../../model/triggerText.ts'
import { tipWhenCut } from '../../kit/cutTip.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { useRowSlide } from '../../motion/exits.tsx'
import { SwitchTrack } from '../../motion/marks.tsx'
import { CountdownLine } from '../../trigger/CountdownLine.tsx'
import { useFireNow } from '../../trigger/FireNow.tsx'
import { ProblemMark } from '../../trigger/ProblemMark.tsx'
import tone from '../../trigger/stateTone.module.css'
import { TriggerMark } from '../../trigger/TriggerMark.tsx'
import hub from '../hub.module.css'
import { TitleEdit } from '../TitleEdit.tsx'
import css from './head.module.css'
import { useCardSwitch } from './useCardSwitch.tsx'

export function TriggerHead(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  onOpenCard(): void
  onRename(name: string): Promise<boolean>
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
            <TitleEdit
              t={t}
              value={entry.data.label ?? ''}
              display={entry.name}
              placeholder={entry.view.node}
              maxLength={80}
              label={t('wf.rename')}
              testId="wl-hub-trg-name"
              onCommit={props.onRename}
            />
            <span
              className={css.tag}
              onPointerOverCapture={(event) =>
                tipWhenCut(
                  event.currentTarget,
                  event.currentTarget.lastElementChild as HTMLElement | null,
                  entry.workflow,
                )
              }
            >
              <Icon name="hub" size={11} />
              <span className={css.tagText}>{entry.workflow}</span>
            </span>
            <span className={cx(css.tag, css.kindTag)}>
              <span className={css.tagText}>
                {t(`trigger.source.${kind}` as LocaleKey)} ·{' '}
                {t(mode === 'active' ? 'trigger.mode.active' : 'trigger.mode.passive')}
              </span>
            </span>
          </div>
          <p className={css.say} data-tip={sourceSay(t, source)}>
            {sourceSay(t, source)}
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
            <span className={css.onoffText}>{t(on ? 'hub.trgIsOn' : 'hub.trgIsOff')}</span>
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
      <StatusBar t={t} hub={props.hub} entry={entry} onNotice={props.onNotice} />
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
  // 全部暂停着：这里说清楚停了哪些、恢复后补不补，带「恢复」（画布面板那句只说到哪里去恢复）。
  const found = problemOf(t, view, source, props.hub.list?.owner?.pid)
  const problem: Problem | null =
    view.state === 'paused'
      ? {
          text: t('hub.trgPausedNote'),
          tone: 'calm',
          action: { label: 'hub.trgResume', run: 'resume' },
        }
      : found
  const onFix = (run: ProblemFix): void => {
    if (run !== 'resume') {
      fixer.turnOn()
      return
    }
    void props.hub.pause(false).then((failed) => {
      if (failed !== null) props.onNotice(failed, 'error')
    })
  }
  // 倒计时：轮询按间隔，定时只有「每隔多久」知道这一段多长。
  const span =
    source.kind === 'poll'
      ? source.seconds
      : source.kind === 'schedule' && source.schedule.kind === 'every'
        ? source.schedule.minutes * 60
        : 0
  const counting = (view.state === 'waiting' || view.state === 'elsewhere') && span > 0
  // 状态字换了长短、问题图标亮了 / 灭了：后面的「上一次」从原处滑过去，不跳。
  const row = useRowSlide()
  return (
    <div className={css.status}>
      <div ref={row} className={css.statusMain}>
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
          onAction={onFix}
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
