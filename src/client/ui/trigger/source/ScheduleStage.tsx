/**
 * dsh-workflow-lite — 「触发方式」对话框里定时的设置，分两步（{@link SchedulePage}）：
 *
 * - 触发时间：规则表单（`ScheduleField`：规则、这种规则自己的几行、常用），判定（到点就执行 / 每次成功 / 变为成功 / 输出变化，
 *   带命令的旁边一排示意、下面一句说明），工作台是接下来 7 天；
 * - 检查命令（判定要跑命令时才有）：工作区，工作台是命令（模板、试运行、最近的输出），占满剩下的高度。
 *
 * 顶上一条步骤条（{@link Steps}），两步都能直接点；换成到点就执行时第二步收回第一步背后，步骤条留着。
 * 在第二步时步骤条右边写这次的节奏（规则 · 判定）。换步时旧的一页往外退、新的从行进方向进来（{@link Staged}）。
 *
 * 换到「到点就执行」时写过的命令先记着（这一张对话框开着时），换回带命令的判定还在。
 *
 * 时间轴每换一次要重排上百个点：规则连着在变（数字框上连滚、按住 + 连着走）时等停下了只排一次，
 * 单独改一下（点常用、滚一格）当场跟上（{@link useSettled} 的 `leading`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/ScheduleStage
 */

import { useRef } from 'react'
import { scheduleIssue } from '../../../../shared/schedule.ts'
import { type ScheduleJudge, scheduleJudge, withScheduleJudge } from '../../../../shared/trigger.ts'
import type { TriggerCheck, TriggerSchedule, TriggerSource } from '../../../../shared/types.ts'
import type { TriggerTryResponse } from '../../../../shared/wire/trigger.ts'
import { useSettled } from '../../../app/useSettled.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { CHECK_TEMPLATES } from '../../../model/commandTemplates.ts'
import { ruleText } from '../../../model/triggerText.ts'
import { zoneText } from '../../../model/triggerUpcoming.ts'
import { weekOf } from '../../../model/triggerWeek.ts'
import { Segmented } from '../../kit/Segmented.tsx'
import { Steps } from '../../kit/Steps.tsx'
import { FadeStack, Staged } from '../../motion/stage.tsx'
import { SwapText } from '../../motion/swapText.tsx'
import { ScheduleField } from '../ScheduleField.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { Bench, benchAside } from './Bench.tsx'
import { CommandBox } from './CommandBox.tsx'
import { CwdRow } from './CwdRow.tsx'
import { JudgeStrip } from './JudgeStrip.tsx'
import { type RunDrafts, runWorkspace } from './runDraft.ts'
import { StageRow, StageRows } from './StageRow.tsx'
import type { SchedulePage } from './schedulePages.ts'
import css from './sourceStage.module.css'
import { WeekStrip } from './WeekStrip.tsx'

type Schedule = Extract<TriggerSource, { kind: 'schedule' }>

/** 规则停下多久之后时间轴才跟上（连滚时一格大约隔 50–100ms）。 */
const WEEK_SETTLE_MS = 250

const JUDGES: readonly { value: ScheduleJudge; label: LocaleKey; hint: LocaleKey }[] = [
  { value: 'always', label: 'trigger.checkWhen.always', hint: 'trigger.checkHint.always' },
  { value: 'every', label: 'trigger.checkWhen.every', hint: 'trigger.checkHint.every' },
  { value: 'success', label: 'trigger.checkWhen.success', hint: 'trigger.checkHint.success' },
  { value: 'change', label: 'trigger.checkWhen.change', hint: 'trigger.checkHint.change' },
]

