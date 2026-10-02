/**
 * dsh-workflow-lite — 「执行前填写」：图里有输入节点时，点「执行」先在这里回答问题。
 *
 * 问题按画布上从上到下、从左到右的顺序排。每题显示问题、说明（只给填写的人看）、按题型的控件：
 * 一句话 / 多行文字是输入框（占位文字是灰字提示、默认值预先填好），单选 / 多选是一列选项。
 * 必填的都有了回答才能执行；回答随「执行」一起交给插件，编译进计划的「本次执行」段。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/InputsDialog
 */

import { useEffect, useRef, useState } from 'react'
import { inputKind, normalizeAnswer } from '../../shared/inputs.ts'
import { canonicalInput } from '../../shared/model.ts'
import type { InputAnswer, InputNode } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import hand from './handoff.module.css'
import { Icon } from './Icon.tsx'
import css from './inputs-dialog.module.css'
import overlay from './overlay.module.css'
import { cx, Modal } from './primitives.tsx'
import ui from './ui.module.css'

/** 表单里一题的值：文字题是一段字，选择题是选中的那几项。 */
type Value = string | string[]

function initialValue(input: InputNode, initial: Record<string, InputAnswer> | undefined): Value {
  const data = canonicalInput(input.data)
  const kind = inputKind(data)
  // 上一次填过就用上一次的（选项改过、对不上了就当没填过），否则用默认值。
  const previous = initial?.[input.id]
  const start =
    (previous === undefined ? undefined : normalizeAnswer(data, previous)) ??
    normalizeAnswer(data, data.default)
  if (kind === 'choice' || kind === 'multi') return start === undefined ? [] : [start].flat()
  return typeof start === 'string' ? start : ''
}

export function InputsDialog(props: {
  t: T
  name: string
  inputs: readonly InputNode[]
  /** 上一次在这里填的回答（预先填好）。 */
  initial: Record<string, InputAnswer> | undefined
  /** 在哪里执行（新建会话 / 本会话 / 某个会话的标题）。 */
  where: string
  onSubmit(answers: Record<string, InputAnswer>): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(props.inputs.map((input) => [input.id, initialValue(input, props.initial)])),
  )
  const firstRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    firstRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus()
  }, [])

  const answers: Record<string, InputAnswer> = {}
  const missing: string[] = []
  for (const input of props.inputs) {
    const answer = normalizeAnswer(canonicalInput(input.data), values[input.id])
    if (answer !== undefined) answers[input.id] = answer
    else if (input.data.required === true) missing.push(input.id)
  }
  const canRun = missing.length === 0

  const submit = (): void => {
    if (canRun) props.onSubmit(answers)
  }
  const set = (id: string, value: Value): void => {
    setValues((current) => ({ ...current, [id]: value }))
  }

  return (
    <Modal label={t('ask.title')} testId="wl-ask" className={css.sheet} onDismiss={props.onClose}>
      <form
        className={overlay.sheetForm}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      >
        <header className={overlay.sheetHead}>
          <span className={cx(hand.askIcon, css.headIcon)}>
            <Icon name="ask" size={16} />
          </span>
          <div className={overlay.sheetTitles}>
            <p className={overlay.sheetTitle}>{t('ask.title')}</p>
            <p className={overlay.sheetSub}>
              {t('ask.sub')
                .replace('{name}', props.name)
                .replace('{n}', String(props.inputs.length))}
            </p>
          </div>
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t('common.close')}
            onClick={props.onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        <div className={cx(overlay.sheetBody, css.body)}>
          {props.inputs.map((input, index) => (
            <Question
              key={input.id}
              t={t}
              input={input}
              index={index}
              value={values[input.id] ?? ''}
              onChange={(value) => set(input.id, value)}
              {...(index === 0 ? { innerRef: firstRef } : {})}
            />
          ))}
        </div>

        <footer className={overlay.sheetFoot}>
          <span className={css.where}>{t('ask.where').replace('{where}', props.where)}</span>
          <span className={ui.grow} />
          {!canRun && (
            <span className={css.missing} data-testid="wl-ask-missing">
              {t('ask.missing').replace('{n}', String(missing.length))}
            </span>
          )}
          {canRun && <span className={overlay.sheetKeys}>{t('ask.keys')}</span>}
          <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className={cx(ui.btn, ui.small, ui.primary)}
            disabled={!canRun}
            data-testid="wl-ask-run"
          >
            <Icon name="play" size={13} />
            {t('ask.run')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

/** 一题：问题（+ 必填）、说明、控件。 */
function Question(props: {
  t: T
  input: InputNode
  index: number
  value: Value
  onChange(value: Value): void
  innerRef?: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  const { t, input } = props
  const data = canonicalInput(input.data)
  const kind = inputKind(data)
  const labelId = `wl-ask-q-${props.index}`
  const picked = Array.isArray(props.value) ? props.value : []
  const text = typeof props.value === 'string' ? props.value : ''
  const defaults = [data.default ?? []].flat()
  return (
    <section
      className={css.question}
      ref={props.innerRef}
      data-testid="wl-ask-question"
      data-id={input.id}
    >
      <div className={css.qHead}>
        <span className={css.qIndex}>{props.index + 1}</span>
        <span id={labelId} className={css.qText}>
          {data.question}
        </span>
        {data.required === true && <span className={css.required}>{t('ask.requiredTag')}</span>}
      </div>
      {data.hint !== undefined && <p className={css.qHint}>{data.hint}</p>}

      {kind === 'text' && (
        <input
          className={ui.input}
          value={text}
          placeholder={data.placeholder ?? ''}
          aria-labelledby={labelId}
          data-testid="wl-ask-text"
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
      {kind === 'textarea' && (
        <textarea
          className={cx(ui.textarea, css.area)}
          value={text}
          rows={4}
          placeholder={data.placeholder ?? ''}
          aria-labelledby={labelId}
          data-testid="wl-ask-text"
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
      {(kind === 'choice' || kind === 'multi') && (
        <div className={css.choices} role="group" aria-labelledby={labelId}>
          <span className={css.pickHint}>
            {kind === 'multi' ? t('ask.pickMany') : t('ask.pickOne')}
          </span>
          {(data.options ?? []).map((option) => {
            const on = picked.includes(option)
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                className={css.choice}
                data-shape={kind === 'multi' ? 'box' : 'dot'}
                data-testid="wl-ask-option"
                onClick={() => {
                  if (kind === 'multi') {
                    const next = on
                      ? picked.filter((value) => value !== option)
                      : [...picked, option]
                    props.onChange(next)
                  } else {
                    // 单选再点一下已选的那项 = 取消（可不填的问题能回到没选）。
                    props.onChange(on ? [] : [option])
                  }
                }}
              >
                <span className={css.mark} aria-hidden="true">
                  <Icon name="check" size={10} />
                </span>
                <span className={css.choiceText}>{option}</span>
                {defaults.includes(option) && (
                  <span className={css.defaultTag}>{t('ask.defaultTag')}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
