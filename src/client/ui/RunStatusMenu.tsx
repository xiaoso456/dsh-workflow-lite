/**
 * dsh-workflow-lite — 实例视图里点步骤卡上的状态小标弹出的小菜单：改状态（有条件出边的改成完成时先问判定）、
 * 指定为下一步、重跑这一步。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunStatusMenu
 */

import { useEffect, useRef } from 'react'
import { NODE_STATUSES, type NodeStatus } from '../../shared/runState.ts'
import type { T } from '../i18n.ts'
import { RUN_TEXT } from './Canvas.tsx'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import { NODE_ICON, nodeHint } from './RunNodeState.tsx'
import run from './run.module.css'
import ui from './ui.module.css'

export function StatusMenu(props: {
  t: T
  at: { x: number; y: number }
  node: { status: NodeStatus; verdict?: string }
  step: 'status' | 'verdict'
  verdicts: readonly string[]
  onStatus(status: NodeStatus): void
  onVerdict(verdict: string): void
  onRerun(): void
  /** 这一步在不在用户指定的下一步里。 */
  pinned: boolean
  onPin(): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) props.onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [props.onClose])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
  }, [props.step])
  return (
    <div
      ref={ref}
      className={cx(ui.panel, run.menu)}
      style={{ left: props.at.x, top: props.at.y }}
      role="menu"
      data-testid="wl-run-menu"
    >
      {props.step === 'verdict' ? (
        <>
          <p className={run.menuHint}>{t('run.pickVerdict')}</p>
          {props.verdicts.map((verdict) => (
            <button
              key={verdict}
              type="button"
              role="menuitem"
              className={ui.menuItem}
              data-testid="wl-run-verdict"
              onClick={() => props.onVerdict(verdict)}
            >
              <Icon name="check" size={14} />
              <span className={ui.menuLabel}>{verdict}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          {NODE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="menuitemradio"
              aria-checked={props.node.status === status}
              className={ui.menuItem}
              data-active={props.node.status === status}
              data-status={status}
              data-tip={t(nodeHint(status))}
              onClick={() => props.onStatus(status)}
            >
              <span
                data-run-status={status}
                style={{ display: 'inline-flex', color: 'var(--wl-run)' }}
              >
                <Icon name={NODE_ICON[status]} size={14} />
              </span>
              <span className={ui.menuLabel}>{t(RUN_TEXT[status])}</span>
            </button>
          ))}
          <div className={ui.menuSep} />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={props.pinned}
            className={ui.menuItem}
            data-testid="wl-run-menu-pin"
            onClick={props.onPin}
          >
            <Icon name="flag" size={14} />
            <span className={ui.menuLabel}>{t(props.pinned ? 'run.unpin' : 'run.pin')}</span>
          </button>
          {props.node.status !== 'pending' && (
            <button
              type="button"
              role="menuitem"
              className={ui.menuItem}
              data-testid="wl-run-rerun"
              onClick={props.onRerun}
            >
              <Icon name="reload" size={14} />
              <span className={ui.menuLabel}>{t('run.rerun')}</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
