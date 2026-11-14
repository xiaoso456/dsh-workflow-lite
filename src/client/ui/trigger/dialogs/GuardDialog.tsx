/**
 * dsh-workflow-lite — 「保护」对话框：上一次没跑完怎么办、错过的补不补、每小时上限、连续失败几次停用（草稿，「保存」才写进图）。
 *
 * 和会话方式同存在图里的启动方式（`launch`）下；缺省值不留在图里，借读入的规范化去掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/GuardDialog
 */

import { useState } from 'react'
import { launchOf, NO_LIMIT, readTriggerData } from '../../../../shared/trigger.ts'
import type { TriggerData, TriggerLaunch } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { Stepper } from '../../kit/NumberStep.tsx'
import { SwitchTrack } from '../../motion/marks.tsx'
import ins from '../../panel/panel.module.css'
import { TriggerMark } from '../TriggerMark.tsx'
import css from '../trigger.module.css'
import { TriggerSheet } from './TriggerSheet.tsx'

export function GuardDialog(props: {
  t: T
  name: string
  data: TriggerData
  onSave(launch: TriggerLaunch | undefined): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const [draft, setDraft] = useState<TriggerLaunch | undefined>(props.data.launch)
  const normal = (launch: TriggerLaunch | undefined): TriggerLaunch | undefined =>
    readTriggerData({ ...props.data, launch }).launch
  const dirty =
    JSON.stringify(normal(draft) ?? null) !== JSON.stringify(normal(props.data.launch) ?? null)
  const launch = launchOf({ ...props.data, launch: draft })
  const patch = (next: Partial<TriggerLaunch>): void =>
    setDraft((old) => normal({ ...old, ...next }))
  return (
    <TriggerSheet
      t={t}
      title={t('trigger.guard')}
      sub={props.name}
      mark={<TriggerMark kind={props.data.source.kind} size={16} />}
      testId="wl-trigger-guard-dialog"
      dirty={dirty}
      canSave
      onSave={() => {
        if (dirty) props.onSave(normal(draft))
        props.onClose()
      }}
      onClose={props.onClose}
    >
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
        t={t}
        none={t('trigger.noLimit')}
        label={t('trigger.maxPerHour')}
        desc={t('trigger.maxPerHourDesc')}
        value={launch.maxPerHour}
        testId="wl-trigger-max-hour"
        onCommit={(maxPerHour) => patch({ maxPerHour })}
      />
      <LimitRow
        t={t}
        none={t('trigger.noLimit')}
        label={t('trigger.maxFailures')}
        desc={t('trigger.maxFailuresDesc')}
        value={launch.maxFailures}
        testId="wl-trigger-max-failures"
        onCommit={(maxFailures) => patch({ maxFailures })}
      />
    </TriggerSheet>
  )
}

/** 数字框里最多几位（放得下、也远在整数的安全范围里）。 */
/** 上限最多填到多少（七位数）。 */
const LIMIT_MAX = 9_999_999

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

/**
 * 一个上限：名字加一句说明，右边一个「− 数 +」；空着是不限制（框里浅字写着「不限制」），在 1 再往下减就是空着。
 * 打字当场交给草稿。
 */
function LimitRow(props: {
  t: T
  label: string
  desc: string
  /** 不限制时框里的浅字。 */
  none: string
  value: number
  testId: string
  onCommit(value: number): void
}): React.JSX.Element {
  const { t } = props
  return (
    <div className={css.row}>
      <span className={cx(ins.requiredText, css.grow)}>
        <span className={ins.requiredTitle}>{props.label}</span>
        <span className={ins.requiredDesc}>{props.desc}</span>
      </span>
      <Stepper
        label={props.label}
        value={props.value === NO_LIMIT ? null : props.value}
        min={1}
        max={LIMIT_MAX}
        empty={props.none}
        digits={4}
        lessLabel={t('common.decrease')}
        moreLabel={t('common.increase')}
        testId={props.testId}
        onChange={(value) => props.onCommit(value ?? NO_LIMIT)}
      />
    </div>
  )
}
