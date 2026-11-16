/**
 * dsh-workflow-lite — 「运行实例」页的「画布」页签：上面一张只读的小图（{@link runMap}），下面选中那一步的情况。
 *
 * - 小图只画步骤和步骤之间的线，排版、走线和画布同一套（{@link runMap}），循环绕回去的线也照样画；卡片带状态色，
 *   走过的线是实线着色，没走过的分支画虚线，分支上写判定。左上角各种状态各几步，右上角「在画布上看这一步」打开实例并选中它。
 * - 点卡片看下面这一步，左右箭头按执行的先后翻；「概览」里点一步、时间线里点一行也到这里选中那一步。
 *
 * 小图不缩放（字一直是原大），框里放不下就按住拖着看（{@link useMapPan}），一打开选中的那一步（没点过是正在做的那步）在正中。
 * 框的高度跟着图，最高 {@link MAP_MAX_H}。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/CanvasTab
 */

import { useEffect, useMemo, useState } from 'react'
import type { InstanceView, NodeStatus } from '../../../../shared/runState.ts'
import { takenEdges } from '../../../../shared/runState.ts'
import type { T } from '../../../i18n.ts'
import { type StepLine, stepCounts } from '../../../model/runSteps.ts'
import { RUN_TEXT } from '../../canvas/cards/cardParts.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import css from './canvasTab.module.css'
import { STEP_ICON } from './runFace.ts'
import { MAP_CARD, type RunMap, runMap } from './runMap.ts'
import { hasStepBody, StepBody, StepMeta } from './StepFacts.tsx'
import { useMapPan } from './useMapPan.ts'

/** 线上的判定：「通过 / 未通过」写成画布上的说法，别的原样。 */
function whenText(t: T, when: string): string {
  return when === 'pass' ? t('edge.pass') : when === 'fail' ? t('edge.fail') : when
}

/** 小图的框最高多少（再高的图拖着看）。 */
const MAP_MAX_H = 280

/** 排过的小图（同一份图快照、同样走过的线不再排）：回到看过的实例、换回这个页签时马上画出来。 */
const drawn = new WeakMap<object, Map<string, RunMap>>()

/** 小图：排版要异步跑一次 ELK，排好之前先画上一份（换实例时）或空着（第一次）。 */
function useRunMap(view: InstanceView, taken: ReadonlySet<string>): RunMap | null {
  const key = [...taken].sort().join('|')
  const cached = (): RunMap | null => drawn.get(view.document)?.get(key) ?? null
  const [map, setMap] = useState<RunMap | null>(cached)
  useEffect(() => {
    const hit = drawn.get(view.document)?.get(key)
    if (hit !== undefined) {
      setMap(hit)
      return
    }
    let live = true
    void runMap(view.document, taken).then((made) => {
      const byKey = drawn.get(view.document) ?? new Map<string, RunMap>()
      byKey.set(key, made)
      drawn.set(view.document, byKey)
      if (live) setMap(made)
    })
    return () => {
      live = false
    }
  }, [view.document, key, taken])
  return map
}

/** 小图左上角依次数哪几种状态（有才写）。 */
const COUNTED: readonly NodeStatus[] = [
  'done',
  'running',
  'waiting',
  'failed',
  'skipped',
  'pending',
]

