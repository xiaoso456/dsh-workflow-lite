/**
 * dsh-workflow-lite — 「触发方式」对话框里接续的设置：设置行是等哪个工作流（一个下拉，展开是带搜索的列表）和什么结果时；
 * 工作台上面两张工作流卡片连一条线（线色和画布上同一套：成功绿、失败红、不论结果蓝），
 * 下面列那个工作流最近几次执行，按现在选的结果标出哪几次会接着执行。
 *
 * - 点一行：选中的淡底先从旧行淡到新行（{@link PICK_HOLD_MS}），淡完才收起列表、下拉框里整行滚动换成新的
 *   （{@link SwapRoll}，新旧两行不叠成残影）——先让人看到点中了哪一行。等着的时候按 Esc、点外面、再点下拉框都是立刻选上并收起；
 *   点的就是已选的那一行、或开着「减少动态效果」，不等。行是整行的按钮，不要按下缩一下的手感；选中只靠淡底，不画勾选圈
 *   （下拉框里本来就写着选的是哪个）。
 * - 列表每行写最近一次执行的结果和几张卡片；没开「记录运行状态」的看不出什么时候跑完，
 *   那一行选不了，行尾「去打开」问一句后替它打开（改的是那个工作流的设置），打开了就直接选上它、收起列表
 *   ——在这里替它打开就是为了选它。问着、打开着的时候列表不收（确认卡在列表外面，点它不算点外面）；
 *   打开着时按钮写「正在打开…」，打不开就留在列表里，那一行写原因。
 * - 选中的那一个不在列表里（改了名、删了，或者在实例视图里）也照样列出来。
 * - 从没选到选上：名字、最近一次是叠在同一格的两层交叉淡；换一个是整行滚动换。左边卡片的虚框、线的虚线是叠层换透明度，
 *   下面的执行列表整块交接（{@link Staged}）——没有哪一块瞬换。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/AfterStage
 */

import { useEffect, useRef, useState } from 'react'
import { afterWhen } from '../../../../shared/trigger.ts'
import type { AfterWhen, TriggerSource } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { AFTER_VERDICT_TEXT, afterVerdict } from '../../../model/afterRuns.ts'
import { momentText } from '../../../model/triggerText.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { HelpTip } from '../../kit/HelpTip.tsx'
import { Icon } from '../../kit/Icon.tsx'
import { WHEN_COLOR } from '../../kit/lineColors.ts'
import { Popover } from '../../kit/Popover.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import ui from '../../kit/ui.module.css'
import { REDUCED } from '../../motion/shared.ts'
import { FadeStack, Staged } from '../../motion/stage.tsx'
import { SwapRoll, SwapText } from '../../motion/swapText.tsx'
import { TriggerMark } from '../TriggerMark.tsx'
import type { RunBrief, TriggerEnv, WorkflowChoice } from '../triggerEnv.ts'
import css from './after.module.css'
import { Bench, benchAside } from './Bench.tsx'
import { StageRow, StageRows } from './StageRow.tsx'

type After = Extract<TriggerSource, { kind: 'after' }>

