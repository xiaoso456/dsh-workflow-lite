/**
 * dsh-workflow-lite — 「保护」对话框：上次执行未结束时怎么办（跳过 / 排队 / 同时运行，排队再问排队上限）、错过的补不补、
 * 每小时上限、连续失败几次停用（草稿，「保存」才写进图）。
 *
 * 「上次执行未结束时」标题后面一个「?」说怎么算结束；选了跳过、排队而工作流没开「记录运行状态」时再亮一枚 ⚠
 * （和面板状态行上的是同一个问题图标），小卡里「去打开」先问一句再开。不拦保存：存进图里照样存，只是开关打不开。
 *
 * 和会话方式同存在图里的启动方式（`launch`）下；缺省值不留在图里，借读入的规范化去掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/GuardDialog
 */

import { useState } from 'react'
import { launchOf, NO_LIMIT, OVERLAPS, readTriggerData } from '../../../../shared/trigger.ts'
import type { TriggerData, TriggerLaunch, TriggerOverlap } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import type { Problem } from '../../../model/triggerProblem.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { HelpList, HelpTip } from '../../kit/HelpTip.tsx'
import { Stepper } from '../../kit/NumberStep.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import ui from '../../kit/ui.module.css'
import { Presence } from '../../motion/exits.tsx'
import { SwitchTrack } from '../../motion/marks.tsx'
import ins from '../../panel/panel.module.css'
import { ProblemMark } from '../ProblemMark.tsx'
import { TriggerMark } from '../TriggerMark.tsx'
import css from '../trigger.module.css'
import { TriggerSheet } from './TriggerSheet.tsx'

/** 卡片所在的工作流开没开「记录运行状态」，和怎么去打开（做不了回一句原因）。 */
export interface RunStateLink {
  workflow: string
  on: boolean
  enable(): Promise<string | null>
}

export function GuardDialog(props: {
  t: T
  name: string
  data: TriggerData
  /** 看不出来（实例视图）就不给：不亮 ⚠。 */
  runState?: RunStateLink | undefined
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
      <OverlapBox
        t={t}
        value={launch.overlap}
        queueMax={launch.queueMax}
        runState={props.runState}
        onChange={(overlap) => patch({ overlap })}
        onQueueMax={(queueMax) => patch({ queueMax })}
      />
      <SwitchRow
        on={launch.catchUp}
        title={t('trigger.catchUp')}
        desc={t('trigger.catchUpDesc')}
        testId="wl-trigger-catchup"
        onToggle={(on) => patch({ catchUp: on ? true : undefined })}
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

/** 上限最多填到多少（七位数）。 */
const LIMIT_MAX = 9_999_999

const OVERLAP_TEXT: Record<TriggerOverlap, { label: LocaleKey; desc: LocaleKey }> = {
  skip: { label: 'trigger.overlap.skip', desc: 'trigger.overlapDesc.skip' },
  queue: { label: 'trigger.overlap.queue', desc: 'trigger.overlapDesc.queue' },
  parallel: { label: 'trigger.overlap.parallel', desc: 'trigger.overlapDesc.parallel' },
}

/**
 * 上次执行未结束时怎么办：标题右边三选一，下面一句跟着选的换；选了「排队」再展开一行「排队上限」。
 * 标题后面「?」说怎么算结束，要开「记录运行状态」而没开时再亮 ⚠（一直挂着、没事时藏着，亮起藏起都不挪东西）。
 * 三句说明叠在同一格里、只露选中的那句（交叉淡），框按最长的那句占高，换选项时下面的东西不跳。
 */
function OverlapBox(props: {
  t: T
  value: TriggerOverlap
  queueMax: number
  runState: RunStateLink | undefined
  onChange(value: TriggerOverlap): void
  onQueueMax(value: number): void
}): React.JSX.Element {
  const { t } = props
  return (
    <div className={css.overlap} data-testid="wl-trigger-overlap">
      <div className={css.row}>
        <span className={cx(ins.requiredTitle, css.grow, css.overlapTitle)}>
          {t('trigger.overlap')}
          <HelpTip label={t('trigger.overlapHelp')} testId="wl-trigger-overlap-help">
            <p className={ui.hintTitle}>{t('trigger.overlapHelp')}</p>
            <HelpList t={t} keys={OVERLAP_HELP} />
          </HelpTip>
          {props.runState !== undefined && (
            <RunStateMark t={t} overlap={props.value} link={props.runState} />
          )}
        </span>
        <Segmented<TriggerOverlap>
          label={t('trigger.overlap')}
          value={props.value}
          fit
          options={OVERLAPS.map((value) => ({ value, label: t(OVERLAP_TEXT[value].label) }))}
          testId="wl-trigger-overlap"
          onChange={props.onChange}
        />
      </div>
      <span className={css.overlapDescs}>
        {OVERLAPS.map((value) => (
          <span
            key={value}
            className={ins.requiredDesc}
            data-on={value === props.value || undefined}
            aria-hidden={value === props.value ? undefined : true}
          >
            {t(OVERLAP_TEXT[value].desc)}
          </span>
        ))}
      </span>
      <Presence show={props.value === 'queue'}>
        <div className={css.overlapSub}>
          <LimitRow
            t={t}
            none={t('trigger.noLimit')}
            label={t('trigger.queueMax')}
            desc={t('trigger.queueMaxDesc')}
            value={props.queueMax}
            testId="wl-trigger-queue-max"
            onCommit={props.onQueueMax}
          />
        </div>
      </Presence>
    </div>
  )
}

const OVERLAP_HELP: readonly LocaleKey[] = [
  'trigger.overlapHelp.state',
  'trigger.overlapHelp.open',
  'trigger.overlapHelp.waive',
  'trigger.overlapHelp.needs',
]

/**
 * 选了跳过、排队而工作流没开「记录运行状态」：一枚提醒色的 ⚠，小卡里「去打开」，点了在图标旁边问一句再开。
 * 开成了就藏起来（不等外面重读）；没开成在小卡里写原因、钉开。
 */
function RunStateMark(props: {
  t: T
  overlap: TriggerOverlap
  link: RunStateLink
}): React.JSX.Element {
  const { t, link } = props
  const confirm = useConfirm<HTMLButtonElement>()
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [pin, setPin] = useState(0)
  const needs = props.overlap !== 'parallel' && !link.on && !done
  const problem: Problem | null = !needs
    ? null
    : failed !== null
      ? { text: failed, tone: 'bad' }
      : {
          text: t('trigger.needsRunState'),
          tone: 'warn',
          action: { label: 'trigger.afterEnable', run: 'runState' },
        }
  const enable = (): void => {
    void link.enable().then((reason) => {
      if (reason === null) {
        setDone(true)
        return
      }
      setFailed(reason)
      setPin((count) => count + 1)
    })
  }
  return (
    <>
      <ProblemMark
        t={t}
        problem={problem}
        testId="wl-trigger-overlap-problem"
        anchorRef={confirm.anchorRef}
        pin={pin}
        onAction={() => {
          setFailed(null)
          confirm.show()
        }}
      />
      {confirm.render({
        t,
        title: t('trigger.runStateTitle').replace('{name}', link.workflow),
        desc: t('trigger.runStateDesc'),
        confirmText: t('trigger.runStateOk'),
        testId: 'wl-trigger-overlap-run-state',
        danger: false,
        onConfirm: enable,
      })}
    </>
  )
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
