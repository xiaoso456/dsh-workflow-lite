/**
 * dsh-workflow-lite — 「工作流设置」对话框里的三块：执行方式（四张卡 + 复用执行者）、
 * 执行时（设定目标、记录运行状态两个开关）、产出根目录。状态都在对话框里，这里只画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/SettingsFields
 */

import { useId } from 'react'
import {
  checkOutputRoot,
  DEFAULT_OUTPUT_ROOT,
  isAbsoluteRoot,
  normalizeRoot,
  resolveOutputPath,
} from '../../shared/outputPaths.ts'
import {
  EXECUTION_MODES,
  type ExecutionMode,
  REUSE_POLICIES,
  type ReusePolicy,
} from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { Icon, type IconName } from './Icon.tsx'
import css from './inspector.module.css'
import { cx, HelpTip, Segmented } from './primitives.tsx'
import s from './settings.module.css'
import ui from './ui.module.css'

const MODE_TEXT: Record<ExecutionMode, { icon: IconName; title: LocaleKey; desc: LocaleKey }> = {
  auto: { icon: 'modeAuto', title: 'settings.mode.auto', desc: 'settings.mode.autoDesc' },
  serial: { icon: 'modeSerial', title: 'settings.mode.serial', desc: 'settings.mode.serialDesc' },
  subagent: {
    icon: 'modeSubagent',
    title: 'settings.mode.subagent',
    desc: 'settings.mode.subagentDesc',
  },
  team: { icon: 'modeTeam', title: 'settings.mode.team', desc: 'settings.mode.teamDesc' },
}

const REUSE_TEXT: Record<ReusePolicy, { title: LocaleKey; desc: LocaleKey }> = {
  auto: { title: 'settings.reuse.auto', desc: 'settings.reuse.autoDesc' },
  reuse: { title: 'settings.reuse.reuse', desc: 'settings.reuse.reuseDesc' },
  fresh: { title: 'settings.reuse.fresh', desc: 'settings.reuse.freshDesc' },
}

/** 一块的标题：名字 +「?」，右边可以再挂东西。 */
function GroupHead(props: {
  title: string
  help?: React.ReactNode
  helpTestId?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={css.label}>
      <span className={css.labelMain}>
        {props.title}
        {props.help !== undefined && (
          <HelpTip label={props.title} testId={props.helpTestId}>
            <p className={ui.hintTitle}>{props.title}</p>
            {props.help}
          </HelpTip>
        )}
      </span>
      {props.children}
    </div>
  )
}

function Tips(props: { t: T; keys: readonly LocaleKey[] }): React.JSX.Element {
  return (
    <ul className={ui.hintList}>
      {props.keys.map((key) => (
        <li key={key}>{props.t(key)}</li>
      ))}
    </ul>
  )
}

// ─────────────────────────────────────────────────────────────
// 执行方式 + 复用执行者
// ─────────────────────────────────────────────────────────────

export function ModeGroup(props: {
  t: T
  mode: ExecutionMode
  reuse: ReusePolicy
  onMode(mode: ExecutionMode): void
  onReuse(reuse: ReusePolicy): void
}): React.JSX.Element {
  const { t } = props
  // 串行没有子代理、队员：复用这一项用不上，留着选过的值（切回来还在），只是不能改。
  const off = props.mode === 'serial'
  return (
    <section className={s.group}>
      <GroupHead
        title={t('settings.mode')}
        helpTestId="wl-settings-mode-help"
        help={
          <Tips
            t={t}
            keys={['settings.modeTipPlan', 'settings.leaderNote', 'settings.modeTipTools']}
          />
        }
      />
      <div className={s.modes} role="radiogroup" aria-label={t('settings.mode')}>
        {EXECUTION_MODES.map((value) => {
          const text = MODE_TEXT[value]
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={props.mode === value}
              className={s.mode}
              data-testid={`wl-settings-mode-${value}`}
              onClick={() => props.onMode(value)}
            >
              <span className={s.modeIcon}>
                <Icon name={text.icon} size={16} />
              </span>
              <span className={s.modeTitle}>{t(text.title)}</span>
              <span className={s.modeDesc}>{t(text.desc)}</span>
              <span className={s.modeCheck} aria-hidden="true">
                <Icon name="check" size={12} />
              </span>
            </button>
          )
        })}
      </div>
      <div className={s.rows}>
        <div className={s.row} data-off={off} data-testid="wl-settings-reuse-row">
          <span className={s.rowIcon}>
            <Icon name="reload" size={15} />
          </span>
          <span className={s.rowText}>
            <span className={s.rowTitle}>
              {t('settings.reuse')}
              <HelpTip label={t('settings.reuse')} testId="wl-settings-reuse-help">
                <p className={ui.hintTitle}>{t('settings.reuse')}</p>
                <Tips
                  t={t}
                  keys={[
                    'settings.reuseTipWhen',
                    'settings.reuseTipScope',
                    'settings.reuseTipPick',
                    'settings.reuseTipTools',
                  ]}
                />
              </HelpTip>
            </span>
            <span className={s.rowDesc} data-testid="wl-settings-reuse-desc">
              {off ? t('settings.reuseSerial') : t(REUSE_TEXT[props.reuse].desc)}
            </span>
          </span>
          <span className={s.rowSeg}>
            <Segmented
              label={t('settings.reuse')}
              value={props.reuse}
              disabled={off}
              testId="wl-settings-reuse"
              options={REUSE_POLICIES.map((value) => ({
                value,
                label: t(REUSE_TEXT[value].title),
              }))}
              onChange={props.onReuse}
            />
          </span>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// 执行时：开关
// ─────────────────────────────────────────────────────────────

/** 一个开关一行：整行是 `<label>`，点哪儿都转给右边的开关；「?」是按钮，点它不会拨开关。 */
function SwitchRow(props: {
  icon: IconName
  title: string
  desc: string
  help: React.ReactNode
  helpTestId: string
  checked: boolean
  testId: string
  onChange(checked: boolean): void
}): React.JSX.Element {
  const id = useId()
  return (
    <label className={s.row} htmlFor={id}>
      <span className={s.rowIcon}>
        <Icon name={props.icon} size={15} />
      </span>
      <span className={s.rowText}>
        <span className={s.rowTitle}>
          {props.title}
          <HelpTip label={props.title} testId={props.helpTestId}>
            <p className={ui.hintTitle}>{props.title}</p>
            {props.help}
          </HelpTip>
        </span>
        <span className={s.rowDesc}>{props.desc}</span>
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.title}
        className={s.switch}
        data-testid={props.testId}
        onClick={() => props.onChange(!props.checked)}
      >
        <span className={s.knob} />
      </button>
    </label>
  )
}

