/**
 * dsh-workflow-lite — 顶栏右端的「预览 / 执行」组。
 *
 * 左边是预览计划（只留图标）；右边是执行，样子和实例下拉的触发器一样（平时不着色，悬停才亮）：
 * 「▶ 执行」缺省在同一工作区**新建一个会话**执行；旁边的小箭头打开选择：第一项就是新建会话，
 * 下面可以搜同一工作区的会话、挑一个执行。
 * 执行 = 用模板现在的样子建一个实例，往那个会话发一句话，然后跳过去看它跑。
 * 工作流设了新建会话用的模型、预设时，「新建会话」下面一行写出来，搜索框下面说一句：挑现成的会话时不换它的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/Launch
 */

import { useMemo, useState } from 'react'
import { hasSessionChoice } from '../../../shared/sessionChoice.ts'
import type { SessionChoice } from '../../../shared/types.ts'
import type { HostAgentsResponse } from '../../../shared/wire/host.ts'
import { useAgentCatalog } from '../../app/agents.ts'
import { pickable, type SessionRow } from '../../app/sessions.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { choiceSummary } from '../../model/sessionChoice.ts'
import { shortTime } from '../../model/time.ts'
import shared from '../chrome/topbar.module.css'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { Popover } from '../kit/Popover.tsx'
import ui from '../kit/ui.module.css'
import { SwapIcon } from '../motion/swapText.tsx'
import css from './launch.module.css'

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
  /** 能在同一工作区新建会话（缺省的执行方式）；不能时主按钮退回本会话。 */
  canCreate: boolean
  /** 新建会话时用的预设、模型（画布上这张工作流的设置）；没设是空的。 */
  newChoice: SessionChoice
  /** 读 DSH 里的预设、模型清单（写名字用；打开选择、又设了东西时才读）。 */
  agents(): Promise<HostAgentsResponse>
  onPreview(): void
  /** `null` = 新建会话执行。 */
  onRun(session: string | null): void
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
  const runTip =
    props.blocked !== null
      ? t(props.blocked)
      : props.canCreate
        ? t('launch.runNew')
        : t('launch.runHere')
  const runDisabled = props.empty || props.blocked !== null || props.starting
  const chosen = hasSessionChoice(props.newChoice)
  const catalog = useAgentCatalog(open && chosen ? props.agents : undefined)
  const summary = chosen ? choiceSummary(t, catalog, props.newChoice) : ''
  const run = (target: string | null): void => {
    close()
    props.onRun(target)
  }

  return (
    <div className={cx(ui.panel, shared.pill)} data-testid="wl-launch">
      <button
        type="button"
        className={cx(ui.btn, ui.icon)}
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
          <div className={css.run} data-disabled={runDisabled} data-opened={open}>
            <button
              type="button"
              className={css.runMain}
              data-tip={runTip}
              aria-label={runTip}
              data-testid="wl-run-start"
              data-busy={props.starting}
              // 不能点时也要看得到原因：灰掉但保留悬停提示。
              aria-disabled={runDisabled}
              onClick={() => {
                if (runDisabled) return
                if (props.canCreate) run(null)
                else if (props.session !== undefined) run(props.session)
              }}
            >
              <SwapIcon name={props.starting ? 'reload' : 'play'} size={13} />
              <span className={css.runText}>{t('launch.run')}</span>
            </button>
            <button
              type="button"
              className={css.runMore}
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
        {props.canCreate && (
          <>
            <button
              type="button"
              className={cx(ui.menuItem, css.newSession)}
              data-testid="wl-run-new"
              onClick={() => run(null)}
            >
              <Icon name="plus" size={15} />
              <span className={css.newText}>
                <span className={ui.menuLabel}>{t('launch.newSession')}</span>
                {summary !== '' && (
                  <span className={css.newChoice} data-testid="wl-run-new-choice">
                    {summary}
                  </span>
                )}
              </span>
              <span className={ui.menuMeta}>{t('launch.default')}</span>
            </button>
            <div className={ui.menuSep} />
          </>
        )}
        <div className={ui.menuSearch}>
          <Icon name="search" size={14} />
          <input
            className={ui.menuSearchInput}
            value={query}
            placeholder={t('launch.search')}
            aria-label={t('launch.search')}
            data-testid="wl-run-search"
            // biome-ignore lint/a11y/noAutofocus: 打开就是为了找一个会话
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        {chosen && <p className={css.keepNote}>{t('session.launchNote')}</p>}
        <div className={css.list} role="listbox" aria-label={t('launch.pick')}>
          {filtered.length === 0 && <p className={ui.menuEmpty}>{t('launch.none')}</p>}
          {filtered.map((row) => (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={row.id === props.session}
              className={ui.menuItem}
              data-value={row.id}
              data-testid="wl-run-session"
              onClick={() => run(row.id)}
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
      </Popover>
    </div>
  )
}
