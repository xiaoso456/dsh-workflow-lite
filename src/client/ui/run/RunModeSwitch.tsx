/**
 * dsh-workflow-lite — 实例右栏标题栏里「运行 / 编辑」的切换：两个图标格，挨着关闭按钮。
 *
 * 两个面各带一份标题栏（换面时整块面板换掉），所以滑块靠 `carry` 跨着重新挂载接着滑。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/RunModeSwitch
 */

import type { T } from '../../i18n.ts'
import { IconSwitch } from '../kit/IconSwitch.tsx'

/** 右栏选中东西时看什么：这次运行的样子，还是改它（模板的属性面板）。 */
export type PanelMode = 'run' | 'edit'

export function RunModeSwitch(props: {
  t: T
  mode: PanelMode
  onChange(mode: PanelMode): void
}): React.JSX.Element {
  const { t } = props
  return (
    <IconSwitch<PanelMode>
      label={t('run.tab.label')}
      value={props.mode}
      options={[
        { value: 'run', icon: 'activity', label: t('run.tab.run') },
        { value: 'edit', icon: 'pencil', label: t('run.tab.edit') },
      ]}
      testId="wl-run-mode"
      carry="run-mode"
      onChange={props.onChange}
    />
  )
}
