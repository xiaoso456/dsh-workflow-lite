/**
 * dsh-workflow-lite — 触发卡片的「怎么运行」：发进哪个会话、在哪个工作区、上一次没跑完怎么办，以及两项保护。
 *
 * 两类设置放在一起，但存的地方不同：会话方式、重叠、补触发、上限写在图里（跟着工作流走）；
 * 选定的工作区和会话只存在这台机器上（见 {@link TriggerEnv}），实例视图里没有现场就不显示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/LaunchField
 */

import { useState } from 'react'
import { launchOf, readTriggerData } from '../../../shared/trigger.ts'
import type {
  TriggerData,
  TriggerLaunch,
  TriggerOverlap,
  TriggerSessionMode,
} from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import { Segmented } from '../kit/Segmented.tsx'
import { Select } from '../kit/Select.tsx'
import ui from '../kit/ui.module.css'
import { SwitchTrack } from '../motion/marks.tsx'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'
import type { TriggerEnv } from './triggerEnv.ts'

const SESSION_MODES: readonly { value: TriggerSessionMode; label: LocaleKey }[] = [
  { value: 'new', label: 'trigger.session.new' },
  { value: 'last', label: 'trigger.session.last' },
  { value: 'fixed', label: 'trigger.session.fixed' },
]

const OVERLAPS: readonly { value: TriggerOverlap; label: LocaleKey }[] = [
  { value: 'skip', label: 'trigger.overlap.skip' },
  { value: 'parallel', label: 'trigger.overlap.parallel' },
]

/** 路径的最后一段（下拉里先看到文件夹名，再是完整路径）。 */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/u).filter((part) => part !== '')
  return parts[parts.length - 1] ?? path
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

  const patch = (next: Partial<TriggerLaunch>): void => {
    // 借读入的规范化去掉等于缺省值的项。
    props.onLaunch(readTriggerData({ ...data, launch: { ...data.launch, ...next } }).launch)
  }
  const store = async (change: { workspace?: string; session?: string }): Promise<void> => {
    if (env === null) return
    setFailed((await env.triggers.set(props.node, change)) ?? '')
  }

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
      <div className={ins.label}>
        <span>{t('trigger.launch')}</span>
      </div>
      <Segmented<TriggerSessionMode>
        label={t('trigger.session')}
        value={launch.session}
        testId="wl-trigger-session"
        onChange={(mode) => patch({ session: mode })}
        options={SESSION_MODES.map((mode) => ({ value: mode.value, label: t(mode.label) }))}
      />
      {env !== null && launch.session !== 'fixed' && (
        <div className={css.row}>
          <span className={css.rowLabel}>{t('trigger.workspace')}</span>
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
        <div className={css.row}>
          <span className={css.rowLabel}>{t('trigger.fixed')}</span>
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

      <div className={css.row}>
        <span className={css.rowLabel}>{t('trigger.overlap')}</span>
        <Segmented<TriggerOverlap>
          label={t('trigger.overlap')}
          value={launch.overlap}
          testId="wl-trigger-overlap"
          onChange={(overlap) => patch({ overlap })}
          options={OVERLAPS.map((item) => ({ value: item.value, label: t(item.label) }))}
        />
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={launch.catchUp}
        className={ins.required}
        data-testid="wl-trigger-catchup"
        onClick={() => patch({ catchUp: launch.catchUp ? false : undefined })}
      >
        <SwitchTrack on={launch.catchUp} />
        <span className={ins.requiredText}>
          <span className={ins.requiredTitle}>{t('trigger.catchUp')}</span>
          <span className={ins.requiredDesc}>{t('trigger.catchUpDesc')}</span>
        </span>
      </button>

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
      {env !== null && <p className={ins.help}>{t('trigger.localHint')}</p>}
    </section>
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
