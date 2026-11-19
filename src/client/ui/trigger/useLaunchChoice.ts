/**
 * dsh-workflow-lite — 触发卡片「在哪执行」的几样选择：会话方式、（固定会话时）固定到哪个会话、工作区，
 * 以及新建会话时用的 agent 预设、模型、思考强度、运行权限（不写 = 跟随工作流设置；权限工作流也没写时用完全权限）。
 *
 * 画布面板（LaunchField）和工作流中心「触发」页的设置（SettingsPane）各按自己的样子摆，选项和存法都从这里拿：
 * 会话方式写在图里（`onLaunch`，缺省值不留）；工作区、固定的会话只存在这台机器上（`env.triggers.set`），
 * 存不下时 `failed` 是原因。要跑命令的卡片换了工作区，宿主让它回到「待确认」（这里不管、也不绕过）。
 * 预设、模型写在图里；能选什么从 DSH 读（`env.agents`），实例视图没有现场时只列「跟随工作流」和已经设了的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/useLaunchChoice
 */

import { useState } from 'react'
import { commandOf, launchOf, readTriggerData } from '../../../shared/trigger.ts'
import type {
  ModelChoice,
  TriggerData,
  TriggerLaunch,
  TriggerSessionMode,
} from '../../../shared/types.ts'
import { useAgentCatalog } from '../../app/agents.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { folderName } from '../../model/hostPath.ts'
import {
  type ChoiceIssue,
  choiceIssues,
  effortOptions,
  FOLLOW,
  issueLines,
  modelKey,
  modelOptions,
  permissionOptions,
  pickModel,
  presetOptions,
  triggerInheritedPermission,
  withEffort,
} from '../../model/sessionChoice.ts'
import type { SelectOption } from '../kit/Select.tsx'
import type { TriggerEnv } from './triggerEnv.ts'

const SESSION_MODES: readonly { value: TriggerSessionMode; label: LocaleKey }[] = [
  { value: 'new', label: 'trigger.session.new' },
  { value: 'last', label: 'trigger.session.last' },
  { value: 'fixed', label: 'trigger.session.fixed' },
]

export interface Choice<V extends string> {
  value: V
  options: SelectOption<V>[]
  set(value: V): void
}

/** 新建会话时用什么跑：卡片上没写的项跟随工作流设置。 */
export interface AgentChoices {
  preset: Choice<string>
  model: Choice<string>
  /** 思考强度：只在卡片自己选了分档的模型时有。 */
  effort: Choice<string> | null
  permission: Choice<string>
  /** 卡片上设的（权限连同跟随来的）在这台机器上用不了时的提醒（预设、模型、权限各一句）；都能用是空的。 */
  issues: { preset?: string[]; model?: string[]; permission?: string[] }
  /** 发进现成的会话（固定会话、接着上一次）：这几项只在那个会话不在了、要新建时才用。 */
  existing: boolean
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
  agent: AgentChoices
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

  const catalog = useAgentCatalog(env?.agents)
  const inherited = env?.workflowChoice
  const setLaunch = (change: Partial<TriggerLaunch>): void =>
    props.onLaunch(readTriggerData({ ...data, launch: { ...data.launch, ...change } }).launch)
  const ownModel = data.launch?.model
  const ownPreset = data.launch?.preset
  const ownPermission = data.launch?.permission
  const inheritedPermission = triggerInheritedPermission(inherited)
  // 权限跟随来的也看：工作流没写时用的完全权限，这台机器上设不上也要提醒（工作流设的由工作流设置那边提醒）。
  const checkedPermission =
    ownPermission ?? (inherited?.permission === undefined ? inheritedPermission : undefined)
  const issues = choiceIssues(catalog, {
    ...(ownPreset === undefined ? {} : { preset: ownPreset }),
    ...(ownModel === undefined ? {} : { model: ownModel }),
    ...(checkedPermission === undefined ? {} : { permission: checkedPermission }),
  })
  const issueOf = (kinds: ChoiceIssue['kind'][]): string[] | undefined => {
    const found = issues.find((issue) => kinds.includes(issue.kind))
    return found === undefined ? undefined : issueLines(t, catalog, found)
  }
  const presetIssue = issueOf(['preset'])
  const modelIssue = issueOf(['model', 'unsupported', 'effort'])
  const permissionIssue = issueOf(['permission', 'permissionUnsupported'])
  const efforts = ownModel === undefined ? [] : effortOptions(t, catalog, ownModel)
  const setModel = (model: ModelChoice | undefined): void => setLaunch({ model })
  const agent: AgentChoices = {
    preset: {
      value: ownPreset ?? FOLLOW,
      options: presetOptions(t, catalog, ownPreset, 'workflow', inherited?.preset),
      set: (value) => setLaunch({ preset: value === FOLLOW ? undefined : value }),
    },
    model: {
      value: modelKey(ownModel),
      options: modelOptions(t, catalog, ownModel, 'workflow', inherited?.model),
      set: (value) => setModel(pickModel(catalog, value, ownModel)),
    },
    effort:
      ownModel === undefined || efforts.length === 0
        ? null
        : {
            value: ownModel.effort ?? FOLLOW,
            options: efforts,
            set: (value) => setModel(withEffort(ownModel, value)),
          },
    permission: {
      value: ownPermission ?? FOLLOW,
      options: permissionOptions(t, catalog, ownPermission, 'workflow', inheritedPermission),
      set: (value) => setLaunch({ permission: value === FOLLOW ? undefined : value }),
    },
    issues: {
      ...(presetIssue === undefined ? {} : { preset: presetIssue }),
      ...(modelIssue === undefined ? {} : { model: modelIssue }),
      ...(permissionIssue === undefined ? {} : { permission: permissionIssue }),
    },
    existing: launch.session !== 'new',
  }

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
    agent,
  }
}
