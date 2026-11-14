/**
 * dsh-workflow-lite — 命令工作台的下半：输出台。顶上两个页签「试运行 / 最近的输出」，右边是试运行的小结
 * （退出码、满足没有、用时）；下面是选中那一页的输出，多了在框里滚。
 *
 * - 试运行：没跑过时说点「试运行」会怎样；跑着时一个转圈；跑完是输出（请求本身失败时是原因）。
 * - 最近的输出：保存着的那条命令跑出来的；草稿里改过命令（或换了方式）时这一页点不动，悬停说为什么。
 *
 * 两页都挂着、只切 `hidden`：切页签不重挂「最近的输出」（它挂上就读一次）；露出来的那一页淡入。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/TrialConsole
 */

import type { TriggerTryResponse } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { Icon } from '../../kit/Icon.tsx'
import { RecentOutput } from '../RecentOutput.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { BenchTabs } from './Bench.tsx'
import css from './trialConsole.module.css'

/** 试运行的样子：没跑过、正在跑、跑完了、请求本身失败。 */
export type Trial =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: TriggerTryResponse }
  | { kind: 'error'; message: string }

export type ConsoleTab = 'try' | 'recent'

/** 轮询怎么读试运行的结果（满足没有）。 */
export type TrialJudge = (result: TriggerTryResponse) => { tone: 'ok' | 'off'; text: string }

export function TrialConsole(props: {
  t: T
  env: TriggerEnv
  node: string
  kind: 'poll' | 'listen'
  trial: Trial
  judge: TrialJudge | undefined
  /** 「最近的输出」这一页有没有内容（草稿的命令和保存着的一样才有）。 */
  recent: boolean
  tab: ConsoleTab
  onTab(tab: ConsoleTab): void
}): React.JSX.Element {
  const { t, trial } = props
  const tab = props.recent ? props.tab : 'try'
  return (
    <section className={css.console}>
      <div className={css.bar}>
        <BenchTabs<ConsoleTab>
          label={t('trigger.try.console')}
          value={tab}
          options={[
            { value: 'try', label: t('trigger.cmd.try'), testId: 'wl-trigger-tab-try' },
            {
              value: 'recent',
              label: t('trigger.output'),
              testId: 'wl-trigger-tab-recent',
              ...(props.recent ? {} : { off: t('trigger.outputStale') }),
            },
          ]}
          onChange={props.onTab}
        />
        {tab === 'try' && (
          <TrialSummary t={t} kind={props.kind} trial={trial} judge={props.judge} />
        )}
      </div>
      <div className={css.page} role="tabpanel" hidden={tab !== 'try'}>
        <TrialBody t={t} trial={trial} />
      </div>
      {props.recent && (
        <div
          className={css.page}
          role="tabpanel"
          hidden={tab !== 'recent'}
          data-testid="wl-trigger-output"
        >
          <RecentOutput t={t} env={props.env} node={props.node} className={css.output} />
        </div>
      )}
    </section>
  )
}

/** 页签那一行右边：试运行的小结（没跑过、跑着时没有）。太长时截断，悬停看全。 */
function TrialSummary(props: {
  t: T
  kind: 'poll' | 'listen'
  trial: Trial
  judge: TrialJudge | undefined
}): React.JSX.Element | null {
  const { t, trial } = props
  if (trial.kind === 'idle' || trial.kind === 'running') return null
  const verdict = verdictOf(t, props.kind, trial, props.judge)
  const full = [verdict.badge, verdict.text].filter((part) => part !== '').join(' · ')
  return (
    <span
      className={css.summary}
      data-tone={verdict.tone}
      data-tip={full}
      data-testid="wl-trigger-try-result"
    >
      <span className={css.badge}>{verdict.badge}</span>
      {verdict.text !== '' && <span className={css.summaryText}>{verdict.text}</span>}
    </span>
  )
}

function verdictOf(
  t: T,
  kind: 'poll' | 'listen',
  trial: Extract<Trial, { kind: 'done' | 'error' }>,
  judge: TrialJudge | undefined,
): { tone: 'ok' | 'off' | 'bad'; badge: string; text: string } {
  if (trial.kind === 'error') return { tone: 'bad', badge: t('trigger.try.failed'), text: '' }
  const { result } = trial
  const seconds = (result.ms / 1000).toFixed(result.ms < 10_000 ? 1 : 0)
  if (result.failure !== undefined) {
    return { tone: 'bad', badge: t('trigger.try.failed'), text: result.failure }
  }
  if (kind === 'listen') {
    return {
      tone: 'ok',
      badge: t('trigger.try.lines')
        .replace('{n}', String(result.lines ?? 0))
        .replace('{s}', seconds),
      text: result.stopped === true ? '' : t('trigger.try.exited'),
    }
  }
  const judged = judge?.(result)
  return {
    tone: judged?.tone ?? 'ok',
    badge: t('trigger.try.code').replace('{code}', String(result.code)),
    text: [judged?.text, t('trigger.try.took').replace('{s}', seconds)]
      .filter((part) => part !== undefined && part !== '')
      .join(' · '),
  }
}

/** 试运行这一页的内容：说明、转圈、输出、或请求失败的原因。 */
function TrialBody(props: { t: T; trial: Trial }): React.JSX.Element {
  const { t, trial } = props
  if (trial.kind === 'idle') {
    return (
      <div className={css.empty}>
        <Icon name="terminal" size={20} />
        <span className={css.emptyTitle}>{t('trigger.try.empty')}</span>
        <span>{t('trigger.try.emptyHint')}</span>
      </div>
    )
  }
  if (trial.kind === 'running') {
    return (
      <div className={css.empty} aria-live="polite">
        <span className={css.spinner} aria-hidden="true" />
        <span>{t('trigger.cmd.trying')}</span>
      </div>
    )
  }
  if (trial.kind === 'error') {
    return (
      <pre className={css.output} data-tone="bad" role="alert">
        {trial.message}
      </pre>
    )
  }
  return (
    <pre className={css.output} data-testid="wl-trigger-try-output">
      {trial.result.output === '' ? t('trigger.try.noOutput') : trial.result.output}
    </pre>
  )
}
