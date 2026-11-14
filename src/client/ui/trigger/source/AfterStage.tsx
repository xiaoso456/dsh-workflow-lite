/**
 * dsh-workflow-lite — 「触发方式」对话框里接续的设置：上面两张工作流卡片连一条线（线色和画布上同一套：
 * 成功绿、失败红、不论结果蓝），下面左边挑等哪个工作流、右边挑什么结果时。
 *
 * - 工作流列表带搜索，每行写最近一次执行的结果和几张卡片；没开「记录运行状态」的看不出什么时候跑完，
 *   那一行选不了，行尾「去打开」问一句后替它打开（改的是那个工作流的设置）。
 * - 选中的那一个不在列表里（改了名、删了，或者在实例视图里）也照样列出来。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/AfterStage
 */

import { useEffect, useState } from 'react'
import { afterWhen } from '../../../../shared/trigger.ts'
import type { AfterWhen, TriggerSource } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { momentText } from '../../../model/triggerText.ts'
import { ChoiceCards } from '../../kit/ChoiceCards.tsx'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { WHEN_COLOR } from '../../kit/lineColors.ts'
import { CheckBox } from '../../motion/marks.tsx'
import { TriggerMark } from '../TriggerMark.tsx'
import type { LastRun, TriggerEnv, WorkflowChoice } from '../triggerEnv.ts'
import css from './after.module.css'
import stage from './sourceStage.module.css'

type After = Extract<TriggerSource, { kind: 'after' }>

const RESULTS: readonly { value: AfterWhen; label: LocaleKey; line: 'pass' | 'fail' | 'always' }[] =
  [
    { value: 'done', label: 'trigger.afterWhen.done', line: 'pass' },
    { value: 'failed', label: 'trigger.afterWhen.failed', line: 'fail' },
    { value: 'any', label: 'trigger.afterWhen.any', line: 'always' },
  ]

/** 换结果：「成功时」是缺省，不写进图。 */
function withWhen(source: After, when: AfterWhen): After {
  const { when: _old, ...rest } = source
  return when === 'done' ? rest : { ...rest, when }
}

export function AfterStage(props: {
  t: T
  source: After
  env: TriggerEnv | null
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source, env } = props
  const when = afterWhen(source)
  const known = env?.workflows ?? []
  const choices: readonly WorkflowChoice[] =
    source.workflow === '' || known.some((item) => item.name === source.workflow)
      ? known
      : [{ name: source.workflow, runState: true, nodes: 0 }, ...known]
  const picked = choices.find((item) => item.name === source.workflow)
  const [runs, setRuns] = useState<ReadonlyMap<string, LastRun>>(new Map())
  useEffect(() => {
    if (env === null) return
    let alive = true
    void env.lastRuns().then((value) => {
      if (alive) setRuns(value)
    })
    return () => {
      alive = false
    }
  }, [env])
  const line = WHEN_COLOR[RESULTS.find((item) => item.value === when)?.line ?? 'pass']
  const noState = known.find((item) => item.name === source.workflow)?.runState === false
  return (
    <>
      <div className={css.chain} style={{ '--line': line } as React.CSSProperties}>
        <div className={css.wf} data-empty={picked === undefined}>
          <span className={css.wfName}>
            <span className={css.wfIcon}>
              <Icon name="hub" size={12} />
            </span>
            <span className={css.ellipsis}>{picked?.name ?? t('trigger.afterNone')}</span>
          </span>
          <span className={css.wfSub}>
            {picked === undefined ? '' : <LastText t={t} run={runs.get(picked.name)} />}
          </span>
        </div>
        <span className={css.edge} data-empty={picked === undefined}>
          <span className={css.edgeLabel}>
            {t(RESULTS.find((item) => item.value === when)?.label ?? 'trigger.afterWhen.done')}
          </span>
        </span>
        <div className={css.wf} data-self="true">
          <span className={css.wfName}>
            <TriggerMark kind="after" size={11} className={css.wfMark} />
            <span className={css.ellipsis}>{env?.workflow || t('trigger.afterThis')}</span>
          </span>
          <span className={css.wfSub}>{t('trigger.afterThis')}</span>
        </div>
      </div>

      <div className={cx(stage.pair, stage.pairWide)}>
        <section className={stage.section}>
          <p className={stage.head}>{t('trigger.afterPick')}</p>
          <WorkflowList
            t={t}
            env={env}
            choices={choices}
            runs={runs}
            value={source.workflow}
            onPick={(workflow) => props.onChange({ ...source, workflow })}
          />
          <p className={stage.error} data-testid="wl-trigger-after-state">
            {noState ? t('trigger.afterNeedsState').replace('{name}', source.workflow) : ''}
          </p>
        </section>
        <section className={stage.section}>
          <p className={stage.head}>{t('trigger.afterResult')}</p>
          <ChoiceCards<AfterWhen>
            label={t('trigger.afterWhen')}
            value={when}
            testId="wl-trigger-after-when"
            onChange={(next) => props.onChange(withWhen(source, next))}
            options={RESULTS.map((item) => ({
              value: item.value,
              label: t(item.label),
              color: WHEN_COLOR[item.line],
            }))}
          />
        </section>
      </div>
      <p className={stage.note}>
        <Icon name="info" size={13} />
        <span>{t('trigger.afterHint')}</span>
      </p>
    </>
  )
}

