/**
 * dsh-workflow-lite — 仓储的节点与边部分：写节点（步骤 / 输入 / 资源 / 记忆卡）、改显示名与设置、删节点、连线与断线。
 *
 * 每一个动作都只交给核心的 `mutate` 一段「拿到文档、改文档、回变更摘要」的函数；
 * 锁、预检、哈希比对、合并与落盘都在 `repoCore`。
 * @module @xiaoso/dsh-workflow-lite/host/store/repoNodes
 */

import { pickAppearance } from '../../shared/appearance.ts'
import { applyDisplay, type DisplaySpec } from '../../shared/display.ts'
import {
  canonicalHandoff,
  findNode,
  idKey,
  isInput,
  isResource,
  isStep,
  makeEdgeId,
  normalizeCoord,
  readInputData,
  readResourceData,
  readSettings,
  sameHandoff,
  sameNodeContent,
  sameSettings,
} from '../../shared/model.ts'
import {
  checkLabel,
  checkName,
  checkOutput,
  checkText,
  checkWhen,
  normalizeName,
} from '../../shared/naming.ts'
import { checkOutputRoot } from '../../shared/outputPaths.ts'
import {
  addGlobalMemory,
  addStepMemory,
  dropOrphanMemories,
  isMemory,
  type MemoryRef,
  memoryOf,
  stepMemories,
} from '../../shared/presets.ts'
import {
  newResourceNode,
  resourceByPath,
  setStepOutputs,
  splitOutputs,
} from '../../shared/resources.ts'
import {
  type ExecutionMode,
  type Handoff,
  INPUT_TYPE,
  type InputData,
  type InputNode,
  NODE_TYPE,
  type NodeData,
  type OutputSpec,
  type Point,
  RESOURCE_TYPE,
  type ResourceData,
  type ResourceItem,
  type ResourceNode,
  type ResourceView,
  type ReusePolicy,
  type StepNode,
  type ToolWarning,
  type WorkflowEdge,
  type WriteResult,
} from '../../shared/types.ts'
import { resourceProblem } from '../../shared/validate.ts'
import type { RepoCore } from './repoCore.ts'
import { fail, type Outcome } from './repoResult.ts'
import type { TemplateStore } from './repoTemplates.ts'

/** `write_node` 的语义入参——`undefined` 一律表示"不改这一项"。 */
export interface NodeUpsert {
  /** 节点 id（图内大小写不敏感唯一）；不存在即新建。 */
  id: string
  /** `data.prompt`；允许空串（空 `prompt` 是编译级，不拦落盘）。 */
  content?: string
  /** 显示名；空串 = 清除（回落渲染 `id`）。 */
  label?: string
  /**
   * 它写的文件（一个路径）；`false` / `null` = 不写任何文件。产出放在资源节点里：
   * 路径已有资源就连上，没有就新建（见 `shared/resources.ts` 的 `setStepOutputs`）。
   */
  output?: string | false | null
  /** 一个或多个写入的文件（可带生成规则）；给了它就整份替换（`noOutput` 仍然优先）。 */
  outputs?: OutputSpec[]
  /** 给其中几个产出所在的资源设画布展示（`write_node` 的 `outputs[].display`）。 */
  displays?: { path: string; display: DisplaySpec }[]
  /** 一句话描述；空串 = 清除。 */
  description?: string
  /** `true` ⇒ 不写任何文件（与 `output` 同时给出时以本字段为准）。 */
  noOutput?: boolean
  /** 从 `templates/nodes/<from>.json` 取 `data` 本体（**不复制模板的 `id` 与 `position`**）。 */
  fromTemplate?: string
  /** 显式坐标；缺省时新建节点留 `{0,0}` 并报 `position_filled` 提示（布局由上层跑）。 */
  position?: Point
}

/** 换上（`undefined` = 去掉）资源的画布展示。 */
function withView(data: ResourceData, view: ResourceView | undefined): ResourceData {
  const next = { ...data }
  if (view === undefined) delete next.view
  else next.view = view
  return next
}

