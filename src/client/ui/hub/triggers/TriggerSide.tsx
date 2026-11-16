/**
 * dsh-workflow-lite — 「触发」页左栏：搜索 + 视图选项，按选的方式分组列出卡片，最下面是全部暂停的总闸。
 *
 * - 每行：触发方式的图标块、名字、「状态 · 下一次」（按工作流分组时）或「状态 · 工作流」（别的分法）。
 *   行上不放开关（开关在右栏头部）：停用的触发器图标块是灰的，一眼看得出。
 * - 分组、折叠、钉顶的分组标题、选中滑块都是 {@link GroupedList}（工作流中心各页共用）；视图菜单是 {@link ViewMenu}。
 * - 筛选不是「全部」时列表顶上一条「仅显示待处理 · 2 个 ✕」，点 ✕ 清掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TriggerSide
 */

import { useState } from 'react'
import type { TriggerSourceKind } from '../../../../shared/types.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { pastTime } from '../../../model/time.ts'
import {
  type ArrangedTriggers,
  type StateBucket,
  TRIGGER_GROUPS,
  TRIGGER_SHOWS,
  TRIGGER_SORTS,
  type TriggerGroup,
  type TriggerGroupBy,
  type TriggerListView,
  type TriggerShow,
  type TriggerSortBy,
} from '../../../model/triggerList.ts'
import { rowNote, sortWhen } from '../../../model/triggerNow.ts'
import { sourceFace, stateBadge, stateTone } from '../../../model/triggerText.ts'
import { tipWhenCut } from '../../kit/cutTip.ts'
import { cx } from '../../kit/cx.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { SwapText } from '../../motion/swapText.tsx'
import tone from '../../trigger/stateTone.module.css'
import { TriggerMark, triggerTint } from '../../trigger/TriggerMark.tsx'
import { HubSearch } from '../HubSearch.tsx'
import hub from '../hub.module.css'
import { GroupedList, type GroupFace, groupDot } from '../list/GroupedList.tsx'
import { HubRow, rowMark } from '../list/HubRow.tsx'
import { type MenuSection, ViewMenu } from '../list/ViewMenu.tsx'
import css from './side.module.css'

/** 一张卡片在这一页上的键（不同工作流里的卡片 id 会重）。 */
export const pairKey = (workflow: string, node: string): string => `${workflow}\n${node}`
export const keyOf = (entry: TriggerEntry): string => pairKey(entry.workflow, entry.view.node)

/** 按状态分组的三组：名字、颜色（标题前面的小圆点）。 */
const BUCKET: Record<StateBucket, { label: LocaleKey; tone: string }> = {
  act: { label: 'hub.trgBucket.act', tone: 'warn' },
  on: { label: 'hub.trgBucket.on', tone: 'live' },
  off: { label: 'hub.trgBucket.off', tone: 'off' },
}

const GROUP: Record<TriggerGroupBy, { label: LocaleKey; icon: IconName }> = {
  workflow: { label: 'hub.trgGroup.workflow', icon: 'hub' },
  state: { label: 'hub.trgGroup.state', icon: 'activity' },
  kind: { label: 'hub.trgGroup.kind', icon: 'bolt' },
  none: { label: 'hub.group.none', icon: 'overview' },
}

const SORT: Record<TriggerSortBy, { label: LocaleKey; icon: IconName }> = {
  name: { label: 'hub.sort.name', icon: 'font' },
  recent: { label: 'hub.trgSort.recent', icon: 'history' },
  next: { label: 'hub.trgSort.next', icon: 'clock' },
}

const SHOW: Record<TriggerShow, { label: LocaleKey; icon: IconName }> = {
  all: { label: 'hub.trgShow.all', icon: 'overview' },
  on: { label: 'hub.trgShow.on', icon: 'play' },
  act: { label: 'hub.trgShow.act', icon: 'alert' },
}