export function CanvasTab(props: {
  t: T
  view: InstanceView
  steps: readonly StepLine[]
  /** 选中的那一步。 */
  focus: string | undefined
  onFocus(step: string): void
  /** 打开实例、选中这一步。 */
  onOpenStep(step: string): void
}): React.JSX.Element {
  const { t, view, steps } = props
  const taken = useMemo(
    () => (view.state === null ? new Set<string>() : takenEdges(view.document, view.state)),
    [view.document, view.state],
  )
  const map = useRunMap(view, taken)
  const statusOf = (id: string): NodeStatus => view.state?.nodes[id]?.status ?? 'pending'
  const counts = stepCounts(steps)
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === props.focus),
  )
  const focused = steps[index]
  const node = focused === undefined ? undefined : view.state?.nodes[focused.id]
  const pan = useMapPan(map, focused?.id)
  const flip = (by: 1 | -1): void => {
    const next = steps[index + by]
    if (next !== undefined) props.onFocus(next.id)
  }

  return (
    <div className={css.tab} data-testid="wl-hub-run-canvas">
      <div
        ref={pan.box}
        className={css.map}
        style={{ height: `${String(Math.min(MAP_MAX_H, map?.height ?? 80))}px` }}
        data-testid="wl-hub-run-map"
        {...pan.handlers}
      >
        <div className={css.mapBar} data-no-pan="">
          {view.state !== null &&
            COUNTED.filter((status) => counts[status] > 0).map((status) => (
              <span key={status} className={css.count} data-run-status={status}>
                {counts[status]} {t(RUN_TEXT[status])}
              </span>
            ))}
          {focused !== undefined && (
            <button
              type="button"
              className={cx(ui.btn, ui.small, css.open)}
              data-testid="wl-hub-run-open-step"
              onClick={() => props.onOpenStep(focused.id)}
            >
              <Icon name="external" size={13} />
              {t('hub.runOpenStep')}
            </button>
          )}
        </div>
        {map !== null && (
          <div
            ref={pan.stage}
            data-testid="wl-hub-run-stage"
            className={css.stage}
            style={{ width: `${String(map.width)}px`, height: `${String(map.height)}px` }}
          >
            <svg className={css.lines} width={map.width} height={map.height} aria-hidden="true">
              <g transform={`translate(${String(map.shift.x)} ${String(map.shift.y)})`}>
                {map.lines.map((line) => (
                  <path
                    key={line.id}
                    d={line.path}
                    className={css.line}
                    data-taken={line.taken || undefined}
                    data-branch={line.when !== undefined || undefined}
                  />
                ))}
              </g>
            </svg>
            {map.lines.map(
              (line) =>
                line.when !== undefined && (
                  <span
                    key={`when-${line.id}`}
                    className={css.when}
                    data-taken={line.taken || undefined}
                    data-tip={whenText(t, line.when)}
                    style={{ left: `${String(line.mid.x)}px`, top: `${String(line.mid.y)}px` }}
                  >
                    {whenText(t, line.when)}
                  </span>
                ),
            )}
            {map.cards.map((card) => {
              const status = statusOf(card.id)
              const name = steps.find((step) => step.id === card.id)?.name ?? card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  className={css.card}
                  data-run-status={status}
                  aria-pressed={card.id === focused?.id}
                  data-tip={`${name} · ${t(RUN_TEXT[status])}`}
                  data-testid="wl-hub-run-map-card"
                  data-id={card.id}
                  style={{
                    width: `${String(MAP_CARD.w)}px`,
                    height: `${String(MAP_CARD.h)}px`,
                    transform: `translate(${String(card.x)}px, ${String(card.y)}px)`,
                  }}
                  onClick={() => props.onFocus(card.id)}
                >
                  <span className={css.cardMark}>
                    <Icon name={STEP_ICON[status]} size={10} />
                  </span>
                  <span className={css.cardName}>{name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {focused !== undefined && (
        <section
          className={css.focus}
          data-run-status={focused.status}
          data-testid="wl-hub-run-focus"
        >
          <div className={css.focusHead}>
            <span className={css.focusMark}>
              <Icon name={STEP_ICON[focused.status]} size={15} />
            </span>
            <b className={css.focusName}>{focused.name}</b>
            <span className={css.chip}>{t(RUN_TEXT[focused.status])}</span>
            <span className={css.flip}>
              <span className={css.flipText}>
                {t('hub.runStepOf')
                  .replace('{n}', String(index + 1))
                  .replace('{total}', String(steps.length))}
              </span>
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small)}
                aria-label={t('hub.runPrevStep')}
                data-tip={t('hub.runPrevStep')}
                disabled={index === 0}
                onClick={() => flip(-1)}
              >
                <Icon name="chevronLeft" size={14} />
              </button>
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small)}
                aria-label={t('hub.runNextStep')}
                data-tip={t('hub.runNextStep')}
                disabled={index === steps.length - 1}
                onClick={() => flip(1)}
              >
                <Icon name="chevronRight" size={14} />
              </button>
            </span>
          </div>
          <StepMeta t={t} node={node} />
          {hasStepBody(node) ? (
            <StepBody t={t} node={node} />
          ) : (
            <p className={css.quiet}>
              {t(
                focused.status === 'pending'
                  ? 'hub.runStepPending'
                  : focused.status === 'skipped'
                    ? 'hub.runStepSkipped'
                    : 'hub.runStepNoSummary',
              )}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
