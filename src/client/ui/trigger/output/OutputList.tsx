/**
 * dsh-workflow-lite — 最近的输出的列表：一次检查（或程序的一次运行）一行，新的在上面，点开看那一次的输出。
 *
 * 行头：时刻、结果、一眼看的那一行，右边是合成次数与退出码（检查）或时长（运行）。展开后：左边一句说明，
 * 右边「N 行 · 显示全部 · 复制」，下面一行一行（运行的每行带时刻；连着重复的写 ×N；截断的写原来多大；错误输出淡色、琥珀色竖条）。
 *
 * 跟着卡片状态刷新时只换字和属性、不插拔元素（宿主页面有条 `:has` 规则，插拔一次就整页重算样式）：
 * 行和行里的每一行都按位置挂着，按 {@link ROW_CHUNK} / {@link LINE_CHUNK} 一档一档多挂几个空的藏起来，
 * 新来一条只是字往下挪一格；展开着一条在读、或已经往下翻了，眼前的不跟着挪（useKeepReading）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/output/OutputList
 */

import { useRef } from 'react'
import type { OutputEntry, OutputFilter, OutputLine } from '../../../../shared/wire/trigger.ts'
import type { OutputView } from '../../../app/outputView.ts'
import { useNow } from '../../../app/useNow.ts'
import type { T } from '../../../i18n.ts'
import {
  codeChip,
  cutText,
  entryMeta,
  entryTone,
  linesText,
  previewText,
  runSpan,
  secondsTime,
  verdictText,
} from '../../../model/outputText.ts'
import { clockTime, fullTime } from '../../../model/time.ts'
import { copyText } from '../../kit/clipboard.ts'
import { Icon } from '../../kit/Icon.tsx'
import { useCopied } from '../../kit/useCopied.ts'
import { Presence } from '../../motion/exits.tsx'
import { EventText } from './EventText.tsx'
import css from './outputLog.module.css'
import { useKeepReading } from './useKeepReading.ts'
import type { OutputLogModel } from './useOutputLog.ts'

/** 行按几个一档挂。 */
const ROW_CHUNK = 20
/** 展开后的行按几个一档挂。 */
const LINE_CHUNK = 10

const roundUp = (n: number, chunk: number): number => Math.max(chunk, Math.ceil(n / chunk) * chunk)

export function OutputList(props: {
  t: T
  model: OutputLogModel
  view: OutputView
  filter: OutputFilter
  /** 点「改保留行数」：到设置里改（没给就不显示这个链接）。 */
  onSettings?: () => void
  className?: string
  testId: string
}): React.JSX.Element {
  const { t, model, view } = props
  const data = model.data
  const entries = data?.entries ?? []
  const slots = roundUp(entries.length, ROW_CHUNK)
  const empty = data !== null && entries.length === 0
  const listRef = useRef<HTMLDivElement>(null)
  useKeepReading(listRef, data?.entries, entries.some(model.isOpen))
  return (
    <div
      ref={listRef}
      className={props.className === undefined ? css.list : `${css.list} ${props.className}`}
      data-wrap={view.wrap}
      data-err={view.err}
      data-testid={props.testId}
    >
      <div className={css.empty} hidden={!empty} data-testid={`${props.testId}-empty`}>
        <Icon name="terminal" size={18} />
        <span className={css.emptyTitle}>
          {props.filter === 'all' || data?.counts.all === 0
            ? t('trigger.outputEmpty')
            : t('out.noMatch')}
        </span>
        <span hidden={props.filter !== 'all' && data?.counts.all !== 0}>
          {t('hub.trgNoOutputHint')}
        </span>
      </div>
      {Array.from({ length: slots }, (_, index) => (
        <Row
          // biome-ignore lint/suspicious/noArrayIndexKey: 按位置挂着，刷新时只换字（见文件头）
          key={index}
          t={t}
          entry={entries[index]}
          model={model}
          view={view}
          testId={props.testId}
        />
      ))}
      <div className={css.tail} hidden={data?.more !== true}>
        <Icon name="info" size={13} />
        <span>{t('out.more').replace('{n}', String(entries.length))}</span>
      </div>
      <div
        className={css.tail}
        hidden={data?.dropped !== true}
        data-testid={`${props.testId}-dropped`}
      >
        <Icon name="info" size={13} />
        <span>{t('out.dropped').replace('{n}', String(data?.keep ?? ''))}</span>
        {props.onSettings !== undefined && (
          <button type="button" className={css.link} onClick={props.onSettings}>
            {t('out.keepLink')}
          </button>
        )}
      </div>
    </div>
  )
}

