/**
 * dsh-workflow-lite — 本机的网卡地址：设置页列出能选的监听地址，卡片上的网址用别人连得上的那个地址。
 *
 * 只看 IPv4；回环网卡不列（`127.0.0.1` 在设置页单独作为「仅本机」）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/netAddress
 */

import { networkInterfaces } from 'node:os'
import { ANY_HOST, LOCAL_HOST } from '../../shared/triggerHttp.ts'
import type { ListenInterface } from '../../shared/wire/config.ts'

type InterfaceTable = ReturnType<typeof networkInterfaces>

/** 本机各块网卡的 IPv4 地址（不含回环）。 */
export function listenInterfaces(table: InterfaceTable = networkInterfaces()): ListenInterface[] {
  const out: ListenInterface[] = []
  for (const [name, addresses] of Object.entries(table)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      out.push({ name, address: address.address })
    }
  }
  return out
}

/**
 * 卡片上的网址写哪个地址：监听所有网卡时写第一块网卡的地址（没有网卡就写本机），其余照写。
 */
export function advertisedHost(host: string, table?: InterfaceTable): string {
  if (host !== ANY_HOST) return host
  return listenInterfaces(table)[0]?.address ?? LOCAL_HOST
}
