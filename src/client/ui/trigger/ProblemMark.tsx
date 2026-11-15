/**
 * dsh-workflow-lite — 触发卡片状态后面的问题图标：平时就是一枚小图标（没有问题时藏着，不插拔、不占地方），
 * 颜色跟着要不要紧（说明 / 提醒 / 出错）。悬停 / 聚焦浮出小卡写着怎么回事，点它钉住（触屏也能用）；
 * 小卡里的按钮做能直接做的那一下（确认命令、重新打开）。
 *
 * 画布面板最上面的框（`TriggerStatus`）和「触发」页右栏的状态条（`TriggerHead`）共用；说法见 `model/triggerProblem.ts`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/ProblemMark
 */

import type { T } from '../../i18n.ts'
import type { Problem, ProblemFix } from '../../model/triggerProblem.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { FLOAT_EXIT_MS, useFloat } from '../kit/useFloat.tsx'
import css from './problemMark.module.css'

/** 问题小卡：悬停多久才出来、离开多久才收（留出把鼠标移进小卡去点按钮的时间）。 */
const OPEN_MS = 120
const CLOSE_MS = 220
const WIDTH = 320

export function ProblemMark(props: {
  t: T
  problem: Problem | null
  /** 图标按钮的 `data-testid`；小卡是 `${testId}-panel`，小卡里的按钮是 `${testId}-fix`。 */
  testId: string
  /** 要确认命令时确认卡浮在哪：给了就挂在这枚图标上。 */
  anchorRef?: React.RefObject<HTMLButtonElement>
  className?: string
  onAction(run: ProblemFix): void
}): React.JSX.Element {
  const { t, problem, testId } = props
  const float = useFloat<HTMLSpanElement>({
    openMs: OPEN_MS,
    closeMs: CLOSE_MS,
    width: WIDTH,
    exitMs: FLOAT_EXIT_MS,
  })
  const { state, setState } = float
  const open = state !== 'off' && problem !== null
  return (
    <span ref={float.anchorRef} className={cx(css.mark, props.className)} hidden={problem === null}>
      <button
        ref={props.anchorRef}
        type="button"
        className={css.button}
        data-tone={problem?.tone}
        data-opened={open}
        aria-label={problem?.text ?? ''}
        aria-expanded={open}
        data-testid={testId}
        {...float.hoverProps}
        onFocus={() => {
          if (state === 'off') setState('hover')
        }}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (
            state === 'hover' &&
            !(next instanceof Node && float.panelRef.current?.contains(next))
          ) {
            setState('off')
          }
        }}
        onClick={() => {
          float.cancel()
          setState((current) => (current === 'pinned' ? 'off' : 'pinned'))
        }}
        onKeyDown={float.onKeyDown}
      >
        <Icon name={problem?.tone === 'calm' ? 'info' : 'alert'} size={15} />
      </button>
      {problem !== null &&
        float.render({
          className: ui.hintPanel,
          testId: `${testId}-panel`,
          role: problem.action === undefined ? 'tooltip' : 'dialog',
          label: problem.text,
          children: (
            <div className={css.card} data-tone={problem.tone}>
              <p className={css.text}>{problem.text}</p>
              {problem.action !== undefined && (
                <button
                  type="button"
                  className={cx(ui.btn, ui.small, ui.soft)}
                  data-testid={`${testId}-fix`}
                  onClick={() => {
                    setState('off')
                    const run = problem.action?.run
                    if (run !== undefined) props.onAction(run)
                  }}
                >
                  {t(problem.action.label)}
                </button>
              )}
            </div>
          ),
        })}
    </span>
  )
}
