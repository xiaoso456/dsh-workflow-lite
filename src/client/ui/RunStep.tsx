/**
 * dsh-workflow-lite — 实例视图右栏：选中一个步骤。
 *
 * 和模板里选中步骤看到的是同一套东西，只是都换成只读、带上本次运行的样子：
 * - 描述（最多三行）；
 * - 运行状态（能改，见 `RunNodeState.tsx`）；
 * - **提示词**：只露四行，点开看全文（可复制）；
 * - **用户输入**：问了什么、这次怎么答的，点一下看那道题；
 * - **产出 / 读取**：它写哪些、读哪些资源（`RunFiles.tsx`）；
 * - **连接**：上游、下游，和模板里同一种行（`LinkRow.tsx`），多了对面那一步的状态，箭头绿的是本次
 *   经过的线；点一行看那条线（线的两端再点一下就到对面那一步）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunStep
 */

import type { GraphAnalysis } from '../../shared/graph.ts'
import { stepInputs } from '../../shared/inputs.ts'
import { idKey } from '../../shared/model.ts'
import { flowEdges } from '../../shared/resources.ts'
import type { RunState } from '../../shared/runState.ts'
import type { InputAnswer, StepNode, WorkflowDocument, WorkflowEdge } from '../../shared/types.ts'
import type { Desktop } from '../app/desktop.ts'
import type { Run } from '../app/useRuns.ts'
import type { T } from '../i18n.ts'
import { findNode } from '../model/editor.ts'
import files from './files.module.css'
import hand from './handoff.module.css'
import { Icon } from './Icon.tsx'
import ins from './inspector.module.css'
import { LinkRow } from './LinkRow.tsx'
import row from './linkrow.module.css'
import { PreviewCard } from './PreviewCard.tsx'
import { cx } from './primitives.tsx'
import { StepResourceList } from './RunFiles.tsx'
import { answerLine } from './RunInput.tsx'
import { StatusChip, StepFacts, StepStatus } from './RunNodeState.tsx'
import { stepName } from './resourceUi.ts'
import run from './run.module.css'
import desc from './runres.module.css'
import { lookOf, StepMark } from './StepMark.tsx'

