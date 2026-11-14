/**
 * dsh-workflow-lite — 「触发方式」对话框里轮询的设置：命令（模板、试运行、最近几次的输出）、间隔、判定方式。
 *
 * 判定方式两张卡片各带一小排格子，画出一串检查里哪几次会触发：成功时触发是「失败 → 成功」那一下，
 * 输出变了时触发是和上一次不一样的那一下。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/PollStage
 */

import { pollWhen } from '../../../../shared/trigger.ts'
import type { PollWhen, TriggerSource } from '../../../../shared/types.ts'
import type { TriggerTryResponse } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { POLL_TEMPLATES } from '../../../model/commandTemplates.ts'
import { ChoiceCards } from '../../kit/ChoiceCards.tsx'
import { Icon } from '../../kit/Icon.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { CommandBox } from './CommandBox.tsx'
import { IntervalField } from './IntervalField.tsx'
import css from './sourceStage.module.css'
import spark from './spark.module.css'

type Poll = Extract<TriggerSource, { kind: 'poll' }>

/** 换判定方式：「成功时」是缺省，不写进图。 */
function withWhen(source: Poll, when: PollWhen): Poll {
  const { when: _old, ...rest } = source
  return when === 'change' ? { ...rest, when } : rest
}

/** 一小排格子：每格一次检查，触发的那几格描边。 */
function Spark(props: {
  cells: readonly { text: string; tone?: 'ok' | 'no'; fire?: true }[]
}): React.JSX.Element {
  return (
    <span className={spark.row} aria-hidden="true">
      {props.cells.map((cell, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 固定的示意，不会变
        <span key={index} className={spark.cell} data-tone={cell.tone} data-fire={cell.fire}>
          {cell.text}
        </span>
      ))}
      <span className={spark.count}>
        <Icon name="bolt" size={10} />
        ×2
      </span>
    </span>
  )
}

const NO = { text: '✕', tone: 'no' } as const
const OK = { text: '✓', tone: 'ok' } as const
const FIRE_OK = { ...OK, fire: true } as const

export function PollStage(props: {
  t: T
  node: string
  source: Poll
  env: TriggerEnv | null
  /** 放不放最近的输出（草稿的命令和跑着的那条一样才放）。 */
  showOutput: boolean
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source } = props
  const when = pollWhen(source)
  const judge = (result: TriggerTryResponse): { tone: 'ok' | 'off'; text: string } =>
    when === 'change'
      ? { tone: 'ok', text: t('trigger.try.changeNote') }
      : result.code === 0
        ? { tone: 'ok', text: t('trigger.try.met') }
        : { tone: 'off', text: t('trigger.try.unmet') }
  return (
    <>
      <CommandBox
        t={t}
        node={props.node}
        kind="poll"
        command={source.command}
        placeholder="git ls-remote origin -h refs/heads/main"
        templates={POLL_TEMPLATES}
        env={props.env}
        recent={props.showOutput}
        judge={judge}
        onChange={(command) => props.onChange({ ...source, command })}
        onTemplate={(template) =>
          props.onChange(withWhen({ ...source, command: template.command }, template.when ?? when))
        }
      />
      <div className={css.pair}>
        <IntervalField
          t={t}
          seconds={source.seconds}
          onChange={(seconds) => props.onChange({ ...source, seconds })}
        />
        <section className={css.section}>
          <p className={css.head}>{t('trigger.pollWhenTitle')}</p>
          <ChoiceCards<PollWhen>
            label={t('trigger.pollWhen')}
            value={when}
            testId="wl-trigger-poll-when"
            onChange={(next) => props.onChange(withWhen(source, next))}
            options={[
              {
                value: 'success',
                label: t('trigger.pollWhen.success'),
                desc: t('trigger.pollHint.success'),
                extra: <Spark cells={[NO, NO, FIRE_OK, OK, NO, FIRE_OK]} />,
              },
              {
                value: 'change',
                label: t('trigger.pollWhen.change'),
                desc: t('trigger.pollHint.change'),
                extra: (
                  <Spark
                    cells={[
                      { text: 'A' },
                      { text: 'A' },
                      { text: 'B', fire: true },
                      { text: 'B' },
                      { text: 'C', fire: true },
                      { text: 'C' },
                    ]}
                  />
                ),
              },
            ]}
          />
        </section>
      </div>
      <p className={css.note}>
        <Icon name="info" size={13} />
        <span>{t('trigger.commandHint')}</span>
      </p>
    </>
  )
}
