/**
 * dsh-workflow-lite — `save_as_template`：把一个步骤存成节点模板（画布步骤库的「我的步骤」）。
 * @module @xiaoso/dsh-workflow-lite/host/tool/nodeTemplate
 */

import { canonicalOutput, idKey, isInput, isResource } from '../../shared/model.ts'
import { checkName } from '../../shared/naming.ts'
import { outputsOf } from '../../shared/resources.ts'
import type { ChangedEntry } from '../../shared/types.ts'
import { writeFileAtomic } from '../store/atomic.ts'
import { templateFile, templateOccupant } from '../store/paths.ts'
import { MAX_SEQUENTIAL, type Outcome, type Repository } from '../store/repository.ts'
import type { ToolDeps } from './tool.ts'

/** 把节点存成节点模板（`templates/nodes/<名>.json`）——撞名加序号，绝不静默覆盖。 */
export async function saveNodeAsTemplate(
  deps: ToolDeps,
  repository: Repository,
  workflow: string,
  nodeId: string,
  to: string | undefined,
): Promise<Outcome<ChangedEntry[]>> {
  const load = await repository.load(workflow)
  if (!load.exists || load.document === null) {
    return { ok: false, error: { code: 'not_found', message: `图 ${workflow} 不存在` } }
  }
  const node = load.document.nodes.find((candidate) => idKey(candidate.id) === idKey(nodeId))
  if (node === undefined) {
    return {
      ok: false,
      error: { code: 'not_found', message: `图 ${workflow} 里没有节点 ${nodeId}` },
    }
  }
  if (isResource(node) || isInput(node)) {
    return {
      ok: false,
      error: {
        code: 'invalid_args',
        message: `${node.id} 是${isResource(node) ? '资源' : '输入'}节点，只有步骤能存成节点模板`,
      },
    }
  }
  const base = to ?? node.id
  const nameProblem = checkName(base)
  if (nameProblem !== null) {
    return { ok: false, error: { code: 'invalid_args', message: nameProblem.message } }
  }
  const dataDir = deps.dataDir()
  let name = base
  for (let n = 1; n <= MAX_SEQUENTIAL; n += 1) {
    const occupant = await templateOccupant(dataDir, name)
    if (occupant === null) break
    if (n === MAX_SEQUENTIAL) {
      return { ok: false, error: { code: 'invalid_args', message: `模板名 ${base} 太挤了` } }
    }
    name = `${base}-${n + 1}`
  }
  // 节点模板 = 节点的 `data` 本体（**不带 id / position**）+ 它写的文件（作为产出清单）。
  const outputs = outputsOf(load.document, node.id)
  const data = outputs.length === 0 ? node.data : { ...node.data, output: canonicalOutput(outputs) }
  await writeFileAtomic(templateFile(dataDir, name), `${JSON.stringify(data, null, 2)}\n`)
  return {
    ok: true,
    result: [
      { kind: 'workflow', op: 'add', id: `templates/nodes/${name}`, detail: { from: nodeId } },
    ],
  }
}
