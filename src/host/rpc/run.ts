/**
 * dsh-workflow-lite — `run/*`：工作流实例的列表、读写、启动，以及实例里文件、图片、目录的浏览。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/run
 */

import { normalizeDocument } from '../../shared/model.ts'
import type { StateEdit } from '../../shared/runState.ts'
import { type LineFilter, RUN_STAT_MAX, type WorkflowLiteEndpoint } from '../../shared/wire.ts'
import type { RunFileTarget } from '../runs/files.ts'
import type { GraphEdit } from '../runs/runEdits.ts'
import { storageAction } from '../runs/storage.ts'
import {
  asRecord,
  fail,
  failFrom,
  ok,
  optionalString,
  type RpcDeps,
  type RpcResult,
  requireString,
} from './shared.ts'

/** `run/file`、`run/image` 的目标：资源的第几项（文件夹项可带 `sub`），或工作区里的相对路径。 */
function runFileTarget(input: Record<string, unknown>, route: string): RunFileTarget {
  const node = optionalString(input, 'node')
  const path = optionalString(input, 'path')
  if (node === undefined && path === undefined) throw new Error(`${route} requires node or path`)
  if (node === undefined) return { path: path ?? '' }
  const sub = optionalString(input, 'sub')
  const item = typeof input.item === 'number' && Number.isInteger(input.item) ? input.item : 0
  const version =
    typeof input.version === 'number' && Number.isInteger(input.version) && input.version > 0
      ? input.version
      : undefined
  return {
    node,
    item,
    ...(sub === undefined ? {} : { sub }),
    ...(version === undefined ? {} : { version }),
  }
}

/** `run/lines` 的筛选：空的当没筛；正则太长（多半是贴错了）拒绝。 */
function readLineFilter(raw: unknown): LineFilter | undefined {
  if (raw === undefined || raw === null) return undefined
  const input = asRecord(raw)
  const pattern = typeof input.pattern === 'string' ? input.pattern : ''
  if (pattern === '') return undefined
  if (pattern.length > 500) throw new Error('filter.pattern is too long')
  const context =
    typeof input.context === 'number' && Number.isInteger(input.context) ? input.context : 0
  return {
    pattern,
    ...(input.regex === true ? { regex: true } : {}),
    ...(input.caseSensitive === true ? { caseSensitive: true } : {}),
    ...(input.invert === true ? { invert: true } : {}),
    ...(context > 0 ? { context: Math.min(3, context) } : {}),
  }
}

/** 一处状态改动：路径是字符串数组，值只能是文字、数字、文字列表或 `null`（删掉）。 */
function readEdit(raw: unknown): StateEdit {
  const input = asRecord(raw)
  const path = input.path
  if (!Array.isArray(path) || path.some((key) => typeof key !== 'string')) {
    throw new Error('edit.path must be an array of strings')
  }
  return { path: path as string[], from: readEditValue(input.from), to: readEditValue(input.to) }
}

function readEditValue(value: unknown): StateEdit['to'] {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    return value as string[]
  throw new Error('edit value must be a string, number, string[] or null')
}

