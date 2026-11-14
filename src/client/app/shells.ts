/**
 * dsh-workflow-lite — 给轮询、监听选 shell：本机找得到哪些、自己选的程序认不认得、去哪儿翻找程序。
 *
 * 「触发方式」对话框和设置页「触发」组共用（见 `ui/trigger/ShellSelect.tsx`）。清单每次打开现问：
 * 「跟着默认」指的是哪个要跟着设置走，宿主那边找一遍也就几次 `stat`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/shells
 */

import type { ShellChoice, TriggerShellsResponse } from '../../shared/wire/trigger.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { createHostAccess, type HostAccess } from './host.ts'

export interface ShellAccess {
  /** 本机的 shell、系统缺省的、「跟着默认」现在指的。 */
  catalog(): Promise<TriggerShellsResponse>
  /** 自己选的程序能不能当 shell 用：能用回说明，不能用回一句原因。 */
  check(path: string): Promise<ShellChoice | string>
  /** 「选择其他」时翻目录用。 */
  host: HostAccess
}

export function createShellAccess(rpc: WorkflowLiteRpc): ShellAccess {
  return {
    catalog: () => rpc.call('trigger/shells', {}),
    check: async (path) => {
      try {
        return await rpc.call('trigger/shell', { path })
      } catch (caught) {
        return errorMessage(caught)
      }
    },
    host: createHostAccess(rpc, {}),
  }
}

/** 路径里的程序名（没认出来时给人看的名字）。 */
export function programName(path: string): string {
  return (
    path
      .split(/[\\/]/u)
      .pop()
      ?.replace(/\.exe$/iu, '') ?? path
  )
}

/** 程序所在的目录（「选择其他」从那儿开始翻）。 */
export function programDir(path: string): string | undefined {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut <= 0 ? undefined : path.slice(0, cut)
}
