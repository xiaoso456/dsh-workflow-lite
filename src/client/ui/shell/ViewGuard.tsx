/**
 * dsh-workflow-lite — 视图出错时的兜底：渲染里抛了错，只把这个视图换成一张「出错了 · 重试」的卡片。
 *
 * 宿主自己也接得住视图里的错，但它会把整个标签页撤掉，要刷新页面才回来；这里接在它前面，
 * 原地给一张卡片，点「重试」把视图重新挂一遍。错误照样打到控制台，方便查。
 *
 * 只接渲染时抛的错（React 的错误边界管不到事件处理和异步回调里的错，那些各处自己报）。
 * 视图里不挂宿主的插槽，接住的不会是宿主要往外抛的装配错误。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/ViewGuard
 */

import { Component, type ErrorInfo, Fragment, type ReactNode } from 'react'
import { useColorScheme, useThemeChoice } from '../../app/theme.ts'
import type { T } from '../../i18n.ts'
import { themeLook, themeStyle } from '../../model/themes.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import css from './shell.module.css'
import guard from './viewGuard.module.css'

interface GuardProps {
  t: T
  children: ReactNode
}

interface GuardState {
  error: Error | null
  /** 第几次挂：重试时换个 key，整棵树从头挂。 */
  attempt: number
}

export class ViewGuard extends Component<GuardProps, GuardState> {
  override state: GuardState = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: unknown): Partial<GuardState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[workflow-lite] 视图渲染出错：', error, info.componentStack)
  }

  private readonly retry = (): void => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }))
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <Crashed t={this.props.t} error={this.state.error} onRetry={this.retry} />
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}

/** 出错的卡片。视图根（带主题变量的那层）也跟着坏掉了，这里自己写一层主题变量。 */
function Crashed(props: { t: T; error: Error; onRetry: () => void }): React.JSX.Element {
  const { t } = props
  const theme = useThemeChoice()
  const look = themeLook(useColorScheme(), theme.light)
  return (
    <div
      className={cx(css.root, guard.root)}
      style={themeStyle(theme.light, theme.dark) as React.CSSProperties}
      data-look={look}
      data-testid="wl-crashed"
    >
      <div className={cx(ui.panel, guard.card)} role="alert">
        <span className={guard.icon} aria-hidden="true">
          <Icon name="alert" size={18} />
        </span>
        <h2 className={guard.title}>{t('error.viewCrashed')}</h2>
        <p className={guard.body}>{t('error.viewCrashedBody')}</p>
        <code className={guard.detail}>{props.error.message || props.error.name}</code>
        <button type="button" className={cx(ui.btn, ui.primary)} onClick={props.onRetry}>
          <Icon name="reload" size={15} />
          {t('common.retry')}
        </button>
      </div>
    </div>
  )
}