export async function dispatchRun(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `run/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'run/list': {
      const input = asRecord(payload)
      const session = optionalString(input, 'session')
      const all = input.all === true || session === undefined
      const instances = await deps.runs.list(session, all)
      const current = session === undefined ? undefined : await deps.runs.currentOf(session)
      return ok({ instances, ...(current === undefined ? {} : { current }) })
    }

    case 'run/load': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      const since = typeof input.since === 'number' ? input.since : undefined
      const outcome = await deps.runs.view(id, optionalString(input, 'session'), since)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/bind': {
      const input = asRecord(payload)
      const outcome = await deps.runs.bind(
        requireString(input, 'id'),
        requireString(input, 'session'),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/save': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      if (!Array.isArray(input.edits)) throw new Error('edits must be an array')
      const edits = input.edits.map(readEdit)
      const note = optionalString(input, 'note')
      let graph: GraphEdit | undefined
      if (input.graph !== undefined) {
        const raw = asRecord(input.graph)
        const parsed = normalizeDocument(raw.document)
        if (parsed.document === null) {
          return fail(
            'invalid_args',
            `提交的图形状不合法：${parsed.problems.map((problem) => problem.message).join('；')}`,
          )
        }
        graph = { base: requireString(raw, 'base'), document: parsed.document }
      }
      if (input.notify !== undefined && typeof input.notify !== 'boolean') {
        throw new Error('notify must be a boolean')
      }
      const outcome = await deps.runs.save(
        id,
        optionalString(input, 'session'),
        edits,
        note,
        graph,
        {
          notify: input.notify !== false,
        },
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/delete': {
      const input = asRecord(payload)
      const outcome = await deps.runs.remove(requireString(input, 'id'), input.withState === true)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/storage': {
      const input = asRecord(payload)
      const action = optionalString(input, 'action') ?? 'stats'
      if (
        action !== 'stats' &&
        action !== 'clearDispatch' &&
        action !== 'clearFinished' &&
        action !== 'clearHistory'
      ) {
        throw new Error(`unknown storage action ${action}`)
      }
      return ok(await storageAction(deps.runs, deps.dataDir(), action))
    }

    case 'run/start': {
      const input = asRecord(payload)
      const workflow = requireString(input, 'workflow')
      const session = requireString(input, 'session')
      const cwd = optionalString(input, 'cwd')
      const load = await deps.repository.load(workflow)
      if (!load.exists) return failFrom({ code: 'not_found', message: `图 ${workflow} 不存在` })
      if (!load.loadable || load.document === null) {
        return failFrom({
          code: 'blocked',
          message: `图 ${workflow} 有保存级问题，无法执行`,
          detail: { problems: load.problems },
        })
      }
      const outcome = await deps.runs.start({
        workflow,
        document: load.document,
        problems: load.problems,
        session: { id: session, ...(cwd === undefined ? {} : { cwd }) },
        answers: input.answers,
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/file': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      const target = runFileTarget(input, 'run/file')
      const outcome = await deps.runs.file(id, target, { tail: input.tail === true })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/lines': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      const target = runFileTarget(input, 'run/lines')
      if (!('node' in target)) throw new Error('run/lines requires node')
      const mode = input.mode === 'head' || input.mode === 'follow' ? input.mode : 'tail'
      const offset = (field: string): number | undefined => {
        const value = input[field]
        return typeof value === 'number' && Number.isInteger(value) && value >= 0
          ? value
          : undefined
      }
      const limit = offset('limit') ?? 200
      const before = offset('before')
      const from = offset('from')
      const owed = offset('owed')
      const tag = optionalString(input, 'tag')
      const filter = readLineFilter(input.filter)
      const outcome = await deps.runs.lines(id, target, {
        mode,
        limit,
        ...(before === undefined ? {} : { before }),
        ...(from === undefined ? {} : { from }),
        ...(tag === undefined ? {} : { tag }),
        ...(owed === undefined ? {} : { owed }),
        ...(filter === undefined ? {} : { filter }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/image': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      const src = optionalString(input, 'src')
      const target = runFileTarget(input, 'run/image')
      const outcome = await deps.runs.image(id, target, src)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/stat': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      if (!Array.isArray(input.targets)) throw new Error('targets must be an array')
      if (input.targets.length > RUN_STAT_MAX) throw new Error(`at most ${RUN_STAT_MAX} targets`)
      const targets = input.targets.map((raw) => {
        const target = asRecord(raw)
        const node = requireString(target, 'node')
        const item =
          typeof target.item === 'number' && Number.isInteger(target.item) ? target.item : 0
        return { node, item }
      })
      const outcome = await deps.runs.stat(id, targets)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/history': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      const node = requireString(input, 'node')
      const item = typeof input.item === 'number' && Number.isInteger(input.item) ? input.item : 0
      const outcome = await deps.runs.versions(id, node, item)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/latest': {
      const input = asRecord(payload)
      const workflow = requireString(input, 'workflow')
      if (!Array.isArray(input.targets)) throw new Error('targets must be an array')
      if (input.targets.length > RUN_STAT_MAX) throw new Error(`at most ${RUN_STAT_MAX} targets`)
      const targets = input.targets.map((raw) => {
        const target = asRecord(raw)
        return { node: requireString(target, 'node'), value: requireString(target, 'value') }
      })
      return ok(await deps.runs.latest(workflow, targets))
    }

    case 'run/dir': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      const node = requireString(input, 'node')
      const sub = optionalString(input, 'sub')
      const item = typeof input.item === 'number' && Number.isInteger(input.item) ? input.item : 0
      const outcome = await deps.runs.dir(id, { node, item, ...(sub === undefined ? {} : { sub }) })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    default: {
      const exhaustive: never = endpoint
      throw new Error(`unknown endpoint ${String(exhaustive)}`)
    }
  }
}
