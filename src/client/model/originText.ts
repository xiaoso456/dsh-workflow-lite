/**
 * dsh-workflow-lite — 实例来源的一句话：渠道，触发卡片发起的再带上卡片名字。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/originText
 */

import type { InstanceOrigin, OriginChannel } from '../../shared/runState.ts'
import type { LocaleKey, T } from '../i18n.ts'

const CHANNEL_TEXT: Record<OriginChannel, LocaleKey> = {
  manual: 'origin.manual',
  session: 'origin.session',
  schedule: 'origin.schedule',
  poll: 'origin.poll',
  listen: 'origin.listen',
  http: 'origin.http',
  after: 'origin.after',
  now: 'origin.now',
}

export function originText(t: T, origin: InstanceOrigin): string {
  const channel = t(CHANNEL_TEXT[origin.channel])
  return origin.trigger === undefined
    ? channel
    : t('origin.by').replace('{channel}', channel).replace('{name}', origin.trigger.name)
}
