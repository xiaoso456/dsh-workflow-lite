/**
 * dsh-workflow-lite — 导入导出清单里的一行：[勾选] 图标 名字 / 说明 [右端]，下面可以再挂一整条（skill 的处理方式）。
 *
 * 给了 `onCheck` 整行就是一个 `<label>`，点哪都切换勾选；挂了下面那一条（里面有按钮）就不要再给 `onCheck`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/PackRow
 */

import hub from './hub.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { Checkbox } from './motion.tsx'
import css from './pack.module.css'
import { cx } from './primitives.tsx'

export function PackRow(props: {
  /** 不给 = 紧凑的一行（导出清单：分类标题已经有图标，行里不再重复）。 */
  icon?: IconName
  tone?: 'accent' | 'warn' | 'ok'
  title: React.ReactNode
  /** 名字是路径（等宽字）。 */
  mono?: boolean
  /** 名字旁边的小标。 */
  badge?: React.ReactNode
  /** 下面一行的几段说明（空的会被略过）。 */
  meta?: readonly React.ReactNode[]
  metaTone?: 'warn'
  end?: React.ReactNode
  checked?: boolean
  onCheck?: (next: boolean) => void
  disabled?: boolean
  /** 没勾上：字淡一点。 */
  dim?: boolean
  /** 悬停提示（完整路径之类放这里，行里只留一句）。 */
  tip?: string
  /** 紧凑行里不能勾的那一格：状态图标，原因放它的悬停提示里。 */
  lead?: { icon: IconName; tone?: 'warn' | 'produce' | 'update'; tip: string }
  children?: React.ReactNode
  testId?: string
}): React.JSX.Element {
  const checkable = props.onCheck !== undefined
  const meta = (props.meta ?? []).filter(
    (part) => part !== null && part !== undefined && part !== false && part !== '',
  )
  const compact = props.icon === undefined
  const checkbox = checkable && (
    <Checkbox
      checked={props.checked === true}
      disabled={props.disabled}
      onChange={(event) => props.onCheck?.(event.currentTarget.checked)}
    />
  )
  const body = (
    <>
      {compact ? (
        <span
          className={css.rowLead}
          data-tone={checkable ? undefined : props.lead?.tone}
          data-tip={checkable ? undefined : props.lead?.tip}
        >
          {checkable ? checkbox : <Icon name={props.lead?.icon ?? 'info'} size={15} />}
        </span>
      ) : (
        checkable && checkbox
      )}
      {props.icon !== undefined && (
        <span className={css.rowIcon} data-tone={props.tone}>
          <Icon name={props.icon} size={15} />
        </span>
      )}
      <span className={css.rowText} data-tip={props.tip}>
        <span className={css.rowTitle}>
          <span className={cx(css.rowName, props.mono === true && css.mono)}>{props.title}</span>
          {props.badge}
        </span>
        {meta.length > 0 && (
          <span className={css.rowMeta} data-tone={props.metaTone}>
            {meta.map((part, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 说明段按位置排，不会重排
              <span key={index}>{part}</span>
            ))}
          </span>
        )}
      </span>
      {props.end !== undefined ? (
        <span className={css.rowEnd} data-tone={props.metaTone}>
          {props.end}
        </span>
      ) : (
        <span />
      )}
      {props.children !== undefined && <div className={css.rowWide}>{props.children}</div>}
    </>
  )
  if (checkable) {
    return (
      // biome-ignore lint/a11y/noLabelWithoutControl: 勾选框就在 body 里（第一个子元素）
      <label
        className={css.row}
        data-check="true"
        data-compact={compact}
        data-dim={props.dim === true}
        data-testid={props.testId}
      >
        {body}
      </label>
    )
  }
  return (
    <div
      className={css.row}
      data-compact={compact}
      data-dim={props.dim === true}
      data-testid={props.testId}
    >
      {body}
    </div>
  )
}

/** 一节：标题、旁注、可选的右端链接，下面一个圆角框。 */
export function PackSection(props: {
  title: string
  note?: React.ReactNode
  hint?: string
  action?: { label: string; onClick(): void }
  children: React.ReactNode
  box?: boolean
  testId?: string
  className?: string
}): React.JSX.Element {
  return (
    <section className={cx(css.section, props.className)} data-testid={props.testId}>
      <div className={css.sectionHead}>
        <p className={css.sectionTitle}>{props.title}</p>
        {props.note !== undefined && <span className={css.sectionNote}>{props.note}</span>}
        {props.action !== undefined && (
          <button type="button" className={css.sectionLink} onClick={props.action.onClick}>
            {props.action.label}
          </button>
        )}
      </div>
      {props.hint !== undefined && <p className={css.sectionHint}>{props.hint}</p>}
      {props.box === false ? props.children : <div className={hub.box}>{props.children}</div>}
    </section>
  )
}

/** 步骤指示：1 选版本 — 2 资源清单。 */
export function PackSteps(props: { steps: readonly string[]; at: number }): React.JSX.Element {
  return (
    <div className={css.steps}>
      {props.steps.map((label, index) => (
        <span key={label} className={css.step} data-on={index === props.at}>
          {index > 0 && <span className={css.stepGap} />}
          <span className={css.stepNum}>{index + 1}</span>
          {label}
        </span>
      ))}
    </div>
  )
}

/** 一条提醒。 */
export function Callout(props: {
  tone?: 'warn' | 'error' | 'ok'
  icon?: IconName
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  return (
    <div className={css.callout} data-tone={props.tone} role="status" data-testid={props.testId}>
      <Icon
        name={props.icon ?? (props.tone === 'ok' ? 'check' : props.tone ? 'alert' : 'info')}
        size={14}
      />
      <span>{props.children}</span>
    </div>
  )
}