/** 视图菜单的三段：分组、排序、筛选（筛选每项带张数）。 */
function menuSections(
  t: T,
  view: TriggerListView,
  counts: Record<TriggerShow, number>,
  onView: (change: Partial<TriggerListView>) => void,
): MenuSection[] {
  return [
    {
      id: 'group',
      title: t('hub.groupBy'),
      choices: TRIGGER_GROUPS.map((value) => ({
        value,
        label: t(GROUP[value].label),
        icon: GROUP[value].icon,
      })),
      checked: (value) => view.group === value,
      onPick: (value) => onView({ group: value as TriggerGroupBy }),
    },
    {
      id: 'sort',
      title: t('hub.sortBy'),
      choices: TRIGGER_SORTS.map((value) => ({
        value,
        label: t(SORT[value].label),
        icon: SORT[value].icon,
      })),
      checked: (value) => view.sort === value,
      onPick: (value) => onView({ sort: value as TriggerSortBy }),
    },
    {
      id: 'show',
      title: t('hub.showBy'),
      choices: TRIGGER_SHOWS.map((value) => ({
        value,
        label: t(SHOW[value].label),
        icon: SHOW[value].icon,
        count: counts[value],
      })),
      checked: (value) => view.show === value,
      onPick: (value) => onView({ show: value as TriggerShow }),
    },
  ]
}

export function TriggerSide(props: {
  t: T
  hub: TriggerHub
  arranged: ArrangedTriggers
  view: TriggerListView
  onView(change: Partial<TriggerListView>): void
  query: string
  onQuery(query: string): void
  selected: string
  onPick(key: string): void
  paused: number | undefined
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, arranged, view } = props
  const now = Date.now()
  return (
    <div className={hub.side}>
      <HubSearch
        t={t}
        value={props.query}
        placeholder={t('hub.trgSearch')}
        testId="wl-hub-trg-search"
        onChange={props.onQuery}
        filter={
          view.show === 'all'
            ? undefined
            : {
                label: t(SHOW[view.show].label),
                count: arranged.shown,
                testId: 'wl-hub-trg-showing',
                onClear: () => props.onView({ show: 'all' }),
              }
        }
        view={
          <ViewMenu
            t={t}
            sections={menuSections(t, view, arranged.counts, props.onView)}
            testId="wl-hub-trg-view"
          />
        }
      />
      <GroupedList
        label={t('hub.trgPage')}
        groups={arranged.groups}
        keyOf={keyOf}
        selected={props.selected}
        face={(group) => groupFace(t, group)}
        empty={t('hub.trgNoMatch')}
        testId="wl-hub-trg-group"
        row={(entry, at) => (
          <TriggerRow
            t={t}
            entry={entry}
            flip={at.flip}
            note={rowNote(t, entry, view.group === 'workflow', now)}
            when={sortWhen(t, entry, view.sort, now)}
            selected={at.selected}
            onPick={() => props.onPick(keyOf(entry))}
          />
        )}
      />
      <PauseBar
        t={t}
        hub={props.hub}
        paused={props.paused}
        on={props.hub.list?.triggers.filter((entry) => entry.view.enabled).length ?? 0}
        onNotice={props.onNotice}
      />
    </div>
  )
}

/** 分组标题：按触发方式、按状态的名字前面一个小圆点（触发方式的颜色、状态色），按工作流的不带。 */
function groupFace(t: T, group: TriggerGroup): GroupFace {
  if (group.by === 'state') {
    const bucket = BUCKET[group.key as StateBucket]
    return {
      label: t(bucket.label),
      mark: <span className={cx(groupDot, tone.tone, css.groupTone)} data-tone={bucket.tone} />,
    }
  }
  if (group.by === 'kind') {
    const kind = group.key as TriggerSourceKind
    return {
      label: t(`trigger.source.${kind}` as LocaleKey),
      mark: (
        <span
          className={groupDot}
          style={{ '--group-dot': triggerTint(kind) } as React.CSSProperties}
        />
      ),
    }
  }
  return { label: group.key }
}

