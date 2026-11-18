/**
 * dsh-workflow-lite — 「触发」页右栏：上面固定一块（{@link TriggerHead}），下面页签——概览、时间线、按触发方式换名字的
 * 那一页（输出 / 调用 / 日程 / 上游）、设置；每一页自己滚。
 *
 * 选中的页签由页面记着，换卡片不变。换卡片时右栏原地交叉淡；换页签时头部不动，只交接滚动区。
 *
 * 头部和页签包在 `<header>` 里，和下面那一页留同样宽的滚动条位置（`--wl-scrollbar`）：两块的左右边对齐。
 * 点一条触发记录（概览、时间线里）打开它的详情（`FireDialog`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TriggerDetail
 */

import { type RefObject, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { TriggerData } from '../../../../shared/types.ts'
import type { FireRecord, TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { useFireSeen } from '../../../app/fireSeen.ts'
import { firesSignal, useActivity, useFires } from '../../../app/useFires.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { T } from '../../../i18n.ts'
import { queuePlace, settledFires } from '../../../model/fireView.ts'
import { rhythmSince } from '../../../model/triggerActivity.ts'
import { sourceFace } from '../../../model/triggerText.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { cx } from '../../kit/cx.ts'
import motion from '../../motion/paneTransition.module.css'
import { tabDirection, usePaneTransition } from '../../motion/paneTransition.ts'
import { FireDialog } from '../../trigger/dialogs/FireDialog.tsx'
import { triggerTint } from '../../trigger/TriggerMark.tsx'
import { prevRunView, type TriggerEnv } from '../../trigger/triggerEnv.ts'
import css from '../pane/detail.module.css'
import tabs from '../pane/paneTabs.module.css'
import { CallPane } from './CallPane.tsx'
import { DETAIL_TABS, type DetailTab, DetailTabs } from './DetailTabs.tsx'
import { OutputPane } from './OutputPane.tsx'
import { OverviewPane } from './OverviewPane.tsx'
import { SchedulePane } from './SchedulePane.tsx'
import { SettingsPane } from './SettingsPane.tsx'
import { TimelinePane } from './TimelinePane.tsx'
import { TriggerHead } from './TriggerHead.tsx'
import { keyOf } from './TriggerSide.tsx'
import { UpstreamPane } from './UpstreamPane.tsx'

/** 右栏最多读几条触发记录（存下的总共也就这么多）。 */
const SHOWN = 200

export function TriggerDetail(props: {
  detailRef: RefObject<HTMLDivElement>
  t: T
  rpc: WorkflowLiteRpc
  hub: TriggerHub
  entry: TriggerEntry
  /** 全部暂停着：从什么时候起。 */
  paused: number | undefined
  tab: DetailTab
  onTab(tab: DetailTab): void
  env: TriggerEnv
  /** 改这张卡片写在图里的设置（存进工作流文件）。 */
  onPatch(patch: Partial<TriggerData>): void
  /** 改名（回有没有存成）。 */
  onRename(name: string): Promise<boolean>
  onOpenCard(): void
  onOpenRun(id: string): void
  onOpenWorkflow(name: string): void
  /** 到工作流中心的「设置」页（改最近的输出保留几行）。 */
  onSettings(): void
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, hub, entry, tab } = props
  const { view } = entry
  const kind = entry.data.source.kind
  const face = sourceFace(entry.data.source)
  const key = keyOf(entry)
  const signal = firesSignal(view.last, view.queued)
  const fires = useFires(key, signal, () => hub.history(entry.workflow, view.node, SHOWN))
  // 近况从节律最早那天的 0 点起；过了零点换一天，跟着重读。
  const since = rhythmSince(Date.now())
  const activity = useActivity(key, `${signal}|${String(since)}`, () =>
    hub.activity(entry.workflow, view.node, since),
  )
  const [picked, setPicked] = useState<FireRecord | null>(null)
  // 时间线页签上的红点：有还没看过的失败才亮；看着时间线时新来的也算看过。
  const [seen, markSeen] = useFireSeen(key)
  const newest = fires?.[0]?.at
  useEffect(() => {
    if (tab === 'timeline' && newest !== undefined) markSeen(newest)
  }, [tab, newest, markSeen])
  const unseenFailure =
    tab !== 'timeline' &&
    (fires?.some((record) => record.outcome === 'failed' && record.at > seen) ?? false)
  const sessions = props.env.sessions
  const sessionTitle = useCallback(
    (id: string) => sessions.find((session) => session.id === id)?.title,
    [sessions],
  )
  // 页签上的条数同筛选的「全部」：排着的不算。
  const settled = fires === null ? 0 : settledFires(fires).length
  const waiting = prevRunView(t, props.env, view.waiting, Date.now())
  // 详情开着时那一次轮到了：换成新读到的那一条。
  const live = picked === null ? null : (fires?.find((record) => record.id === picked.id) ?? picked)
  const onNotice = props.onNotice
  const clearQueue = (): void => {
    void hub.clearQueue(entry.workflow, view.node).then((problem) => {
      if (problem !== null) onNotice(problem, 'error')
    })
  }
  const waive = (): Promise<string | null> => hub.waive(entry.workflow, view.node)

  const paneMotion = usePaneTransition()
  const scroll = paneMotion.scope
  useLayoutEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = 0
  }, [key, tab, scroll])
  const turn = (next: DetailTab): void => {
    paneMotion.change(() => props.onTab(next), tabDirection(DETAIL_TABS, tab, next))
  }

  const paused = props.paused !== undefined
  const pane = ((): React.ReactNode => {
    switch (tab) {
      case 'overview':
        return (
          <OverviewPane
            t={t}
            entry={entry}
            fires={fires}
            activity={activity}
            paused={paused}
            sessionTitle={sessionTitle}
            onPick={setPicked}
            onTab={turn}
            onOpenRun={props.onOpenRun}
          />
        )
      case 'timeline':
        return (
          <TimelinePane
            key={key}
            t={t}
            entry={entry}
            fires={fires}
            paused={paused}
            sessionTitle={sessionTitle}
            waiting={waiting}
            onClearQueue={clearQueue}
            onWaive={waive}
            onNotice={onNotice}
            onPick={setPicked}
            onOpenRun={props.onOpenRun}
          />
        )
      case 'live':
        switch (face) {
          case 'check':
          case 'listen':
            return (
              <OutputPane key={key} t={t} hub={hub} entry={entry} onSettings={props.onSettings} />
            )
          case 'http':
            return <CallPane key={key} t={t} hub={hub} entry={entry} />
          case 'schedule':
            return <SchedulePane t={t} entry={entry} />
          case 'after':
            return (
              <UpstreamPane
                key={key}
                t={t}
                rpc={props.rpc}
                entry={entry}
                onOpenWorkflow={props.onOpenWorkflow}
                onOpenRun={props.onOpenRun}
              />
            )
        }
        return null
      case 'settings':
        return (
          <SettingsPane
            key={key}
            t={t}
            entry={entry}
            name={entry.name}
            env={props.env}
            onPatch={props.onPatch}
          />
        )
    }
  })()
  const fill = tab === 'timeline' || (tab === 'live' && (face === 'check' || face === 'listen'))

  return (
    <div
      ref={props.detailRef}
      className={cx(css.detail, motion.scope)}
      style={{ '--wl-kind': triggerTint(kind) } as React.CSSProperties}
      data-testid="wl-hub-trg-detail"
    >
      <div className={css.body}>
        <header className={css.top}>
          <TriggerHead
            t={t}
            hub={hub}
            entry={entry}
            onOpenCard={props.onOpenCard}
            onRename={props.onRename}
            onNotice={props.onNotice}
            onEnableRunState={props.env.enableRunState}
          />
          <DetailTabs
            t={t}
            face={face}
            value={tab}
            count={settled === 0 ? undefined : settled}
            failed={unseenFailure}
            onChange={turn}
          />
        </header>
        <div
          ref={scroll}
          className={cx(tabs.pane, motion.scope)}
          role="tabpanel"
          data-fill={fill}
          data-testid={`wl-hub-trg-pane-${tab}`}
        >
          {pane}
        </div>
      </div>
      {live !== null && (
        <FireDialog
          t={t}
          record={live}
          detail={hub.detail}
          onOpenRun={props.onOpenRun}
          place={fires === null ? undefined : queuePlace(fires, live.id)}
          waiting={waiting}
          onCancel={hub.cancel}
          onWaive={waive}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  )
}
