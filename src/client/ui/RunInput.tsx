/**
 * dsh-workflow-lite — 实例视图里选中一个输入节点：这次执行用户是怎么回答的。
 *
 * 问题、用户的回答（执行前填的，已补上默认值），以及回答交给了哪些步骤（点一下看那一步）。
 * 回答是实例建立时定下的，这里只读。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunInput
 */

import { inputKind, inputReaders } from '../../shared/inputs.ts'
import { isStep } from '../../shared/model.ts'
import type { InputAnswer, InputNode, WorkflowDocument } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { inputKindLabel } from '../model/library.ts'
import hand from './handoff.module.css'
import { Icon } from './Icon.tsx'
import css from './inspector.module.css'
import { stepName } from './resourceUi.ts'
import run from './run.module.css'
import { lookOf, StepMark } from './StepMark.tsx'

export function RunInputDetail(props: {
  t: T
  snapshot: WorkflowDocument
  input: InputNode
  answer: InputAnswer | undefined
  onSelectStep(id: string): void
}): React.JSX.Element {
  const { t, input, answer } = props
  const kind = inputKind(input.data)
  const readers = inputReaders(props.snapshot, input.id)
  const label = inputKindLabel(kind)
  return (
    <div className={run.inputDetail} data-testid="wl-run-input">
      <div className={run.inputHead}>
        <span className={hand.askIcon}>
          <Icon name="ask" size={14} />
        </span>
        <span className={run.inputQuestion}>{input.data.question}</span>
      </div>
      <p className={css.help}>
        {t(label)}
        {input.data.required === true ? ` · ${t('input.required')}` : ''}
      </p>

      <section className={css.field}>
        <div className={css.label}>
          <span>{t('input.answer')}</span>
        </div>
        {answer === undefined ? (
          <p className={run.inputAnswerEmpty} data-testid="wl-run-input-answer">
            {t('input.noAnswer')}
          </p>
        ) : Array.isArray(answer) ? (
          <ul className={run.inputPicked} data-testid="wl-run-input-answer">
            {answer.map((item) => (
              <li key={item}>
                <Icon name="check" size={12} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={run.inputAnswer} data-testid="wl-run-input-answer">
            {answer}
          </p>
        )}
      </section>

      <section className={css.field}>
        <div className={css.label}>
          <span>{t('input.readers')}</span>
        </div>
        {readers.length === 0 ? (
          <p className={css.help}>{t('input.readersAll')}</p>
        ) : (
          <div className={css.links}>
            {readers.map((id) => {
              const step = props.snapshot.nodes.find((node) => node.id === id)
              return (
                <button
                  key={id}
                  type="button"
                  className={css.link}
                  onClick={() => props.onSelectStep(id)}
                >
                  <span className={css.linkTop}>
                    <StepMark
                      look={lookOf(id, step !== undefined && isStep(step) ? step.data : undefined)}
                      size={13}
                    />
                    <span className={css.linkName}>{stepName(step, id)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
