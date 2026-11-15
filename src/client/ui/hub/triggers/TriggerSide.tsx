/**
 * dsh-workflow-lite — 「触发」页左栏：搜索 + 视图选项，按选的方式分组列出卡片，最下面是全部暂停的总闸。
 *
 * - 每行：触发方式的图标块、名字、「状态 · 下一次」（按工作流分组时）或「状态 · 工作流」（别的分法），行尾开关；
 *   开关就是画布上那张卡片的开关，要在本机跑命令、没确认过的先在开关旁问一句（{@link useCardSwitch}）。
 * - 分组标题能折叠，滚动时钉在顶上；不分组时没有标题。
 * - 筛选不是「全部」时列表顶上一条「只看要处理的 · 2 张 ✕」，点 ✕ 清掉。
 * - 选中底色是一块滑块（ListThumb），换选中、筛选、换分法时各行滑到新位置（useFlip）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TriggerSide
 */

import { useRef, useState } from 'react'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { fireWhen } from '../../../model/fireView.ts'
import {
  type ArrangedTriggers,
  groupId,
  type StateBucket,
  type TriggerGroup,
  type TriggerListView,
} from '../../../model/triggerList.ts'
import { rowNote } from '../../../model/triggerNow.ts'
import { stateBadge, stateTone } from '../../../model/triggerText.ts'
import { tipWhenCut } from '../../kit/cutTip.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { useFlip } from '../../motion/flip.ts'
import { SwitchTrack } from '../../motion/marks.tsx'
import { SwapText } from '../../motion/swapText.tsx'
import { ListThumb } from '../../motion/thumb.tsx'
import tone from '../../trigger/stateTone.module.css'
import { TRIGGER_ICON, TriggerMark, triggerTint } from '../../trigger/TriggerMark.tsx'
import wf from '../../versions/wfList.module.css'
import { HubSearch } from '../HubSearch.tsx'
import hub from '../hub.module.css'
import css from './side.module.css'
import { useCardSwitch } from './useCardSwitch.tsx'
import { SHOW, ViewMenu } from './ViewMenu.tsx'

/** 一张卡片在这一页上的键（不同工作流里的卡片 id 会重）。 */
export const pairKey = (workflow: string, node: string): string => `${workflow}\n${node}`
export const keyOf = (entry: TriggerEntry): string => pairKey(entry.workflow, entry.view.node)

