/**
 * dsh-workflow-lite — 设置页「触发」组里的「监听状态」：HTTP 触发的端口现在开没开、开在哪、开不了的原因。
 *
 * 一直占一行（读到之前写「读取中」），只换字和颜色、不插删行，设置页的高度不跟着变；
 * 原因很长时一行省略，悬停看全文。改了监听地址或端口保存后，几秒内这里跟着变。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/ListenStatus
 */

import { ANY_HOST } from '../../../shared/triggerHttp.ts'
import type { TriggerHttpStatus } from '../../../shared/wire/trigger.ts'
import { useHttpStatus } from '../../app/useHttpStatus.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { SwapText } from '../motion/swapText.tsx'
import hub from './hub.module.css'
import css from './hubSettings.module.css'

type Tone = 'ok' | 'idle' | 'error'

const CHIP: Record<TriggerHttpStatus['state'], LocaleKey> = {
  open: 'cfg.listen.open',
  idle: 'cfg.listen.idle',
  error: 'cfg.listen.error',
  away: 'cfg.listen.away',
}

/** 一行说明与小标的颜色。 */
export function listenText(t: T, status: TriggerHttpStatus | null): { desc: string; tone: Tone } {
  if (status === null) return { desc: t('cfg.listen.loading'), tone: 'idle' }
  switch (status.state) {
    case 'open':
      return {
        desc: (status.host === ANY_HOST ? t('cfg.listen.openAny') : t('cfg.listen.openOne'))
          .replace('{bind}', `${status.host}:${String(status.port)}`)
          .replace('{url}', status.url),
        tone: 'ok',
      }
    case 'error':
      return { desc: status.problem, tone: 'error' }
    case 'idle':
      return { desc: t('cfg.listen.idleDesc'), tone: 'idle' }
    case 'away':
      return { desc: t('cfg.listen.awayDesc'), tone: 'idle' }
  }
}

export function ListenStatus(props: { t: T; rpc: WorkflowLiteRpc }): React.JSX.Element {
  const { t } = props
  const status = useHttpStatus(props.rpc)
  const { desc, tone } = listenText(t, status)
  return (
    <div className={cx(hub.item, css.item)} data-testid="wl-cfg-listen" data-state={status?.state}>
      <span className={hub.itemIcon} data-tone={tone === 'ok' ? 'accent' : undefined}>
        <Icon name="activity" size={16} />
      </span>
      <div className={hub.itemText}>
        <span className={hub.itemTitle}>{t('cfg.listen')}</span>
        <span className={cx(hub.itemDesc, css.listenDesc)} data-tip={desc} data-tone={tone}>
          <SwapText text={desc} />
        </span>
      </div>
      <div className={hub.itemEnd}>
        <span className={css.listenChip} data-tone={tone} data-testid="wl-cfg-listen-chip">
          <span className={css.listenDot} aria-hidden="true" />
          <SwapText text={status === null ? '' : t(CHIP[status.state])} />
        </span>
      </div>
    </div>
  )
}
