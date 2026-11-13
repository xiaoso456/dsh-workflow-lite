/**
 * dsh-workflow-lite — 触发卡片的「怎么运行」：发进哪个会话、在哪个工作区、上一次没跑完怎么办，以及两项保护。
 *
 * 两类设置放在一起，但存的地方不同：会话方式、重叠、补触发、上限写在图里（跟着工作流走）；
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
import { cx } from '../kit/cx.ts'
import { Segmented } from '../kit/Segmented.tsx'
import { Select } from '../kit/Select.tsx'
import ui from '../kit/ui.module.css'
import { SwitchTrack } from '../motion/marks.tsx'
import { FieldHead, HelpText } from '../panel/FieldHead.tsx'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'
import type { LaunchField as Missing, TriggerEnv } from './triggerEnv.ts'

const SESSION_MODES: readonly { value: TriggerSessionMode; label: LocaleKey }[] = [
  { value: 'new', label: 'trigger.session.new' },
  { value: 'last', label: 'trigger.session.last' },
  { value: 'fixed', label: 'trigger.session.fixed' },
]

/** 路径的最后一段（下拉里先看到文件夹名，再是完整路径）。 */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/u).filter((part) => part !== '')
  return parts[parts.length - 1] ?? path
}

/** 闪一下要补的那一项（和 CSS 里 `.attention` 的动画一样长）。 */
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
    const field = take(node)
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
      <Segmented<TriggerSessionMode>
        label={t('trigger.session')}
        value={launch.session}
        testId="wl-trigger-session"
        onChange={(mode) => patch({ session: mode })}
        options={SESSION_MODES.map((mode) => ({ value: mode.value, label: t(mode.label) }))}
      />
      {env !== null && (launch.session !== 'fixed' || runsCommand) && (
        <div
          ref={workspaceRow}
          className={cx(css.row, css.attention)}
          data-flash={flash === 'workspace' || undefined}
        >
          <span className={css.lead}>{t('trigger.workspace')}</span>
          <Select<string>
            label={t('trigger.workspace')}
            value={workspace}
            className={css.grow}
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
        </div>
      )}
      {env !== null && launch.session === 'fixed' && (
        <div
          ref={sessionRow}
          className={cx(css.row, css.attention)}
          data-flash={flash === 'session' || undefined}
        >
          <span className={css.lead}>{t('trigger.fixed')}</span>
          <Select<string>
            label={t('trigger.fixed')}
            value={session}
            className={css.grow}
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
        </div>
      )}
      {env !== null && (
        <p className={ins.error} hidden={failed === ''} data-testid="wl-trigger-launch-error">
          {failed}
        </p>
      )}

      <SwitchRow
        on={launch.overlap === 'parallel'}
        title={t('trigger.overlap')}
        desc={t('trigger.overlapDesc')}
        testId="wl-trigger-overlap"
        onToggle={(on) => patch({ overlap: on ? 'parallel' : 'skip' })}
      />
      <SwitchRow
        on={launch.catchUp}
        title={t('trigger.catchUp')}
        desc={t('trigger.catchUpDesc')}
        testId="wl-trigger-catchup"
        onToggle={(on) => patch({ catchUp: on ? undefined : false })}
      />

      <LimitRow
        label={t('trigger.maxPerHour')}
        value={launch.maxPerHour}
        max={3600}
        testId="wl-trigger-max-hour"
        onCommit={(maxPerHour) => patch({ maxPerHour })}
      />
      <LimitRow
        label={t('trigger.maxFailures')}
        value={launch.maxFailures}
        max={100}
        testId="wl-trigger-max-failures"
        onCommit={(maxFailures) => patch({ maxFailures })}
      />
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

/** 一行开关：标题加一句说明，整行可点（和面板里别的开关行一样）。 */
function SwitchRow(props: {
  on: boolean
  title: string
  desc: string
  testId: string
  onToggle(on: boolean): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      className={ins.required}
      data-testid={props.testId}
      onClick={() => props.onToggle(!props.on)}
    >
      <SwitchTrack on={props.on} />
      <span className={ins.requiredText}>
        <span className={ins.requiredTitle}>{props.title}</span>
        <span className={ins.requiredDesc}>{props.desc}</span>
      </span>
    </button>
  )
}

/** 一个上限：一行说明加一个数字框。输入时是草稿，失焦、回车才生效（夹进范围）。 */
function LimitRow(props: {
  label: string
  value: number
  max: number
  testId: string
  onCommit(value: number): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const value = Number.parseInt(draft, 10)
    if (Number.isFinite(value) && value !== props.value) {
      props.onCommit(Math.min(props.max, Math.max(1, value)))
    }
    setDraft(null)
  }
  return (
    <label className={css.row}>
      <span className={cx(css.rowLabel, css.grow)}>{props.label}</span>
      <input
        className={cx(ui.input, css.number)}
        inputMode="numeric"
        value={draft ?? String(props.value)}
        aria-label={props.label}
        data-testid={props.testId}
        onChange={(event) => setDraft(event.currentTarget.value.replace(/[^\d]/gu, ''))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
    </label>
  )
}
