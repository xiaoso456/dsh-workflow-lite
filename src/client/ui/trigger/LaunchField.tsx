/**
 * dsh-workflow-lite — 触发卡片的「执行设置」：一张列表卡，一项一行——会话方式、（固定会话时）固定到哪个会话、工作区、
 * 新建会话用的预设、模型、权限（缺省跟随工作流，权限工作流也没写时是完全权限；选了分档的模型再多一行思考强度）是下拉，
 * 「保护」是一行短摘要（点开是对话框，悬停看完整说法）。
 * 发进现成的会话（固定会话、接着上一次）时这几行淡下去、最后一行下面说一句：只在要新建会话时用。
 *
 * 会话方式和工作区留在面板上：打开开关前就要选好。选项和存法在 useLaunchChoice（工作流中心「触发」页的设置共用）：
 * 会话方式、保护写在图里（跟着工作流走）；选定的工作区和会话只存在这台机器上，实例视图里没有现场就不显示。
 *
 * 开关打不开是因为这里缺了一项（工作区、会话）时，画布那边会请面板把它带到眼前（`env.reveal`）：
 * 滚到看得见、闪一下、焦点落上去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/LaunchField
 */

import { useEffect, useRef, useState } from 'react'
import type { TriggerData, TriggerLaunch, TriggerSessionMode } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { guardBrief, guardSummary } from '../../model/triggerSummary.ts'
import { Select } from '../kit/Select.tsx'
import { FieldHead, HelpText } from '../panel/FieldHead.tsx'
import ins from '../panel/panel.module.css'
import { GuardDialog } from './dialogs/GuardDialog.tsx'
import { SummaryField, SummaryList, SummaryRow } from './SummaryRow.tsx'
import type { LaunchField as Missing, TriggerEnv } from './triggerEnv.ts'
import { type AgentChoices, useLaunchChoice } from './useLaunchChoice.ts'

/** 这一节接手的「带到眼前」。 */
const LAUNCH_FIELDS: readonly Missing[] = ['workspace', 'session']

/** 闪一下要补的那一项（和 summaryRow.module.css 里 `.field` 的 flash 动画一样长）。 */
const ATTENTION_MS = 1200

/**
 * 面板接手「把要补的那一项带到眼前」：只滚面板自己的滚动区（不带着宿主页面一起动），闪一下，焦点落到下拉上。
 * 接手一次就清掉，面板重新挂上不会再来一遍。
 */
function useReveal(env: TriggerEnv | null, node: string): Missing | null {
  const [flash, setFlash] = useState<Missing | null>(null)
  const request = env?.reveal
  const take = env?.takeReveal
  useEffect(() => {
    if (request === undefined || request === null || take === undefined) return
    const field = take(node, LAUNCH_FIELDS)
    if (field !== null) setFlash(field)
  }, [request, take, node])
  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(() => setFlash(null), ATTENTION_MS)
    return () => window.clearTimeout(timer)
  }, [flash])
  return flash
}

