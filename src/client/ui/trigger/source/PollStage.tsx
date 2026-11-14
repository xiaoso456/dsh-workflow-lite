/**
 * dsh-workflow-lite — 「触发方式」对话框里轮询的设置：设置行是间隔、判定（执行成功 / 输出变化，旁边一排示意、
 * 下面一句说明）、工作区，工作台是命令（模板、试运行、最近的输出）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/PollStage
 */

import { pollWhen } from '../../../../shared/trigger.ts'
import type { PollWhen, TriggerSource } from '../../../../shared/types.ts'
import type { TriggerTryResponse } from '../../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { POLL_TEMPLATES } from '../../../model/commandTemplates.ts'
import { Segmented } from '../../kit/Segmented.tsx'
import { FadeStack } from '../../motion/stage.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { CommandBox } from './CommandBox.tsx'
import { IntervalField } from './IntervalField.tsx'
import { JudgeStrip } from './JudgeStrip.tsx'
import type { RunDrafts } from './runDraft.ts'
import { StageRow, StageRows } from './StageRow.tsx'
import css from './sourceStage.module.css'
import { runWorkspace, WorkspaceRow } from './WorkspaceRow.tsx'

type Poll = Extract<TriggerSource, { kind: 'poll' }>

const WHENS: readonly { value: PollWhen; label: LocaleKey; hint: LocaleKey }[] = [
  { value: 'every', label: 'trigger.pollWhen.every', hint: 'trigger.pollHint.every' },
  { value: 'success', label: 'trigger.pollWhen.success', hint: 'trigger.pollHint.success' },
  { value: 'change', label: 'trigger.pollWhen.change', hint: 'trigger.pollHint.change' },
]

/** 换判定方式：「变为成功」不写进图（早先的卡片都这样存，见 PollWhen），另两种写进去。 */
function withWhen(source: Poll, when: PollWhen): Poll {
  const { when: _old, ...rest } = source
  return when === 'success' ? rest : { ...rest, when }
}

export function PollStage(props: {
  t: T
  node: string
  source: Poll
  env: TriggerEnv | null
  /** 工作区、shell 的草稿。 */
  run: RunDrafts
  /** 放不放最近的输出（草稿的命令和跑着的那条一样才放）。 */
  showOutput: boolean
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source, env } = props
  const when = pollWhen(source)
  const judge = (result: TriggerTryResponse): { tone: 'ok' | 'off'; text: string } =>
    when === 'change'
      ? { tone: 'ok', text: t('trigger.try.changeNote') }
      : result.code === 0
        ? { tone: 'ok', text: t('trigger.try.met') }
        : { tone: 'off', text: t('trigger.try.unmet') }
  return (
    <>
      <StageRows>
        <IntervalField
          t={t}
          seconds={source.seconds}
          onChange={(seconds) => props.onChange({ ...source, seconds })}
        />
        <StageRow
          label={t('trigger.pollWhen')}
          note={
            <FadeStack
              at={when}
              items={WHENS.map((item) => ({ key: item.value, node: t(item.hint) }))}
            />
          }
          noteTestId="wl-trigger-poll-hint"
        >
          <div className={css.judge}>
            <Segmented<PollWhen>
              label={t('trigger.pollWhen')}
              value={when}
              testId="wl-trigger-poll-when"
              onChange={(next) => props.onChange(withWhen(source, next))}
              options={WHENS.map((item) => ({ value: item.value, label: t(item.label) }))}
            />
            <JudgeStrip t={t} when={when} />
          </div>
        </StageRow>
        {env !== null && (
          <WorkspaceRow
            t={t}
            env={env}
            value={props.run.workspace.value}
            saved={props.run.workspace.saved}
            onChange={props.run.workspace.onChange}
          />
        )}
      </StageRows>
      <CommandBox
        t={t}
        node={props.node}
        kind="poll"
        title={t('trigger.command')}
        command={source.command}
        placeholder="git ls-remote origin -h refs/heads/main"
        templates={POLL_TEMPLATES}
        env={env}
        workspace={runWorkspace(env, props.run.workspace)}
        shell={props.run.shell}
        recent={props.showOutput}
        judge={judge}
        onChange={(command) => props.onChange({ ...source, command })}
        onTemplate={(template) =>
          props.onChange(withWhen({ ...source, command: template.command }, template.when ?? when))
        }
      />
    </>
  )
}