/**
 * `write_node` 带 `input`：新建或改一个输入节点。给了的字段才改（`kind` 换了会按新题型重新规范化选项与默认值）；
 * 文字字段空串 = 清除。
 */
export interface InputUpsert {
  id: string
  question?: string
  kind?: InputData['kind'] | 'text'
  options?: string[]
  default?: string | string[]
  placeholder?: string
  hint?: string
  required?: boolean
  other?: boolean
  position?: Point
}

/** `write_resource`：新建或修改一个资源节点。给了的字段才改；`items` 给了就整份替换。 */
export interface ResourceUpsert {
  /** 资源节点 id；缺省 = 新建，按名字或第一项起一个。 */
  id?: string
  /** 名字；空串 = 清除。 */
  label?: string
  /** 描述；空串 = 清除。 */
  description?: string
  items?: ResourceItem[]
  /** 画布展示：给了的字段才改，`show: false` = 关掉（见 `shared/display.ts` 的 `applyDisplay`）。 */
  display?: DisplaySpec
  position?: Point
}

/** 加一张记忆卡：引用库里的哪一条；给了 `step` 就是那一步的记忆（连一条写它的线），不给就是工作流记忆。 */
export interface MemoryCardRequest {
  ref: MemoryRef
  step?: string
  position?: Point
}

/** 改工作流设置时给的字段（没给的不动）。 */
export interface SettingsPatch {
  outputRoot?: string
  mode?: ExecutionMode
  reuse?: ReusePolicy
  setGoal?: boolean
  runState?: boolean
}

function setLabelValue(data: NodeData, label: string | undefined): void {
  if (label === undefined) delete data.label
  else data.label = label
}

function setPromptValue(data: NodeData, prompt: string | undefined): void {
  if (prompt === undefined) delete data.prompt
  else data.prompt = prompt
}

/** 节点与边部分用到的核心能力：只有 `mutate`。 */
type NodesCore = Pick<RepoCore, 'mutate'>

/** 节点与边部分用到的模板能力：`write_node` 带 `fromTemplate` 时取模板的 `data`。 */
type NodesTemplates = Pick<TemplateStore, 'readNodeTemplate'>

export class NodeWriter {
  private readonly core: NodesCore

  private readonly templates: NodesTemplates

  constructor(core: NodesCore, templates: NodesTemplates) {
    this.core = core
    this.templates = templates
  }

  async writeNode(workflow: string, upsert: NodeUpsert): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      const rawId = normalizeName(upsert.id)
      const idIssue = checkName(rawId)
      if (idIssue !== null) {
        return fail('blocked', `节点 id 不合法：${idIssue.message}`, {
          code: idIssue.code,
          id: upsert.id,
        })
      }
      if (upsert.label !== undefined) {
        const labelIssue = checkLabel(upsert.label)
        if (labelIssue !== null) {
          return fail('blocked', `label 不合法：${labelIssue.message}`, { code: labelIssue.code })
        }
      }
      const requested = [
        ...(typeof upsert.output === 'string' ? [{ path: upsert.output }] : []),
        ...(upsert.outputs ?? []),
      ]
      for (const spec of requested) {
        const outputIssue =
          checkOutput(spec.path) ??
          (spec.rule === undefined ? null : checkText(spec.rule, '产出规则'))
        if (outputIssue !== null) {
          return fail('blocked', `output 不合法：${outputIssue.message}`, {
            code: outputIssue.code,
          })
        }
      }

