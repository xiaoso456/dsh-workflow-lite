/**
 * dsh-workflow-lite — 触发卡片「过滤」的表单（在 `dialogs/FilterDialog.tsx` 里，改的是草稿）：合并、去重、关键字。
 * 都在插件里做，不花模型调用。
 *
 * 只对带背景信息的触发源（轮询、监听、HTTP）有；定时、接续没有内容可筛。
 * 每打一个字就交给草稿（数字夹进范围），失焦时框里的字整理成交出去的样子。缺省值不留在图里，借读入的规范化去掉。
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
import css from './trigger.module.css'

/** 关键字一格：逗号（中英文）、换行隔开。 */
export function parseKeywords(text: string): string[] {
  return text
    .split(/[,，、\n]/u)
    .map((word) => word.trim())
    .filter((word) => word !== '')
}

export function FilterForm(props: {
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
    <div className={css.form} data-testid="wl-trigger-filter">
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
    </div>
  )
}

/** 一个数（0 = 不用）：一行说明加一个数字框；打字就交给草稿（夹进范围），失焦时框里显示夹过的数。 */
function NumberRow(props: {
  label: string
  value: number
  max: number
  testId: string
  onCommit(value: number): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className={css.row}>
      <span className={cx(css.rowLabel, css.grow)}>{props.label}</span>
      <input
        className={cx(ui.input, css.number)}
        inputMode="numeric"
        value={draft ?? String(props.value)}
        aria-label={props.label}
        data-testid={props.testId}
        onChange={(event) => {
          const text = event.currentTarget.value.replace(/[^\d]/gu, '')
          setDraft(text)
          const value = text === '' ? 0 : Number.parseInt(text, 10)
          if (Number.isFinite(value)) props.onCommit(Math.min(props.max, Math.max(0, value)))
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}

/** 一组关键字：一个文字框，逗号隔开；打字就交给草稿，失焦时整理成「、」隔开。 */
function KeywordRow(props: {
  t: T
  label: string
  words: readonly string[]
  testId: string
  onCommit(words: string[]): void
}): React.JSX.Element {
  const shown = props.words.join(props.t('trigger.rule.sep'))
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className={css.stack}>
      <span className={css.rowLabel}>{props.label}</span>
      <input
        className={ui.input}
        value={draft ?? shown}
        placeholder={props.t('trigger.keywordsPlaceholder')}
        aria-label={props.label}
        data-testid={props.testId}
        onChange={(event) => {
          const text = event.currentTarget.value
          setDraft(text)
          props.onCommit(parseKeywords(text))
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}
