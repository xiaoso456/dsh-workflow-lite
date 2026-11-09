/**
 * dsh-workflow-lite — 「内容」一组里日志、纯文本的那几项。
 * 位置（自动 / 末尾 / 开头）、只看（筛选：普通文字或正则、区分大小写、反选、前后带几行、
 * 两个现成的筛选）、错误警告着色。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/options/LinesOptions
 */

import type { LineView } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { FilterField } from '../../files/FilterField.tsx'
import { FromPicker, OptSwitch } from './optionParts.tsx'

/** 日志、纯文本的那几项。 */
export function LinesOptions(props: {
  t: T
  value: LineView
  onChange(lines: LineView | undefined): void
}): React.JSX.Element {
  const { t, value } = props
  const set = (patch: Partial<LineView>): void => {
    const next: LineView = { ...value, ...patch }
    for (const key of Object.keys(patch) as (keyof LineView)[]) {
      if (patch[key] === undefined) delete next[key]
    }
    props.onChange(Object.keys(next).length === 0 ? undefined : next)
  }
  return (
    <>
      <FromPicker
        t={t}
        value={value.from}
        tip={t('display.fromTip')}
        onChange={(from) => set({ from })}
      />
      <FilterField t={t} value={value.filter} onChange={(filter) => set({ filter })} />
      <OptSwitch
        on={value.levels !== false}
        label={t('display.levels')}
        tip={t('display.levelsTip')}
        testId="wl-display-levels"
        onToggle={() => set({ levels: value.levels === false ? undefined : false })}
      />
    </>
  )
}
