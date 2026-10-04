/**
 * dsh-workflow-lite — 输入节点的属性面板，与步骤面板里「用户输入」那一小节。
 *
 * 一个输入节点 = 执行前问用户的一个问题：
 * - **问题**与用户的**回答**原样进计划，交给连着的步骤（一条没连 = 交给整个工作流）；
 * - **怎么回答**：一句话 / 多行文字 / 单选 / 多选；选择题在这里编辑选项，点选项左边的圈设成默认；
 * - **默认值**：用户没改就用它；**必填**：没有回答也没有默认值时不能执行；
 * - **占位文字**与**说明**只给填写的人看，不进计划。
 *
 * 文本框都是受控的：每敲一个字就改文档（合并成一条撤销步），失焦时封口。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/InputPanel
 */

import { inputKind, inputReaders, isChoiceKind, stepInputs } from '../../shared/inputs.ts'
import { idKey, isStep } from '../../shared/model.ts'
import type {
  InputData,
  InputKind,
  InputNode,
  StepNode,
  WorkflowDocument,
} from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { type Edit, findNode, type Selection } from '../model/editor.ts'
import { INPUT_KIND_OPTIONS } from '../model/library.ts'
import hand from './handoff.module.css'
import { Icon } from './Icon.tsx'
import css from './input.module.css'
import ins from './inspector.module.css'
import { InputHead } from './NodeHeads.tsx'
import { cx, Segmented } from './primitives.tsx'
import { stepName } from './resourceUi.ts'
import { lookOf, StepMark } from './StepMark.tsx'
import ui from './ui.module.css'

export interface InputPanelProps {
  t: T
  doc: WorkflowDocument
  node: InputNode
  onEdit(edit: Edit): void
  onSelect(selection: Selection): void
  onSeal(): void
  onRemove(id: string): void
  /** 标题栏里关闭按钮左边的切换（实例视图里「运行 / 编辑」）。 */
  tabs?: React.ReactNode
}

