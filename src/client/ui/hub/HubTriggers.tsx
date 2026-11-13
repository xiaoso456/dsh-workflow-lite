/**
 * dsh-workflow-lite — 工作流中心的「触发」页：所有工作流里的触发卡片放在一处看、一处管。
 *
 * - 左栏：每张卡片一行（名字、所在工作流、触发源、现在的状态），行尾的开关和画布上卡片的开关是同一个；
 *   要在本机跑命令、还没确认过的，开之前在开关旁浮出确认卡（和画布上一样列出命令和工作区）。
 *   最下面是「全部暂停 / 恢复」：只是一个总闸，各张卡片自己的开关不变。
 * - 右栏：选中那张的状态、「立即触发一次」、何时触发与怎么运行的摘要（只读）、触发记录；
 *   「在画布上打开」跳到那个工作流、选中这张卡片。全部暂停着时右栏顶上一条说明，状态行不再重复说。
 *
 * 工作区、会话这些只能在画布上那张卡片的面板里改（这里没有工作流的现场）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/HubTriggers
 */

import { useRef, useState } from 'react'
import { commandOf, launchOf } from '../../../shared/trigger.ts'
import type { TriggerSessionMode } from '../../../shared/types.ts'
import type { TriggerEntry } from '../../../shared/wire/trigger.ts'
import { firesSignal, useFires } from '../../app/useFires.ts'
import { type TriggerHub, useTriggerHub } from '../../app/useTriggerHub.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { matchesWords, searchWords } from '../../model/search.ts'
import { shortTime } from '../../model/time.ts'
import { sourceText, stateText, stateTone } from '../../model/triggerText.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { useFlip } from '../motion/flip.ts'
import { SwitchTrack } from '../motion/marks.tsx'
import { ListThumb } from '../motion/thumb.tsx'
import ins from '../panel/panel.module.css'
import { useApproveConfirm } from '../trigger/ApproveConfirm.tsx'
import { FireList } from '../trigger/FireList.tsx'
import { FireNow } from '../trigger/FireNow.tsx'
import tone from '../trigger/stateTone.module.css'
import { TRIGGER_ICON } from '../trigger/TriggerMark.tsx'
import wf from '../versions/wfList.module.css'
import { HubSearch } from './HubSearch.tsx'
import hub from './hub.module.css'
import css from './hubTriggers.module.css'
import { Callout } from './PackRow.tsx'

/** 一张卡片在这一页上的键（不同工作流里的卡片 id 会重）。 */
const keyOf = (entry: TriggerEntry): string => `${entry.workflow}\n${entry.view.node}`

/** 右栏列几条触发记录。 */
const SHOWN = 20

const SESSION_TEXT: Record<TriggerSessionMode, LocaleKey> = {
  new: 'trigger.session.new',
  last: 'trigger.session.last',
  fixed: 'trigger.session.fixed',
}

export function HubTriggers(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 编辑页正开着的那张先存下去（开关按磁盘上的图来）。 */
  flush(): Promise<boolean>
  /** 打开那个工作流、选中这张卡片（会关掉工作流中心）。 */
  onOpenCard(workflow: string, node: string): void
  onOpenRun(id: string): void
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t } = props
  const hubData = useTriggerHub(props.rpc, props.flush)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const list = hubData.list

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

  const words = searchWords(query)
  const visible = list.triggers.filter((entry) =>
    matchesWords(words, [entry.name, entry.workflow, sourceText(t, entry.data.source)]),
  )
  const selected = visible.find((entry) => keyOf(entry) === picked) ?? visible[0]
  const paused = list.paused

  return (
    <div className={cx(hub.wfPage, css.page)} data-testid="wl-hub-trg-page">
      <div className={hub.side}>
        <HubSearch
          t={t}
          value={query}
          placeholder={t('hub.trgSearch')}
          testId="wl-hub-trg-search"
          onChange={setQuery}
        />
        <TriggerList
          t={t}
          hub={hubData}
          entries={visible}
          selected={selected === undefined ? '' : keyOf(selected)}
          onPick={setPicked}
          onNotice={props.onNotice}
        />
        <PauseBar t={t} hub={hubData} paused={paused} onNotice={props.onNotice} />
      </div>
      {selected === undefined ? (
        <div className={hub.empty}>
          <span className={hub.emptyIcon}>
            <Icon name="search" size={20} />
          </span>
          <p className={hub.emptyTitle}>{t('hub.trgNoMatch')}</p>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            onClick={() => setQuery('')}
          >
            {t('hub.clearSearch')}
          </button>
        </div>
      ) : (
        <TriggerDetail
          key={keyOf(selected)}
          t={t}
          hub={hubData}
          entry={selected}
          paused={paused !== undefined}
          onOpenCard={props.onOpenCard}
          onOpenRun={props.onOpenRun}
        />
      )}
    </div>
  )
}

