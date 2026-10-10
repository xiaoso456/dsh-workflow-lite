/**
 * dsh-workflow-lite — 工作流中心一行里的整体状态：小标本身就是按钮，点开挑一个新状态，再二次确认。
 *
 * - 菜单列六种整体状态（和实例视图「整体」那一排同一套），每项一行名字、一行说明，当前的打勾；
 * - 挑了别的，菜单收起，确认卡挂在同一个小标上：「把实例状态改成『失败』？」，
 *   卡里一个「通知模型」开关（和实例视图草稿栏同一个）——这里**默认关**：在列表里顺手改状态，
 *   多半只是整理，不该打断正在跑的模型；打开时多一栏「给模型的说明」。
 * - 只改整体状态，不动各步骤；文件里的状态已经不是列表上看到的那个，保存会被拒（冲突），由调用方提示并刷新。
 *
 * 不记运行状态的实例、状态文件读不出来的实例不能在这里改（小标照旧，不是按钮）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubRunStatus
 */

import { useId, useRef, useState } from 'react'
import { RUN_STATUSES, type RunStatus } from '../../shared/runState.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { useConfirm } from './Confirm.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { cx, useFloat } from './primitives.tsx'
import { RUN_STATUS_TEXT, RunStatusBadge } from './RunTopBar.tsx'
import run from './run.module.css'
import ui from './ui.module.css'

const MENU_W = 248

export function HubRunStatus(props: {
  t: T
  status: RunStatus
  onChange(to: RunStatus, options: { notify: boolean; note: string }): void
}): React.JSX.Element {
  const { t, status } = props
  const menu = useFloat<HTMLButtonElement>({ openMs: 0, closeMs: 0, width: MENU_W, align: 'auto' })
  const confirm = useConfirm<HTMLSpanElement>()
  const [target, setTarget] = useState<RunStatus | null>(null)
  const [notify, setNotify] = useState(false)
  const [note, setNote] = useState('')
  const notifyId = useId()
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const open = menu.state !== 'off'

  const pick = (to: RunStatus): void => {
    menu.setState('off')
    if (to === status) return
    setTarget(to)
    setNotify(false)
    setNote('')
    confirm.show()
  }

  return (
    <span ref={confirm.anchorRef} className={hub.state}>
      <button
        ref={menu.anchorRef}
        type="button"
        className={hub.statusButton}
        aria-haspopup="menu"
        aria-expanded={open || confirm.open}
        aria-label={`${t('hub.setStatus')}：${t(RUN_STATUS_TEXT[status])}`}
        data-tip={open || confirm.open ? undefined : t('hub.setStatus')}
        data-testid="wl-hub-status"
        onClick={() => {
          if (confirm.open) confirm.hide()
          menu.setState(open ? 'off' : 'pinned')
          // 打开后焦点落在当前那一项上，上下键能接着挑。
          requestAnimationFrame(() =>
            items.current[RUN_STATUSES.indexOf(status)]?.focus({ preventScroll: true }),
          )
        }}
        onKeyDown={menu.onKeyDown}
      >
        <RunStatusBadge t={t} status={status} />
        <span className={hub.statusCaret}>
          <Icon name="chevronDown" size={12} />
        </span>
      </button>
      {menu.render({
        className: cx(ui.confirmPop, hub.statusMenu),
        role: 'menu',
        label: t('hub.setStatus'),
        testId: 'wl-hub-status-menu',
        children: RUN_STATUSES.map((value, index) => (
          <button
            key={value}
            ref={(element) => {
              items.current[index] = element
            }}
            type="button"
            role="menuitemradio"
            aria-checked={value === status}
            className={cx(ui.menuItem, hub.statusItem)}
            data-run-status={value}
            data-value={value}
            data-testid="wl-hub-status-item"
            onClick={() => pick(value)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
              if (step === 0) return
              event.preventDefault()
              const next = (index + step + RUN_STATUSES.length) % RUN_STATUSES.length
              items.current[next]?.focus()
            }}
          >
            <span className={run.dot} />
            <span className={hub.statusText}>
              <span className={hub.statusName}>{t(RUN_STATUS_TEXT[value])}</span>
              <span className={hub.statusHint}>{t(`run.hint.${value}` as LocaleKey)}</span>
            </span>
            {value === status && (
              <span className={hub.statusCheck}>
                <Icon name="check" size={14} />
              </span>
            )}
          </button>
        )),
      })}
      {target !== null &&
        confirm.render({
          t,
          title: t('hub.setStatusTitle').replace('{to}', t(RUN_STATUS_TEXT[target])),
          desc: t('hub.setStatusDesc').replace('{from}', t(RUN_STATUS_TEXT[status])),
          confirmText: t('hub.setStatusConfirm'),
          danger: false,
          testId: 'wl-hub-status-confirm',
          onConfirm: () => props.onChange(target, { notify, note }),
          children: (
            <div className={hub.statusOptions}>
              <label className={run.notify} htmlFor={notifyId} data-tip={t('run.notifyTip')}>
                <button
                  id={notifyId}
                  type="button"
                  role="switch"
                  aria-checked={notify}
                  className={ui.switch}
                  data-testid="wl-hub-status-notify"
                  onClick={() => setNotify((on) => !on)}
                >
                  <span className={ui.knob} />
                </button>
                {t('run.notify')}
              </label>
              {notify && (
                <input
                  className={cx(ui.input, hub.statusNote)}
                  value={note}
                  placeholder={t('run.notePrompt')}
                  aria-label={t('run.notePrompt')}
                  data-testid="wl-hub-status-note"
                  onChange={(event) => setNote(event.currentTarget.value)}
                />
              )}
            </div>
          ),
        })}
    </span>
  )
}
