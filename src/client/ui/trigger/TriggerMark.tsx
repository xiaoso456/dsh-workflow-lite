/**
 * dsh-workflow-lite — 触发源的图标块：画布上的触发卡片、工作流中心「触发」页里认一种触发源的那个小色块。
 *
 * 和步骤的图标块（kit/StepMark）同一种样子（`ui.kind`）：每种触发源一个图标、一种颜色。
 * 「↗ 主动 / ↙ 被动」小标（{@link ModeChip}）也在这里：画布卡片的底行（写触发源名字）、面板「触发方式」的卡头共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerMark
 */

import type { StepColor } from '../../../shared/appearance.ts'
import type { FireChannel } from '../../../shared/trigger.ts'
import type { TriggerSourceKind } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { triggerMode } from '../../model/triggerGlance.ts'
import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import css from './triggerMark.module.css'

/** 每种触发源的图标。 */
export const TRIGGER_ICON: Record<TriggerSourceKind, IconName> = {
  schedule: 'clock',
  poll: 'poll',
  listen: 'terminal',
  http: 'globe',
  after: 'after',
}

/** 每种触发渠道的图标：五种触发源用各自的，「立即触发一次」是闪电。 */
export const FIRE_ICON: Record<FireChannel, IconName> = { ...TRIGGER_ICON, now: 'bolt' }

const TRIGGER_COLOR: Record<TriggerSourceKind, StepColor> = {
  schedule: 'blue',
  poll: 'teal',
  listen: 'amber',
  http: 'violet',
  after: 'green',
}

/** 这种触发源的颜色（CSS 值）：卡片上速览里的上色部分跟它走。 */
export function triggerTint(kind: TriggerSourceKind): string {
  return `var(--wl-c-${TRIGGER_COLOR[kind]})`
}

export function TriggerMark(props: {
  kind: TriggerSourceKind
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cx(ui.kind, props.className)}
      data-color={TRIGGER_COLOR[props.kind]}
      data-trigger-kind={props.kind}
    >
      <Icon name={TRIGGER_ICON[props.kind]} size={props.size ?? 15} />
    </span>
  )
}

/**
 * 「↗ 主动」/「↙ 被动」小标：主动往外（插件自己去做），被动往里（等外面的事进来）。颜色跟着触发源。
 * `named`：字换成触发源的名字（「↗ 定时」「↙ 监视」），箭头照旧标主动 / 被动，悬停的说明写全——
 * 画布卡片上用（卡上没有别处写触发源）；面板「触发方式」卡头旁边已经写着触发源，那里写主动 / 被动。
 */
export function ModeChip(props: {
  t: T
  kind: TriggerSourceKind
  named?: boolean
  testId?: string
}): React.JSX.Element {
  const { t } = props
  const mode = triggerMode(props.kind)
  const say = t(mode === 'active' ? 'trigger.mode.activeTip' : 'trigger.mode.passiveTip')
  const kindName = t(`trigger.source.${props.kind}` as LocaleKey)
  return (
    <span
      className={css.mode}
      style={{ '--wl-kind': triggerTint(props.kind) } as React.CSSProperties}
      data-mode={mode}
      data-tip={props.named === true ? `${kindName} · ${say}` : say}
      data-testid={props.testId}
    >
      <Icon name={mode === 'active' ? 'arrowOut' : 'arrowIn'} size={10} />
      {props.named === true
        ? kindName
        : t(mode === 'active' ? 'trigger.mode.active' : 'trigger.mode.passive')}
    </span>
  )
}
