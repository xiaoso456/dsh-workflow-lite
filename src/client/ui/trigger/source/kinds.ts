/**
 * dsh-workflow-lite — 五种触发方式：顺序、名字、一句说明，以及换一种时草稿怎么接上。
 * 「触发方式」对话框的左栏、卡头的方式菜单、面板里换方式都从这里取。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/kinds
 */

import { commandOf, SOURCE_SEED } from '../../../../shared/trigger.ts'
import type { TriggerSource, TriggerSourceKind } from '../../../../shared/types.ts'
import type { LocaleKey } from '../../../i18n.ts'

export const SOURCE_KINDS: readonly { value: TriggerSourceKind; label: LocaleKey }[] = [
  { value: 'schedule', label: 'trigger.source.schedule' },
  { value: 'poll', label: 'trigger.source.poll' },
  { value: 'listen', label: 'trigger.source.listen' },
  { value: 'http', label: 'trigger.source.http' },
  { value: 'after', label: 'trigger.source.after' },
]

/** 每种方式的一句说明。 */
export const KIND_DESC: Record<TriggerSourceKind, LocaleKey> = {
  schedule: 'trigger.kindDesc.schedule',
  poll: 'trigger.kindDesc.poll',
  listen: 'trigger.kindDesc.listen',
  http: 'trigger.kindDesc.http',
  after: 'trigger.kindDesc.after',
}

/** 换到 `kind`：填过的回来，没填过的给常用值；轮询、监听之间换时，那边还没写命令就带上这边的。 */
export function switchSource(
  from: TriggerSource,
  kind: TriggerSourceKind,
  kept: ReadonlyMap<TriggerSourceKind, TriggerSource>,
): TriggerSource {
  const next = kept.get(kind) ?? SOURCE_SEED[kind]
  const command = commandOf(from)
  if (
    (next.kind === 'poll' || next.kind === 'listen') &&
    next.command.trim() === '' &&
    command !== undefined
  ) {
    return { ...next, command }
  }
  return next
}