function TriggerRow(props: {
  t: T
  entry: TriggerEntry
  /** 动画键（见 GroupedList 的 RowAt）。 */
  flip: string
  /** 状态后面那半句；空串不写。 */
  note: string
  /** 按时间排着时排序用的那个时刻（上一次 / 下一次触发）：紧凑时行尾写它，不写状态。 */
  when: string | undefined
  selected: boolean
  onPick(): void
}): React.JSX.Element {
  const { t, entry } = props
  const face = sourceFace(entry.data.source)
  const badge = stateBadge(t, entry.view, face)
  const toneOf = {
    'data-state': entry.view.state,
    'data-tone': stateTone(entry.view.state, face),
    'data-testid': 'wl-hub-trg-state',
  }
  return (
    <HubRow
      flip={props.flip}
      selected={props.selected}
      current={props.selected}
      testId="wl-hub-trg"
      value={`${entry.workflow}/${entry.view.node}`}
      off={!entry.view.enabled}
      mark={<TriggerMark kind={entry.data.source.kind} size={15} className={rowMark} />}
      name={entry.name}
      meta={
        <span className={cx(css.meta, tone.tone)} {...toneOf}>
          <span className={tone.dot} aria-hidden="true" />
          <span className={css.stateText}>{badge}</span>
          <span className={css.note} hidden={props.note === ''} data-cut="">
            {props.note}
          </span>
        </span>
      }
      // 紧凑时行尾：按时间排写那个时刻，别的写状态（状态色）；哪个工作流、下一次几点在悬停提示里。
      end={
        props.when ?? (
          <span className={tone.tone} {...toneOf}>
            <span className={css.stateText}>{badge}</span>
          </span>
        )
      }
      // 栏窄，名字、后面那句（哪个工作流、上一次）放不下就截断：悬停写全。
      tip={[entry.name, badge, props.note].filter((part) => part !== '').join(' · ')}
      onPick={props.onPick}
    />
  )
}

/**
 * 左栏最下面的总闸：「N 张开着 · 全部暂停」/「几点起全部暂停 · 恢复」。只换字，不插拔元素；字放不下截成省略号，悬停看全；
 * 按钮上的字按两种里长的那种占宽（SwapText 的 `reserve`），点了换字时按钮不变宽变窄、左边的字不跟着挪。
 */
function PauseBar(props: {
  t: T
  hub: TriggerHub
  paused: number | undefined
  /** 开着的卡片有几张。 */
  on: number
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, paused } = props
  const [busy, setBusy] = useState(false)
  const stopped = paused !== undefined
  // 时刻照记录的写法：今天只写钟点，栏窄也放得下；再早的带日期，放不下就截断，悬停看全。
  const text = stopped
    ? t('hub.trgPausedSince').replace('{time}', pastTime(t, paused, Date.now()))
    : t('hub.trgOnCount').replace('{n}', String(props.on))
  const flip = async (): Promise<void> => {
    setBusy(true)
    const problem = await props.hub.pause(!stopped)
    setBusy(false)
    if (problem !== null) props.onNotice(problem, 'error')
  }
  return (
    <div className={css.pauseBar} data-paused={stopped} data-testid="wl-hub-trg-pausebar">
      <span className={cx(css.pauseMark, tone.tone)} data-tone={stopped ? 'warn' : 'live'}>
        <span className={tone.dot} aria-hidden="true" />
      </span>
      <span
        className={css.pauseText}
        data-testid="wl-hub-trg-pause-text"
        onPointerOverCapture={(event) =>
          tipWhenCut(event.currentTarget, event.currentTarget, text, 'start')
        }
      >
        {text}
      </span>
      <button
        type="button"
        className={cx(ui.btn, ui.small, stopped && ui.soft)}
        disabled={busy}
        data-tip={stopped ? undefined : t('hub.trgPauseTip')}
        data-testid="wl-hub-trg-pause"
        onClick={() => void flip()}
      >
        <Icon name={stopped ? 'play' : 'pause'} size={13} />
        <SwapText
          text={t(stopped ? 'hub.trgResume' : 'hub.trgPause')}
          reserve={[t('hub.trgResume'), t('hub.trgPause')]}
        />
      </button>
    </div>
  )
}
