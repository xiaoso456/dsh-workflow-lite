/**
 * dsh-workflow-lite — 实例右栏标题栏里「运行 / 编辑」的切换：两个图标格，挨着关闭按钮。
 * 选中格下面的滑块靠 `transform` 滑过去；文字在悬停提示里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunModeSwitch
 */

import type { LocaleKey, T } from '../i18n.ts'
import { Icon, type IconName } from './Icon.tsx'
import run from './run.module.css'

/** 右栏选中东西时看什么：这次运行的样子，还是改它（模板的属性面板）。 */
export type PanelMode = 'run' | 'edit'

const OPTIONS: readonly { value: PanelMode; icon: IconName; label: LocaleKey }[] = [
  { value: 'run', icon: 'activity', label: 'run.tab.run' },
  { value: 'edit', icon: 'pencil', label: 'run.tab.edit' },
]

export function RunModeSwitch(props: {
  t: T
  mode: PanelMode
  onChange(mode: PanelMode): void
}): React.JSX.Element {
  const { t } = props
  const index = Math.max(
    0,
    OPTIONS.findIndex((option) => option.value === props.mode),
  )
  return (
    <div
      className={run.mode}
      role="radiogroup"
      aria-label={t('run.tab.label')}
      data-testid="wl-run-mode"
    >
      <span className={run.modeThumb} style={{ transform: `translateX(${index * 100}%)` }} />
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.mode}
          aria-label={t(option.label)}
          data-tip={t(option.label)}
          data-mode={option.value}
          className={run.modeItem}
          onClick={() => props.onChange(option.value)}
        >
          <Icon name={option.icon} size={14} />
        </button>
      ))}
    </div>
  )
}
