/**
 * dsh-workflow-lite — 画布看主机：给资源选文件、文件夹、Skill 时列出主机上有什么。
 *
 * 都走 RPC（`host/list`、`host/skills`、`host/skill`）。Skill 清单按「会话 + 工作区」记一份，
 * 一页里只问一次——选 Skill 是顺手的事，不该每点一下都等一趟。看某个 skill 的全文时才去读它。
 * 顺带捎上桌面能力（用系统程序打开 SKILL.md、在文件管理器里显示）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/host
 */

import type { HostListResponse, HostSkillResponse, HostSkillsResponse } from '../../shared/wire.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import type { Desktop } from './desktop.ts'

export interface HostAccess {
  /** 会话的工作区（列目录的起点，相对路径按它解析）；不知道就是 `undefined`。 */
  cwd: string | undefined
  /** 用系统程序打开文件；宿主没有桌面能力时为 `undefined`。 */
  desktop: Desktop | undefined
  /** 列一个目录；不给就是工作区。 */
  list(path?: string): Promise<HostListResponse>
  /** 会话里的 agent 能用的 skill。 */
  skills(): Promise<HostSkillsResponse>
  /** 读一个 skill 的全文。 */
  skill(name: string): Promise<HostSkillResponse>
}

const skillCache = new Map<string, Promise<HostSkillsResponse>>()

export function createHostAccess(
  rpc: WorkflowLiteRpc,
  where: { cwd?: string | undefined; session?: string | undefined; desktop?: Desktop | undefined },
): HostAccess {
  const { cwd, session } = where
  const scope = {
    ...(cwd === undefined ? {} : { cwd }),
    ...(session === undefined ? {} : { session }),
  }
  return {
    cwd,
    desktop: where.desktop,
    list: (path) =>
      rpc.call('host/list', {
        ...(path === undefined ? {} : { path }),
        ...(cwd === undefined ? {} : { cwd }),
      }),
    skills: () => {
      const key = `${session ?? ''}\n${cwd ?? ''}`
      let pending = skillCache.get(key)
      if (pending === undefined) {
        pending = rpc.call('host/skills', scope)
        // 失败了不记：下次再点再问。
        pending.catch(() => skillCache.delete(key))
        skillCache.set(key, pending)
      }
      return pending
    },
    skill: (name) => rpc.call('host/skill', { name, ...scope }),
  }
}
