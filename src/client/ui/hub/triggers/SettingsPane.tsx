/**
 * dsh-workflow-lite — 「触发」页的「设置」：和画布面板同样的几块（触发方式、过滤、触发处理、执行设置、保护），一块一张卡片。
 *
 * 一张卡片一个规矩：要么右上角铅笔打开面板里同一个对话框（触发方式、过滤、触发处理、保护），存下来改的是工作流文件里
 * 这张卡片（`onPatch`）；要么就地下拉、选了就生效（执行设置：会话方式、固定的会话、工作区，和面板共用 useLaunchChoice）。
 * 工作区、固定的会话只存在这台机器上，名字旁标「本机」。
 *
 * 两列各自往下排、底边对齐（每列最后一张撑满）：有过滤时左「触发方式、过滤」右「触发处理、执行设置、保护」，
 * 没有过滤时触发处理挪到左边。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/SettingsPane
 */

import { useState } from 'react'
import {
  afterWhen,
  commandOf,
  filterOf,
  isFilterKind,
  launchOf,
  pollWhen,
} from '../../../../shared/trigger.ts'
import type { TriggerData, TriggerSessionMode } from '../../../../shared/types.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { readableUrl } from '../../../model/triggerGlance.ts'
import { spanText } from '../../../model/triggerSay.ts'
import { guardLimits, scheduleNext } from '../../../model/triggerSummary.ts'
import { momentText, ruleText } from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import { Select } from '../../kit/Select.tsx'
import { FilterDialog } from '../../trigger/dialogs/FilterDialog.tsx'
import { GuardDialog } from '../../trigger/dialogs/GuardDialog.tsx'
import { NotesDialog } from '../../trigger/dialogs/NotesDialog.tsx'
import { SourceDialog } from '../../trigger/dialogs/SourceDialog.tsx'
import { TRIGGER_ICON, triggerTint } from '../../trigger/TriggerMark.tsx'
import type { TriggerEnv } from '../../trigger/triggerEnv.ts'
import { useLaunchChoice } from '../../trigger/useLaunchChoice.ts'
import css from './settingsPane.module.css'

type Dialog = 'source' | 'filter' | 'notes' | 'guard'

/** 一行：名字和值。 */
type Row = readonly [label: string, value: React.ReactNode]

export function SettingsPane(props: {
  t: T
  entry: TriggerEntry
  /** 卡片名。 */
  name: string
  env: TriggerEnv
  onPatch(patch: Partial<TriggerData>): void
}): React.JSX.Element {
  const { t, entry, name, env, onPatch } = props
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const { data, view } = entry
  const kind = data.source.kind
  const close = (): void => setDialog(null)

  const sourceCard = (
    <Card
      t={t}
      icon={TRIGGER_ICON[kind]}
      tint={triggerTint(kind)}
      title={t('trigger.when')}
      testId="wl-hub-trg-set-source"
      onEdit={() => setDialog('source')}
    >
      {commandOf(data.source) !== undefined && (
        <code className={css.cmd}>{commandOf(data.source)}</code>
      )}
      <Rows rows={sourceRows(t, entry)} />
    </Card>
  )
  const filterCard = isFilterKind(kind) ? (
    <Card
      t={t}
      icon="sliders"
      title={t('trigger.filter')}
      testId="wl-hub-trg-set-filter"
      onEdit={() => setDialog('filter')}
    >
      <Rows rows={filterRows(t, data)} />
    </Card>
  ) : null
  const notesCard = (
    <Card
      t={t}
      icon="note"
      title={t('trigger.afterFire')}
      testId="wl-hub-trg-set-notes"
      onEdit={() => setDialog('notes')}
    >
      <Rows
        rows={[
          [t('trigger.condition'), quote(t, data.condition)],
          [t('trigger.note'), quote(t, data.note)],
        ]}
      />
    </Card>
  )
  const runCard = (
    <Card t={t} icon="play" title={t('trigger.launch')} testId="wl-hub-trg-set-launch">
      <LaunchRows t={t} entry={entry} env={env} onPatch={onPatch} />
    </Card>
  )
  const launch = launchOf(data)
  const guardCard = (
    <Card
      t={t}
      icon="shield"
      title={t('trigger.guard')}
      testId="wl-hub-trg-set-guard"
      onEdit={() => setDialog('guard')}
    >
      <Rows
        rows={[
          [t('hub.trgOverlap'), t(`hub.trgOverlap.${launch.overlap}` as LocaleKey)],
          [t('hub.trgLimits'), guardLimits(t, launch)],
        ]}
      />
    </Card>
  )

  return (
    <div className={css.masonry} data-testid="wl-hub-trg-settings">
      <div className={css.col}>
        {sourceCard}
        {filterCard ?? notesCard}
      </div>
      <div className={css.col}>
        {filterCard !== null && notesCard}
        {runCard}
        {guardCard}
      </div>

      {dialog === 'source' && (
        <SourceDialog
          t={t}
          node={view.node}
          name={name}
          source={data.source}
          env={env}
          onSave={(source) => onPatch({ source })}
          onClose={close}
        />
      )}
      {dialog === 'filter' && (
        <FilterDialog
          t={t}
          name={name}
          data={data}
          onSave={(filter) => onPatch({ filter })}
          onClose={close}
        />
      )}
      {dialog === 'notes' && (
        <NotesDialog
          t={t}
          name={name}
          data={data}
          focus="condition"
          onSave={(change) => onPatch(change)}
          onClose={close}
        />
      )}
      {dialog === 'guard' && (
        <GuardDialog
          t={t}
          name={name}
          data={data}
          onSave={(launch) => onPatch({ launch })}
          onClose={close}
        />
      )}
    </div>
  )
}