function Row(props: {
  t: T
  entry: OutputEntry | undefined
  model: OutputLogModel
  view: OutputView
  testId: string
}): React.JSX.Element {
  const { t, entry, model } = props
  const open = entry !== undefined && model.isOpen(entry)
  const chip = entry === undefined ? null : codeChip(t, entry.code)
  const merged =
    entry?.count === undefined || entry.last === undefined
      ? ''
      : t('out.merged').replace('{n}', String(entry.count)).replace('{time}', clockTime(entry.last))
  return (
    <div
      className={css.row}
      hidden={entry === undefined}
      data-id={entry?.id}
      data-v={entry === undefined ? undefined : entryTone(entry)}
      data-opened={open || undefined}
    >
      <button
        type="button"
        className={css.head}
        aria-expanded={open}
        disabled={entry === undefined}
        data-testid={`${props.testId}-row`}
        onClick={() => {
          if (entry !== undefined) model.toggle(entry)
        }}
      >
        <span className={css.chev} aria-hidden="true">
          <Icon name="chevronRight" size={12} />
        </span>
        <span className={css.time} data-tip={entry === undefined ? undefined : fullTime(entry.at)}>
          {entry === undefined ? '' : clockTime(entry.at)}
        </span>
        <span className={css.verdict}>{entry === undefined ? '' : verdictText(t, entry)}</span>
        <EventText
          t={t}
          stream="out"
          text={entry === undefined ? '' : previewText(t, entry)}
          className={css.preview}
        />
        <span className={css.end}>
          <span className={css.merged} hidden={merged === ''} data-tip={tipOf(t, entry)}>
            {merged}
          </span>
          <span className={css.code} hidden={entry?.kind !== 'check'} data-tone={chip?.tone}>
            {chip?.text ?? ''}
          </span>
          <span className={css.span} hidden={entry?.kind !== 'run'}>
            <RunSpan t={t} entry={entry} />
          </span>
        </span>
      </button>
      {/*
        展开、收起：高度连续地长开、收回（Presence）。按条换 key：轮询时这一格换成了别的条，直接按新条开着没开挂上，不放动画。
        行是展开了才去读的：读到了再长开（ready），一口气长到整高，不长到一半蹿一截。箭头、底色照样当下就变。
      */}
      <Presence
        key={entry?.id ?? 'empty'}
        show={open}
        ready={entry === undefined || model.lines(entry.id) !== undefined}
      >
        <div className={css.body}>
          {open && entry !== undefined && (
            <Body t={t} entry={entry} model={model} err={props.view.err} testId={props.testId} />
          )}
        </div>
      </Presence>
    </div>
  )
}

function tipOf(t: T, entry: OutputEntry | undefined): string | undefined {
  if (entry?.count === undefined) return undefined
  return t('out.mergedTip').replace('{n}', String(entry.count))
}

function Body(props: {
  t: T
  entry: OutputEntry
  model: OutputLogModel
  err: boolean
  testId: string
}): React.JSX.Element {
  const { t, entry, model } = props
  const loaded = model.lines(entry.id)
  const tail = model.tailOf(entry)
  const lines = loaded?.lines ?? []
  const total = loaded?.total ?? entry.lines
  const partial = tail !== undefined && total > lines.length
  const slots = lines.length === 0 ? 0 : roundUp(lines.length, LINE_CHUNK)
  return (
    <>
      <div className={css.meta}>
        <span className={css.metaText}>{entryMeta(t, entry, partial ? tail : undefined)}</span>
        <span className={css.acts}>
          <span className={css.count}>{t('out.lines').replace('{n}', String(total))}</span>
          {partial && (
            <button type="button" className={css.link} onClick={() => model.showAll(entry.id)}>
              {t('out.showAll')}
            </button>
          )}
          <CopyLink t={t} entry={entry} model={model} err={props.err} disabled={total === 0} />
        </span>
      </div>
      <div className={css.lines} data-testid={`${props.testId}-lines`}>
        {Array.from({ length: slots }, (_, index) => (
          <Line
            // biome-ignore lint/suspicious/noArrayIndexKey: 按位置挂着，新的行进来只换字
            key={index}
            t={t}
            line={lines[index]}
            stamped={entry.kind === 'run'}
          />
        ))}
      </div>
    </>
  )
}

function Line(props: { t: T; line: OutputLine | undefined; stamped: boolean }): React.JSX.Element {
  const { t, line } = props
  return (
    <div className={css.line} hidden={line === undefined} data-s={line?.stream}>
      <span className={css.ts} hidden={!props.stamped}>
        {line === undefined ? '' : secondsTime(line.at)}
      </span>
      <EventText t={t} stream={line?.stream} text={line?.text ?? ''} className={css.text} />
      <span className={css.cut} hidden={line?.size === undefined}>
        {line?.size === undefined ? '' : cutText(t, line.size)}
      </span>
      <span
        className={css.repeat}
        hidden={line?.repeat === undefined}
        data-tip={
          line?.repeat === undefined
            ? undefined
            : t('out.repeatTip').replace('{n}', String(line.repeat))
        }
      >
        {line?.repeat === undefined ? '' : `×${String(line.repeat)}`}
      </span>
    </div>
  )
}

/** 一条的「复制」：复制好了字换成「已复制」，一会儿回去。 */
function CopyLink(props: {
  t: T
  entry: OutputEntry
  model: OutputLogModel
  err: boolean
  disabled: boolean
}): React.JSX.Element {
  const { t, entry, model } = props
  const [copied, setCopied] = useCopied(String(entry.id))
  return (
    <button
      type="button"
      className={css.link}
      disabled={props.disabled}
      data-copied={copied || undefined}
      onClick={() =>
        void model
          .fullLines(entry)
          .then((lines) => copyText(linesText(entry, lines, props.err)))
          .then(setCopied)
      }
    >
      <span className={css.swap} data-text={t('trigger.copied')}>
        {t(copied ? 'trigger.copied' : 'trigger.copy')}
      </span>
    </button>
  )
}

/** 一次运行的时长：在跑的那次每秒走一下，别的不用走（按小时醒一下而已）。只这一小块跟着换字。 */
function RunSpan(props: { t: T; entry: OutputEntry | undefined }): React.JSX.Element {
  const { entry } = props
  const now = useNow(entry?.verdict === 'running' ? 1000 : 3_600_000)
  return <>{entry === undefined ? '' : runSpan(props.t, entry, now)}</>
}