/** 左栏的卡片列表：选中底块滑过去；每行的开关就是那张卡片的开关。 */
function TriggerList(props: {
  t: T
  hub: TriggerHub
  entries: readonly TriggerEntry[]
  selected: string
  onPick(key: string): void
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, hub: data, entries } = props
  const confirm = useApproveConfirm<HTMLButtonElement>()
  /** 确认卡指着哪一行。 */
  const [asking, setAsking] = useState<string | null>(null)
  const askingEntry = entries.find((entry) => keyOf(entry) === asking)
  const askingCommand = askingEntry === undefined ? undefined : commandOf(askingEntry.data.source)
  const listRef = useRef<HTMLElement>(null)
  const layout = `${props.selected}|${entries.map(keyOf).join('|')}`
  useFlip(listRef, layout, { enter: true })

  const toggle = async (entry: TriggerEntry): Promise<void> => {
    const on = entry.view.enabled
    const command = commandOf(entry.data.source)
    // 要跑命令、还没确认过：先在开关旁边列出命令和工作区，请用户看一眼。
    if (!on && command !== undefined && entry.view.approved !== true) {
      const key = keyOf(entry)
      if (confirm.open && asking === key) {
        confirm.hide()
        return
      }
      setAsking(key)
      confirm.show()
      return
    }
    const problem = await data.set(entry.workflow, entry.view.node, { enabled: !on })
    if (problem !== null) props.onNotice(problem, 'error')
  }

  return (
    <nav ref={listRef} className={cx(wf.wfList, wf.sideList)} aria-label={t('hub.trgPage')}>
      <ListThumb layout={layout} />
      {entries.length === 0 && <p className={cx(hub.sideEmpty, ui.fade)}>{t('hub.trgNoMatch')}</p>}
      {entries.map((entry) => {
        const key = keyOf(entry)
        const on = entry.view.enabled
        const kind = entry.data.source.kind
        return (
          <div
            key={key}
            className={wf.wfRow}
            data-flip={key}
            data-selected={key === props.selected}
          >
            <button
              type="button"
              aria-current={key === props.selected ? 'true' : undefined}
              className={cx(wf.wfItem, css.item)}
              data-testid="wl-hub-trg"
              data-value={`${entry.workflow}/${entry.view.node}`}
              onClick={() => props.onPick(key)}
            >
              <span className={wf.wfIcon}>
                <Icon name={TRIGGER_ICON[kind]} size={15} />
              </span>
              <span className={wf.wfText}>
                <span className={wf.wfName}>{entry.name}</span>
                <span className={wf.wfMeta}>
                  {entry.workflow} · {sourceText(t, entry.data.source)}
                </span>
                <span
                  className={cx(css.state, tone.tone)}
                  data-state={entry.view.state}
                  data-tone={stateTone(entry.view.state, kind)}
                  data-testid="wl-hub-trg-state"
                >
                  <span className={tone.dot} aria-hidden="true" />
                  <span className={css.stateText}>{stateText(t, entry.view, kind)}</span>
                </span>
              </span>
            </button>
            <button
              ref={asking === key ? confirm.anchorRef : undefined}
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`${t('trigger.switch')} ${entry.name}`}
              data-tip={
                confirm.open && asking === key
                  ? undefined
                  : t(on ? 'trigger.switchOff' : 'trigger.switchOn')
              }
              className={css.switch}
              data-testid="wl-hub-trg-switch"
              onClick={() => void toggle(entry)}
            >
              <SwitchTrack on={on} />
            </button>
          </div>
        )
      })}
      {askingEntry !== undefined &&
        askingCommand !== undefined &&
        confirm.render({
          t,
          command: askingCommand,
          workspace: askingEntry.view.workspace,
          noCwd: t('hub.trgNoCwd'),
          testId: 'wl-hub-trg-approve',
          onApprove: (command) =>
            void data
              .set(askingEntry.workflow, askingEntry.view.node, { approve: command, enabled: true })
              .then((problem) => {
                if (problem !== null) props.onNotice(problem, 'error')
              }),
        })}
    </nav>
  )
}

/** 左栏最下面的总闸：全部暂停 / 恢复。只换字，不插拔元素。 */
function PauseBar(props: {
  t: T
  hub: TriggerHub
  paused: number | undefined
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, paused } = props
  const [busy, setBusy] = useState(false)
  const on = paused !== undefined
  const flip = async (): Promise<void> => {
    setBusy(true)
    const problem = await props.hub.pause(!on)
    setBusy(false)
    if (problem !== null) props.onNotice(problem, 'error')
  }
  return (
    <div className={css.pauseBar} data-paused={on} data-testid="wl-hub-trg-pausebar">
      <span className={css.pauseText} data-testid="wl-hub-trg-pause-text">
        {on ? t('hub.trgPausedSince').replace('{time}', shortTime(paused)) : t('hub.trgRunning')}
      </span>
      <button
        type="button"
        className={cx(ui.btn, ui.small, on && ui.soft)}
        disabled={busy}
        data-tip={on ? undefined : t('hub.trgPauseTip')}
        data-testid="wl-hub-trg-pause"
        onClick={() => void flip()}
      >
        <Icon name={on ? 'play' : 'pause'} size={13} />
        {t(on ? 'hub.trgResume' : 'hub.trgPause')}
      </button>
    </div>
  )
}

