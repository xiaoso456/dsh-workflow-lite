/**
 * dsh-workflow-lite — 工作流中心「触发」页：所有工作流里的触发卡片。
 *
 * 左栏（{@link TriggerSide}）搜索、按选的方式分组 / 排序 / 筛选列出卡片，行尾开关，最下面「全部暂停」；
 * 右栏（{@link TriggerDetail}）是选中那张的状态、概览、时间线、按触发方式的那一页和设置。
 *
 * 数据都从 {@link useTriggerHub} 那一路轮询来；「设置」里的铅笔改的是工作流文件里这张卡片
 * （先把编辑页没存的改动存下去，改完编辑页正开着它就按磁盘重新读）。视图选项存在这台浏览器上，选中的页签换卡片不变。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/HubTriggers
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TriggerData } from '../../../../shared/types.ts'
import type { GraphListResponse } from '../../../../shared/wire/graph.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { useListView } from '../../../app/listView.ts'
import type { SessionRow } from '../../../app/sessions.ts'
import { patchTriggerOnDisk } from '../../../app/triggerEdit.ts'
import { primeActivity } from '../../../app/useFires.ts'
import { useTriggerHub } from '../../../app/useTriggerHub.ts'
import { whenPrimed } from '../../../app/whenPrimed.ts'
import type { T } from '../../../i18n.ts'
import { matchesWords, searchWords } from '../../../model/search.ts'
import { arrangeTriggers, TRIGGER_VIEW, type TriggerListView } from '../../../model/triggerList.ts'
import { sourceText } from '../../../model/triggerText.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { SwapScope } from '../../motion/swapScope.tsx'
import hub from '../hub.module.css'
import { keepShown } from '../list/keepShown.ts'
import type { DetailTab } from './DetailTabs.tsx'
import { TriggerDetail } from './TriggerDetail.tsx'
import { keyOf, pairKey, TriggerSide } from './TriggerSide.tsx'
import { useHubTriggerEnv } from './useHubTriggerEnv.ts'

export function HubTriggers(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 编辑页正开着的那张先存下去（开关、设置都按磁盘上的图来）；存不下去回 `false`。 */
  flush(): Promise<boolean>
  /** 编辑页正开着哪个工作流。 */
  current: string | null
  /** 编辑页正开着的那张在这里被改了：按磁盘重新加载。 */
  onReload(): void
  /** 工作流文件变了（重读工作流列表）。 */
  onChanged(): void
  /** 工作流中心所在的会话、它的工作区，侧栏的会话（选工作区、固定会话用）。 */
  session: string | undefined
  cwd: string | undefined
  sessionRows: readonly SessionRow[]
  /** 打开那个工作流、选中这张卡片（会关掉工作流中心）。 */
  onOpenCard(workflow: string, node: string): void
  /** 打开一个工作流（接续触发的上游；会关掉工作流中心）。 */
  onOpenWorkflow(name: string): void
  /** 到工作流中心的「设置」页（改最近的输出保留几行）。 */
  onSettings(): void
  onOpenRun(id: string): void
  /** 跳到一个会话；跳不了回 `false`。 */
  onOpenSession(id: string): boolean
  onNotice(text: string, tone?: 'info' | 'error'): void
  /** 打开时先选中的卡片（画布上点了「全部记录」）。 */
  start?: { workflow: string; node: string }
}): React.JSX.Element {
  const { t, rpc, onNotice } = props
  const hubData = useTriggerHub(rpc, props.flush)
  const [view, changeView] = useListView(TRIGGER_VIEW)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(
    props.start === undefined ? null : pairKey(props.start.workflow, props.start.node),
  )
  // 从「全部记录」进来直接看时间线。
  const [tab, setTab] = useState<DetailTab>(props.start === undefined ? 'overview' : 'timeline')
  const pickRevision = useRef(0)
  const catalog = useCatalog(rpc)
  const list = hubData.list

  const visible = useMemo(() => {
    const words = searchWords(query)
    return (list?.triggers ?? []).filter((entry) =>
      matchesWords(words, [entry.name, entry.workflow, sourceText(t, entry.data.source)]),
    )
  }, [list, query, t])
  const arranged = useMemo(() => arrangeTriggers(visible, view), [visible, view])
  const shown = arranged.groups.flatMap((group) => group.entries)
  const selected = shown.find((entry) => keyOf(entry) === picked) ?? shown[0]
  const pick = (id: string): void => {
    const revision = ++pickRevision.current
    const changed = selected !== undefined && keyOf(selected) !== id
    const target = changed ? shown.find((entry) => keyOf(entry) === id) : undefined
    const apply = (): void => {
      if (revision === pickRevision.current) setPicked(id)
    }
    const reading =
      target === undefined || tab !== 'overview'
        ? undefined
        : primeActivity(target, hubData.activity)
    whenPrimed(reading ?? null, apply)
  }
  // 换排法时右栏还看着原来那一项（没点过时它是第一项）。
  const onView = (change: Partial<TriggerListView>): void => {
    keepShown(picked, selected === undefined ? undefined : keyOf(selected), setPicked)
    changeView(change)
  }

  const reloadCatalog = catalog.reload
  const onChanged = props.onChanged
  const catalogChanged = useCallback(() => {
    reloadCatalog()
    onChanged()
  }, [reloadCatalog, onChanged])
  const { flush, onReload, current } = props
  const refreshHub = hubData.refresh
  /** 改一张卡片写在图里的设置（磁盘上的图；编辑页正开着它就先存、改完重读）。改不成回一句原因。 */
  const patchCard = useCallback(
    async (workflow: string, node: string, patch: Partial<TriggerData>): Promise<string | null> => {
      const open = workflow === current
      if (open && !(await flush())) return t('ver.flushFailed')
      const problem = await patchTriggerOnDisk(rpc, workflow, node, patch)
      if (problem !== null) return problem
      if (open) onReload()
      onChanged()
      await refreshHub()
      return null
    },
    [t, rpc, current, flush, onReload, onChanged, refreshHub],
  )
  const env = useHubTriggerEnv({
    t,
    rpc,
    hub: hubData,
    workflow: selected?.workflow ?? '',
    session: props.session,
    cwd: props.cwd,
    sessionRows: props.sessionRows,
    catalog: catalog.list,
    onCatalogChanged: catalogChanged,
    onNotice,
    patch: patchCard,
    openRun: props.onOpenRun,
    openSession: props.onOpenSession,
  })

  /** 改这张卡片写在图里的设置；回有没有存成（没成已经提示过）。 */
  const edit = async (entry: TriggerEntry, patch: Partial<TriggerData>): Promise<boolean> => {
    const problem = await patchCard(entry.workflow, entry.view.node, patch)
    if (problem !== null) onNotice(problem, 'error')
    return problem === null
  }

  if (list === null) {
    return (
      <div className={hub.empty}>
        <p className={hub.emptyTitle}>{hubData.error ?? ''}</p>
      </div>
    )
  }
  if (list.triggers.length === 0) {
    return (
      <div className={hub.empty} data-testid="wl-hub-trg-empty">
        <span className={hub.emptyIcon}>
          <Icon name="bolt" size={20} />
        </span>
        <p className={hub.emptyTitle}>{hubData.error ?? t('hub.trgEmpty')}</p>
        <p className={hub.emptyText}>{t('hub.trgEmptyHint')}</p>
      </div>
    )
  }

  return (
    <div className={hub.wfPage} data-testid="wl-hub-trg-page">
      <TriggerSide
        t={t}
        hub={hubData}
        arranged={arranged}
        view={view}
        onView={onView}
        query={query}
        onQuery={setQuery}
        selected={selected === undefined ? '' : keyOf(selected)}
        onPick={pick}
        paused={list.paused}
        onNotice={onNotice}
      />
      {selected === undefined ? (
        <div className={hub.empty}>
          <span className={hub.emptyIcon}>
            <Icon name="search" size={20} />
          </span>
          <p className={hub.emptyTitle}>{t('hub.trgNoMatch')}</p>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            onClick={() => {
              setQuery('')
              onView({ show: 'all' })
            }}
          >
            {t('hub.clearSearch')}
          </button>
        </div>
      ) : (
        <SwapScope id={keyOf(selected)} order={shown.indexOf(selected)}>
          <TriggerDetail
            t={t}
            rpc={rpc}
            hub={hubData}
            entry={selected}
            paused={list.paused}
            tab={tab}
            onTab={setTab}
            env={env}
            onPatch={(patch) => void edit(selected, patch)}
            // 名字写在卡片上（`label`）；清空就回到卡片的 id。
            onRename={(name) => edit(selected, { label: name === '' ? undefined : name })}
            onOpenCard={() => props.onOpenCard(selected.workflow, selected.view.node)}
            onOpenRun={props.onOpenRun}
            onOpenWorkflow={props.onOpenWorkflow}
            onSettings={props.onSettings}
            onNotice={onNotice}
          />
        </SwapScope>
      )}
    </div>
  )
}

/** 全部工作流（接续触发选上游用）；`reload` 在改了某个工作流的设置之后重读。 */
function useCatalog(rpc: WorkflowLiteRpc): { list: GraphListResponse | null; reload(): void } {
  const [list, setList] = useState<GraphListResponse | null>(null)
  const reload = useCallback(() => {
    void rpc.call('graph/list', {}).then(setList, () => {})
  }, [rpc])
  useEffect(reload, [reload])
  return { list, reload }
}