export function ScheduleStage(props: {
  t: T
  node: string
  source: Schedule
  env: TriggerEnv | null
  /** 带命令时：工作区、shell 的草稿。 */
  run: RunDrafts
  /** 放不放最近的输出（草稿的命令和跑着的那条一样才放）。 */
  showOutput: boolean
  /** 卡片开着时宿主排好的下一次。 */
  live?: number | undefined
  /** 停在哪一步（没有第二步时总是第一步，见 `schedulePages.ts`）。 */
  page: SchedulePage
  onPage(page: SchedulePage): void
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source, env, page } = props
  const judge = scheduleJudge(source)
  const { check } = source
  /** 换到「到点就执行」之前写的命令。 */
  const kept = useRef<TriggerCheck | undefined>(check)
  const setJudge = (next: ScheduleJudge): void => {
    if (next === judge) return
    if (check !== undefined) kept.current = check
    if (next === 'always') {
      props.onChange(withScheduleJudge(source, 'always'))
      return
    }
    const command = check?.command ?? kept.current?.command ?? ''
    props.onChange({ ...source, check: { command, when: next } })
  }
  const setCheck = (patch: Partial<TriggerCheck>): void => {
    if (check !== undefined) props.onChange({ ...source, check: { ...check, ...patch } })
  }
  const judgeLabel = JUDGES.find((item) => item.value === judge)?.label
  return (
    <>
      <div className={css.stepBar}>
        <Steps
          label={t('trigger.step.label')}
          steps={[
            { label: t('trigger.step.time'), icon: 'clock', testId: 'wl-trigger-step-time' },
            ...(check === undefined
              ? []
              : [
                  {
                    label: t('trigger.step.command'),
                    icon: 'terminal' as const,
                    alert: check.command.trim() === '',
                    testId: 'wl-trigger-step-command',
                  },
                ]),
          ]}
          at={page === 'time' ? 0 : 1}
          onPick={(index) => props.onPage(index === 0 ? 'time' : 'command')}
        />
        <span className={css.recap} data-on={page === 'command'} aria-hidden={page !== 'command'}>
          <SwapText
            text={
              judgeLabel === undefined ? '' : `${ruleText(t, source.schedule)} · ${t(judgeLabel)}`
            }
          />
        </span>
      </div>
      {/* 换步：往后新的一页从右边进来，往回从左边。 */}
      <Staged at={page} order={page === 'time' ? 0 : 1} className={css.staged}>
        {page === 'time' || check === undefined ? (
          <>
            <StageRows>
              <ScheduleField
                t={t}
                schedule={source.schedule}
                plain={check === undefined}
                onChange={(schedule) => props.onChange({ ...source, schedule })}
              />
              <StageRow
                label={t('trigger.checkWhen')}
                note={
                  <FadeStack
                    at={judge}
                    items={JUDGES.map((item) => ({ key: item.value, node: t(item.hint) }))}
                  />
                }
                noteTestId="wl-trigger-check-hint"
              >
                <div className={css.judge}>
                  <Segmented<ScheduleJudge>
                    label={t('trigger.checkWhen')}
                    value={judge}
                    testId="wl-trigger-check-when"
                    fit
                    onChange={setJudge}
                    options={JUDGES.map((item) => ({ value: item.value, label: t(item.label) }))}
                  />
                  <JudgeStrip
                    t={t}
                    when={check?.when ?? kept.current?.when ?? 'every'}
                    off={check === undefined}
                  />
                </div>
              </StageRow>
            </StageRows>
            <WeekBench
              t={t}
              schedule={source.schedule}
              live={props.live}
              checks={check !== undefined}
            />
          </>
        ) : (
          <>
            {env !== null && (
              <StageRows>
                <CwdRow
                  t={t}
                  env={env}
                  node={props.node}
                  draft={props.run.cwd}
                  workspace={props.run.workspace}
                />
              </StageRows>
            )}
            <CommandBox
              t={t}
              node={props.node}
              kind="check"
              title={t('trigger.command')}
              command={check.command}
              placeholder="node check.mjs"
              templates={CHECK_TEMPLATES}
              env={env}
              workspace={runWorkspace(env, props.run.workspace)}
              cwd={props.run.cwd.value}
              shell={props.run.shell}
              recent={props.showOutput}
              judge={trialJudge(t, check)}
              onChange={(command) => setCheck({ command })}
              onTemplate={(template) =>
                setCheck({ command: template.command, when: template.when ?? check.when })
              }
            />
          </>
        )}
      </Staged>
    </>
  )
}

/** 试运行的结果按判定读：输出变化要和上一次比，试一次说不出满足没有。 */
function trialJudge(
  t: T,
  check: TriggerCheck,
): (result: TriggerTryResponse) => { tone: 'ok' | 'off'; text: string } {
  return (result) =>
    check.when === 'change'
      ? { tone: 'ok', text: t('trigger.try.changeNote') }
      : result.code === 0
        ? { tone: 'ok', text: t('trigger.try.met') }
        : { tone: 'off', text: t('trigger.try.unmet') }
}

/** 接下来 7 天的时间轴，顶栏右边写 7 天内还要执行（检查）几次、按哪个时区。 */
function WeekBench(props: {
  t: T
  schedule: TriggerSchedule
  live?: number | undefined
  /** 到点先跑命令检查（次数写成「检查」）。 */
  checks: boolean
}): React.JSX.Element {
  const { t } = props
  /** 时间轴照着排的规则：连着在变时等停下。 */
  const schedule = useSettled(props.schedule, WEEK_SETTLE_MS, { leading: true })
  const now = Date.now()
  const week = weekOf(schedule, now, props.live)
  const valid = scheduleIssue(schedule) === null
  return (
    <Bench
      icon="clock"
      title={t('trigger.week')}
      fill
      tools={
        <span className={benchAside}>
          <SwapText
            text={[
              valid
                ? t(props.checks ? 'trigger.week.checks' : 'trigger.week.total').replace(
                    '{n}',
                    String(week.upcoming),
                  )
                : '',
              t('trigger.upcoming.zone').replace('{zone}', zoneText(now)),
            ]
              .filter((part) => part !== '')
              .join(' · ')}
          />
        </span>
      }
    >
      <WeekStrip t={t} week={week} valid={valid} />
    </Bench>
  )
}