/** 一张卡片：小图标 + 标题，右上角铅笔。 */
function Card(props: {
  t: T
  icon: IconName
  tint?: string
  title: string
  testId: string
  /** 右上角铅笔；就地能改的卡片不给。 */
  onEdit?(): void
  children: React.ReactNode
}): React.JSX.Element {
  const style = props.tint === undefined ? undefined : { '--tint': props.tint }
  return (
    <section className={css.card} style={style as React.CSSProperties} data-testid={props.testId}>
      <div className={css.cardTitle}>
        <Icon name={props.icon} size={12} />
        <span>{props.title}</span>
        {props.onEdit !== undefined && (
          <button
            type="button"
            className={css.pen}
            aria-label={props.t('hub.trgEditCard').replace('{name}', props.title)}
            data-tip={props.t('hub.trgEditCard').replace('{name}', props.title)}
            data-testid={`${props.testId}-edit`}
            onClick={props.onEdit}
          >
            <Icon name="pencil" size={13} />
          </button>
        )}
      </div>
      {props.children}
    </section>
  )
}

function Rows(props: { rows: readonly Row[] }): React.JSX.Element {
  return (
    <dl className={css.kv}>
      {props.rows.map(([label, value]) => (
        <div key={label} className={css.kvRow}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function muted(text: string): React.JSX.Element {
  return <span className={css.muted}>{text}</span>
}

function mono(text: string): React.JSX.Element {
  return <code className={css.mono}>{text}</code>
}

/** 触发条件、说明：有就引出来，没有写「未设置」。 */
function quote(t: T, text: string | undefined): React.ReactNode {
  return text === undefined || text.trim() === '' ? (
    muted(t('trigger.conditionEmpty'))
  ) : (
    <div className={css.quote}>{text}</div>
  )
}

/** 「触发方式」里按触发源列的几行（命令单独在上面）。 */
function sourceRows(t: T, entry: TriggerEntry): Row[] {
  const { source } = entry.data
  const { view } = entry
  switch (source.kind) {
    case 'schedule': {
      const next = scheduleNext(source.schedule, view.next, new Date())
      return [
        [t('trigger.rule'), ruleText(t, source.schedule)],
        [t('hub.trgNextRow'), next === undefined ? muted('—') : momentText(t, next)],
      ]
    }
    case 'poll':
      return [
        [t('trigger.every'), spanText(t, source.seconds)],
        [t('trigger.pollWhen'), t(`trigger.pollWhen.${pollWhen(source)}` as LocaleKey)],
        [t('trigger.shell'), shellText(t, entry)],
      ]
    case 'listen':
      return [[t('trigger.shell'), shellText(t, entry)]]
    case 'http': {
      const endpoint = view.endpoint
      return [
        [
          t('trigger.url'),
          endpoint === undefined ? muted(t('hub.trgNoUrl')) : mono(readableUrl(endpoint.url)),
        ],
        [
          t('trigger.token'),
          t(endpoint?.noToken === true ? 'hub.trgNoToken' : 'trigger.tokenNeed.on'),
        ],
      ]
    }
    case 'after':
      return [
        [
          t('trigger.afterLead'),
          source.workflow === '' ? muted(t('trigger.rule.afterNone')) : source.workflow,
        ],
        [t('trigger.afterWhen'), t(`trigger.afterWhen.${afterWhen(source)}` as LocaleKey)],
      ]
  }
}

/** 这张卡片用哪个 shell：自己选的写名字，没选写「跟随默认（…）」。 */
function shellText(t: T, entry: TriggerEntry): string {
  const name = entry.view.runShell?.name ?? '…'
  return entry.view.shell === undefined || entry.view.shell === ''
    ? t('trigger.shell.follow').replace('{name}', name)
    : name
}

function filterRows(t: T, data: TriggerData): Row[] {
  const filter = filterOf(data)
  const words =
    filter.include.length + filter.exclude.length === 0 ? (
      muted(t('trigger.conditionEmpty'))
    ) : (
      <span className={css.words}>
        {filter.include.map((word) => (
          <span key={`+${word}`} className={css.word}>
            {word}
          </span>
        ))}
        {filter.exclude.map((word) => (
          <span key={`-${word}`} className={css.word} data-no>
            {word}
          </span>
        ))}
      </span>
    )
  return [
    [t('hub.trgKeywords'), words],
    [
      t('hub.trgMerge'),
      filter.merge > 0
        ? t('hub.trgMergeOn').replace('{n}', String(filter.merge))
        : t('hub.trgMergeOff'),
    ],
    [
      t('hub.trgDedupe'),
      filter.dedupe > 0
        ? t('hub.trgDedupeOn').replace('{n}', String(filter.dedupe))
        : t('hub.trgDedupeOff'),
    ],
  ]
}

/**
 * 「执行设置」的几行：会话方式、（固定会话时）固定到哪个会话、工作区，都是就地下拉。
 * 固定会话又不跑命令时不用工作区，写「不需要」。
 */
function LaunchRows(props: {
  t: T
  entry: TriggerEntry
  env: TriggerEnv
  onPatch(patch: Partial<TriggerData>): void
}): React.JSX.Element {
  const { t, entry } = props
  const choice = useLaunchChoice({
    t,
    node: entry.view.node,
    data: entry.data,
    env: props.env,
    onLaunch: (launch) => props.onPatch({ launch }),
  })
  const local = (
    <span className={css.local} data-tip={t('trigger.localHint')}>
      {t('hub.trgLocal')}
    </span>
  )
  return (
    <>
      <dl className={cx(css.kv, css.kvWide)}>
        <div className={css.kvRow}>
          <dt>{t('trigger.session')}</dt>
          <dd className={css.pick}>
            <Select<TriggerSessionMode>
              plain
              label={t('trigger.session')}
              value={choice.mode.value}
              testId="wl-hub-trg-session"
              onChange={choice.mode.set}
              options={choice.mode.options}
            />
          </dd>
        </div>
        {choice.fixed !== null && (
          <div className={css.kvRow}>
            <dt>
              {t('trigger.fixed')}
              {local}
            </dt>
            <dd className={css.pick}>
              <Select<string>
                plain
                t={t}
                label={t('trigger.fixed')}
                value={choice.fixed.value}
                testId="wl-hub-trg-fixed"
                onChange={choice.fixed.set}
                options={choice.fixed.options}
              />
            </dd>
          </div>
        )}
        <div className={css.kvRow}>
          <dt>
            {t('trigger.workspace')}
            {choice.workspace !== null && local}
          </dt>
          {choice.workspace === null ? (
            <dd>{muted(t('hub.trgNotNeeded'))}</dd>
          ) : (
            <dd className={css.pick}>
              <Select<string>
                plain
                t={t}
                label={t('trigger.workspace')}
                value={choice.workspace.value}
                testId="wl-hub-trg-workspace"
                onChange={choice.workspace.set}
                options={choice.workspace.options}
              />
            </dd>
          )}
        </div>
      </dl>
      <p className={css.error} hidden={choice.failed === ''} data-testid="wl-hub-trg-launch-error">
        {choice.failed}
      </p>
    </>
  )
}
