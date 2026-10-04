/**
 * dsh-workflow-lite — 实例视图右栏：选中一条线。
 *
 * 和模板里选中连线看到的一样，换成只读、带上本次运行：
 * - 两端（带各自的状态，点一下到那一步 / 那张卡）；
 * - 一张小表：**状态**（已流转 / 未流转，下面一行是依据：条件线看上游的判定）、
 *   **条件**（步骤之间的线）、**交接**（执行结果 / 只管先后）；连资源的线是写入方式或读取；
 * - **上游摘要**、**交接说明**：只露几行，点开看全文——下游拿到的就是它们；
 * - 用户输入的线：本次的回答；回头线说明在循环里、目标做到第几轮。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunEdge
 */

import type { GraphAnalysis } from '../../shared/graph.ts'
import { isInput, isStep } from '../../shared/model.ts'
import { isVerdictWhen } from '../../shared/naming.ts'
import { type EdgeKind, edgeKind, nodeIndex, resolveHandoff } from '../../shared/resources.ts'
import type { RunState } from '../../shared/runState.ts'
import type { InputAnswer, WorkflowDocument, WorkflowEdge } from '../../shared/types.ts'
import type { Desktop } from '../app/desktop.ts'
import type { T } from '../i18n.ts'
import { findNode, whenOf } from '../model/editor.ts'
import { RUN_TEXT } from './Canvas.tsx'
import files from './files.module.css'
import { Icon } from './Icon.tsx'
import { EndIcon } from './Inspector.tsx'
import ins from './inspector.module.css'
import { WhenChip } from './LinkRow.tsx'
import { PreviewCard } from './PreviewCard.tsx'
import { cx } from './primitives.tsx'
import { AnswerView } from './RunInput.tsx'
import { stepName } from './resourceUi.ts'
import run from './run.module.css'
import css from './runstep.module.css'

