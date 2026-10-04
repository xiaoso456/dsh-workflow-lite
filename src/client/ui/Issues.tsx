/**
 * dsh-workflow-lite — 顶栏的检查结果：一个小牌子（没有问题 / x 个问题），点开列出每一条，点一条定位到那个节点。
 * 模板编辑和实例视图共用（两边是同一套规则，见 `shared/validate.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Issues
 */

import { useMemo, useState } from 'react'
import type { ValidationLevel, ValidationProblem } from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import css from './topbar.module.css'
import ui from './ui.module.css'

const LEVEL_TEXT: Record<ValidationLevel, LocaleKey> = {
  save: 'issues.level.save',
  compile: 'issues.level.compile',
  warning: 'issues.level.warning',
  hint: 'issues.level.hint',
}

const LEVEL_ORDER: Record<ValidationLevel, number> = { save: 0, compile: 1, warning: 2, hint: 3 }

export function Issues(props: {
  t: T
  problems: readonly ValidationProblem[]
  /** 没有问题时那句说明。 */
  noneBody?: LocaleKey
  onLocate(nodeId: string): void
}): React.JSX.Element {
  const { t, problems } = props
  const [open, setOpen] = useState(false)
  const sorted = useMemo(
    () => [...problems].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]),
    [problems],
  )
  // 建议（hint）不计数：它们不挡任何事，只是顺手一提。
  const errors = problems.filter((p) => p.level === 'save' || p.level === 'compile').length
  const warnings = problems.filter((p) => p.level === 'warning').length
  const counted = errors + warnings
  const tone = errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'ok'
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      label={t('issues.title')}
      className={css.issues}
      trigger={
        <button
          type="button"
          className={cx(ui.btn, css.issueChip)}
          data-tone={tone}
          data-testid="wl-issues"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={tone === 'ok' ? 'check' : 'alert'} size={15} />
          <span>{counted === 0 ? t('issues.none') : `${counted} ${t('issues.unit')}`}</span>
        </button>
      }
    >
      {sorted.length === 0 ? (
        <div className={css.allGood}>
          <span className={css.allGoodIcon}>
            <Icon name="check" size={18} />
          </span>
          <p className={css.allGoodTitle}>{t('issues.none')}</p>
          <p className={css.allGoodBody}>{t(props.noneBody ?? 'issues.noneBody')}</p>
        </div>
      ) : (
        <div className={css.issueList} data-testid="wl-issue-list">
          {sorted.map((problem) => {
            const node = problem.node
            return (
              <button
                // 级别 + 归属 + 原文：同一条问题不会在同一个位置报两遍。
                key={`${problem.code}:${node ?? ''}:${problem.edge ?? ''}:${problem.message}`}
                type="button"
                className={css.issue}
                disabled={node === undefined}
                onClick={() => {
                  if (node === undefined) return
                  setOpen(false)
                  props.onLocate(node)
                }}
              >
                <span className={css.issueLevel} data-level={problem.level}>
                  {t(LEVEL_TEXT[problem.level])}
                </span>
                <span className={css.issueText}>{problem.message}</span>
              </button>
            )
          })}
        </div>
      )}
    </Popover>
  )
}
