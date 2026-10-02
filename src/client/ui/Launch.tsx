/**
 * dsh-workflow-lite — 顶栏右端的「预览 / 执行」组。
 *
 * 左边是预览计划（只留图标）；右边是执行，样子和实例下拉的触发器一样（平时不着色，悬停才亮）：
 * 「▶ 执行」在本会话执行，旁边的小箭头打开会话选择，可以搜同一工作区的会话、挑一个执行。
 * 执行 = 用模板现在的样子建一个实例，往那个会话发一句话。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Launch
 */

import { useMemo, useState } from 'react'
import { pickable, type SessionRow } from '../app/sessions.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import { shortTime } from './RunView.tsx'
import css from './topbar.module.css'
import ui from './ui.module.css'

export interface LaunchProps {
  t: T
  /** 图是空的：预览、执行都不能点。 */
  empty: boolean
  /** 执行为什么不能点（`null` = 能点）。 */
  blocked: LocaleKey | null
  /** 正在建实例 / 发消息。 */
  starting: boolean
  /** 这个 tab 所在的会话。 */
  session: string | undefined
  rows: readonly SessionRow[]
  onPreview(): void
  onRun(session: string): void
}

export function Launch(props: LaunchProps): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const close = (): void => {
    setOpen(false)
    setQuery('')
  }
  const choices = useMemo(() => pickable(props.rows, props.session), [props.rows, props.session])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle === ''
      ? choices
      : choices.filter((row) => row.title.toLowerCase().includes(needle))
  }, [choices, query])
  const runTip = props.blocked === null ? t('launch.runHere') : t(props.blocked)
  const runDisabled = props.empty || props.blocked !== null || props.starting

  return (
    <div className={cx(ui.panel, css.pill)} data-testid="wl-launch">
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.tip)}
        data-tip={t('tool.preview')}
        aria-label={t('tool.preview')}
        data-testid="wl-preview"
        disabled={props.empty}
        onClick={props.onPreview}
      >
        <Icon name="eye" size={16} />
      </button>
      <span className={ui.divider} />
      <Popover
        open={open}
        onClose={close}
        align="end"
        label={t('launch.pick')}
        className={css.picker}
        trigger={
          <div className={css.run} data-disabled={runDisabled} data-open={open}>
            <button
              type="button"
              className={cx(ui.tip, css.runMain)}
              data-tip={runTip}
              aria-label={runTip}
              data-testid="wl-run-start"
              data-busy={props.starting}
              // 不能点时也要看得到原因：灰掉但保留悬停提示。
              aria-disabled={runDisabled}
              onClick={() => {
                if (runDisabled || props.session === undefined) return
                close()
                props.onRun(props.session)
              }}
            >
              <Icon name={props.starting ? 'reload' : 'play'} size={13} />
              <span className={css.runText}>{t('launch.run')}</span>
            </button>
            <button
              type="button"
              className={cx(ui.tip, ui.tipEnd, css.runMore)}
              data-tip={t('launch.pick')}
              aria-label={t('launch.pick')}
              aria-expanded={open}
              aria-haspopup="dialog"
              data-testid="wl-run-more"
              aria-disabled={runDisabled}
              onClick={() => {
                if (runDisabled) return
                if (open) close()
                else setOpen(true)
              }}
            >
              <Icon name="chevronDown" size={14} />
            </button>
          </div>
        }
      >
        <p className={ui.menuTitle}>{t('launch.pick')}</p>
        <div className={css.search}>
          <Icon name="search" size={14} />
          <input
            className={css.searchInput}
            value={query}
            placeholder={t('launch.search')}
            aria-label={t('launch.search')}
            data-testid="wl-run-search"
            // biome-ignore lint/a11y/noAutofocus: 打开就是为了找一个会话
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div className={css.list} role="listbox" aria-label={t('launch.pick')}>
          {filtered.length === 0 && <p className={css.emptyLine}>{t('launch.none')}</p>}
          {filtered.map((row) => (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={row.id === props.session}
              className={ui.menuItem}
              data-value={row.id}
              data-testid="wl-run-session"
              onClick={() => {
                close()
                props.onRun(row.id)
              }}
            >
              <span className={css.sessionDot} data-running={row.running} />
              <span className={ui.menuLabel}>{row.title}</span>
              <span className={ui.menuMeta}>
                {row.id === props.session
                  ? t('launch.here')
                  : row.running
                    ? t('launch.running')
                    : shortTime(row.updatedAt)}
              </span>
            </button>
          ))}
        </div>
        <p className={css.pickerHint}>{t('launch.hint')}</p>
      </Popover>
    </div>
  )
}