/** 最近一次执行：「今天 08:12 完成」；没执行过写「还没执行过」。 */
function LastText(props: { t: T; run: LastRun | undefined }): React.JSX.Element {
  const { t, run } = props
  if (run === undefined) return <>{t('trigger.afterNever')}</>
  const status = run.status === undefined ? '' : t(`run.status.${run.status}` as LocaleKey)
  return (
    <>
      <span className={css.dot} data-status={run.status} />
      {`${momentText(t, run.at)} ${status}`.trim()}
    </>
  )
}

/** 工作流列表：搜索框 + 一行一个（勾选圈、名字、最近一次、几张卡片 / 「去打开」）。 */
function WorkflowList(props: {
  t: T
  env: TriggerEnv | null
  choices: readonly WorkflowChoice[]
  runs: ReadonlyMap<string, LastRun>
  value: string
  onPick(workflow: string): void
}): React.JSX.Element {
  const { t, choices } = props
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown =
    needle === '' ? choices : choices.filter((item) => item.name.toLowerCase().includes(needle))
  return (
    <div className={css.list} data-testid="wl-trigger-after">
      <label className={css.search}>
        <Icon name="search" size={13} />
        <input
          className={css.searchInput}
          value={query}
          placeholder={t('trigger.afterSearch')}
          aria-label={t('trigger.afterSearch')}
          data-testid="wl-trigger-after-search"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className={css.rows} role="radiogroup" aria-label={t('trigger.afterPick')}>
        {shown.map((item) => (
          <WorkflowRow
            key={item.name}
            t={t}
            env={props.env}
            item={item}
            run={props.runs.get(item.name)}
            on={item.name === props.value}
            onPick={() => props.onPick(item.name)}
          />
        ))}
        <p className={css.empty} hidden={shown.length > 0}>
          {choices.length === 0 ? t('trigger.afterEmpty') : t('trigger.afterNoMatch')}
        </p>
      </div>
    </div>
  )
}

function WorkflowRow(props: {
  t: T
  env: TriggerEnv | null
  item: WorkflowChoice
  run: LastRun | undefined
  on: boolean
  onPick(): void
}): React.JSX.Element {
  const { t, item, env } = props
  const confirm = useConfirm<HTMLButtonElement>()
  const [problem, setProblem] = useState<string | null>(null)
  const usable = item.runState || props.on
  return (
    <div className={css.row} data-on={props.on} data-off={!item.runState || undefined}>
      <button
        type="button"
        role="radio"
        aria-checked={props.on}
        className={css.pick}
        disabled={!usable}
        data-testid={`wl-trigger-after-${item.name}`}
        onClick={props.onPick}
      >
        <CheckBox on={props.on} className={css.check} />
        <span className={css.name}>{item.name}</span>
        <span className={css.last}>
          {item.runState ? (
            <LastText t={t} run={props.run} />
          ) : (
            (problem ?? t('trigger.afterStateOff'))
          )}
        </span>
      </button>
      {item.runState || env === null ? (
        <span className={css.steps}>
          {item.nodes > 0 ? t('trigger.afterNodes').replace('{n}', String(item.nodes)) : ''}
        </span>
      ) : (
        <>
          <button
            ref={confirm.anchorRef}
            type="button"
            className={css.enable}
            data-testid={`wl-trigger-after-enable-${item.name}`}
            onClick={confirm.toggle}
          >
            {t('trigger.afterEnable')}
          </button>
          {confirm.render({
            t,
            title: t('trigger.afterEnableTitle').replace('{name}', item.name),
            desc: t('trigger.afterEnableDesc'),
            confirmText: t('trigger.afterEnableConfirm'),
            danger: false,
            testId: `wl-trigger-after-enable-confirm-${item.name}`,
            onConfirm: () => {
              void env.enableRunState(item.name).then(setProblem)
            },
          })}
        </>
      )}
    </div>
  )
}