/** 点了一行之后等多久再收起列表：选中的淡底从旧行淡到新行的时长（同 after.module.css 的 `.row::after`）。 */
const PICK_HOLD_MS = 140

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
    source.workflow === '' || known.some((item) => item.workflowId === source.workflow)
      ? known
      : [
          {
            workflowId: source.workflow,
            name: t('trigger.afterMissing'),
            runState: true,
            nodes: 0,
          },
          ...known,
        ]
  const picked = choices.find((item) => item.workflowId === source.workflow)
  const [runs, setRuns] = useState<ReadonlyMap<string, readonly RunBrief[]>>(new Map())
  useEffect(() => {
    if (env === null) return
    let alive = true
    void env.recentRuns().then((value) => {
      if (alive) setRuns(value)
    })
    return () => {
      alive = false
    }
  }, [env])
  const result = RESULTS.find((item) => item.value === when)
  const line = WHEN_COLOR[result?.line ?? 'pass']
  const noState = picked?.runState === false
  const pickedRuns = picked === undefined ? undefined : runs.get(picked.workflowId)
  return (
    <>
      <StageRows>
        <StageRow
          label={t('trigger.afterLead')}
          note={noState ? t('trigger.afterNeedsState').replace('{name}', picked.name) : ''}
          problem
          noteTestId="wl-trigger-after-state"
        >
          <WorkflowPicker
            t={t}
            env={env}
            choices={choices}
            runs={runs}
            value={source.workflow}
            onPick={(workflow) => props.onChange({ ...source, workflow })}
          />
        </StageRow>
        <StageRow
          label={t('trigger.afterWhen')}
          help={
            <HelpTip label={t('trigger.afterResultHelp')} testId="wl-trigger-after-when-help">
              <ResultHelp t={t} />
            </HelpTip>
          }
        >
          <Segmented<AfterWhen>
            label={t('trigger.afterResult')}
            value={when}
            testId="wl-trigger-after-when"
            onChange={(next) => props.onChange(withWhen(source, next))}
            options={RESULTS.map((item) => ({
              value: item.value,
              label: t(item.label),
              color: WHEN_COLOR[item.line],
            }))}
          />
        </StageRow>
      </StageRows>
      <Bench
        icon="after"
        title={t('trigger.afterRuns')}
        tools={<span className={benchAside}>{t('trigger.afterRunsAside')}</span>}
        foot={t('trigger.afterFoot')}
        testId="wl-trigger-after-bench"
      >
        <div className={css.flow} style={{ '--line': line } as React.CSSProperties}>
          <div className={css.chain}>
            <div className={css.wf} data-empty={picked === undefined}>
              <span className={css.wfName}>
                <span className={css.wfIcon}>
                  <Icon name="hub" size={12} />
                </span>
                <PickedName t={t} name={picked?.name} className={css.wfNameText} />
              </span>
              <span className={css.wfSub}>
                <PickedLast t={t} workflowId={picked?.workflowId} runs={runs} />
              </span>
            </div>
            <span className={css.edge} data-empty={picked === undefined}>
              <span className={css.edgeDash} aria-hidden="true" />
              <span className={css.edgeLabel}>
                <SwapText text={t(result?.label ?? 'trigger.afterWhen.done')} />
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
          <Staged
            at={`${picked?.name ?? ''}|${pickedRuns === undefined ? '' : pickedRuns.map((run) => run.id).join()}`}
            order={0}
          >
            <RunList t={t} source={source} picked={picked !== undefined} runs={pickedRuns} />
          </Staged>
        </div>
      </Bench>
    </>
  )
}

/** 「结果」旁「?」里的说明：三个选项各一行（选项名带线色圆点，和分段控件里一样），下面一句前提。 */
function ResultHelp(props: { t: T }): React.JSX.Element {
  const { t } = props
  return (
    <div className={css.help}>
      <ul className={css.helpList}>
        {RESULTS.map((item) => (
          <li key={item.value} className={css.helpItem}>
            <span className={css.helpName}>
              <span className={css.helpDot} style={{ background: WHEN_COLOR[item.line] }} />
              {t(item.label)}
            </span>
            <span>{t(`trigger.afterResultTip.${item.value}` as LocaleKey)}</span>
          </li>
        ))}
      </ul>
      <p className={css.helpNote}>{t('trigger.afterResultTip.note')}</p>
    </div>
  )
}

