/**
 * dsh-workflow-lite — 触发卡片的「执行设置」：一张列表卡，一项一行——会话方式、（固定会话时）固定到哪个会话、工作区是下拉，
 * 「保护」是一行短摘要（点开是对话框，悬停看完整说法）。
 *
 * 会话方式和工作区留在面板上：打开开关前就要选好。存的地方不同：会话方式、保护写在图里（跟着工作流走）；
 * 选定的工作区和会话只存在这台机器上（见 {@link TriggerEnv}），实例视图里没有现场就不显示。
 *
 * 开关打不开是因为这里缺了一项（工作区、会话）时，画布那边会请面板把它带到眼前（`env.reveal`）：
 * 滚到看得见、闪一下、焦点落上去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/LaunchField
 */

import { useEffect, useRef, useState } from 'react'
import { commandOf, launchOf, readTriggerData } from '../../../shared/trigger.ts'
import type { TriggerData, TriggerLaunch, TriggerSessionMode } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { folderName } from '../../model/hostPath.ts'
import { guardBrief, guardSummary } from '../../model/triggerSummary.ts'
import { Select } from '../kit/Select.tsx'
import { FieldHead, HelpText } from '../panel/FieldHead.tsx'
import ins from '../panel/panel.module.css'
import { GuardDialog } from './dialogs/GuardDialog.tsx'
import { SummaryField, SummaryList, SummaryRow } from './SummaryRow.tsx'
import type { LaunchField as Missing, TriggerEnv } from './triggerEnv.ts'

const SESSION_MODES: readonly { value: TriggerSessionMode; label: LocaleKey }[] = [
  { value: 'new', label: 'trigger.session.new' },
  { value: 'last', label: 'trigger.session.last' },
  { value: 'fixed', label: 'trigger.session.fixed' },
]

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
  const { t, env, data } = props
  const launch = launchOf(data)
  const view = env?.triggers.view(props.node)
  /** 选工作区、会话没存下去时的原因。 */
  const [failed, setFailed] = useState('')
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

  const patch = (next: Partial<TriggerLaunch>): void => {
    // 借读入的规范化去掉等于缺省值的项。
    props.onLaunch(readTriggerData({ ...data, launch: { ...data.launch, ...next } }).launch)
  }
  const store = async (change: { workspace?: string; session?: string }): Promise<void> => {
    if (env === null) return
    setFailed((await env.triggers.set(props.node, change)) ?? '')
  }

  // 要跑命令的触发源（轮询、监听）不论会话方式都要选工作区：命令在那里运行。
  const runsCommand = commandOf(data.source) !== undefined
  const workspace = view?.workspace ?? ''
  const workspaces = env === null ? [] : [...new Set([...env.workspaces, workspace])]
  const session = view?.session ?? ''
  const known = env?.sessions ?? []
  const sessions =
    session === '' || known.some((item) => item.id === session)
      ? known
      : [...known, { id: session, title: session }]

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
            value={launch.session}
            testId="wl-trigger-session"
            onChange={(mode) => patch({ session: mode })}
            options={SESSION_MODES.map((mode) => ({ value: mode.value, label: t(mode.label) }))}
          />
        </SummaryField>
        {env !== null && launch.session === 'fixed' && (
          <SummaryField title={t('trigger.fixed')} rowRef={sessionRow} flash={flash === 'session'}>
            <Select<string>
              plain
              t={t}
              label={t('trigger.fixed')}
              value={session}
              testId="wl-trigger-fixed"
              onChange={(id) => void store({ session: id })}
              options={[
                ...(session === '' ? [{ value: '', label: t('trigger.fixedNone') }] : []),
                ...sessions.map((item) => ({
                  value: item.id,
                  label:
                    item.id === env.here.session
                      ? t('trigger.sessionHere').replace('{name}', item.title)
                      : item.title,
                })),
              ]}
            />
          </SummaryField>
        )}
        {env !== null && (launch.session !== 'fixed' || runsCommand) && (
          <SummaryField
            title={t('trigger.workspace')}
            rowRef={workspaceRow}
            flash={flash === 'workspace'}
          >
            <Select<string>
              plain
              t={t}
              label={t('trigger.workspace')}
              value={workspace}
              testId="wl-trigger-workspace"
              onChange={(path) => void store({ workspace: path })}
              options={workspaces.map((path) => ({
                value: path,
                label:
                  path === ''
                    ? t('trigger.workspaceNone')
                    : path === env.here.cwd
                      ? t('trigger.workspaceHere').replace('{name}', folderName(path))
                      : `${folderName(path)} · ${path}`,
              }))}
            />
          </SummaryField>
        )}
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
        <p className={ins.error} hidden={failed === ''} data-testid="wl-trigger-launch-error">
          {failed}
        </p>
      )}
      {guard && (
        <GuardDialog
          t={t}
          name={props.name}
          data={data}
          onSave={props.onLaunch}
          onClose={() => setGuard(false)}
        />
      )}
    </section>
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
