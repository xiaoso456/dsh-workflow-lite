/**
 * dsh-workflow-lite — 触发卡片的「过滤」：合并、去重、关键字。都在插件里做，不花模型调用。
 *
 * 只对带背景信息的触发源（轮询、监听、HTTP）显示；定时没有内容可筛。
 * 数字、关键字都是草稿：失焦、回车才写进图（缺省值不留在图里，借读入的规范化去掉）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/FilterField
 */

import { useState } from 'react'
import {
  DEDUPE_MAX_MINUTES,
  filterOf,
  MERGE_MAX_SECONDS,
  readTriggerData,
} from '../../../shared/trigger.ts'
import type { TriggerData, TriggerFilter } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import ui from '../kit/ui.module.css'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'

/** 关键字一格：逗号（中英文）、换行隔开。 */
export function parseKeywords(text: string): string[] {
  return text
    .split(/[,，、\n]/u)
    .map((word) => word.trim())
    .filter((word) => word !== '')
}

export function FilterField(props: {
  t: T
  data: TriggerData
  onFilter(filter: TriggerFilter | undefined): void
}): React.JSX.Element {
  const { t, data } = props
  const filter = filterOf(data)
  const patch = (next: Partial<TriggerFilter>): void => {
    props.onFilter(readTriggerData({ ...data, filter: { ...filter, ...next } }).filter)
  }
  return (
    <section className={ins.field} data-testid="wl-trigger-filter">
      <div className={ins.label}>
        <span>{t('trigger.filter')}</span>
      </div>
      <NumberRow
        label={t('trigger.merge')}
        value={filter.merge}
        max={MERGE_MAX_SECONDS}
        testId="wl-trigger-merge"
        onCommit={(merge) => patch({ merge })}
      />
      <NumberRow
        label={t('trigger.dedupe')}
        value={filter.dedupe}
        max={DEDUPE_MAX_MINUTES}
        testId="wl-trigger-dedupe"
        onCommit={(dedupe) => patch({ dedupe })}
      />
      <KeywordRow
        t={t}
        label={t('trigger.include')}
        words={filter.include}
        testId="wl-trigger-include"
        onCommit={(include) => patch({ include })}
      />
      <KeywordRow
        t={t}
        label={t('trigger.exclude')}
        words={filter.exclude}
        testId="wl-trigger-exclude"
        onCommit={(exclude) => patch({ exclude })}
      />
      <p className={ins.help}>{t('trigger.filterHint')}</p>
    </section>
  )
}

/** 一个数（0 = 不用）：一行说明加一个数字框，失焦、回车才生效（夹进范围）。 */
function NumberRow(props: {
  label: string
  value: number
  max: number
  testId: string
  onCommit(value: number): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const value = draft === '' ? 0 : Number.parseInt(draft, 10)
    if (Number.isFinite(value) && value !== props.value) {
      props.onCommit(Math.min(props.max, Math.max(0, value)))
    }
    setDraft(null)
  }
  return (
    <label className={css.row}>
      <span className={cx(css.rowLabel, css.grow)}>{props.label}</span>
      <input
        className={cx(ui.input, css.number)}
        inputMode="numeric"
        value={draft ?? String(props.value)}
        aria-label={props.label}
        data-testid={props.testId}
        onChange={(event) => setDraft(event.currentTarget.value.replace(/[^\d]/gu, ''))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
    </label>
  )
}

/** 一组关键字：一个文字框，逗号隔开；失焦、回车才生效。 */
function KeywordRow(props: {
  t: T
  label: string
  words: readonly string[]
  testId: string
  onCommit(words: string[]): void
}): React.JSX.Element {
  const shown = props.words.join(props.t('trigger.rule.sep'))
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const words = parseKeywords(draft)
    if (words.join('\n') !== props.words.join('\n')) props.onCommit(words)
    setDraft(null)
  }
  return (
    <label className={css.stack}>
      <span className={css.rowLabel}>{props.label}</span>
      <input
        className={ui.input}
        value={draft ?? shown}
        placeholder={props.t('trigger.keywordsPlaceholder')}
        aria-label={props.label}
        data-testid={props.testId}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
    </label>
  )
}