/** 那个工作流最近几次执行：结果圆点、时刻、结果，行尾按现在的设置写会不会接着执行。 */
function RunList(props: {
  t: T
  source: After
  picked: boolean
  runs: readonly RunBrief[] | undefined
}): React.JSX.Element {
  const { t, source, runs } = props
  if (!props.picked || runs === undefined || runs.length === 0) {
    return (
      <p className={css.runsEmpty} data-testid="wl-trigger-after-runs">
        {t(props.picked ? 'trigger.afterNever' : 'trigger.afterRunsPick')}
      </p>
    )
  }
  return (
    <ul className={css.runs} data-testid="wl-trigger-after-runs">
      {runs.map((run) => {
        const verdict = afterVerdict(source, run)
        const fires = verdict === 'fires'
        return (
          <li key={run.id} className={css.run} data-fires={fires}>
            <span className={css.dot} data-status={run.status} />
            <span className={css.runAt}>{momentText(t, run.at)}</span>
            <span className={css.runStatus}>
              {run.status === undefined ? '' : t(`run.status.${run.status}` as LocaleKey)}
            </span>
            <span className={css.runVerdict}>
              {fires && <Icon name="bolt" size={11} />}
              {t(AFTER_VERDICT_TEXT[verdict])}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** 等哪个工作流：一个像下拉框的按钮（名字 + 最近一次），点开是带搜索的列表。 */
function WorkflowPicker(props: {
  t: T
  env: TriggerEnv | null
  choices: readonly WorkflowChoice[]
  runs: ReadonlyMap<string, readonly RunBrief[]>
  value: string
  onPick(workflow: string): void
}): React.JSX.Element {
  const { t, env } = props
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const picked = props.choices.find((item) => item.workflowId === props.value)
  // 「去打开」：一张确认卡，挂在问着的那一行的按钮上。
  const enable = useConfirm<HTMLButtonElement>()
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map())
  // 点了、还在等淡底走完的那一行：列表先按它画选中，到点（或提前收起）才真的选上。
  const [pending, setPending] = useState<string | null>(null)
  const hold = useRef<number | null>(null)
  const onPick = useRef(props.onPick)
  onPick.current = props.onPick
  useEffect(
    () => () => {
      if (hold.current !== null) window.clearTimeout(hold.current)
    },
    [],
  )
  const commit = (workflow: string): void => {
    if (hold.current !== null) window.clearTimeout(hold.current)
    hold.current = null
    setPending(null)
    setOpen(false)
    onPick.current(workflow)
  }
  const pick = (workflow: string): void => {
    if (workflow === props.value || REDUCED?.matches === true) {
      commit(workflow)
      return
    }
    setPending(workflow)
    if (hold.current !== null) window.clearTimeout(hold.current)
    hold.current = window.setTimeout(() => commit(workflow), PICK_HOLD_MS)
  }
  const close = (): void => {
    if (pending !== null) commit(pending)
    else setOpen(false)
  }
  const turnOn = (name: string): void => {
    if (env === null) return
    setBusy(name)
    void env.enableRunState(name).then((problem) => {
      setBusy(null)
      if (problem === null) {
        const row = props.choices.find((item) => item.name === name)
        if (row !== undefined) pick(row.workflowId)
        return
      }
      setProblems((current) => new Map(current).set(name, problem))
    })
  }
  const enabling: EnableState = {
    busy,
    problems,
    anchorFor: (name) => (asking === name ? enable.anchorRef : undefined),
    onAsk: (name) => {
      if (enable.open && asking === name) {
        enable.hide()
        return
      }
      setAsking(name)
      enable.show()
    },
  }
  return (
    <>
      <Popover
        open={open}
        wide
        hold={enable.open || busy !== null}
        onClose={() => {
          close()
          button.current?.focus({ preventScroll: true })
        }}
        label={t('trigger.afterPick')}
        className={css.pop}
        trigger={
          <button
            ref={button}
            type="button"
            className={cx(ui.input, css.picker)}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-empty={picked === undefined}
            data-testid="wl-trigger-after-pick"
            onClick={() => (open ? close() : setOpen(true))}
          >
            <PickedLine t={t} picked={picked} choices={props.choices} runs={props.runs} />
            <Icon name="chevronDown" size={13} />
          </button>
        }
      >
        <WorkflowList
          t={t}
          env={props.env}
          choices={props.choices}
          runs={props.runs}
          value={pending ?? props.value}
          enabling={enabling}
          onPick={pick}
        />
      </Popover>
      {asking !== null &&
        enable.render({
          t,
          title: t('trigger.afterEnableTitle').replace('{name}', asking),
          desc: t('trigger.afterEnableDesc'),
          confirmText: t('trigger.afterEnableConfirm'),
          danger: false,
          testId: `wl-trigger-after-enable-confirm-${asking}`,
          onConfirm: () => turnOn(asking),
        })}
    </>
  )
}

/** 「去打开」的进度：问着哪一行（确认卡挂在它的按钮上）、正在替哪一张打开、哪几张打不开（原因）。 */
interface EnableState {
  busy: string | null
  problems: ReadonlyMap<string, string>
  anchorFor(name: string): React.RefObject<HTMLButtonElement> | undefined
  onAsk(name: string): void
}

/**
 * 下拉框里那一行（名字 + 最近一次）：没选时是灰的「选一个工作流」，和选上的那一行叠在同一格交叉淡；
 * 换一个工作流时名字和最近一次当一整行滚动换（{@link SwapRoll}），附注不会被宽窄不同的名字先推一下。
 */
function PickedLine(props: {
  t: T
  picked: WorkflowChoice | undefined
  choices: readonly WorkflowChoice[]
  runs: ReadonlyMap<string, readonly RunBrief[]>
}): React.JSX.Element {
  const { t } = props
  const last = useLatest(props.picked)
  return (
    <FadeStack
      at={props.picked === undefined ? 'none' : 'picked'}
      className={css.pickedLine}
      items={[
        {
          key: 'none',
          node: <span className={cx(css.ellipsis, css.placeholder)}>{t('trigger.afterNone')}</span>,
        },
        {
          key: 'picked',
          node:
            last === undefined ? null : (
              <SwapRoll
                id={last.workflowId}
                className={css.pickedRow}
                render={(id) => (
                  <>
                    <span className={css.pickerName}>
                      {id === last.workflowId
                        ? last.name
                        : props.choices.find((choice) => choice.workflowId === id)?.name}
                    </span>
                    <span className={cx(css.last, css.pickerLast)}>
                      <LastText t={t} run={props.runs.get(id)?.[0]} />
                    </span>
                  </>
                )}
              />
            ),
        },
      ]}
    />
  )
}

/**
 * 工作台卡片上的名字：没选时是灰的「选一个工作流」，选上是粗体名字——两层叠在同一格交叉淡（颜色、字重各是各的，不瞬换）；
 * 换一个工作流时整行滚动换（同下拉框，见 {@link PickedLine}）。
 */
function PickedName(props: {
  t: T
  name: string | undefined
  className: string
}): React.JSX.Element {
  const { t } = props
  const last = useLatest(props.name)
  return (
    <FadeStack
      at={props.name === undefined ? 'none' : 'picked'}
      className={cx(css.pickedStack, props.className)}
      items={[
        {
          key: 'none',
          node: <span className={cx(css.ellipsis, css.placeholder)}>{t('trigger.afterNone')}</span>,
        },
        {
          key: 'picked',
          node: <SwapRoll id={last ?? ''} className={css.ellipsis} render={(name) => name} />,
        },
      ]}
    />
  )
}

/** 工作台卡片上那个工作流最近一次执行：没选时是空的，选上淡进来、换一个滚动换（同 {@link PickedName}）。 */
function PickedLast(props: {
  t: T
  workflowId: string | undefined
  runs: ReadonlyMap<string, readonly RunBrief[]>
}): React.JSX.Element {
  const last = useLatest(props.workflowId)
  return (
    <FadeStack
      at={props.workflowId === undefined ? 'none' : 'picked'}
      className={css.pickedStack}
      items={[
        { key: 'none', node: null },
        {
          key: 'picked',
          node:
            last === undefined ? null : (
              <SwapRoll
                id={last}
                render={(id) => <LastText t={props.t} run={props.runs.get(id)?.[0]} />}
              />
            ),
        },
      ]}
    />
  )
}

/** 最近一次不是 `undefined` 的值：清空之后那一层还拿着旧的淡出去。 */
function useLatest<V>(value: V | undefined): V | undefined {
  const kept = useRef(value)
  if (value !== undefined) kept.current = value
  return kept.current
}

/** 最近一次执行：「今天 08:12 完成」；没执行过写「还没执行过」。 */
function LastText(props: { t: T; run: RunBrief | undefined }): React.JSX.Element {
  const { t, run } = props
  if (run === undefined) return <span className={css.lastLine}>{t('trigger.afterNever')}</span>
  const status = run.status === undefined ? '' : t(`run.status.${run.status}` as LocaleKey)
  return (
    <span className={css.lastLine}>
      <span className={css.dot} data-status={run.status} />
      {`${momentText(t, run.at)} ${status}`.trim()}
    </span>
  )
}

/** 工作流列表：搜索框 + 一行一个（名字、最近一次、几张卡片 / 「去打开」；选中的那行带淡底）。 */
function WorkflowList(props: {
  t: T
  env: TriggerEnv | null
  choices: readonly WorkflowChoice[]
  runs: ReadonlyMap<string, readonly RunBrief[]>
  value: string
  enabling: EnableState
  onPick(workflow: string): void
}): React.JSX.Element {
  const { t, choices } = props
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown =
    needle === '' ? choices : choices.filter((item) => item.name.toLowerCase().includes(needle))
  return (
    <div className={css.list} data-testid="wl-trigger-after">
      <label className={ui.menuSearch}>
        <Icon name="search" size={13} />
        <input
          className={ui.menuSearchInput}
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
            key={item.workflowId}
            t={t}
            env={props.env}
            item={item}
            run={props.runs.get(item.workflowId)?.[0]}
            on={item.workflowId === props.value}
            enabling={props.enabling}
            onPick={() => props.onPick(item.workflowId)}
          />
        ))}
        <p className={ui.menuEmpty} hidden={shown.length > 0}>
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
  run: RunBrief | undefined
  on: boolean
  enabling: EnableState
  onPick(): void
}): React.JSX.Element {
  const { t, item, env, enabling } = props
  const problem = enabling.problems.get(item.name)
  const busy = enabling.busy === item.name
  const usable = item.runState || props.on
  return (
    <div
      className={css.row}
      data-on={props.on}
      data-off={!item.runState || undefined}
      data-usable={usable}
    >
      <button
        type="button"
        role="radio"
        aria-checked={props.on}
        className={css.pick}
        disabled={!usable}
        data-testid={`wl-trigger-after-${item.name}`}
        onClick={props.onPick}
      >
        <span className={css.name}>{item.name}</span>
        <span className={css.last}>
          {item.runState ? (
            <LastText t={t} run={props.run} />
          ) : (
            <span className={css.lastLine} data-problem={problem !== undefined || undefined}>
              {problem ?? t('trigger.afterStateOff')}
            </span>
          )}
        </span>
      </button>
      {item.runState || env === null ? (
        <span className={css.steps}>
          {item.nodes > 0 ? t('trigger.afterNodes').replace('{n}', String(item.nodes)) : ''}
        </span>
      ) : (
        <button
          ref={enabling.anchorFor(item.name)}
          type="button"
          className={css.enable}
          disabled={busy}
          aria-busy={busy || undefined}
          data-testid={`wl-trigger-after-enable-${item.name}`}
          onClick={() => enabling.onAsk(item.name)}
        >
          <SwapText
            text={t(busy ? 'trigger.afterEnabling' : 'trigger.afterEnable')}
            reserve={[t('trigger.afterEnabling'), t('trigger.afterEnable')]}
          />
        </button>
      )}
    </div>
  )
}
