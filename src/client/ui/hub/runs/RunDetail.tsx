/**
 * dsh-workflow-lite — 「运行实例」页右栏：上面固定一块（{@link RunHead}：标题、操作、状态条），下面页签——概览、画布、
 * 时间线、信息；每一页自己滚。和「触发」页右栏（`TriggerDetail`）同一种排法、同一种交接。
 *
 * - 选中的页签由页面记着，换实例不变；选中的那一步按实例记，没点过是停在的那一步（{@link keyStep}）。
 * - 「概览」里点一步、时间线里点一行：选中那一步、到「画布」页签。「画布」里「在画布上看这一步」打开实例并选中它。
 * - 时间线里点一条触发看它的详情（`FireDialog`，不放「看这次执行」——已经在看了）。
 *
 * 实例本身和记到它上面的触发由 {@link useHubRun} 读；还没读到时显示占位，「信息」照常。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/RunDetail
 */

import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { runCursor } from '../../../../shared/runCursor.ts'
import type { InstanceSummary, RunStatus } from '../../../../shared/runState.ts'
import type { FireRecord } from '../../../../shared/wire/trigger.ts'
import { useHubRun } from '../../../app/useHubRun.ts'
import type { T } from '../../../i18n.ts'
import { keyStep, stepLines } from '../../../model/runSteps.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { cx } from '../../kit/cx.ts'
import { Skeleton } from '../../kit/Skeleton.tsx'
import ui from '../../kit/ui.module.css'
import motion from '../../motion/paneTransition.module.css'
import { tabDirection, usePaneTransition } from '../../motion/paneTransition.ts'
import { FireDialog } from '../../trigger/dialogs/FireDialog.tsx'
import css from '../pane/detail.module.css'
import { PaneTabs } from '../pane/PaneTabs.tsx'
import tabs from '../pane/paneTabs.module.css'
import { CanvasTab } from './CanvasTab.tsx'
import { InfoTab } from './InfoTab.tsx'
import { OverviewTab } from './OverviewTab.tsx'
import { RunHead } from './RunHead.tsx'
import { TimelineTab } from './TimelineTab.tsx'

export type RunTab = 'overview' | 'canvas' | 'timeline' | 'info'
export const RUN_TABS: readonly RunTab[] = ['overview', 'canvas', 'timeline', 'info']

export function RunDetail(props: {
  loading: boolean
  t: T
  rpc: WorkflowLiteRpc
  item: InstanceSummary
  /** 工作区叫什么、路径（没记下是 undefined）、是不是本工作区。 */
  workspace: { name: string; path: string | undefined; here: boolean }
  session: { text: string; mine: boolean }
  tab: RunTab
  onTab(tab: RunTab): void
  canMove: boolean
  /** 打开实例；给了 `node` 就选中那一步。 */
  onView(node?: string): void
  onMove(): void
  onDelete(withState: boolean): void
  onSetStatus(to: RunStatus, options: { notify: boolean; note: string }): void
}): React.JSX.Element {
  const { t, rpc, item, tab } = props
  const { view, fires, error, retry } = useHubRun(rpc, item)
  const steps = useMemo(() => (view === null ? null : stepLines(view.document, view.state)), [view])
  const cursor = useMemo(
    () => (view === null || view.state === null ? null : runCursor(view.document, view.state)),
    [view],
  )
  const at = steps === null ? undefined : keyStep(steps, cursor)
  // 点过的那一步按实例记：换了实例回到停在的那一步。
  const [picked, setPicked] = useState<{ id: string; step: string } | null>(null)
  const focus = picked?.id === item.id ? picked.step : at
  const [fire, setFire] = useState<FireRecord | null>(null)
  const paneMotion = usePaneTransition()
  const scroll = paneMotion.scope
  useLayoutEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = 0
  }, [item.id, tab, scroll])
  const turn = (next: RunTab): void => {
    paneMotion.change(() => props.onTab(next), tabDirection(RUN_TABS, tab, next))
  }
  const toStep = (step: string): void => {
    paneMotion.change(
      () => {
        setPicked({ id: item.id, step })
        props.onTab('canvas')
      },
      tabDirection(RUN_TABS, tab, 'canvas'),
    )
  }
  const detail = useCallback((id: string) => rpc.call('trigger/detail', { fire: id }), [rpc])

  const events = (view?.state?.log.length ?? 0) + fires.length

  const pane = ((): React.ReactNode => {
    if (tab === 'info') {
      return (
        <InfoTab
          t={t}
          item={item}
          view={view}
          fires={fires}
          workspace={props.workspace}
          session={props.session}
          canMove={props.canMove}
          onMove={props.onMove}
        />
      )
    }
    if (view === null || steps === null) {
      if (error === null) return <Skeleton label={t('hub.loading')} shape="form" />
      return (
        <div role="alert">
          <p>{error}</p>
          <button type="button" className={cx(ui.btn, ui.small, ui.soft)} onClick={retry}>
            {t('common.retry')}
          </button>
        </div>
      )
    }
    switch (tab) {
      case 'overview':
        return (
          <OverviewTab
            t={t}
            item={item}
            view={view}
            steps={steps}
            cursor={cursor}
            onFocus={toStep}
          />
        )
      case 'canvas':
        return (
          <CanvasTab
            key={item.id}
            t={t}
            view={view}
            steps={steps}
            focus={focus}
            onFocus={(step) => setPicked({ id: item.id, step })}
            onOpenStep={(step) => props.onView(step)}
          />
        )
      case 'timeline':
        return <TimelineTab t={t} view={view} fires={fires} onFocus={toStep} onPickFire={setFire} />
    }
  })()

  return (
    <div
      className={css.detail}
      aria-busy={props.loading || undefined}
      data-testid="wl-hub-run-detail"
      data-id={item.id}
    >
      <div className={css.body}>
        <header className={css.top}>
          <RunHead
            t={t}
            item={item}
            workspace={props.workspace}
            session={props.session}
            steps={steps}
            at={at}
            onView={() => props.onView()}
            onDelete={props.onDelete}
            onSetStatus={props.onSetStatus}
          />
          <PaneTabs
            label={t('hub.runTabs')}
            testId="wl-hub-run-tab"
            value={tab}
            onChange={turn}
            tabs={RUN_TABS.map((id) => ({
              id,
              label: t(`hub.runTab.${id}`),
              ...(id === 'timeline' ? { count: events } : {}),
            }))}
          />
        </header>
        <div
          ref={scroll}
          className={cx(tabs.pane, motion.scope)}
          role="tabpanel"
          data-fill={tab === 'timeline' && events > 0}
          data-testid={`wl-hub-run-pane-${tab}`}
        >
          {pane}
        </div>
      </div>
      {fire !== null && (
        <FireDialog t={t} record={fire} detail={detail} onClose={() => setFire(null)} />
      )}
    </div>
  )
}
