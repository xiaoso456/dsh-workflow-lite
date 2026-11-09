/**
 * dsh-workflow-lite — 日志、纯文本的筛选框：一个输入框、三个小开关、两个现成的、前后带几行；打字停一下才生效。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/files/FilterField
 */

import { useRef, useState } from 'react'
import { LINE_CONTEXT_MAX } from '../../../shared/model.ts'
import type { LineFilter } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { FILTER_PRESETS, type FilterPreset, filterProblem } from '../../model/logLines.ts'
import css from '../display/display.module.css'
import { Icon } from '../kit/Icon.tsx'
import { Stepper } from '../kit/NumberStep.tsx'
import { useDelayedCommit } from './useDelayedCommit.ts'

/** 筛选框停手多久才生效。 */
const FILTER_DELAY = 320

/** 筛选框边上的小开关（正则、大小写、反选）：按下去是强调色。 */
function FlagButton(props: {
  label: string
  on: boolean
  glyph: string
  testId: string
  onToggle(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={css.flag}
      aria-pressed={props.on}
      aria-label={props.label}
      data-tip={props.label}
      data-testid={props.testId}
      onClick={props.onToggle}
    >
      {props.glyph}
    </button>
  )
}

/**
 * 筛选：一个输入框（打字停一下才生效，回车立刻生效，Esc 撤回这次输入）、三个小开关、两个现成的、前后带几行。
 * 正则写错了框子底线变红、下面说原因，卡片上还是上一次对的结果。
 */
export function FilterField(props: {
  t: T
  value: LineFilter | undefined
  onChange(filter: LineFilter | undefined): void
  /** 查看框顶上那一条：不带「只看」两个字，一行排开。 */
  inline?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  /** 排在「前后带」后面的（查看框里写匹配了多少）。 */
  extra?: React.ReactNode
}): React.JSX.Element {
  const { t } = props
  const value = props.value
  const field = useDelayedCommit(value?.pattern ?? '', FILTER_DELAY)
  const text = field.text
  const latest = useRef(value)
  latest.current = value
  // 还没写字时按下的开关先记在这里（没写字就是不筛，存不进设置里）。
  const [loose, setLoose] = useState({
    regex: false,
    caseSensitive: false,
    invert: false,
    context: 0,
  })
  const flags =
    value === undefined
      ? loose
      : {
          regex: value.regex === true,
          caseSensitive: value.caseSensitive === true,
          invert: value.invert === true,
          context: value.context ?? 0,
        }
  /** 拼一个筛选：没写字就是不筛（开关的状态也不留，下次从头来）。 */
  const make = (pattern: string, patch: Partial<typeof flags> = {}): LineFilter | undefined => {
    const next = { ...flags, ...patch }
    if (pattern === '') return undefined
    return {
      pattern,
      ...(next.regex ? { regex: true } : {}),
      ...(next.caseSensitive ? { caseSensitive: true } : {}),
      ...(next.invert ? { invert: true } : {}),
      ...(next.context > 0 ? { context: next.context } : {}),
    }
  }
  const commit = (pattern: string, patch: Partial<typeof flags> = {}): void => {
    field.settle()
    if (pattern === '') setLoose({ ...flags, ...patch })
    const next = make(pattern, patch)
    if (JSON.stringify(next) !== JSON.stringify(latest.current)) props.onChange(next)
  }
  const problem = filterProblem(make(text))
  // 前后各带几行：没写字时灰着（不筛就没有「前后」），提示里说先写字。
  const context = (
    <Stepper
      label={t('display.context')}
      value={flags.context}
      min={0}
      max={LINE_CONTEXT_MAX}
      unit={t('display.contextUnit')}
      lessLabel={t('display.contextLess')}
      moreLabel={t('display.contextMore')}
      disabled={text === ''}
      tip={text === '' ? t('display.contextOff') : t('display.contextTip')}
      testId="wl-display-context"
      onChange={(count) => commit(text, { context: count })}
    />
  )
  return (
    <div className={css.filter} data-inline={props.inline || undefined}>
      <div className={css.optLine}>
        {props.inline !== true && <span className={css.optLabel}>{t('display.filter')}</span>}
        <div className={css.filterBox} aria-invalid={problem !== null || undefined}>
          <Icon name="search" size={13} />
          <input
            ref={props.inputRef}
            className={css.filterInput}
            {...field.bind((next) => commit(next))}
            placeholder={t('display.filterPlaceholder')}
            aria-label={t('display.filter')}
            aria-invalid={problem !== null || undefined}
            spellCheck={false}
            maxLength={500}
            data-testid="wl-display-filter"
          />
          {text !== '' && (
            <button
              type="button"
              className={css.clearFilter}
              aria-label={t('display.filter.clear')}
              data-tip={t('display.filter.clear')}
              data-testid="wl-display-filter-clear"
              onClick={() => commit('')}
            >
              <Icon name="x" size={12} />
            </button>
          )}
          <FlagButton
            label={t('display.filter.regex')}
            glyph=".*"
            on={flags.regex}
            testId="wl-display-filter-regex"
            onToggle={() => commit(text, { regex: !flags.regex })}
          />
          <FlagButton
            label={t('display.filter.case')}
            glyph="Aa"
            on={flags.caseSensitive}
            testId="wl-display-filter-case"
            onToggle={() => commit(text, { caseSensitive: !flags.caseSensitive })}
          />
          <FlagButton
            label={t('display.filter.invert')}
            glyph="≠"
            on={flags.invert}
            testId="wl-display-filter-invert"
            onToggle={() => commit(text, { invert: !flags.invert })}
          />
        </div>
      </div>
      {problem !== null && (
        <p className={css.filterProblem} role="alert">
          {t('display.filterBad').replace('{reason}', problem)}
        </p>
      )}
      <div className={css.filterMore}>
        <span className={css.presets}>
          {(Object.keys(FILTER_PRESETS) as FilterPreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={css.preset}
              aria-pressed={value?.regex === true && value.pattern === FILTER_PRESETS[preset]}
              data-testid={`wl-display-preset-${preset}`}
              onClick={() =>
                commit(FILTER_PRESETS[preset], { regex: true, caseSensitive: false, invert: false })
              }
            >
              {t(`display.preset.${preset}`)}
            </button>
          ))}
        </span>
        {props.inline === true && (
          <span className={css.context}>
            <span>{t('display.context')}</span>
            {context}
          </span>
        )}
        {props.extra}
      </div>
      {props.inline !== true && (
        <div className={css.optLine}>
          <span className={css.optLabel}>{t('display.context')}</span>
          {context}
        </div>
      )}
    </div>
  )
}
