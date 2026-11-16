/**
 * dsh-workflow-lite — 「触发」页右栏：上面固定一块（{@link TriggerHead}），下面页签——概览、时间线、按触发方式换名字的
 * 那一页（输出 / 调用 / 日程 / 上游）、设置；每一页自己滚。
 *
 * 选中的页签由页面记着，换卡片不变。换内容走右栏通用的交接（{@link useSwap}）：旧内容留个影子淡出、新内容同时淡入，
 * 中间不空一下——换卡片时整栏原地交叉淡（左栏是竖排的，分不出左右）；换页签时头部和页签不动，
 * 下面那一页从点的那一侧进来。
 *
 * 头部和页签包在 `<header>` 里，和下面那一页留同样宽的滚动条位置（`--wl-scrollbar`）：两块的左右边对齐。
 * 点一条触发记录（概览、时间线里）打开它的详情（`FireDialog`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TriggerDetail
 */

import { useCallback, useEffect, useState } from 'react'
import type { TriggerData } from '../../../../shared/types.ts'
import type { FireRecord, TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { useFireSeen } from '../../../app/fireSeen.ts'
import { firesSignal, useActivity, useFires } from '../../../app/useFires.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { T } from '../../../i18n.ts'
import { rhythmSince } from '../../../model/triggerActivity.ts'
import { sourceFace } from '../../../model/triggerText.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { useSwap } from '../../motion/swap.tsx'
import { FireDialog } from '../../trigger/dialogs/FireDialog.tsx'
import { triggerTint } from '../../trigger/TriggerMark.tsx'
import type { TriggerEnv } from '../../trigger/triggerEnv.ts'
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
  const signal = firesSignal(view.last)
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

  // 换卡片：同一个横坐标（0），原地交叉淡；换页签：第几个面，按前后从那一侧进来。
  const swap = useSwap<HTMLDivElement>(key, 0, DETAIL_TABS.indexOf(tab))

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
            onTab={props.onTab}
            onOpenRun={props.onOpenRun}
          />
        )
      case 'timeline':
        return (
          <TimelinePane
            t={t}
            entry={entry}
            fires={fires}
            paused={paused}
            sessionTitle={sessionTitle}
            onPick={setPicked}
            onOpenRun={props.onOpenRun}
          />
        )
      case 'live':
        switch (face) {
          case 'check':
          case 'listen':
            return <OutputPane t={t} hub={hub} entry={entry} onSettings={props.onSettings} />
          case 'http':
            return <CallPane t={t} hub={hub} entry={entry} />
          case 'schedule':
            return <SchedulePane t={t} entry={entry} />
          case 'after':
            return (
              <UpstreamPane
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
      className={css.detail}
      style={{ '--wl-kind': triggerTint(kind) } as React.CSSProperties}
      data-testid="wl-hub-trg-detail"
    >
      <div ref={swap} className={css.body}>
        <header className={css.top}>
          <TriggerHead
            t={t}
            hub={hub}
            entry={entry}
            onOpenCard={props.onOpenCard}
            onRename={props.onRename}
            onNotice={props.onNotice}
          />
          <DetailTabs
            t={t}
            face={face}
            value={tab}
            count={fires === null || fires.length === 0 ? undefined : fires.length}
            failed={unseenFailure}
            onChange={props.onTab}
          />
        </header>
        {/* 换卡片、换页签都重新挂一块：滚动位置从顶上开始。 */}
        <div
          key={`${key}|${tab}`}
          className={tabs.pane}
          role="tabpanel"
          data-fill={fill}
          data-testid={`wl-hub-trg-pane-${tab}`}
        >
          {pane}
        </div>
      </div>
      {picked !== null && (
        <FireDialog
          t={t}
          record={picked}
          detail={hub.detail}
          onOpenRun={props.onOpenRun}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  )
}