      const found = findNode(document, rawId)
      if (found !== undefined && isResource(found)) {
        return fail('blocked', `${rawId} 是资源节点，改它请用 write_resource`, { id: rawId })
      }
      if (found !== undefined && isInput(found)) {
        return fail('blocked', `${rawId} 是输入节点，改它请带上 input`, { id: rawId })
      }
      const existing = found
      let data: NodeData = existing === undefined ? {} : { ...existing.data }
      let outputs: OutputSpec[] | undefined
      if (upsert.fromTemplate !== undefined) {
        const template = await this.templates.readNodeTemplate(upsert.fromTemplate)
        if (!template.ok) return template
        // 节点模板 = `data` 本体；**不复制模板的 `id` 与 `position`**；模板里的产出展开成文件节点。
        const split = splitOutputs(template.result)
        data = split.data
        if (split.outputs.length > 0) outputs = split.outputs
      }
      if (upsert.content !== undefined) setPromptValue(data, upsert.content)
      if (upsert.label !== undefined)
        setLabelValue(data, upsert.label === '' ? undefined : upsert.label)
      if (upsert.noOutput === true || upsert.output === false || upsert.output === null)
        outputs = []
      else if (upsert.outputs !== undefined) outputs = upsert.outputs
      else if (typeof upsert.output === 'string') outputs = [{ path: upsert.output }]
      if (upsert.description !== undefined) {
        if (upsert.description === '') delete data.description
        else data.description = upsert.description
      }
      delete data.output
      if (existing === undefined) {
        // 新步骤：没指定图标与颜色就挑图里用得最少的，尽量不和别的步骤重样。
        const look = pickAppearance(document.nodes, data, rawId)
        data = { ...data, icon: look.icon, color: look.color }
      }

      const warnings: ToolWarning[] = []
      let position: Point
      if (upsert.position !== undefined) {
        position = upsert.position
      } else if (existing !== undefined) {
        position = existing.position
      } else {
        // 补位由上层跑分层布局；这里先留占位并报提示（position 缺失的补位）。
        position = { x: 0, y: 0 }
        warnings.push({
          level: 'hint',
          code: 'position_filled',
          message: `节点 ${rawId} 未给坐标，已留 (0,0) 占位，待布局补位`,
          nodes: [rawId],
        })
      }