export function RunStepDetail(props: {
  t: T
  current: Run
  snapshot: WorkflowDocument
  analysis: GraphAnalysis
  step: StepNode
  state: RunState | null
  /** 图里刚加、还没保存的步骤：没有运行状态可看。 */
  fresh?: boolean
  /** 这次走过的线；不记进度时为 `null`。 */
  taken: ReadonlySet<string> | null
  verdicts: readonly string[] | undefined
  answers: Readonly<Record<string, InputAnswer>> | undefined
  made: Readonly<Record<string, readonly (boolean | null)[]>>
  desktop: Desktop | undefined
  onRerun(): void
  onSelectNode(id: string): void
  onSelectEdge(id: string): void
  onFocusFile(id: string | null): void
  onViewPath(path: string): void
  /** 改这一步的提示词（改的是这次执行的图，进草稿）。 */
  onEditPrompt(prompt: string): void
  /** 一次编辑结束（弹窗关上）：断开撤销合并。 */
  onSeal(): void
}): React.JSX.Element {
  const { t, step, state } = props
  const node = state?.nodes[step.id]
  const description = step.data.description?.trim() ?? ''
  return (
    <>
      {description !== '' && (
        <p className={desc.desc} title={description}>
          {description}
        </p>
      )}
      {props.fresh === true ? (
        <p className={ins.help} data-testid="wl-run-fresh">
          {t('run.freshStep')}
        </p>
      ) : (
        state !== null &&
        (node === undefined ? (
          <p className={ins.help}>{t('run.noNode')}</p>
        ) : (
          <StepStatus
            t={t}
            current={props.current}
            id={step.id}
            node={node}
            verdicts={props.verdicts}
            onRerun={props.onRerun}
            name={stepName(step, step.id)}
            badge={<StepMark look={lookOf(step.id, step.data)} size={15} />}
            desktop={props.desktop}
          />
        ))
      )}
      <PromptSection
        t={t}
        step={step}
        desktop={props.desktop}
        onChange={props.onEditPrompt}
        onSeal={props.onSeal}
      />
      <InputsSection
        t={t}
        snapshot={props.snapshot}
        step={step.id}
        answers={props.answers}
        onSelect={props.onSelectNode}
      />
      <StepResourceList
        t={t}
        snapshot={props.snapshot}
        step={step.id}
        reported={node?.outputs ?? []}
        made={props.made}
        onSelectResource={props.onSelectNode}
        onFocusFile={props.onFocusFile}
        onViewPath={props.onViewPath}
      />
      <LinksSection
        t={t}
        snapshot={props.snapshot}
        analysis={props.analysis}
        step={step.id}
        state={state}
        taken={props.taken}
        onSelect={props.onSelectEdge}
      />
      <StepFacts t={t} node={node} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// 提示词
// ─────────────────────────────────────────────────────────────

function PromptSection(props: {
  t: T
  step: StepNode
  desktop: Desktop | undefined
  onChange(prompt: string): void
  onSeal(): void
}): React.JSX.Element {
  const { t, step } = props
  const prompt = step.data.prompt ?? ''
  const description = step.data.description?.trim() ?? ''
  return (
    <PreviewCard
      t={t}
      label={t('ins.prompt')}
      text={prompt}
      name={stepName(step, step.id)}
      badge={<StepMark look={lookOf(step.id, step.data)} size={15} />}
      meta={`${t('ins.prompt')} · ${[...prompt].length} ${t('ins.chars')}`}
      note={description}
      copyLabel={t('run.copyPrompt')}
      desktop={props.desktop}
      testId="wl-run-prompt"
      edit={{
        placeholder: t('ins.promptPlaceholder'),
        testId: 'wl-run-prompt-input',
        onChange: props.onChange,
        onSeal: props.onSeal,
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// 用户输入
// ─────────────────────────────────────────────────────────────

function InputsSection(props: {
  t: T
  snapshot: WorkflowDocument
  step: string
  answers: Readonly<Record<string, InputAnswer>> | undefined
  onSelect(id: string): void
}): React.JSX.Element | null {
  const { t } = props
  const inputs = stepInputs(props.snapshot, props.step)
  if (inputs.length === 0) return null
  return (
    <section className={run.section} data-testid="wl-run-step-asks">
      <p className={files.groupTitle}>
        {t('ins.inputs')}
        <span className={files.groupCount}>{inputs.length}</span>
      </p>
      <div className={ins.links}>
        {inputs.map((input) => (
          <button
            key={input.id}
            type="button"
            className={row.row}
            data-testid="wl-run-step-ask"
            data-id={input.id}
            onClick={() => props.onSelect(input.id)}
          >
            <span className={hand.askIcon}>
              <Icon name="ask" size={13} />
            </span>
            <span className={row.name}>
              <span className={row.nameText}>
                {input.data.question.trim() === '' ? t('input.questionEmpty') : input.data.question}
              </span>
            </span>
            <span className={row.end}>
              <Icon name="chevronRight" size={13} />
            </span>
            <span className={cx(row.sub, desc.hint)}>
              <span className={row.nameText}>{answerLine(t, props.answers?.[input.id])}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// 连接
// ─────────────────────────────────────────────────────────────

function LinksSection(props: {
  t: T
  snapshot: WorkflowDocument
  analysis: GraphAnalysis
  step: string
  state: RunState | null
  taken: ReadonlySet<string> | null
  onSelect(id: string): void
}): React.JSX.Element {
  const { t, snapshot } = props
  const key = idKey(props.step)
  const flow = flowEdges(snapshot)
  const incoming = flow.filter((edge) => idKey(edge.target) === key)
  const outgoing = flow.filter((edge) => idKey(edge.source) === key)

  const link = (edge: WorkflowEdge, direction: 'in' | 'out'): React.JSX.Element => {
    const otherId = direction === 'in' ? edge.source : edge.target
    const other = findNode(snapshot, otherId)
    const taken = props.taken === null ? undefined : props.taken.has(edge.id)
    return (
      <LinkRow
        key={edge.id}
        t={t}
        edge={edge}
        direction={direction}
        other={other}
        otherId={otherId}
        back={props.analysis.backEdges.has(edge.id)}
        taken={taken}
        takenLabel={
          taken === undefined ? undefined : t(taken ? 'run.edgeTaken' : 'run.edgeNotTaken')
        }
        end={
          <StatusChip
            t={t}
            status={other === undefined ? undefined : props.state?.nodes[other.id]?.status}
          />
        }
        testId="wl-run-link"
        onPick={() => props.onSelect(edge.id)}
      />
    )
  }

  return (
    <section className={run.section} data-testid="wl-run-links">
      <p className={files.groupTitle}>
        {t('ins.links')}
        <span className={files.groupCount}>{incoming.length + outgoing.length}</span>
      </p>
      {incoming.length === 0 && outgoing.length === 0 ? (
        <p className={ins.help}>{t('run.noLinks')}</p>
      ) : (
        <>
          {incoming.length > 0 && (
            <div className={ins.links}>
              <p className={ins.linkGroup}>{t('ins.from')}</p>
              {incoming.map((edge) => link(edge, 'in'))}
            </div>
          )}
          {outgoing.length > 0 && (
            <div className={ins.links}>
              <p className={ins.linkGroup}>{t('ins.to')}</p>
              {outgoing.map((edge) => link(edge, 'out'))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
