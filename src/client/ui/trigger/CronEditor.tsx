/**
 * dsh-workflow-lite — Cron 的编辑器：五格（分 时 日 月 周）、每格上面写名字，光标在哪一格下面就解释那一格能填什么；
 * 哪一格写错只那一格标红；一排常用的预设，点一下填入；往任何一格里粘贴整条表达式，会自动拆进五格。
 *
 * 格子里是草稿：和表达式对不上才从表达式重新拆（预设、换回来），自己打字时不被改写。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/CronEditor
 */

import { useEffect, useState } from 'react'
import { type CronFieldName, scheduleIssue } from '../../../shared/schedule.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import ui from '../kit/ui.module.css'
import ins from '../panel/panel.module.css'
import css from './cronEditor.module.css'

const FIELDS: readonly { name: CronFieldName; label: LocaleKey; help: LocaleKey }[] = [
  { name: 'minute', label: 'trigger.cronField.minute', help: 'trigger.cronHelp.minute' },
  { name: 'hour', label: 'trigger.cronField.hour', help: 'trigger.cronHelp.hour' },
  { name: 'day', label: 'trigger.cronField.day', help: 'trigger.cronHelp.day' },
  { name: 'month', label: 'trigger.cronField.month', help: 'trigger.cronHelp.month' },
  { name: 'weekday', label: 'trigger.cronField.weekday', help: 'trigger.cronHelp.weekday' },
]

/** 常用的几条。 */
const PRESETS: readonly { id: string; label: LocaleKey; expression: string }[] = [
  { id: 'hourly', label: 'trigger.cronPreset.hourly', expression: '0 * * * *' },
  { id: 'daily', label: 'trigger.cronPreset.daily', expression: '0 9 * * *' },
  { id: 'workdays', label: 'trigger.cronPreset.workdays', expression: '0 9 * * 1-5' },
  { id: 'monday', label: 'trigger.cronPreset.monday', expression: '0 9 * * 1' },
  { id: 'monthly', label: 'trigger.cronPreset.monthly', expression: '0 9 1 * *' },
]

/** 拆成空白隔开的几段（空的不算）。 */
const tokens = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/u)
    .filter((part) => part !== '')

/** 草稿拆成五格：不够补空，多的并在最后一格里（报错时能看到整串）。 */
function split(expression: string): string[] {
  const parts = tokens(expression)
  const head = parts.slice(0, 4)
  while (head.length < 4) head.push('')
  return [...head, parts.slice(4).join(' ')]
}

export function CronEditor(props: {
  t: T
  expression: string
  /** `typing` = 正在连续输入（草稿里用不上）。 */
  onChange(expression: string, typing?: boolean): void
  onSeal?(): void
}): React.JSX.Element {
  const { t, expression } = props
  const [parts, setParts] = useState(() => split(expression))
  /** 光标在哪一格（`null` = 都不在，下面说五段各是什么）。 */
  const [focus, setFocus] = useState<number | null>(null)

  // 表达式被别处改了（预设、换回这一种）：重新拆；自己打字改的不用。
  useEffect(() => {
    setParts((now) =>
      tokens(now.join(' ')).join(' ') === tokens(expression).join(' ') ? now : split(expression),
    )
  }, [expression])

  const issue = scheduleIssue({ kind: 'cron', expression })
  const wrong =
    issue !== null && 'field' in issue
      ? FIELDS.findIndex((field) => field.name === issue.field)
      : -1

  const write = (next: string[], typing?: boolean): void => {
    setParts(next)
    props.onChange(next.join(' ').trim(), typing)
  }
  const current = tokens(expression).join(' ')

  return (
    <div className={css.editor} data-testid="wl-trigger-cron-editor">
      <div className={css.fields}>
        {FIELDS.map((field, index) => (
          <label key={field.name} className={css.field}>
            <span className={css.name}>{t(field.label)}</span>
            <input
              className={cx(ui.input, ui.mono, css.cell)}
              value={parts[index] ?? ''}
              spellCheck={false}
              placeholder="*"
              aria-label={t(field.label)}
              aria-invalid={wrong === index}
              data-testid={index === 0 ? 'wl-trigger-cron' : `wl-trigger-cron-${field.name}`}
              onFocus={() => setFocus(index)}
              onChange={(event) => {
                // 空格是分段的符号：在格子里打空格不当内容，跳到下一格。
                const value = event.currentTarget.value.replace(/\s+/gu, '')
                write(
                  parts.map((old, at) => (at === index ? value : old)),
                  true,
                )
              }}
              onPaste={(event) => {
                const pasted = tokens(event.clipboardData.getData('text'))
                if (pasted.length !== 5) return
                event.preventDefault()
                write(pasted)
              }}
              onKeyDown={(event) => {
                if (event.key !== ' ') return
                event.preventDefault()
                const next = event.currentTarget.closest('label')?.nextElementSibling
                next?.querySelector('input')?.focus()
              }}
              onBlur={() => {
                setFocus(null)
                props.onSeal?.()
              }}
            />
          </label>
        ))}
      </div>
      {/* 一直挂着，只换字：光标在哪一格就说那一格，否则说五段是什么、可以直接粘贴整条。 */}
      <p className={ins.help} data-testid="wl-trigger-cron-help">
        {focus === null ? t('trigger.cronHint') : t(FIELDS[focus]?.help ?? 'trigger.cronHint')}
      </p>
      <div className={css.presets} role="group" aria-label={t('trigger.cronPresets')}>
        <span className={css.presetsLabel}>{t('trigger.cronPresets')}</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={css.preset}
            aria-pressed={tokens(preset.expression).join(' ') === current}
            data-testid={`wl-trigger-cron-preset-${preset.id}`}
            onClick={() => write(split(preset.expression))}
          >
            {t(preset.label)}
          </button>
        ))}
      </div>
    </div>
  )
}
