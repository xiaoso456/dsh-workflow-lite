/**
 * dsh-workflow-lite — 「?」说明：平时只占一个小图标，悬停 / 聚焦 / 点击时浮出一段说明。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/HelpTip
 */

import ui from './ui.module.css'
import { FLOAT_EXIT_MS, useFloat } from './useFloat.tsx'

/** 「?」说明：悬停多久才出来、离开多久才收（留出把鼠标移进浮层的时间）。 */
const HINT_OPEN_MS = 120
const HINT_CLOSE_MS = 220
const HINT_W = 320

/**
 * 「?」说明：平时只占一个小图标，悬停 / 聚焦 / 点击时浮出一段说明（浮层行为见 {@link useFloat}）。
 * 点「?」钉住（触屏也能用），点别处或按 Esc 收起。
 */
export function HelpTip(props: {
  label: string
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  const float = useFloat<HTMLButtonElement>({
    openMs: HINT_OPEN_MS,
    closeMs: HINT_CLOSE_MS,
    width: HINT_W,
    exitMs: FLOAT_EXIT_MS,
  })
  const { state, setState } = float
  return (
    <span className={ui.hint}>
      <button
        ref={float.anchorRef}
        type="button"
        className={ui.hintButton}
        aria-label={props.label}
        aria-expanded={state !== 'off'}
        data-open={state !== 'off'}
        data-testid={props.testId}
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
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
          <path
            d="M9.6 9.4a2.5 2.5 0 014.9.6c0 1.7-2.5 2.1-2.5 3.6M12 16.9v.1"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </svg>
      </button>
      {float.render({
        className: ui.hintPanel,
        testId: props.testId === undefined ? undefined : `${props.testId}-panel`,
        children: props.children,
      })}
    </span>
  )
}