const BUCKET: Record<StateBucket, { label: LocaleKey; tone: string }> = {
  act: { label: 'hub.trgBucket.act', tone: 'warn' },
  on: { label: 'hub.trgBucket.on', tone: 'live' },
  off: { label: 'hub.trgBucket.off', tone: 'off' },
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
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const listRef = useRef<HTMLElement>(null)
  const now = Date.now()
  const shownKeys = arranged.groups.flatMap((group) =>
    folded.has(groupId(group)) && group.by !== 'none' ? [groupId(group)] : group.entries.map(keyOf),
  )
  const layout = `${props.selected}|${view.group}|${shownKeys.join('|')}`
  useFlip(listRef, layout, { enter: true })

  const fold = (id: string): void => {
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <div className={hub.side}>
      <HubSearch
        t={t}
        value={props.query}
        placeholder={t('hub.trgSearch')}
        testId="wl-hub-trg-search"
        onChange={props.onQuery}
      >
        <ViewMenu t={t} view={view} counts={arranged.counts} onChange={props.onView} />
      </HubSearch>
      {view.show !== 'all' && (
        <div className={cx(css.showing, ui.fade)} data-testid="wl-hub-trg-showing">
          <span className={css.showingText}>
            {t('hub.trgShowing')
              .replace('{label}', t(SHOW[view.show].label))
              .replace('{n}', String(arranged.shown))}
          </span>
          <button
            type="button"
            className={css.showingClear}
            aria-label={t('hub.trgClearShow')}
            data-tip={t('hub.trgClearShow')}
            onClick={() => props.onView({ show: 'all' })}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <nav
        ref={listRef}
        className={cx(wf.wfList, wf.sideList, css.list)}
        aria-label={t('hub.trgPage')}
      >
        <ListThumb layout={layout} />
        {arranged.groups.length === 0 && (
          <p className={cx(hub.sideEmpty, ui.fade)}>{t('hub.trgNoMatch')}</p>
        )}
        {arranged.groups.map((group) => {
          const id = groupId(group)
          const closed = group.by !== 'none' && folded.has(id)
          return [
            group.by === 'none' ? null : (
              <GroupHead
                key={`group-${id}`}
                t={t}
                group={group}
                closed={closed}
                onFold={() => fold(id)}
              />
            ),
            ...(closed
              ? []
              : group.entries.map((entry) => (
                  <TriggerRow
                    key={keyOf(entry)}
                    t={t}
                    hub={props.hub}
                    entry={entry}
                    note={rowNote(t, entry, view.group === 'workflow', now)}
                    selected={keyOf(entry) === props.selected}
                    onPick={() => props.onPick(keyOf(entry))}
                    onNotice={props.onNotice}
                  />
                ))),
          ]
        })}
      </nav>
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

/** 分组标题：点了折叠 / 展开；按状态分时前面一个状态色点，按触发方式分时是那种方式的图标。 */
function GroupHead(props: {
  t: T
  group: TriggerGroup
  closed: boolean
  onFold(): void
}): React.JSX.Element {
  const { t, group } = props
  const label =
    group.by === 'state'
      ? t(BUCKET[group.key].label)
      : group.by === 'kind'
        ? t(`trigger.source.${group.key}` as LocaleKey)
        : group.key
  return (
    <button
      type="button"
      className={css.group}
      aria-expanded={!props.closed}
      data-flip={`group-${groupId(group)}`}
      data-testid="wl-hub-trg-group"
      data-value={groupId(group)}
      onClick={props.onFold}
    >
      <span className={css.chevron} aria-hidden="true">
        <Icon name="chevronDown" size={12} />
      </span>
      {group.by === 'state' && (
        <span className={cx(css.groupDot, tone.tone)} data-tone={BUCKET[group.key].tone}>
          <span className={tone.dot} />
        </span>
      )}
      {group.by === 'kind' && (
        <span
          className={css.groupMark}
          style={{ color: triggerTint(group.key) } as React.CSSProperties}
        >
          <Icon name={TRIGGER_ICON[group.key]} size={12} />
        </span>
      )}
      <span className={css.groupName}>{label}</span>
      <span className={css.groupCount}>{group.entries.length}</span>
    </button>
  )
}

function TriggerRow(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  /** 状态后面那半句；空串不写。 */
  note: string
  selected: boolean
  onPick(): void
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, entry } = props
  const key = keyOf(entry)
  const on = entry.view.enabled
  const kind = entry.data.source.kind
  const toggle = useCardSwitch<HTMLButtonElement>({
    t,
    hub: props.hub,
    entry,
    testId: 'wl-hub-trg-approve',
    onNotice: props.onNotice,
  })
  return (
    <div className={wf.wfRow} data-end="fixed" data-flip={key} data-selected={props.selected}>
      <button
        type="button"
        aria-current={props.selected ? 'true' : undefined}
        className={cx(wf.wfItem, css.item)}
        data-testid="wl-hub-trg"
        data-value={`${entry.workflow}/${entry.view.node}`}
        onPointerOverCapture={(event) =>
          // 栏窄，名字、后面那句（哪个工作流、上一次）放不下就截断：悬停写全。
          tipWhenCut(
            event.currentTarget,
            [...event.currentTarget.querySelectorAll<HTMLElement>('[data-cut]')],
            props.note === '' ? entry.name : `${entry.name} · ${props.note}`,
            'start',
          )
        }
        onClick={props.onPick}
      >
        <TriggerMark kind={kind} size={15} className={css.mark} />
        <span className={wf.wfText}>
          <span className={wf.wfName} data-cut="">
            {entry.name}
          </span>
          <span
            className={cx(css.meta, tone.tone)}
            data-state={entry.view.state}
            data-tone={stateTone(entry.view.state, kind)}
            data-testid="wl-hub-trg-state"
          >
            <span className={tone.dot} aria-hidden="true" />
            <span className={css.stateText}>{stateBadge(t, entry.view, kind)}</span>
            <span className={css.note} hidden={props.note === ''} data-cut="">
              {props.note}
            </span>
          </span>
        </span>
      </button>
      <button
        ref={toggle.anchorRef}
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${t('trigger.switch')} ${entry.name}`}
        data-tip={toggle.asking ? undefined : t(on ? 'trigger.switchOff' : 'trigger.switchOn')}
        className={css.switch}
        data-testid="wl-hub-trg-switch"
        onClick={toggle.flip}
      >
        <SwitchTrack on={on} />
      </button>
      {toggle.confirm}
    </div>
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
    ? t('hub.trgPausedSince').replace('{time}', fireWhen(t, paused, Date.now()))
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
