/**
 * dsh-workflow-lite — `read` 的索引条目：步骤、输入节点、资源节点各一份不含正文的摘要。
 * @module @xiaoso/dsh-workflow-lite/host/tool/indexEntries
 */

import { analyzeGraph, compareByCodepoint } from '../../shared/graph.ts'
import { inputKind, inputReaders, orderedInputs, stepInputs } from '../../shared/inputs.ts'
import { idKey } from '../../shared/model.ts'
import { memoryOf } from '../../shared/presets.ts'
import { resourceGraph, stepResources } from '../../shared/resources.ts'
import type {
  InputIndexEntry,
  NodeIndexEntry,
  ResourceIndexEntry,
  StepNode,
  WorkflowDocument,
} from '../../shared/types.ts'

/** 步骤的索引条目（不含正文）：前置步骤，以及它读、写的资源。 */
export function indexEntry(document: WorkflowDocument, node: StepNode): NodeIndexEntry {
  const analysis = analyzeGraph(document)
  const predecessors = (analysis.predecessors.get(node.id) ?? []).slice().sort(compareByCodepoint)
  const linked = stepResources(document, node.id)
  const inputs = stepInputs(document, node.id)
  return {
    id: node.id,
    ...(node.data.label === undefined ? {} : { label: node.data.label }),
    predecessors,
    ...(linked.reads.length === 0
      ? {}
      : { reads: linked.reads.map(({ resource }) => resource.id) }),
    ...(linked.writes.length === 0
      ? {}
      : {
          writes: linked.writes.map(({ resource, update }) =>
            update ? { id: resource.id, update: true as const } : { id: resource.id },
          ),
        }),
    ...(inputs.length === 0 ? {} : { inputs: inputs.map((input) => input.id) }),
  }
}

/** 输入节点的索引条目：问题、题型、选项、默认值、交给谁（占位与说明是给填写的人看的，不给）。 */
export function inputEntries(document: WorkflowDocument): InputIndexEntry[] {
  return orderedInputs(document).map(({ id, data }) => ({
    id,
    question: data.question,
    kind: inputKind(data),
    ...(data.options === undefined ? {} : { options: data.options }),
    ...(data.default === undefined ? {} : { default: data.default }),
    ...(data.required === true ? { required: true as const } : {}),
    ...(data.other === true ? { other: true as const } : {}),
    readers: inputReaders(document, id),
  }))
}

/** 资源节点的索引条目：名字、内容、谁写、谁读（描述是给人看的，不给）。 */
export function resourceEntries(
  document: WorkflowDocument,
  missing: ReadonlySet<string>,
): ResourceIndexEntry[] {
  return [...resourceGraph(document).values()]
    .sort((a, b) => compareByCodepoint(a.resource.id, b.resource.id))
    .map(({ resource, writers, readers }) => {
      const memory = memoryOf(resource.data)
      return {
        id: resource.id,
        ...(resource.data.label === undefined ? {} : { label: resource.data.label }),
        items: resource.data.items,
        writers: writers.map((writer) =>
          writer.update ? { id: writer.id, update: true as const } : { id: writer.id },
        ),
        readers,
        ...(resource.data.view === undefined ? {} : { display: resource.data.view }),
        ...(memory === undefined
          ? {}
          : {
              memory: {
                id: memory.memory,
                type: memory.type,
                ...(missing.has(idKey(memory.memory)) ? { missing: true as const } : {}),
              },
            }),
      }
    })
}
