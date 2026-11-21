/**
 * dsh-workflow-lite — 开关一张触发卡片要写进图的改动（画布和工作流中心「触发」页共用）。
 *
 * 打开前看卡片上齐没齐：新建会话要有工作区，固定会话要选定会话。HTTP 卡片还没有地址、令牌时
 * （在画布上直接换成 HTTP、没进过对话框）先向宿主要一份缺省的，和开关一起写进去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerSwitch
 */

import { endpointMissing, launchMissing } from '../../shared/trigger.ts'
import type { TriggerData } from '../../shared/types.ts'
import type { TriggerEndpointResponse } from '../../shared/wire/trigger.ts'
import type { T } from '../i18n.ts'

/**
 * @param endpoint 向宿主要缺省的地址、令牌（只在 HTTP 卡片缺的时候问）。
 * @returns 要写进图的改动；打不开时是原因。
 */
export async function switchPatch(
  t: T,
  data: TriggerData,
  on: boolean,
  endpoint: () => Promise<TriggerEndpointResponse | string>,
): Promise<Partial<TriggerData> | string> {
  if (!on) return { enabled: undefined }
  const missing = launchMissing(data)
  if (missing !== null) {
    return t(missing === 'session' ? 'trigger.needSession' : 'trigger.needWorkspace')
  }
  const { source } = data
  if (source.kind !== 'http' || !endpointMissing(source)) return { enabled: true }
  const suggested = await endpoint()
  if (typeof suggested === 'string') return suggested
  return {
    enabled: true,
    source: {
      ...source,
      hook: source.hook ?? suggested.hook,
      token: source.token ?? suggested.token,
    },
  }
}
