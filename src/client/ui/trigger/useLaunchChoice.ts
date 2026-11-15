/**
 * dsh-workflow-lite — 触发卡片「在哪执行」的几样选择：会话方式、（固定会话时）固定到哪个会话、工作区。
 *
 * 画布面板（LaunchField）和工作流中心「触发」页的设置（SettingsPane）各按自己的样子摆，选项和存法都从这里拿：
 * 会话方式写在图里（`onLaunch`，缺省值不留）；工作区、固定的会话只存在这台机器上（`env.triggers.set`），
 * 存不下时 `failed` 是原因。要跑命令的卡片换了工作区，宿主让它回到「待确认」（这里不管、也不绕过）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/useLaunchChoice
 */

import { useState } from 'react'
import { commandOf, launchOf, readTriggerData } from '../../../shared/trigger.ts'
import type { TriggerData, TriggerLaunch, TriggerSessionMode } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { folderName } from '../../model/hostPath.ts'
import type { TriggerEnv } from './triggerEnv.ts'

const SESSION_MODES: readonly { value: TriggerSessionMode; label: LocaleKey }[] = [
  { value: 'new', label: 'trigger.session.new' },
  { value: 'last', label: 'trigger.session.last' },
  { value: 'fixed', label: 'trigger.session.fixed' },
]

export interface Choice<V extends string> {
  value: V
  options: { value: V; label: string }[]
  set(value: V): void
}

export interface LaunchChoice {
  launch: ReturnType<typeof launchOf>
  mode: Choice<TriggerSessionMode>
  /** 固定到哪个会话：只在固定会话、有现场时有。 */
  fixed: Choice<string> | null
  /** 工作区：有现场，且不是「固定会话又不跑命令」时有（要跑命令的不论会话方式都要选）。 */
  workspace: Choice<string> | null
  /** 不用选工作区（固定会话、不跑命令）。 */
  noWorkspace: boolean
  /** 工作区、会话没存下去时的原因；没有是空串。 */
  failed: string
}

export function useLaunchChoice(props: {
  t: T
  node: string
  data: TriggerData
  /** 模板视图的现场；实例视图是 `null`（只能改会话方式）。 */
  env: TriggerEnv | null
  /** 改图里的启动方式（缺省值不留在图里）。 */
  onLaunch(launch: TriggerLaunch | undefined): void
}): LaunchChoice {
  const { t, env, data } = props
  const launch = launchOf(data)
  const view = env?.triggers.view(props.node)
  const [failed, setFailed] = useState('')

  const store = async (change: { workspace?: string; session?: string }): Promise<void> => {
    if (env === null) return
    setFailed((await env.triggers.set(props.node, change)) ?? '')
  }

  const fixedMode = launch.session === 'fixed'
  const noWorkspace = fixedMode && commandOf(data.source) === undefined

  const session = view?.session ?? ''
  const known = env?.sessions ?? []
  const sessions =
    session === '' || known.some((item) => item.id === session)
      ? known
      : [...known, { id: session, title: session }]

  const workspace = view?.workspace ?? ''
  const workspaces = env === null ? [] : [...new Set([...env.workspaces, workspace])]

  return {
    launch,
    mode: {
      value: launch.session,
      options: SESSION_MODES.map((mode) => ({ value: mode.value, label: t(mode.label) })),
      // 借读入的规范化去掉等于缺省值的项。
      set: (mode) =>
        props.onLaunch(
          readTriggerData({ ...data, launch: { ...data.launch, session: mode } }).launch,
        ),
    },
    fixed:
      env === null || !fixedMode
        ? null
        : {
            value: session,
            options: [
              ...(session === '' ? [{ value: '', label: t('trigger.fixedNone') }] : []),
              ...sessions.map((item) => ({
                value: item.id,
                label:
                  item.id === env.here.session
                    ? t('trigger.sessionHere').replace('{name}', item.title)
                    : item.title,
              })),
            ],
            set: (id) => void store({ session: id }),
          },
    workspace:
      env === null || noWorkspace
        ? null
        : {
            value: workspace,
            options: workspaces.map((path) => ({
              value: path,
              label:
                path === ''
                  ? t('trigger.workspaceNone')
                  : path === env.here.cwd
                    ? t('trigger.workspaceHere').replace('{name}', folderName(path))
                    : `${folderName(path)} · ${path}`,
            })),
            set: (path) => void store({ workspace: path }),
          },
    noWorkspace,
    failed,
  }
}