export function DuringGroup(props: {
  t: T
  setGoal: boolean
  runState: boolean
  onSetGoal(on: boolean): void
  onRunState(on: boolean): void
}): React.JSX.Element {
  const { t } = props
  return (
    <section className={s.group}>
      <GroupHead title={t('settings.during')} />
      <div className={s.rows}>
        <SwitchRow
          icon="target"
          title={t('settings.goal')}
          desc={t('settings.goalDesc')}
          helpTestId="wl-settings-goal-help"
          help={
            <Tips
              t={t}
              keys={['settings.goalTipPlan', 'settings.goalTipWhy', 'settings.goalTipSkip']}
            />
          }
          checked={props.setGoal}
          testId="wl-settings-goal"
          onChange={props.onSetGoal}
        />
        <SwitchRow
          icon="runs"
          title={t('settings.runStateOn')}
          desc={t('settings.runStateDesc')}
          helpTestId="wl-settings-run-help"
          help={
            <Tips
              t={t}
              keys={[
                'settings.runStateTipInstance',
                'settings.runStateTipWriter',
                'settings.runStateTipView',
              ]}
            />
          }
          checked={props.runState}
          testId="wl-settings-run-state"
          onChange={props.onRunState}
        />
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// 产出根目录
// ─────────────────────────────────────────────────────────────

/** 根目录现在的样子：问题、标准化后的写法、是不是默认值（保存时据此决定写不写）。 */
export function rootStatus(root: string): {
  problem: ReturnType<typeof checkOutputRoot>
  normalized: string | undefined
  isDefault: boolean
} {
  const problem = checkOutputRoot(root)
  const normalized = problem === null ? normalizeRoot(root) : undefined
  return {
    problem,
    normalized,
    isDefault: root.trim() === '' || normalized === DEFAULT_OUTPUT_ROOT,
  }
}

export function RootGroup(props: {
  t: T
  root: string
  /** 说明里拼接示例用的产出（图里第一个产出文件；没有就是 `plan.md`）。 */
  sample: string
  inputRef: React.RefObject<HTMLInputElement>
  onChange(root: string): void
}): React.JSX.Element {
  const { t } = props
  const { problem, normalized, isDefault } = rootStatus(props.root)
  return (
    <section className={s.group}>
      <GroupHead
        title={t('settings.root')}
        helpTestId="wl-settings-root-help"
        help={
          <>
            <Tips
              t={t}
              keys={[
                'settings.rootTipJoin',
                'settings.rootTipKinds',
                'settings.rootTipNormalize',
                'settings.rootTipEmpty',
                'settings.rootTipToken',
              ]}
            />
            {/* 示例跟着输入框实时变：拼接与标准化和编译器是同一份。 */}
            <p className={ui.hintExample} data-testid="wl-settings-preview">
              <span>{t('settings.preview')}</span>
              <code>{props.sample}</code>
              <span aria-hidden="true">→</span>
              <code>
                {resolveOutputPath(isDefault ? DEFAULT_OUTPUT_ROOT : normalized, props.sample)}
              </code>
            </p>
          </>
        }
      >
        {problem === null && (
          <span
            className={s.rootKind}
            data-absolute={normalized !== undefined && isAbsoluteRoot(normalized)}
            data-testid="wl-settings-root-kind"
          >
            {isDefault
              ? t('settings.rootDefault')
              : normalized === undefined
                ? t('settings.rootWorkspace')
                : isAbsoluteRoot(normalized)
                  ? t('settings.rootAbsolute')
                  : t('settings.rootRelative')}
          </span>
        )}
        {!isDefault && (
          <button
            type="button"
            className={cx(ui.btn, ui.small, s.rootReset)}
            data-testid="wl-settings-root-reset"
            onClick={() => {
              props.onChange(DEFAULT_OUTPUT_ROOT)
              props.inputRef.current?.focus()
            }}
          >
            {t('settings.rootReset')}
          </button>
        )}
      </GroupHead>
      <input
        ref={props.inputRef}
        className={cx(ui.input, ui.mono)}
        value={props.root}
        placeholder={t('settings.rootPlaceholder')}
        aria-label={t('settings.root')}
        aria-invalid={problem !== null}
        data-testid="wl-settings-root"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      {problem !== null && <p className={css.error}>{problem.message}</p>}
    </section>
  )
}
