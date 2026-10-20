/**
 * dsh-workflow-lite — 导入导出清单里的一行：[勾选] 图标 名字 / 说明 [右端]，下面可以再挂一整条（skill 的处理方式）。
 *
 * 给了 `onCheck` 整行就是一个 `<label>`，点哪都切换勾选；挂了下面那一条（里面有按钮）就不要再给 `onCheck`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/PackRow
 */

import hub from './hub.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { Checkbox, SwapText, useTrail } from './motion.tsx'
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

/**
 * 一节：标题、旁注、可选的右端链接，下面一个圆角框。
 * `quiet`：旁注和链接这会儿用不上（导出成 Skill 时的「已选几个」「全选」）——原地淡掉、不能点，但位置留着，
 * 来回切时标题行不跳；标题换字也是原地换。
 */
export function PackSection(props: {
  title: string
  note?: React.ReactNode
  hint?: string
  action?: { label: string; onClick(): void }
  quiet?: boolean
  children: React.ReactNode
  box?: boolean
  testId?: string
  className?: string
}): React.JSX.Element {
  const quiet = props.quiet === true
  return (
    <section className={cx(css.section, props.className)} data-testid={props.testId}>
      <div className={css.sectionHead}>
        <p className={css.sectionTitle}>
          <SwapText text={props.title} />
        </p>
        {props.note !== undefined && (
          <span className={css.sectionNote} data-quiet={quiet} aria-hidden={quiet || undefined}>
            {props.note}
          </span>
        )}
        {props.action !== undefined && (
          <button
            type="button"
            className={css.sectionLink}
            data-quiet={quiet}
            disabled={quiet}
            aria-hidden={quiet || undefined}
            tabIndex={quiet ? -1 : undefined}
            onClick={props.action.onClick}
          >
            <SwapText text={props.action.label} />
          </button>
        )}
      </div>
      {props.hint !== undefined && <p className={css.sectionHint}>{props.hint}</p>}
      {props.box === false ? props.children : <div className={hub.box}>{props.children}</div>}
    </section>
  )
}

/**
 * 步骤指示：1 选版本 — 2 资源清单（导出成 Skill 时多一步「Skill 信息」）。
 * 步数变了和路径栏一个做法（{@link useTrail}）：多出的一步从前一步背后展开，少了的收回去；
 * 所以按位置认（键是第几步），换了名字原地换字。
 */
export function PackSteps(props: { steps: readonly string[]; at: number }): React.JSX.Element {
  const trail = useTrail()
  return (
    <div className={css.steps} ref={trail}>
      {props.steps.map((label, index, all) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 步骤按位置认，名字会换（工作流包 / Skill 的第一步）
          key={index}
          className={css.step}
          style={{ zIndex: all.length - index }}
          data-on={index === props.at}
          data-reached={index <= props.at}
          aria-current={index === props.at ? 'step' : undefined}
        >
          {index > 0 && <span className={css.stepGap} />}
          {/* 暗、亮各一份叠着，换的是透明度（见 pack.module.css 的步骤切换）。 */}
          <span className={css.stepNum}>
            <span className={css.stepFill} />
            <span className={css.numDim} aria-hidden="true">
              {index + 1}
            </span>
            <span className={css.numLit}>{index + 1}</span>
          </span>
          <span className={css.stepLabel}>
            <span className={css.labelDim} aria-hidden="true">
              <SwapText text={label} />
            </span>
            <span className={css.labelLit}>
              <SwapText text={label} />
            </span>
          </span>
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
  /** 给了就在右边放一个 ✕，点一下收掉这条（`closeLabel` 是它的名字与悬浮提示）。 */
  onClose?: () => void
  closeLabel?: string
}): React.JSX.Element {
  return (
    <div className={css.callout} data-tone={props.tone} role="status" data-testid={props.testId}>
      <Icon
        name={props.icon ?? (props.tone === 'ok' ? 'check' : props.tone ? 'alert' : 'info')}
        size={14}
      />
      <span className={css.calloutText}>{props.children}</span>
      {props.onClose !== undefined && (
        <button
          type="button"
          className={css.calloutClose}
          data-testid={props.testId === undefined ? undefined : `${props.testId}-close`}
          aria-label={props.closeLabel}
          data-tip={props.closeLabel}
          onClick={props.onClose}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  )
}
