/**
 * dsh-workflow-lite — 「用其他程序打开」按钮。
 *
 * 点开列出系统里能打开这类文件的程序（默认的那个排第一并标出来），最后一项是在文件管理器里显示——
 * 和 DSH 文档预览右上角那个按钮一样。宿主没有桌面能力（远程访问、没接上服务）或文件还不在时不出现。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/OpenWith
 */

import { useEffect, useState } from 'react'
import type { Desktop, DesktopApp } from '../app/desktop.ts'
import type { T } from '../i18n.ts'
import css from './files.module.css'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import ui from './ui.module.css'

export interface OpenWithProps {
  t: T
  desktop: Desktop | undefined
  /** 文件的绝对路径；文件还不在时为 `null`（系统程序那一半不出现）。 */
  path: string | null
  /** 只留图标（文件面板的标题行里用）；缺省是「图标 + 字 + 箭头」。 */
  compact?: boolean
  /** 打开失败时告诉调用方（给人看的一句话）。 */
  onError?: (text: string) => void
}

type Apps =
  | { state: 'loading' }
  | { state: 'ready'; apps: readonly DesktopApp[] }
  | { state: 'failed' }

export function OpenWith(props: OpenWithProps): React.JSX.Element | null {
  const { t, desktop, path } = props
  const [hasDesktop, setHasDesktop] = useState(false)
  const [open, setOpen] = useState(false)
  const [apps, setApps] = useState<Apps>({ state: 'loading' })

  useEffect(() => {
    let alive = true
    if (desktop === undefined) {
      setHasDesktop(false)
      return
    }
    void desktop.available().then((value) => {
      if (alive) setHasDesktop(value)
    })
    return () => {
      alive = false
    }
  }, [desktop])

  // 菜单打开时才问系统（每个文件的关联程序不一样，也可能刚装了新的）。
  useEffect(() => {
    if (!open || desktop === undefined || path === null) return
    const abort = new AbortController()
    setApps({ state: 'loading' })
    void desktop.applications(path, abort.signal).then((value) => {
      if (abort.signal.aborted) return
      setApps(value === null ? { state: 'failed' } : { state: 'ready', apps: value })
    })
    return () => abort.abort()
  }, [open, desktop, path])

  if (!hasDesktop || desktop === undefined || path === null) return null

  const launch = (how: { reveal: true } | { application?: string }): void => {
    setOpen(false)
    if (desktop === undefined || path === null) return
    void desktop.open(path, how).then((ok) => {
      if (!ok) props.onError?.(t('file.openFailed'))
    })
  }

  // 程序多时只滚程序那一段，「在文件管理器中显示」一直露在底下。
  const menu = (
    <>
      <div className={css.appList}>
        {apps.state === 'loading' && <p className={ui.menuTitle}>{t('file.appsLoading')}</p>}
        {apps.state === 'failed' && <p className={ui.menuTitle}>{t('file.appsNone')}</p>}
        {apps.state === 'ready' && apps.apps.length === 0 && (
          <p className={ui.menuTitle}>{t('file.appsNone')}</p>
        )}
        {apps.state === 'ready' &&
          // 默认程序放最前（主操作就是它），其余按系统给的顺序。
          [
            ...apps.apps.filter((app) => app.default),
            ...apps.apps.filter((app) => !app.default),
          ].map((app) => (
            <button
              key={app.id}
              type="button"
              className={ui.menuItem}
              data-testid="wl-open-app"
              onClick={() => launch(app.default ? {} : { application: app.id })}
            >
              {app.icon === null ? (
                <Icon name="external" size={15} />
              ) : (
                <img className={css.appIcon} src={app.icon} alt="" />
              )}
              <span className={ui.menuLabel}>
                {app.default ? t('file.openDefault').replace('{app}', app.name) : app.name}
              </span>
            </button>
          ))}
      </div>
      <div className={ui.menuSep} />
      <button
        type="button"
        className={ui.menuItem}
        data-testid="wl-open-reveal"
        onClick={() => launch({ reveal: true })}
      >
        <Icon name="folderOpen" size={15} />
        <span className={ui.menuLabel}>{t('file.reveal')}</span>
      </button>
    </>
  )

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      label={t('file.openWith')}
      className={css.apps}
      trigger={
        <button
          type="button"
          className={
            props.compact === true ? cx(ui.btn, ui.icon, ui.small) : cx(ui.btn, ui.small, ui.soft)
          }
          aria-label={t('file.openWith')}
          data-tip={props.compact === true ? t('file.openWith') : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          data-testid="wl-open-with"
          onClick={() => setOpen(!open)}
        >
          <Icon name="external" size={14} />
          {props.compact !== true && (
            <>
              {t('file.openWith')}
              <Icon name="chevronDown" size={13} />
            </>
          )}
        </button>
      }
    >
      {menu}
    </Popover>
  )
}
