/**
 * dsh-workflow-lite — 最近的输出的工具条（右边那一串）：定时检查有筛选（全部 / 触发 / 没跑成，带次数）；
 * 再是几枚图标——自动换行、显示错误输出（开关，记在本机浏览器里）、全部展开（定时检查）、复制全部、清空。名字在悬停提示里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/output/OutputTools
 */

import type { OutputFilter } from '../../../../shared/wire/trigger.ts'
import type { OutputKind, OutputView } from '../../../app/outputView.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { entriesText } from '../../../model/outputText.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { copyText } from '../../kit/clipboard.ts'
import { cx } from '../../kit/cx.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import ui from '../../kit/ui.module.css'
import { useCopied } from '../../kit/useCopied.ts'
import { SwapIcon } from '../../motion/swapText.tsx'
import css from './outputLog.module.css'
import type { OutputLogModel } from './useOutputLog.ts'

const FILTERS: readonly { value: OutputFilter; label: LocaleKey }[] = [
  { value: 'all', label: 'out.filter.all' },
  { value: 'met', label: 'out.filter.met' },
  { value: 'fail', label: 'out.filter.fail' },
]

export function OutputTools(props: {
  t: T
  kind: OutputKind
  model: OutputLogModel
  view: OutputView
  onView(change: Partial<OutputView>): void
  filter: OutputFilter
  onFilter(filter: OutputFilter): void
  testId: string
}): React.JSX.Element {
  const { t, model, view } = props
  const data = model.data
  const none = data === null || data.entries.length === 0
  const [copied, setCopied] = useCopied(String(data?.entries[0]?.id ?? ''))
  return (
    <div className={css.tools}>
      {props.kind === 'check' && (
        <>
          <Segmented<OutputFilter>
            label={t('out.filter')}
            value={props.filter}
            options={FILTERS.map((item) => ({
              value: item.value,
              label: t(item.label),
              count: data?.counts[item.value] ?? 0,
            }))}
            testId={`${props.testId}-filter`}
            plain
            onChange={props.onFilter}
          />
          <span className={css.sep} aria-hidden="true" />
        </>
      )}
      <Toggle
        icon="wrap"
        label={t('out.wrap')}
        on={view.wrap}
        testId={`${props.testId}-wrap`}
        onClick={() => props.onView({ wrap: !view.wrap })}
      />
      <Toggle
        icon="alert"
        label={t('out.err')}
        on={view.err}
        tone="warn"
        testId={`${props.testId}-err`}
        onClick={() => props.onView({ err: !view.err })}
      />
      {props.kind === 'check' && (
        <Tool
          icon={model.allOpen ? 'fold' : 'unfold'}
          label={t(model.allOpen ? 'out.collapseAll' : 'out.expandAll')}
          disabled={none}
          testId={`${props.testId}-expand`}
          onClick={() => model.setAll(!model.allOpen)}
        />
      )}
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, css.tool)}
        aria-label={t('out.copyAll')}
        data-tip={t(copied ? 'trigger.copied' : 'out.copyAll')}
        disabled={none}
        data-testid={`${props.testId}-copy`}
        onClick={() =>
          void model
            .allLines()
            .then((lines) => copyText(entriesText(t, data?.entries ?? [], lines, view.err)))
            .then(setCopied)
        }
      >
        <SwapIcon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      <ClearButton t={t} model={model} disabled={none} testId={`${props.testId}-clear`} />
    </div>
  )
}

/** 「清空」：清掉的找不回来，先在按钮旁边浮出一张小卡问一句。 */
function ClearButton(props: {
  t: T
  model: OutputLogModel
  disabled: boolean
  testId: string
}): React.JSX.Element {
  const { t } = props
  const confirm = useConfirm<HTMLButtonElement>()
  return (
    <>
      <button
        ref={confirm.anchorRef}
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, css.tool)}
        aria-label={t('out.clear')}
        aria-expanded={confirm.open}
        data-tip={confirm.open ? undefined : t('out.clear')}
        disabled={props.disabled}
        data-testid={props.testId}
        onClick={confirm.toggle}
      >
        <Icon name="trash" size={14} />
      </button>
      {confirm.render({
        t,
        title: t('out.clearTitle'),
        desc: t('out.clearDesc'),
        confirmText: t('out.clear'),
        testId: `${props.testId}-confirm`,
        onConfirm: () => void props.model.clear(),
      })}
    </>
  )
}

function Tool(props: {
  icon: IconName
  label: string
  disabled?: boolean
  testId: string
  onClick(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(ui.btn, ui.icon, ui.small, css.tool)}
      aria-label={props.label}
      data-tip={props.label}
      disabled={props.disabled === true}
      data-testid={props.testId}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={14} />
    </button>
  )
}

/** 开着、关着两样的图标按钮：开着时浅蓝底；`warn`（错误输出）开着时琥珀色，和行里错误输出的竖条同色。 */
function Toggle(props: {
  icon: IconName
  label: string
  on: boolean
  tone?: 'warn'
  testId: string
  onClick(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(ui.btn, ui.icon, ui.small, css.tool)}
      aria-label={props.label}
      aria-pressed={props.on}
      data-tone={props.tone}
      data-tip={props.label}
      data-testid={props.testId}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={14} />
    </button>
  )
}