export function LaunchField(props: {
  t: T
  node: string
  /** 卡片名（对话框标题下面那行）。 */
  name: string
  data: TriggerData
  /** 模板视图的现场；实例视图是 `null`。 */
  env: TriggerEnv | null
  /** 改图里的启动方式（缺省值不留在图里）。 */
  onLaunch(launch: TriggerLaunch | undefined): void
}): React.JSX.Element {
  const { t, env } = props
  const choice = useLaunchChoice(props)
  const { launch } = choice
  const flash = useReveal(env, props.node)
  const [guard, setGuard] = useState(false)
  const workspaceRow = useRef<HTMLDivElement>(null)
  const sessionRow = useRef<HTMLDivElement>(null)

  // 要补的那一项：滚进面板的可视区、焦点落到它的下拉上。
  useEffect(() => {
    if (flash === null) return
    const row = (flash === 'workspace' ? workspaceRow : sessionRow).current
    if (row === null) return
    scrollIntoPanel(row)
    row.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }, [flash])

  return (
    <section className={ins.field} data-testid="wl-trigger-launch">
      <FieldHead
        title={t('trigger.launch')}
        helpTestId="wl-trigger-launch-help"
        help={env === null ? undefined : <HelpText>{t('trigger.localHint')}</HelpText>}
      />
      <SummaryList>
        <SummaryField title={t('trigger.session')}>
          <Select<TriggerSessionMode>
            plain
            label={t('trigger.session')}
            value={choice.mode.value}
            testId="wl-trigger-session"
            onChange={choice.mode.set}
            options={choice.mode.options}
          />
        </SummaryField>
        {choice.fixed !== null && (
          <SummaryField title={t('trigger.fixed')} rowRef={sessionRow} flash={flash === 'session'}>
            <Select<string>
              plain
              t={t}
              label={t('trigger.fixed')}
              value={choice.fixed.value}
              testId="wl-trigger-fixed"
              onChange={choice.fixed.set}
              options={choice.fixed.options}
            />
          </SummaryField>
        )}
        {choice.workspace !== null && (
          <SummaryField
            title={t('trigger.workspace')}
            rowRef={workspaceRow}
            flash={flash === 'workspace'}
          >
            <Select<string>
              plain
              t={t}
              label={t('trigger.workspace')}
              value={choice.workspace.value}
              testId="wl-trigger-workspace"
              onChange={choice.workspace.set}
              options={choice.workspace.options}
            />
          </SummaryField>
        )}
        <AgentRows t={t} agent={choice.agent} />
        <SummaryRow
          title={t('trigger.guard')}
          summary={guardBrief(t, launch)}
          tip={guardSummary(t, launch)}
          editLabel={t('trigger.edit')}
          testId="wl-trigger-guard"
          onEdit={() => setGuard(true)}
        />
      </SummaryList>
      {env !== null && (
        <p
          className={ins.error}
          hidden={choice.failed === ''}
          data-testid="wl-trigger-launch-error"
        >
          {choice.failed}
        </p>
      )}
      {guard && (
        <GuardDialog
          t={t}
          name={props.name}
          data={props.data}
          runState={
            env === null
              ? undefined
              : {
                  workflow: env.workflow,
                  on: env.triggers.view(props.node)?.runState === true,
                  enable: () => env.enableRunState(env.workflow),
                }
          }
          onSave={props.onLaunch}
          onClose={() => setGuard(false)}
        />
      )}
    </section>
  )
}

/** 新建会话用的预设、模型（、思考强度）、权限几行。 */
function AgentRows(props: { t: T; agent: AgentChoices }): React.JSX.Element {
  const { t, agent } = props
  const dim = agent.existing
  return (
    <>
      <SummaryField
        title={t('session.presetShort')}
        dim={dim}
        warn={agent.issues.preset ?? null}
        testId="wl-trigger-row-preset"
      >
        <Select<string>
          plain
          t={t}
          label={t('session.preset')}
          value={agent.preset.value}
          proseDesc
          testId="wl-trigger-preset"
          onChange={agent.preset.set}
          options={agent.preset.options}
        />
      </SummaryField>
      <SummaryField
        title={t('session.model')}
        dim={dim}
        warn={agent.issues.model ?? null}
        testId="wl-trigger-row-model"
      >
        <Select<string>
          plain
          t={t}
          search
          label={t('session.model')}
          value={agent.model.value}
          proseDesc
          testId="wl-trigger-model"
          onChange={agent.model.set}
          options={agent.model.options}
        />
      </SummaryField>
      {agent.effort !== null && (
        <SummaryField title={t('session.effortShort')} dim={dim} testId="wl-trigger-row-effort">
          <Select<string>
            plain
            label={t('session.effort')}
            value={agent.effort.value}
            testId="wl-trigger-effort"
            onChange={agent.effort.set}
            options={agent.effort.options}
          />
        </SummaryField>
      )}
      <SummaryField
        title={t('session.permissionShort')}
        dim={dim}
        note={dim ? t('session.existingNote') : undefined}
        warn={agent.issues.permission ?? null}
        testId="wl-trigger-row-permission"
      >
        <Select<string>
          plain
          t={t}
          label={t('session.permission')}
          value={agent.permission.value}
          proseDesc
          testId="wl-trigger-permission"
          onChange={agent.permission.set}
          options={agent.permission.options}
        />
      </SummaryField>
    </>
  )
}

/** 只滚面板自己的滚动区，把 `element` 挪进可视区（已经看得见就不动）。 */
function scrollIntoPanel(element: HTMLElement): void {
  let box = element.parentElement
  while (
    box !== null &&
    !(box.scrollHeight > box.clientHeight && getComputedStyle(box).overflowY !== 'visible')
  ) {
    box = box.parentElement
  }
  if (box === null) return
  const outer = box.getBoundingClientRect()
  const inner = element.getBoundingClientRect()
  const margin = 24
  if (inner.top < outer.top + margin) box.scrollTop -= outer.top + margin - inner.top
  else if (inner.bottom > outer.bottom - margin)
    box.scrollTop += inner.bottom - (outer.bottom - margin)
}
