/**
 * dsh-workflow-lite — 「内容」一组各种设置共用的小件：位置三选一、开关一行、分段一行、组标题。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/options/optionParts
 */

import type { ViewFrom } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import { SwitchTrack } from '../../motion/marks.tsx'
import css from '../display.module.css'

type FromChoice = ViewFrom | 'auto'

/** 「位置」三选一：自动 / 末尾 / 开头。 */
export function FromPicker(props: {
  t: T
  value: ViewFrom | undefined
  tip: string
  onChange(from: ViewFrom | undefined): void
}): React.JSX.Element {
  const { t } = props
  return (
    <div className={css.optLine}>
      <span className={css.optLabel} data-tip={props.tip}>
        {t('display.from')}
      </span>
      <div className={css.optGrow}>
        <Segmented<FromChoice>
          label={t('display.from')}
          value={props.value ?? 'auto'}
          options={[
            { value: 'auto', label: t('display.from.auto') },
            { value: 'end', label: t('display.from.end') },
            { value: 'start', label: t('display.from.start') },
          ]}
          testId="wl-display-from"
          onChange={(from) => props.onChange(from === 'auto' ? undefined : from)}
        />
      </div>
    </div>
  )
}

/** 一个开关一行（和「隐藏标题」一个样子）。 */
export function OptSwitch(props: {
  on: boolean
  label: string
  tip?: string
  testId: string
  onToggle(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      className={css.optSwitch}
      data-tip={props.tip}
      data-testid={props.testId}
      onClick={props.onToggle}
    >
      <SwitchTrack on={props.on} />
      <span>{props.label}</span>
    </button>
  )
}

/** 一行「标签 + 分段选择」。 */
export function SegLine<V extends string>(props: {
  label: string
  tip?: string
  value: V
  options: readonly { value: V; label: string }[]
  testId: string
  onChange(value: V): void
}): React.JSX.Element {
  return (
    <div className={css.optLine}>
      <span className={css.optLabel} data-tip={props.tip}>
        {props.label}
      </span>
      <div className={css.optGrow}>
        <Segmented<V>
          label={props.label}
          value={props.value}
          options={props.options}
          testId={props.testId}
          onChange={props.onChange}
        />
      </div>
    </div>
  )
}

/**
 * 一组的标题：粗一档的字，前面可带一个小记号（内容那组是文件类型），后面可带淡色的补充（文件名）和一枚「i」，悬停看说明。
 * 组和组之间一道细线（见 `.options > .optGroup`）。
 */
export function GroupHead(props: {
  label: string
  tip?: string | undefined
  lead?: React.ReactNode
  sub?: string | undefined
}): React.JSX.Element {
  return (
    <div className={css.optHead}>
      {props.lead}
      <span className={css.optHeadText}>{props.label}</span>
      {props.sub !== undefined && props.sub !== '' && (
        <span className={css.optHeadSub}>{props.sub}</span>
      )}
      {props.tip !== undefined && (
        <span className={css.optTip} data-tip={props.tip} aria-label={props.tip} role="img">
          <Icon name="info" size={12} />
        </span>
      )}
    </div>
  )
}
