/**
 * dsh-workflow-lite — 导出页上触发卡片和新建会话设置那两块的算账：缺省怎么勾、勾了之后多出多少字节、
 * 交给宿主的几项、各处写了哪些会话设置。纯函数，不碰 RPC。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/packTriggers
 */

import {
  type PackExportRequest,
  type PackScanResponse,
  type PackTrigger,
  packsScripts,
} from '../../shared/pack.ts'
import type { ChoiceKeep, ChoiceSpot } from '../../shared/sessionChoice.ts'
import type { SessionChoice } from '../../shared/types.ts'

/** 导出时各张卡片怎么带：留不留、带不带密钥、带不带脚本数据（都是卡片 id）。 */
export interface TriggerPick {
  enabled: boolean
  keep: ReadonlySet<string>
  secrets: ReadonlySet<string>
  data: ReadonlySet<string>
  choices: ReadonlyMap<string, ChoiceKeep>
}

/** 缺省关闭；打开后卡片全选，密钥和脚本数据不勾。 */
export function defaultTriggerPick(scan: PackScanResponse): TriggerPick {
  return {
    enabled: false,
    keep: new Set(scan.triggers.map((card) => card.node)),
    secrets: new Set(),
    data: new Set(),
    choices: new Map(),
  }
}

/** 换一张卡片的一项勾选。 */
export function toggleTrigger(
  pick: TriggerPick,
  part: 'keep' | 'secrets' | 'data',
  node: string,
  on: boolean,
): TriggerPick {
  const next = new Set(pick[part])
  if (on) next.add(node)
  else next.delete(node)
  return { ...pick, [part]: next }
}

/** 这张卡片的密钥真的带进包（留下了、又勾了）。 */
export function packsSecrets(pick: TriggerPick, card: PackTrigger): boolean {
  return card.secrets !== undefined && pick.keep.has(card.node) && pick.secrets.has(card.node)
}

/** 包里有没有明文密钥：触发器这类打开着，且至少一张卡片的密钥真的带上。 */
export function packsAnySecrets(scan: PackScanResponse, pick: TriggerPick): boolean {
  return pick.enabled && scan.triggers.some((card) => packsSecrets(pick, card))
}

/** 这张卡片的脚本数据真的带进包。 */
export function packsData(pick: TriggerPick, card: PackTrigger): boolean {
  return card.data !== undefined && pick.keep.has(card.node) && pick.data.has(card.node)
}

/** 触发器那一块带进包的字节数。 */
export function triggerBytes(scan: PackScanResponse, pick: TriggerPick): number {
  if (!pick.enabled) return 0
  let total =
    scan.triggerScripts !== null && packsScripts(scan.triggers, pick.keep)
      ? scan.triggerScripts.bytes
      : 0
  for (const card of scan.triggers) {
    if (packsSecrets(pick, card)) total += card.secrets?.bytes ?? 0
    if (packsData(pick, card)) total += card.data?.bytes ?? 0
  }
  return total
}

/** 交给宿主的几项（只说图里有的卡片）。 */
export function triggerRequest(
  scan: PackScanResponse,
  pick: TriggerPick,
): Pick<PackExportRequest, 'triggers' | 'secrets' | 'triggerData' | 'triggerChoices'> {
  if (!pick.enabled) return { triggers: [], secrets: [], triggerData: [], triggerChoices: [] }
  const cards = scan.triggers.filter((card) => pick.keep.has(card.node))
  return {
    triggers: cards.map((card) => card.node),
    secrets: scan.triggers.filter((card) => packsSecrets(pick, card)).map((card) => card.node),
    triggerData: scan.triggers.filter((card) => packsData(pick, card)).map((card) => card.node),
    triggerChoices: cards.flatMap(({ node }) => {
      const choice = pick.choices.get(node)
      return choice === undefined ? [] : [{ node, choice }]
    }),
  }
}

/** 每处会话设置的三组选项（呈现顺序）。 */
export const CHOICE_PARTS: readonly (keyof ChoiceKeep)[] = ['model', 'preset', 'permission']

/** 一组选项在各版本里设了什么，只留这一项的值。 */
export function choicePlaces(
  spots: readonly ChoiceSpot[],
  part: keyof ChoiceKeep,
): { spot: ChoiceSpot; choice: SessionChoice }[] {
  return spots
    .filter((spot) => spot.choice[part] !== undefined)
    .map((spot) => ({ spot, choice: { [part]: spot.choice[part] } }))
}
