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
import type { RunState } from '../../shared/runState.ts'
import type { InputAnswer, InputNode, WorkflowDocument } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { inputKindLabel } from '../model/library.ts'
import hand from './handoff.module.css'
import { Icon } from './Icon.tsx'
import css from './inspector.module.css'
import row from './linkrow.module.css'
import { StatusChip } from './RunNodeState.tsx'
import { stepName } from './resourceUi.ts'
import run from './run.module.css'
import { lookOf, StepMark } from './StepMark.tsx'

/** 用户的回答：文字原样、多选一行一个、没填写就说没填写。 */
export function AnswerView(props: { t: T; answer: InputAnswer | undefined }): React.JSX.Element {
  const { t, answer } = props
  if (answer === undefined) {
    return (
      <p className={run.inputAnswerEmpty} data-testid="wl-run-input-answer">
        {t('input.noAnswer')}
      </p>
    )
  }
  if (Array.isArray(answer)) {
    return (
      <ul className={run.inputPicked} data-testid="wl-run-input-answer">
        {answer.map((item) => (
          <li key={item}>
            <Icon name="check" size={12} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <p className={run.inputAnswer} data-testid="wl-run-input-answer">
      {answer}
    </p>
  )
}

/** 回答的一行写法（步骤详情的「用户输入」里）：多选用顿号连起来。 */
export function answerLine(t: T, answer: InputAnswer | undefined): string {
  if (answer === undefined) return t('input.noAnswer')
  return Array.isArray(answer) ? answer.join('、') : answer
}

export function RunInputDetail(props: {
  t: T
  snapshot: WorkflowDocument
  input: InputNode
  answer: InputAnswer | undefined
  state: RunState | null
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
        <AnswerView t={t} answer={answer} />
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
                  className={row.row}
                  onClick={() => props.onSelectStep(id)}
                >
                  <span className={row.lead}>
                    <StepMark
                      look={lookOf(id, step !== undefined && isStep(step) ? step.data : undefined)}
                      size={13}
                    />
                  </span>
                  <span className={row.name}>
                    <span className={row.nameText}>{stepName(step, id)}</span>
                  </span>
                  <span className={row.end}>
                    <StatusChip t={t} status={props.state?.nodes[id]?.status} />
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
