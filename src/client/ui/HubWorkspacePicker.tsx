/**
 * dsh-workflow-lite — 工作流中心的工作区下拉：全部工作区，或列表里出现过的某一个（本工作区在最前）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubWorkspacePicker
 */

import { useState } from 'react'
import type { T } from '../i18n.ts'
import type { HubWorkspace } from '../model/hubRuns.ts'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import ui from './ui.module.css'

export function HubWorkspacePicker(props: {
  t: T
  workspaces: readonly HubWorkspace[]
  /** 全部实例数。 */
  total: number
  /** `'all'` 或工作区的键。 */
  value: string
  onChange(value: string): void
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  const current = props.workspaces.find((item) => item.key === props.value)
  const label =
    current === undefined
      ? t('hub.allWorkspaces')
      : current.path === undefined
        ? t('hub.noWorkspace')
        : current.name
  const pick = (value: string): void => {
    props.onChange(value)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      label={t('hub.pickWorkspace')}
      className={hub.wsMenu}
      trigger={
        <button
          type="button"
          className={cx(ui.btn, hub.wsButton)}
          aria-label={`${t('hub.pickWorkspace')}：${label}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={current?.path}
          data-testid="wl-hub-workspace"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="folder" size={14} />
          <span className={hub.wsLabel}>{label}</span>
          <Icon name="chevronDown" size={14} />
        </button>
      }
    >
      <div className={hub.wsList} role="listbox" aria-label={t('hub.pickWorkspace')}>
        <button
          type="button"
          role="option"
          aria-selected={props.value === 'all'}
          className={ui.menuItem}
          data-active={props.value === 'all'}
          data-testid="wl-hub-workspace-all"
          onClick={() => pick('all')}
        >
          <Icon name="folderOpen" size={15} />
          <span className={ui.menuLabel}>{t('hub.allWorkspaces')}</span>
          <span className={hub.count}>{props.total}</span>
        </button>
        {props.workspaces.length > 0 && <div className={ui.menuSep} />}
        {props.workspaces.map((item) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={props.value === item.key}
            className={cx(ui.menuItem, hub.wsItem)}
            data-active={props.value === item.key}
            data-testid="wl-hub-workspace-item"
            data-path={item.path}
            onClick={() => pick(item.key)}
          >
            <Icon name="folder" size={15} />
            <span className={hub.wsText}>
              <span className={hub.wsName}>
                <span>{item.path === undefined ? t('hub.noWorkspace') : item.name}</span>
                {item.here && <span className={hub.tag}>{t('hub.here')}</span>}
              </span>
              {item.path !== undefined && <span className={hub.wsPath}>{item.path}</span>}
            </span>
            <span className={hub.count}>{item.count}</span>
          </button>
        ))}
      </div>
    </Popover>
  )
}