/** 右栏：选中那张卡片的状态、立即触发、设置摘要、触发记录。 */
function TriggerDetail(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  paused: boolean
  onOpenCard(workflow: string, node: string): void
  onOpenRun(id: string): void
}): React.JSX.Element {
  const { t, entry, hub: data } = props
  const { view } = entry
  const fires = useFires(keyOf(entry), firesSignal(view.last), () =>
    data.history(entry.workflow, view.node),
  )
  // 全部暂停着：顶上那条说明已经说了，状态行不再重复。
  const pausedHere = props.paused && view.state === 'paused'
  const problem = view.state === 'paused' ? '' : (view.problem ?? '')
  return (
    <div className={cx(hub.wfDetail, hub.paneIn)} data-testid="wl-hub-trg-detail">
      <div className={hub.wfHead}>
        <div className={hub.wfHeadText}>
          <p className={hub.wfTitle}>{entry.name}</p>
          <p className={hub.wfSub}>
            {entry.workflow} · {sourceText(t, entry.data.source)}
          </p>
        </div>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.soft)}
          data-tip={t('hub.trgOpenTip')}
          data-testid="wl-hub-trg-open"
          onClick={() => props.onOpenCard(entry.workflow, view.node)}
        >
          <Icon name="external" size={14} />
          {t('hub.trgOpen')}
        </button>
      </div>
      {props.paused && (
        <Callout tone="warn" icon="pause" testId="wl-hub-trg-paused">
          {t('hub.trgPausedNote')}
        </Callout>
      )}
      <section className={ins.field}>
        <p
          className={cx(css.detailState, tone.tone)}
          data-state={view.state}
          data-tone={stateTone(view.state, entry.data.source.kind)}
          data-testid="wl-hub-trg-detail-state"
          hidden={pausedHere}
        >
          <span className={tone.dot} aria-hidden="true" />
          {stateText(t, view, entry.data.source.kind)}
        </p>
        <p className={ins.error} hidden={problem === ''} data-testid="wl-hub-trg-problem">
          {problem}
        </p>
        <FireNow
          t={t}
          testId="wl-hub-trg"
          fire={(info) => data.fire(entry.workflow, view.node, info)}
        />
      </section>
      <Facts t={t} entry={entry} />
      <section className={ins.field} data-testid="wl-hub-trg-history">
        <div className={ins.label}>
          <span>{t('trigger.history')}</span>
          <span className={ins.count}>
            {fires === null || fires.length === 0 ? '' : Math.min(fires.length, SHOWN)}
          </span>
        </div>
        <FireList t={t} fires={fires?.slice(0, SHOWN) ?? null} onOpenRun={props.onOpenRun} />
      </section>
    </div>
  )
}

/** 何时触发、怎么运行的摘要（只读；要改到画布上那张卡片的面板里）。没填的项不列。 */
function Facts(props: { t: T; entry: TriggerEntry }): React.JSX.Element {
  const { t, entry } = props
  const { source } = entry.data
  const command = commandOf(source)
  const launch = launchOf(entry.data)
  const needsWorkspace = command !== undefined || launch.session !== 'fixed'
  return (
    <dl className={css.facts} data-testid="wl-hub-trg-facts">
      <dt>{t('trigger.when')}</dt>
      <dd>{sourceText(t, source)}</dd>
      {command !== undefined && (
        <>
          <dt>{t('trigger.command')}</dt>
          <dd>
            <code className={css.factCode}>{command}</code>
          </dd>
        </>
      )}
      <dt>{t('trigger.session')}</dt>
      <dd>{t(SESSION_TEXT[launch.session])}</dd>
      {needsWorkspace && (
        <>
          <dt>{t('trigger.workspace')}</dt>
          <dd data-missing={entry.view.workspace === undefined || undefined}>
            {entry.view.workspace ?? t('hub.trgNotChosen')}
          </dd>
        </>
      )}
      {entry.data.condition !== undefined && (
        <>
          <dt>{t('trigger.condition')}</dt>
          <dd>{entry.data.condition}</dd>
        </>
      )}
      {entry.data.note !== undefined && (
        <>
          <dt>{t('trigger.note')}</dt>
          <dd>{entry.data.note}</dd>
        </>
      )}
    </dl>
  )
}