      const node: StepNode = {
        id: existing === undefined ? rawId : existing.id,
        type: NODE_TYPE,
        position: { x: normalizeCoord(position.x), y: normalizeCoord(position.y) },
        data,
      }
      if (existing === undefined) document.nodes = [...document.nodes, node]
      else {
        document.nodes = document.nodes.map((current) =>
          idKey(current.id) === idKey(node.id) ? node : current,
        )
      }
      const created = outputs === undefined ? [] : setStepOutputs(document, node.id, outputs)
      const shown: string[] = []
      for (const { path, display } of upsert.displays ?? []) {
        const resource = resourceByPath(document, path)
        if (resource === undefined) continue
        const applied = applyDisplay(resource.data, display)
        if ('error' in applied) {
          return fail('blocked', `产出 ${path} 的 display：${applied.error}`, {
            code: 'display_invalid',
          })
        }
        const data = withView(resource.data, applied.view)
        if (sameNodeContent(resource, { ...resource, data })) continue
        document.nodes = document.nodes.map((current) =>
          current === resource ? { ...resource, data } : current,
        )
        if (!created.includes(resource.id)) shown.push(resource.id)
      }
      return {
        ok: true,
        document,
        changed: [
          {
            kind: 'node',
            op: existing === undefined ? 'add' : 'update',
            id: node.id,
            detail: { fromTemplate: upsert.fromTemplate ?? null },
          },
          ...created.map((id) => ({ kind: 'node' as const, op: 'add' as const, id })),
          ...shown.map((id) => ({ kind: 'node' as const, op: 'update' as const, id })),
        ],
        warnings,
      }
    })
  }

  async writeInput(workflow: string, upsert: InputUpsert): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      const rawId = normalizeName(upsert.id)
      const idIssue = checkName(rawId)
      if (idIssue !== null) {
        return fail('blocked', `节点 id 不合法：${idIssue.message}`, { code: idIssue.code })
      }
      const found = findNode(document, rawId)
      if (found !== undefined && !isInput(found)) {
        return fail('blocked', `${found.id} 不是输入节点`, { id: found.id })
      }
      if (found === undefined && (upsert.question === undefined || upsert.question.trim() === '')) {
        return fail('invalid_args', '新建输入节点需要 input.question（问用户的问题）', {
          id: rawId,
        })
      }
      const base: Record<string, unknown> = found === undefined ? {} : { ...found.data }
      const text = (key: 'question' | 'placeholder' | 'hint', value: string | undefined): void => {
        if (value === undefined) return
        if (value.trim() === '' && key !== 'question') delete base[key]
        else base[key] = value
      }
      text('question', upsert.question)
      text('placeholder', upsert.placeholder)
      text('hint', upsert.hint)
      if (upsert.kind !== undefined) base.kind = upsert.kind
      if (upsert.options !== undefined) base.options = upsert.options
      if (upsert.default !== undefined) base.default = upsert.default
      if (upsert.required !== undefined) base.required = upsert.required
      if (upsert.other !== undefined) base.other = upsert.other
      const data = readInputData(base)
      if (typeof data.question === 'string' && /[\r\n]/u.test(data.question)) {
        return fail('blocked', '问题不得包含换行（要多说几句请写在 hint 里）', { id: rawId })
      }
      const position = upsert.position ?? found?.position ?? { x: 0, y: 0 }
      const node: InputNode = {
        id: found?.id ?? rawId,
        type: INPUT_TYPE,
        position: { x: normalizeCoord(position.x), y: normalizeCoord(position.y) },
        data,
      }
      document.nodes =
        found === undefined
          ? [...document.nodes, node]
          : document.nodes.map((current) => (current === found ? node : current))
      return {
        ok: true,
        document,
        changed: [{ kind: 'node', op: found === undefined ? 'add' : 'update', id: node.id }],
        warnings: [],
      }
    })
  }

  async writeResource(workflow: string, upsert: ResourceUpsert): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      const found = upsert.id === undefined ? undefined : findNode(document, upsert.id)
      if (found !== undefined && !isResource(found)) {
        return fail('blocked', `${found.id} 不是资源节点`, { id: found.id })
      }
      // 记忆卡的内容固定是引用的那条记忆；不拦的话改了也会在读回时归一化掉，模型却以为改成了。
      if (found !== undefined && isMemory(found) && upsert.items !== undefined) {
        return fail(
          'blocked',
          `${found.id} 是记忆卡，内容固定是它引用的那条记忆，不能改 items；要换一条就 delete_node 再用 memory 加`,
          { id: found.id, code: 'memory_items' },
        )
      }
      if (found === undefined && upsert.id !== undefined) {
        const idIssue = checkName(normalizeName(upsert.id))
        if (idIssue !== null) {
          return fail('blocked', `节点 id 不合法：${idIssue.message}`, { code: idIssue.code })
        }
      }
      const base: Record<string, unknown> =
        found === undefined ? { items: [] } : { ...found.data, items: found.data.items }
      if (upsert.label !== undefined) {
        if (upsert.label === '') delete base.label
        else base.label = upsert.label
      }
      if (upsert.description !== undefined) {
        if (upsert.description.trim() === '') delete base.description
        else base.description = upsert.description
      }
      if (upsert.items !== undefined) base.items = upsert.items
      if (upsert.display !== undefined) {
        const applied = applyDisplay(readResourceData(base), upsert.display)
        if ('error' in applied) {
          return fail('blocked', applied.error, { code: 'display_invalid' })
        }
        if (applied.view === undefined) delete base.view
        else base.view = applied.view
      }
      const data: ResourceData = readResourceData(base)
      const problem = resourceProblem(data)
      if (problem !== null) return fail('blocked', problem.message, { code: 'resource_invalid' })
      if (found === undefined) {
        const fresh = newResourceNode(document, data, upsert.position)
        const node: ResourceNode =
          upsert.id === undefined ? fresh : { ...fresh, id: normalizeName(upsert.id) }
        document.nodes = [...document.nodes, node]
        return {
          ok: true,
          document,
          changed: [{ kind: 'node', op: 'add', id: node.id }],
          warnings: [],
        }
      }
      const next: ResourceNode = {
        id: found.id,
        type: RESOURCE_TYPE,
        position: upsert.position ?? found.position,
        data,
      }
      if (sameNodeContent(found, next) && upsert.position === undefined) {
        return { ok: true, document, changed: [], warnings: [] }
      }
      document.nodes = document.nodes.map((node) => (node === found ? next : node))
      return {
        ok: true,
        document,
        changed: [{ kind: 'node', op: 'update', id: found.id }],
        warnings: [],
      }
    })
  }

  async addMemory(workflow: string, request: MemoryCardRequest): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      const position = request.position ?? { x: 0, y: 0 }
      if (request.step === undefined) {
        const added = addGlobalMemory(document, request.ref, position)
        return {
          ok: true,
          document: added.document,
          changed: [
            { kind: 'node', op: 'add', id: added.id, detail: { memory: request.ref.memory } },
          ],
          warnings: [],
        }
      }
      const step = findNode(document, request.step)
      if (step === undefined) {
        return fail('not_found', `节点 ${request.step} 不存在`, { node: request.step })
      }
      if (!isStep(step)) return fail('invalid_args', `${step.id} 不是步骤`, { node: step.id })
      const existing = stepMemories(document, step.id)[0]
      if (existing !== undefined) {
        return fail('conflict', `步骤 ${step.id} 已经有记忆了（${existing.id}）`, {
          node: step.id,
          memory: existing.id,
        })
      }
      const added = addStepMemory(document, step.id, request.ref, position)
      if (added === null) {
        return fail('invalid_args', `步骤 ${step.id} 加不了记忆`, { node: step.id })
      }
      const edge = added.document.edges[added.document.edges.length - 1]
      return {
        ok: true,
        document: added.document,
        changed: [
          { kind: 'node', op: 'add', id: added.id, detail: { memory: request.ref.memory } },
          ...(edge === undefined
            ? []
            : [{ kind: 'edge' as const, op: 'add' as const, id: edge.id }]),
        ],
        warnings: [],
      }
    })
  }

  async setLabel(workflow: string, node: string, label: string): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      const target = findNode(document, node)
      if (target === undefined) return fail('not_found', `节点 ${node} 不存在`, { node })
      if (isInput(target)) {
        return fail(
          'invalid_args',
          `${target.id} 是输入节点，没有显示名（改问题请用 input.question）`,
          {
            node,
          },
        )
      }
      const issue = checkLabel(label)
      if (issue !== null) {
        return fail('blocked', `label 不合法：${issue.message}`, { code: issue.code, node })
      }
      if ((target.data.label ?? '') === label) {
        return { ok: true, document, changed: [], warnings: [] }
      }
      // 改 `label` 是纯 `data` 变更：不碰 edges、不涉及文件名、无连带写入。
      setLabelValue(target.data, label === '' ? undefined : label)
      return {
        ok: true,
        document,
        changed: [{ kind: 'node', op: 'update', id: target.id, detail: { field: 'label' } }],
        warnings: [],
      }
    })
  }

  /**
   * 改工作流设置。给了的字段才改：`outputRoot` 空串 = 清除（回到默认的
   * `.workflow-lite/runs/{instance}/out`）、`.` = 工作区根，`mode` / `reuse` 给 `'auto'` = 清除。
   */
  async configure(workflow: string, patch: SettingsPatch): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      if (patch.outputRoot !== undefined) {
        const issue = checkOutputRoot(patch.outputRoot)
        if (issue !== null) {
          return fail('invalid_args', `output_root 不合法：${issue.message}`, { code: issue.code })
        }
      }
      const before = document.settings
      const next = readSettings({
        outputRoot: patch.outputRoot ?? before?.outputRoot,
        mode: patch.mode ?? before?.mode,
        reuse: patch.reuse ?? before?.reuse,
        setGoal: patch.setGoal ?? before?.setGoal,
        runState: patch.runState ?? before?.runState,
      })
      if (sameSettings(before, next)) return { ok: true, document, changed: [], warnings: [] }
      if (next === undefined) delete document.settings
      else document.settings = next
      return {
        ok: true,
        document,
        changed: [
          { kind: 'workflow', op: 'update', id: workflow, detail: { settings: next ?? {} } },
        ],
        warnings: [],
      }
    })
  }

  async deleteNode(workflow: string, node: string): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      const target = findNode(document, node)
      if (target === undefined) return fail('not_found', `节点 ${node} 不存在`, { node })
      // 删节点**必须连带删边**，否则立刻产生悬空 edge、整图不可加载。
      const orphans = document.edges.filter(
        (edge) =>
          idKey(edge.source) === idKey(target.id) || idKey(edge.target) === idKey(target.id),
      )
      const orphanIds = new Set(orphans.map((edge) => edge.id))
      const before = { ...document }
      document.nodes = document.nodes.filter((current) => idKey(current.id) !== idKey(target.id))
      document.edges = document.edges.filter((edge) => !orphanIds.has(edge.id))
      // 删步骤时它自己的记忆卡一起删掉，不然就悄悄成了全局记忆（记忆库里那一条不动）。
      const kept = dropOrphanMemories(before, document).nodes
      const dropped = document.nodes.filter((current) => !kept.includes(current))
      document.nodes = kept
      return {
        ok: true,
        document,
        changed: [
          {
            kind: 'node',
            op: 'delete',
            id: target.id,
            detail: { edges: orphans.map((edge) => edge.id) },
          },
          ...dropped.map((card) => ({
            kind: 'node' as const,
            op: 'delete' as const,
            id: card.id,
            detail: { memory: isResource(card) ? (memoryOf(card.data)?.memory ?? '') : '' },
          })),
        ],
        warnings: [],
      }
    })
  }

  /**
   * 连一条边。给了 `handoff` 就顺带设置它的交接（`null` = 回到自动，`false` = 只管先后）；
   * 边已存在时只改交接（没给 `handoff` 就是幂等的空操作）。
   */
  async connect(
    workflow: string,
    source: string,
    target: string,
    when?: string,
    handoff?: Handoff | false | null,
    update?: boolean,
  ): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      const from = findNode(document, source)
      if (from === undefined) return fail('not_found', `源节点 ${source} 不存在`, { node: source })
      const to = findNode(document, target)
      if (to === undefined) return fail('not_found', `目标节点 ${target} 不存在`, { node: target })
      // 线的种类由两端决定：步骤 → 步骤是先后；步骤 → 资源是写；资源 → 步骤是读。
      if (isResource(from) && isResource(to)) {
        return fail('invalid_args', '资源不能直接连到资源', { source, target })
      }
      if (isInput(to)) {
        return fail('invalid_args', '不能连进输入节点——输入只往外连到步骤', { source, target })
      }
      if (isInput(from) && !isStep(to)) {
        return fail('invalid_args', '输入节点只能连到步骤', { source, target })
      }
      const touchesResource = isResource(from) || isResource(to) || isInput(from)
      if (touchesResource && (when !== undefined || (handoff !== undefined && handoff !== null))) {
        return fail('invalid_args', '连着资源或输入的线不能带 when 或 handoff', { source, target })
      }
      if (update !== undefined && !(isStep(from) && isResource(to))) {
        return fail('invalid_args', 'update 只用在「步骤 → 资源」的线上', { source, target })
      }

      let whenValue: string | undefined
      if (when !== undefined) {
        const issue = checkWhen(when)
        if (issue !== null) {
          return fail('blocked', `when 不合法：${issue.message}`, { code: issue.code })
        }
        whenValue = when
      }

      const nextHandoff = handoff === null ? undefined : canonicalHandoff(handoff)
      if (nextHandoff !== undefined && nextHandoff !== false) {
        const issue = checkText(nextHandoff.note, '交接说明')
        if (issue !== null) return fail('blocked', issue.message, { code: 'handoff_invalid' })
      }

      // 幂等：同 source + target + when 已存在 ⇒ 不新增；给了交接就只改交接。
      const existing = document.edges.find(
        (edge) =>
          idKey(edge.source) === idKey(from.id) &&
          idKey(edge.target) === idKey(to.id) &&
          (edge.data?.when ?? undefined) === whenValue,
      )
      if (existing !== undefined) {
        const sameUpdate = update === undefined || (existing.data?.update === true) === update
        if (
          (handoff === undefined || sameHandoff(existing.data?.handoff, nextHandoff)) &&
          sameUpdate
        ) {
          return { ok: true, document, changed: [], warnings: [] }
        }
        const data = { ...existing.data }
        if (handoff !== undefined) {
          if (nextHandoff === undefined) delete data.handoff
          else data.handoff = nextHandoff
        }
        if (update === true) data.update = true
        else if (update === false) delete data.update
        const updated: WorkflowEdge = { ...existing }
        if (Object.keys(data).length === 0) delete updated.data
        else updated.data = data
        document.edges = document.edges.map((edge) => (edge === existing ? updated : edge))
        return {
          ok: true,
          document,
          changed: [{ kind: 'edge', op: 'update', id: existing.id }],
          warnings: [],
        }
      }

      const id = makeEdgeId(from.id, to.id, whenValue)
      // 这个资源已经有别的步骤在写：没说写入方式时，接着写默认是"在原文件上更新"。
      const writtenBefore =
        isResource(to) && document.edges.some((edge) => idKey(edge.target) === idKey(to.id))
      const data = {
        ...(whenValue === undefined ? {} : { when: whenValue }),
        ...(nextHandoff === undefined ? {} : { handoff: nextHandoff }),
        ...((update ?? writtenBefore) && isResource(to) ? { update: true as const } : {}),
      }
      const edge: WorkflowEdge = {
        id,
        source: from.id,
        target: to.id,
        sourceHandle: null,
        targetHandle: null,
        ...(Object.keys(data).length === 0 ? {} : { data }),
      }
      document.edges = [...document.edges, edge]
      return { ok: true, document, changed: [{ kind: 'edge', op: 'add', id }], warnings: [] }
    })
  }

  async disconnect(
    workflow: string,
    source: string,
    target: string,
    when?: string,
  ): Promise<Outcome<WriteResult>> {
    return this.core.mutate(workflow, async (document) => {
      const matches = document.edges.filter(
        (edge) => idKey(edge.source) === idKey(source) && idKey(edge.target) === idKey(target),
      )
      if (matches.length === 0) {
        return fail('not_found', `边 ${source}->${target} 不存在`, { source, target })
      }
      let chosen: WorkflowEdge[]
      if (when !== undefined) {
        const issue = checkWhen(when)
        if (issue !== null) {
          return fail('blocked', `when 不合法：${issue.message}`, { code: issue.code })
        }
        chosen = matches.filter((edge) => (edge.data?.when ?? '') === when)
        if (chosen.length === 0) {
          return fail('not_found', `边 ${source}->${target}#${when} 不存在`, {
            source,
            target,
            when,
          })
        }
      } else {
        if (matches.length > 1) {
          return fail(
            'invalid_args',
            `节点 ${source} 与 ${target} 之间有 ${matches.length} 条边，必须用 when 指定删哪一条`,
            { source, target, count: matches.length },
          )
        }
        chosen = matches
      }
      const ids = new Set(chosen.map((edge) => edge.id))
      document.edges = document.edges.filter((edge) => !ids.has(edge.id))
      return {
        ok: true,
        document,
        changed: chosen.map((edge) => ({
          kind: 'edge' as const,
          op: 'delete' as const,
          id: edge.id,
        })),
        warnings: [],
      }
    })
  }
}