/** 去掉换行：问题是一行字（要进计划里的一行）。 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ')
}

export function InputPanel(props: InputPanelProps): React.JSX.Element {
  const { t, node, doc, onEdit } = props
  const data = node.data
  const kind = inputKind(data)
  const choice = isChoiceKind(kind)
  const merge = (field: string): string => `${idKey(node.id)}:input:${field}`
  const patch = (next: Partial<InputData>, field?: string): void => {
    onEdit({
      type: 'patchInput',
      id: node.id,
      patch: next,
      ...(field === undefined ? {} : { merge: merge(field) }),
    })
  }
  const readers = inputReaders(doc, node.id)
  const options = data.options ?? []

  const setKind = (next: InputKind): void => {
    if (next === kind) return
    const nextChoice = isChoiceKind(next)
    const seeded =
      nextChoice && options.filter((option) => option.trim() !== '').length === 0
        ? [t('input.optionN').replace('{n}', '1'), t('input.optionN').replace('{n}', '2')]
        : undefined
    // 换题型：默认值的形状跟着变（文字 ↔ 选项 ↔ 多选），对不上就清掉。
    const keepDefault = nextChoice === choice && next !== 'multi' && kind !== 'multi'
    patch({
      kind: next === 'text' ? undefined : next,
      ...(seeded === undefined ? {} : { options: seeded }),
      ...(keepDefault ? {} : { default: undefined }),
    })
  }

  const defaults = [data.default ?? []].flat()
  const toggleDefault = (option: string): void => {
    if (kind === 'multi') {
      const next = defaults.includes(option)
        ? defaults.filter((value) => value !== option)
        : [...defaults, option]
      patch({ default: next.length === 0 ? undefined : next })
      return
    }
    patch({ default: defaults.includes(option) ? undefined : option })
  }

  return (
    <aside
      className={cx(ui.panel, ins.panel)}
      data-testid="wl-inspector"
      aria-label={t('input.title')}
    >
      <InputHead t={t} node={node} extra={props.tabs} onClose={() => props.onSelect(null)} />

      <div className={ins.body}>
        <section className={ins.field}>
          <div className={ins.label}>
            <span>{t('input.question')}</span>
          </div>
          <textarea
            className={cx(ui.textarea, css.question)}
            value={data.question}
            rows={2}
            placeholder={t('input.questionPlaceholder')}
            aria-label={t('input.question')}
            data-testid="wl-input-question"
            onChange={(event) =>
              patch({ question: oneLine(event.currentTarget.value) }, 'question')
            }
            onBlur={props.onSeal}
          />
          <p className={ins.help}>{t('input.questionHint')}</p>
        </section>

        <section className={ins.field}>
          <div className={ins.label}>
            <span>{t('input.kindLabel')}</span>
          </div>
          <Segmented<InputKind>
            label={t('input.kindLabel')}
            value={kind}
            onChange={setKind}
            options={INPUT_KIND_OPTIONS.map((option) => ({
              value: option.kind,
              label: t(option.labelKey),
            }))}
          />
        </section>

        {choice ? (
          <section className={ins.field} data-testid="wl-input-options">
            <div className={ins.label}>
              <span>{t('input.options')}</span>
              <span className={ins.count}>{t('input.defaultTip')}</span>
            </div>
            <ul className={css.options}>
              {options.map((option, index) => {
                const trimmed = option.trim()
                const duplicate =
                  trimmed !== '' && options.findIndex((other) => other.trim() === trimmed) !== index
                const isDefault = trimmed !== '' && defaults.includes(trimmed)
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 选项可以重名、可以为空，只能按位置认
                  <li key={index} className={css.option} data-duplicate={duplicate}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isDefault}
                      className={css.mark}
                      data-shape={kind === 'multi' ? 'box' : 'dot'}
                      aria-label={t('input.default')}
                      disabled={trimmed === ''}
                      data-testid="wl-input-default-mark"
                      onClick={() => toggleDefault(trimmed)}
                    >
                      <Icon name="check" size={10} />
                    </button>
                    <input
                      className={cx(ui.input, css.optionInput)}
                      value={option}
                      placeholder={t('input.optionPlaceholder')}
                      aria-label={t('input.optionN').replace('{n}', String(index + 1))}
                      aria-invalid={duplicate}
                      data-testid="wl-input-option"
                      onChange={(event) => {
                        const next = [...options]
                        const before = option.trim()
                        next[index] = oneLine(event.currentTarget.value)
                        // 改了一个默认选项的字：默认值跟着改名。
                        const after = (next[index] ?? '').trim()
                        const renamed =
                          before !== '' && defaults.includes(before)
                            ? defaults.map((value) => (value === before ? after : value))
                            : null
                        patch(
                          {
                            options: next,
                            ...(renamed === null
                              ? {}
                              : {
                                  default: kind === 'multi' ? renamed : (renamed[0] ?? undefined),
                                }),
                          },
                          `option:${index}`,
                        )
                      }}
                      onBlur={props.onSeal}
                    />
                    <button
                      type="button"
                      className={cx(ui.btn, ui.icon, ui.small, css.remove)}
                      aria-label={t('input.removeOption')}
                      data-testid="wl-input-option-remove"
                      onClick={() => {
                        const next = options.filter((_, at) => at !== index)
                        patch({
                          options: next,
                          ...(isDefault
                            ? {
                                default:
                                  kind === 'multi'
                                    ? defaults.filter((value) => value !== trimmed)
                                    : undefined,
                              }
                            : {}),
                        })
                      }}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </li>
                )
              })}
            </ul>
            {options.some(
              (option, index) =>
                option.trim() !== '' &&
                options.findIndex((other) => other.trim() === option.trim()) !== index,
            ) && <p className={ins.error}>{t('input.optionDup')}</p>}
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.soft, css.add)}
              data-testid="wl-input-option-add"
              onClick={() =>
                patch({
                  options: [
                    ...options,
                    t('input.optionN').replace('{n}', String(options.length + 1)),
                  ],
                })
              }
            >
              <Icon name="plus" size={13} />
              {t('input.addOption')}
            </button>
          </section>
        ) : (
          <section className={ins.field}>
            <div className={ins.label}>
              <span>{t('input.default')}</span>
            </div>
            {kind === 'textarea' ? (
              <textarea
                className={cx(ui.textarea, css.defaultArea)}
                value={typeof data.default === 'string' ? data.default : ''}
                rows={3}
                placeholder={t('input.defaultPlaceholder')}
                aria-label={t('input.default')}
                data-testid="wl-input-default"
                onChange={(event) => {
                  const value = event.currentTarget.value
                  patch({ default: value === '' ? undefined : value }, 'default')
                }}
                onBlur={props.onSeal}
              />
            ) : (
              <input
                className={ui.input}
                value={typeof data.default === 'string' ? data.default : ''}
                placeholder={t('input.defaultPlaceholder')}
                aria-label={t('input.default')}
                data-testid="wl-input-default"
                onChange={(event) => {
                  const value = oneLine(event.currentTarget.value)
                  patch({ default: value === '' ? undefined : value }, 'default')
                }}
                onBlur={props.onSeal}
              />
            )}
            <p className={ins.help}>{t('input.defaultHint')}</p>
          </section>
        )}

        <button
          type="button"
          role="switch"
          aria-checked={data.required === true}
          className={css.required}
          data-testid="wl-input-required"
          onClick={() => patch({ required: data.required === true ? undefined : true })}
        >
          <span className={css.switch} aria-hidden="true">
            <span className={css.knob} />
          </span>
          <span className={css.requiredText}>
            <span className={css.requiredTitle}>{t('input.required')}</span>
            <span className={css.requiredDesc}>{t('input.requiredDesc')}</span>
          </span>
        </button>

        <section className={cx(ins.field, css.private)}>
          <p className={css.privateNote}>
            <Icon name="eye" size={13} />
            <span>{t('input.private')}</span>
          </p>
          {!choice && (
            <label className={css.sub}>
              <span className={css.subLabel}>{t('input.placeholder')}</span>
              <input
                className={ui.input}
                value={data.placeholder ?? ''}
                placeholder={t('input.placeholderPlaceholder')}
                data-testid="wl-input-placeholder"
                onChange={(event) => {
                  const value = oneLine(event.currentTarget.value)
                  patch({ placeholder: value === '' ? undefined : value }, 'placeholder')
                }}
                onBlur={props.onSeal}
              />
            </label>
          )}
          <label className={css.sub}>
            <span className={css.subLabel}>{t('input.hint')}</span>
            <textarea
              className={cx(ui.textarea, css.hint)}
              value={data.hint ?? ''}
              rows={2}
              placeholder={t('input.hintPlaceholder')}
              data-testid="wl-input-hint"
              onChange={(event) => {
                const value = event.currentTarget.value
                patch({ hint: value === '' ? undefined : value }, 'hint')
              }}
              onBlur={props.onSeal}
            />
          </label>
        </section>

        <section className={ins.field} data-testid="wl-input-readers">
          <div className={ins.label}>
            <span>{t('input.readers')}</span>
          </div>
          {readers.length === 0 ? (
            <>
              <p className={ins.help}>{t('input.readersAll')}</p>
              <p className={ins.help}>{t('input.readersHint')}</p>
            </>
          ) : (
            <div className={ins.links}>
              {readers.map((id) => {
                const step = findNode(doc, id)
                return (
                  <button
                    key={id}
                    type="button"
                    className={ins.link}
                    data-testid="wl-input-reader"
                    onClick={() => props.onSelect({ kind: 'node', id })}
                  >
                    <span className={ins.linkTop}>
                      <StepMark
                        look={lookOf(
                          id,
                          step !== undefined && isStep(step) ? step.data : undefined,
                        )}
                        size={13}
                      />
                      <span className={ins.linkName}>{stepName(step, id)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <footer className={ins.foot}>
        <span className={ui.grow} />
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.danger, ui.tip, ui.tipEnd, ui.tipUp)}
          data-tip={t('input.delete')}
          aria-label={t('input.delete')}
          data-testid="wl-delete-node"
          onClick={() => props.onRemove(node.id)}
        >
          <Icon name="trash" size={15} />
        </button>
      </footer>
    </aside>
  )
}

/**
 * 步骤面板里的「用户输入」：交给这一步的问题（点一下选中那个输入）。一个都没连就不出现。
 */
export function StepInputsField(props: {
  t: T
  doc: WorkflowDocument
  step: StepNode
  onSelect(selection: Selection): void
}): React.JSX.Element | null {
  const { t } = props
  const inputs = stepInputs(props.doc, props.step.id)
  if (inputs.length === 0) return null
  return (
    <section className={ins.field} data-testid="wl-step-inputs">
      <div className={ins.label}>
        <span>{t('ins.inputs')}</span>
        <span className={ins.count}>{inputs.length}</span>
      </div>
      <div className={ins.links}>
        {inputs.map((input) => (
          <button
            key={input.id}
            type="button"
            className={ins.link}
            data-testid="wl-step-input"
            onClick={() => props.onSelect({ kind: 'node', id: input.id })}
          >
            <span className={ins.linkTop}>
              <span className={hand.askIcon}>
                <Icon name="ask" size={13} />
              </span>
              <span className={ins.linkName}>
                {input.data.question.trim() === '' ? t('input.questionEmpty') : input.data.question}
              </span>
              {input.data.required === true && (
                <span className={css.requiredChip}>{t('input.required')}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      <p className={ins.help}>{t('ins.inputsHint')}</p>
    </section>
  )
}
