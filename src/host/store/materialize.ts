/**
 * dsh-workflow-lite — 编译时的载荷物化（§3.1 `.dispatch/` 的规矩、§5.2）。
 *
 * 路径 = `<dataDir>/.dispatch/<图名>/<planId>/<节点 id>.md`。三条硬规矩：
 * 1. **一次成功编译先清空该图该 `planId` 的目录、再写**——不做增量、不做局部改写；
 * 2. 物化文件与 `data.prompt` **字节相同**：不补尾换行、不改 EOL、无 BOM；
 * 3. 失败（不可写 / 磁盘满）**抛错**，由上层转成 `io_error`——**绝不返回一份路径不存在的计划**。
 *
 * `planId` 是内容哈希前 8 位 ⇒ 同内容重编得到同一目录（幂等覆盖），先前发出去的计划不会被新编译打穿。
 * `.dispatch/` 以 `.` 开头 ⇒ 一切扫描天然忽略；这里是**唯一**碰它的地方，也是启动时唯一不建它的目录。
 * @module @xiaoso/dsh-workflow-lite/host/store/materialize
 */

import { mkdir, rm } from 'node:fs/promises'

import { compareByCodepoint } from '../../shared/graph.ts'
import { checkName } from '../../shared/naming.ts'
import type { PlanId } from '../../shared/types.ts'
import { writeFileAtomic } from './atomic.ts'
import { payloadDir, payloadFile } from './paths.ts'

/**
 * 把每个节点的 `data.prompt` 原样落到载荷文件。
 *
 * @param payloads 节点 id → 正文。**没有条目的节点不落盘**（上层已按编译级规则拦过）。
 * @throws 任何 IO 失败、非法节点 id——上层统一翻成 `io_error`。
 */
export async function materialize(
  dataDir: string,
  workflow: string,
  planId: PlanId,
  payloads: ReadonlyMap<string, string>,
): Promise<void> {
  const dir = payloadDir(dataDir, workflow, planId)

  // 先清空该图该 planId 的目录（可随时整个删掉，无独立权威），再整批重写。
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  // 节点 id 的码位序 ⇒ 落盘顺序稳定（可复现，便于比对）。
  const entries = [...payloads.entries()].sort(([left], [right]) => compareByCodepoint(left, right))
  for (const [nodeId, prompt] of entries) {
    // 纵深防御：id 同时是文件名，合法性与图校验一致（正常路径上早已通过）。
    const issue = checkName(nodeId)
    if (issue !== null) {
      throw new Error(`节点 id 不能作为载荷文件名：${issue.message}（id=${nodeId}）`)
    }
    await writeFileAtomic(payloadFile(dataDir, workflow, planId, nodeId), prompt)
  }
}
