/**
 * dsh-workflow-lite — 工作流中心各页左栏的一行（运行实例、工作流、触发、记忆共用）：图标块 + 名字（+ 小标）+ 一句说明。
 *
 * 两种行高（{@link useListDensity}，四页共用一个选择）：
 * - 标准：图标块 + 两行字，第二行是页给的 `meta`；名字或第二行里标了 `data-cut` 的那截被截断时，悬停看 `tip`。
 * - 紧凑：一行，小图标块 + 名字 + 行尾一格短字（页给的 `end`，靠右对齐成一列）；第二行没画出来，悬停一直看 `tip`。
 *
 * 尺寸写成变量放在列表上（groupedList.module.css 的 `.list`），分组标题前面那一格跟着图标块一起变宽变窄。
 * 选中底块、悬停底色、行的动画沿用 versions/wfList.module.css 的 `wfRow` / `wfItem`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/list/HubRow
 */

import { useListDensity } from '../../../app/listDensity.ts'
import { tipWhenCut } from '../../kit/cutTip.ts'
import { cx } from '../../kit/cx.ts'
import wf from '../../versions/wfList.module.css'
import css from './hubRow.module.css'

/** 图标块的类名：页画的图标块（`ui.kind` 那种）加上它，大小跟着行高走。 */
export const rowMark = css.mark

export function HubRow(props: {
  /** 动画键（见 GroupedList 的 RowAt）。 */
  flip: string
  /** 选中底块在这一行下面。 */
  selected: boolean
  /** 右栏正看着这一项（底块可能在它别的组里那一行）。 */
  current: boolean
  testId: string
  value: string
  /** 整行上的测试锚点（只有「运行实例」页用）。 */
  rowTestId?: string
  /** 灰掉图标块（停用、没被用）。 */
  off?: boolean
  /** 图标块（带上 {@link rowMark}）。 */
  mark: React.ReactNode
  name: string
  /** 名字后面的小标（「当前」）。 */
  badge?: React.ReactNode
  /** 标准行高的第二行。 */
  meta: React.ReactNode
  /** 紧凑时行尾那一格。 */
  end: React.ReactNode
  /** 悬停看的全文。 */
  tip: string
  /** 标准行高下没截断也给 `tip`（名字之外还有别的要说，比如记忆的编号）。 */
  tipAlways?: boolean
  onPick(): void
}): React.JSX.Element {
  const compact = useListDensity() === 'compact'
  return (
    <div
      className={wf.wfRow}
      data-end="none"
      data-flip={props.flip}
      data-selected={props.selected}
      data-testid={props.rowTestId}
      data-id={props.rowTestId === undefined ? undefined : props.value}
    >
      <button
        type="button"
        aria-current={props.current ? 'true' : undefined}
        className={cx(wf.wfItem, css.item)}
        data-testid={props.testId}
        data-value={props.value}
        data-off={props.off === true ? 'true' : undefined}
        onPointerOverCapture={(event) => {
          const host = event.currentTarget
          if (compact || props.tipAlways === true) {
            host.dataset.tip = props.tip
            host.dataset.tipAlign = 'start'
            return
          }
          tipWhenCut(
            host,
            [...host.querySelectorAll<HTMLElement>('[data-cut]')],
            props.tip,
            'start',
          )
        }}
        onClick={props.onPick}
      >
        {props.mark}
        <span className={css.text}>
          <span className={css.nameLine}>
            <span className={css.name} data-cut="">
              {props.name}
            </span>
            {props.badge}
          </span>
          {!compact && <span className={css.meta}>{props.meta}</span>}
        </span>
        {compact && <span className={css.end}>{props.end}</span>}
      </button>
    </div>
  )
}