export function RunEdgeDetail(props: {
  t: T
  snapshot: WorkflowDocument
  analysis: GraphAnalysis
  edge: WorkflowEdge
  state: RunState | null
  /** 本次经过的线；不记进度时为 `null`。 */
  taken: ReadonlySet<string> | null
  answers: Readonly<Record<string, InputAnswer>> | undefined
  desktop: Desktop | undefined
  onSelectNode(id: string): void
}): React.JSX.Element {
  const { t, snapshot, edge, state } = props
  const kind = edgeKind(nodeIndex(snapshot), edge)
  const source = findNode(snapshot, edge.source)
  const target = findNode(snapshot, edge.target)
  const sourceName = stepName(source, edge.source)
  const back = props.analysis.backEdges.has(edge.id)
  const when = whenOf(edge)
  const handoff = resolveHandoff(edge.data?.handoff)
  const update = edge.data?.update === true
  const summary =
    kind === 'flow' && handoff.result && source !== undefined
      ? state?.nodes[source.id]?.summary?.trim() || undefined
      : undefined
  const round = target === undefined ? 0 : (state?.nodes[target.id]?.round ?? 0)

  const end = (id: string): React.JSX.Element => {
    const node = findNode(snapshot, id)
    const status = node !== undefined && isStep(node) ? state?.nodes[node.id]?.status : undefined
    return (
      <button
        type="button"
        className={ins.end}
        data-testid="wl-run-edge-end"
        data-id={id}
        onClick={() => props.onSelectNode(node?.id ?? id)}
      >
        <EndIcon node={node} id={id} />
        <span className={ins.endName}>{stepName(node, id)}</span>
        {status !== undefined && (
          <span className={css.endDot} data-run-status={status} title={t(RUN_TEXT[status])}>
            <span className={run.dot} />
          </span>
        )}
      </button>
    )
  }

  const taken = props.taken?.has(edge.id)
  const sourceBadge =
    source !== undefined ? <EndIcon node={source} id={edge.source} /> : <Icon name="result" />

  return (
    <>
      <div className={ins.ends} data-testid="wl-run-edge" data-kind={kind}>
        {end(edge.source)}
        <span className={ins.endArrow}>
          <Icon name="arrowRight" size={14} />
        </span>
        {end(edge.target)}
      </div>

      <dl className={css.facts}>
        {taken !== undefined && (
          <>
            <dt>{t('run.edgeStatus')}</dt>
            <dd>
              <span
                className={cx(css.value, css.taken)}
                data-on={taken}
                data-testid="wl-run-edge-taken"
              >
                <span className={css.takenDot} />
                {t(taken ? 'run.edgeTaken' : 'run.edgeNotTaken')}
              </span>
              <span className={css.hint}>{takenWhy(t, snapshot, edge, kind, state)}</span>
            </dd>
          </>
        )}

        {kind === 'flow' && (
          <>
            <dt>{t('run.edgeWhen')}</dt>
            <dd>
              <WhenChip t={t} when={when} always />
              {when !== undefined && isVerdictWhen(when) ? (
                <span className={css.hint}>
                  {t('run.edgeVerdictRule')} <code className={css.code}>VERDICT: {when}</code>
                </span>
              ) : (
                <span className={css.hint}>
                  {t(when === undefined ? 'edge.hintAlways' : 'edge.hintJudge')}
                </span>
              )}
            </dd>
            <dt>{t('hand.title')}</dt>
            <dd data-testid="wl-run-edge-handoff">
              <span className={css.value}>
                <span className={css.resultIcon} data-result={handoff.result}>
                  <Icon name="result" size={12} />
                </span>
                {handoff.result ? t('hand.resultShort') : t('hand.flowOnly')}
              </span>
              <span className={css.hint}>
                {handoff.result ? `${sourceName}${t('hand.resultOf')}` : t('hand.flowOnlyHint')}
              </span>
            </dd>
          </>
        )}

        {kind === 'write' && (
          <>
            <dt>{t('run.edgeWrite')}</dt>
            <dd>
              <span className={files.mode} data-mode={update ? 'update' : 'produce'}>
                {t(update ? 'file.updateLong' : 'file.produceLong')}
              </span>
              <span className={css.hint}>{t('res.modeHint')}</span>
            </dd>
          </>
        )}
        {kind === 'read' && (
          <>
            <dt>{t('run.edgeRead')}</dt>
            <dd>
              <span className={files.mode} data-mode="read">
                {t('file.read')}
              </span>
              <span className={css.hint}>{t('res.readHint')}</span>
            </dd>
          </>
        )}
        {back && (
          <>
            <dt>{t('run.edgeLoop')}</dt>
            <dd>
              <span className={css.value}>
                <Icon name="loop" size={13} />
                {round > 1 && target !== undefined
                  ? t('run.loopRound')
                      .replace('{step}', stepName(target, target.id))
                      .replace('{n}', String(round))
                  : t('run.loopBack')}
              </span>
              <span className={css.hint}>{t('edge.loop')}</span>
            </dd>
          </>
        )}
      </dl>

      {summary !== undefined && (
        <PreviewCard
          t={t}
          label={t('run.handedSummary')}
          text={summary}
          name={`${sourceName} · ${t('run.handedSummary')}`}
          badge={sourceBadge}
          meta={t('run.summary')}
          copyLabel={t('run.copySummary')}
          desktop={props.desktop}
          testId="wl-run-edge-summary"
          lines={5}
        />
      )}
      {kind === 'flow' && handoff.result && handoff.note !== undefined && (
        <PreviewCard
          t={t}
          label={t('hand.note')}
          text={handoff.note}
          name={`${sourceName} · ${t('hand.note')}`}
          badge={sourceBadge}
          meta={t('hand.note')}
          copyLabel={t('run.copyNote')}
          desktop={props.desktop}
          testId="wl-run-edge-note"
          lines={3}
        />
      )}
      {kind === 'ask' && source !== undefined && isInput(source) && (
        <section className={run.section}>
          <p className={files.groupTitle}>{t('input.answer')}</p>
          <AnswerView t={t} answer={props.answers?.[source.id]} />
          <p className={ins.help}>{t('edge.askHint')}</p>
        </section>
      )}
    </>
  )
}

/** 流转的依据：条件线看上游的判定，其余按规则。 */
function takenWhy(
  t: T,
  doc: WorkflowDocument,
  edge: WorkflowEdge,
  kind: EdgeKind,
  state: RunState | null,
): string {
  if (kind !== 'flow') return t('run.edgeWhyStep')
  const when = whenOf(edge)
  if (when === undefined) return t('run.edgeWhyFlow')
  const source = findNode(doc, edge.source)
  const name = stepName(source, edge.source)
  const verdict = source === undefined ? undefined : state?.nodes[source.id]?.verdict
  return verdict === undefined
    ? t('run.edgeNoVerdict').replace('{step}', name)
    : t('run.edgeVerdict').replace('{step}', name).replace('{verdict}', verdict)
}
