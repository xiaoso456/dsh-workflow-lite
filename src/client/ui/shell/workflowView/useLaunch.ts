/**
 * dsh-workflow-lite — 「执行」：会话与工作区、主机访问、先存盘再建实例再发话、执行前的提问。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useLaunch
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { isInput } from '../../../../shared/model.ts'
import type { InputAnswer } from '../../../../shared/types.ts'
import type { Desktop } from '../../../app/desktop.ts'
import { createHostAccess, type HostAccess } from '../../../app/host.ts'
import { type SessionBridge, type SessionRow, useSessionRows } from '../../../app/sessions.ts'
import type { Runs } from '../../../app/useRuns.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { errorMessage, type WorkflowLiteRpc } from '../../../rpc.ts'

export interface LaunchInput {
  /** 视图的 props（里面的成员在依赖数组里按原样写成 props.x）。 */
  props: {
    rpc: WorkflowLiteRpc
    session: string | undefined
    openView(view: string, focus: string): void
    sessions?: SessionBridge
    desktop?: Desktop
  }
  t: T
  wf: Workflow
  runs: Runs
  openRun(id: string): void
  /** 本会话上一次见到的当前实例（执行后先记下，免得把自己建的实例当成「新实例」提示）。 */
  seenCurrent: React.MutableRefObject<string | undefined | null>
}

export function useLaunch({ props, t, wf, runs, openRun, seenCurrent }: LaunchInput): {
  sessionRows: readonly SessionRow[]
  starting: boolean
  launchBlocked: LocaleKey | null
  sessionCwd: string | undefined
  host: HostAccess
  canCreate: boolean
  startRun(target: string | null, answers?: Record<string, InputAnswer>): Promise<void>
  asking: { target: string | null } | null
  setAsking: React.Dispatch<React.SetStateAction<{ target: string | null } | null>>
  lastAnswers: React.MutableRefObject<Map<string, Record<string, InputAnswer>>>
  launch(target: string | null): void
} {
  const { state } = wf
  // ── 执行 ────────────────────────────────────────────────────
  const sessionRows = useSessionRows(props.sessions)
  const [starting, setStarting] = useState(false)
  const launchBlocked: LocaleKey | null =
    props.sessions === undefined || !props.sessions.available()
      ? 'launch.noBridge'
      : props.session === undefined
        ? 'launch.noSession'
        : wf.conflict !== null
          ? 'launch.conflict'
          : state.problems.some((p) => p.level === 'save' || p.level === 'compile')
            ? 'launch.fixFirst'
            : null
  /** 本会话的工作区（新建会话建在这里；预览计划也按它写工作区路径）。 */
  const sessionCwd = sessionRows.find((row) => row.id === props.session)?.cwd
  /** 给资源选文件、文件夹、Skill 时看主机（相对路径按本会话的工作区）。 */
  const host = useMemo(
    () =>
      createHostAccess(props.rpc, {
        cwd: sessionCwd,
        session: props.session,
        desktop: props.desktop,
      }),
    [props.rpc, sessionCwd, props.session, props.desktop],
  )
  const canCreate = props.sessions?.canCreate() === true && props.session !== undefined
  /**
   * 执行：先把没存的改动存下去（实例拿磁盘上的那份做快照），要新建会话就先建好，建实例，
   * 再往目标会话发那句话，然后跳过去看它跑。发不出去就把刚建的实例删掉，不留一个没人认领的实例。
   *
   * @param target - 会话 id；`null` = 在本工作区新建一个会话。
   * @param answers - 用户在「执行前填写」里的回答（图里有输入节点时）。
   */
  const startRun = useCallback(
    async (target: string | null, answers?: Record<string, InputAnswer>): Promise<void> => {
      const name = state.name
      const bridge = props.sessions
      if (name === null || bridge === undefined || props.session === undefined) return
      setStarting(true)
      try {
        if (!(await wf.flush())) throw new Error(t('launch.unsaved'))
        const session = target ?? (await bridge.create(props.session, sessionCwd))
        const row = sessionRows.find((candidate) => candidate.id === session)
        const cwd = row?.cwd ?? (target === null ? sessionCwd : undefined)
        const started = await props.rpc.call('run/start', {
          workflow: name,
          session,
          ...(cwd === undefined ? {} : { cwd }),
          ...(answers === undefined ? {} : { answers }),
        })
        try {
          await bridge.deliver(session, started.prompt)
        } catch (error) {
          await props.rpc
            .call('run/delete', { id: started.instance.id, withState: true })
            .catch(() => {})
          throw error
        }
        await runs.refresh()
        if (session === props.session) {
          // 本会话：切到对话 tab 看它跑（回到工作流 tab 时显示的就是这个实例）。
          seenCurrent.current = started.instance.id
          openRun(started.instance.id)
          props.openView('chat', 'workflow-lite:run')
        } else if (!bridge.open(session)) {
          wf.notify(t('launch.sent').replace('{title}', row?.title ?? session))
        }
      } catch (error) {
        wf.notify(`${t('launch.failed')}：${errorMessage(error)}`, 'error')
      } finally {
        setStarting(false)
      }
    },
    [
      state.name,
      props.sessions,
      props.rpc,
      props.session,
      props.openView,
      wf,
      t,
      sessionRows,
      sessionCwd,
      runs,
      openRun,
    ],
  )

  /**
   * 「执行」的入口：图里有输入节点就先弹「执行前填写」，填好再执行；没有就直接执行。
   * 上一次填的回答按工作流记着（只在这个视图里），再执行时预先填好。
   */
  const [asking, setAsking] = useState<{ target: string | null } | null>(null)
  const lastAnswers = useRef(new Map<string, Record<string, InputAnswer>>())
  const launch = useCallback(
    (target: string | null): void => {
      const doc = state.doc
      if (doc?.nodes.some(isInput)) {
        setAsking({ target })
        return
      }
      void startRun(target)
    },
    [state.doc, startRun],
  )
  return {
    sessionRows,
    starting,
    launchBlocked,
    sessionCwd,
    host,
    canCreate,
    startRun,
    asking,
    setAsking,
    lastAnswers,
    launch,
  }
}
