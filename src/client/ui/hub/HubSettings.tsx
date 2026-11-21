/**
 * dsh-workflow-lite — 工作流中心「设置」页：最上面是外观（配色主题，点了就换），
 * 下面是插件自己的几项设置，分「存储 / 画布 / 模型 / 触发」四组。
 *
 * - 改在草稿上，底下浮出一条「有 N 处改动还没保存 · 放弃 · 保存」，点保存才写；
 *   数据目录这种改错了很麻烦的东西，不能一敲字就生效。
 * - 和默认值不一样的项，右边有个「恢复默认」的小按钮（提示里写着默认是多少）。
 * - 要重启才生效的项标一个小标签；保存后的提示也会再说一遍。
 * - 没有设置服务、或 profile 不让改：照样显示现值，控件都禁用，顶上说明为什么。
 * - 从别处的「设置」链接进来（HTTP 的监听地址、命令输出的保留行数）给 `jump`：读好后直接滚到那一组。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/HubSettings
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type PluginConfigKey, RESTART_CONFIG_KEYS } from '../../../shared/wire/config.ts'
import { createShellAccess } from '../../app/shells.ts'
import type { ConfigDraft, PluginConfigState } from '../../app/usePluginConfig.ts'
import {
  LABEL,
  type NumberKey,
  numberRange,
  stepNumber,
  usePluginConfig,
} from '../../app/usePluginConfig.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'
import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import { Stepper } from '../kit/NumberStep.tsx'
import { Skeleton } from '../kit/Skeleton.tsx'
import ui from '../kit/ui.module.css'
import { ShellSelect } from '../trigger/ShellSelect.tsx'
import hub from './hub.module.css'
import css from './hubSettings.module.css'
import { ListenHostSelect } from './ListenHostSelect.tsx'
import { ListenStatus } from './ListenStatus.tsx'
import { ThemePicker } from './ThemePicker.tsx'

const DESC: Record<PluginConfigKey, LocaleKey> = {
  dataDir: 'cfg.dataDirDesc',
  maxNodes: 'cfg.maxNodesDesc',
  saveDebounceMs: 'cfg.saveDebounceDesc',
  maxResultBytes: 'cfg.maxResultDesc',
  installSkill: 'cfg.skillDesc',
  triggerPort: 'cfg.triggerPortDesc',
  triggerHost: 'cfg.triggerHostDesc',
  triggerShell: 'cfg.triggerShellDesc',
  triggerOutputLines: 'cfg.triggerOutputLinesDesc',
}

const ICON: Record<PluginConfigKey, IconName> = {
  dataDir: 'folder',
  maxNodes: 'library',
  saveDebounceMs: 'clock',
  maxResultBytes: 'download',
  installSkill: 'bookmark',
  triggerPort: 'bolt',
  triggerHost: 'globe',
  triggerShell: 'terminal',
  triggerOutputLines: 'rows',
}

/** 从链接进来时直接滚到的那一组。 */
export type SettingsJump = 'trigger'

export function HubSettings(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 打开后滚到哪一组（缺省停在顶上）。 */
  jump?: SettingsJump
  /** 保存成功：画布要用的上限、自动保存等待跟着换。 */
  onSaved(): void
}): React.JSX.Element {
  const { t } = props
  const state = usePluginConfig(props.rpc, t, props.onSaved)
  const { view, draft } = state
  const triggerGroup = useRef<HTMLElement>(null)
  const loaded = view !== null && draft !== null
  // 设置读回来、那一组画出来之后滚一次（只滚这一次，之后用户自己滚）。
  const jumped = useRef(false)
  useLayoutEffect(() => {
    if (!loaded || jumped.current || props.jump !== 'trigger') return
    jumped.current = true
    triggerGroup.current?.scrollIntoView({ block: 'start' })
  }, [loaded, props.jump])
  const shells = useMemo(() => createShellAccess(props.rpc), [props.rpc])
  /** 自己挑的 shell 程序用不了时的原因（写在那一行的说明处）。 */
  const [shellProblem, setShellProblem] = useState<string | null>(null)

  if (!loaded) {
    return (
      <div className={hub.page}>
        <ThemePicker t={t} />
        {state.loadError !== null ? (
          <div className={hub.notice} data-tone="error" role="status">
            <Icon name="alert" size={14} />
            {state.loadError}
          </div>
        ) : (
          <Skeleton label={t('hub.loading')} shape="form" />
        )}
      </div>
    )
  }

  const locked = !view.writable || state.busy
  const dirty = state.dirty.length > 0 && view.writable
  const field = { t, state, locked }
  return (
    <div className={css.wrap} data-testid="wl-hub-config">
      <div className={hub.page}>
        {!view.writable && (
          <div className={css.banner} role="note">
            <Icon name="info" size={14} />
            {t(view.available ? 'cfg.readonly' : 'cfg.unavailable')}
          </div>
        )}
        <ThemePicker t={t} />

        <Group title={t('cfg.groupStorage')}>
          <Row {...field} name="dataDir" wide>
            <input
              className={cx(ui.input, ui.mono, css.path)}
              value={draft.dataDir}
              disabled={locked}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('cfg.dataDir')}
              aria-invalid={state.errors.dataDir !== undefined}
              data-tip={state.errors.dataDir}
              data-testid="wl-cfg-dataDir"
              onChange={(event) => state.edit('dataDir', event.currentTarget.value)}
              onBlur={(event) => {
                // 清空了就回到已保存的路径：数据目录不能是空的，也不在行里多出一行错字。
                if (event.currentTarget.value.trim() === '')
                  state.edit('dataDir', view.values.dataDir)
              }}
            />
          </Row>
        </Group>

        <Group title={t('cfg.groupCanvas')}>
          <Row {...field} name="maxNodes">
            <NumberInput {...field} name="maxNodes" unit={t('cfg.steps')} />
          </Row>
          <Row {...field} name="saveDebounceMs">
            <NumberInput {...field} name="saveDebounceMs" unit={t('cfg.ms')} />
          </Row>
        </Group>

        <Group title={t('cfg.groupModel')}>
          <Row {...field} name="maxResultBytes">
            <NumberInput {...field} name="maxResultBytes" unit={t('cfg.kb')} />
          </Row>
          <Row {...field} name="installSkill">
            <button
              type="button"
              role="switch"
              aria-checked={draft.installSkill}
              aria-label={t('cfg.skill')}
              className={ui.switch}
              disabled={locked}
              data-testid="wl-cfg-installSkill"
              onClick={() => state.edit('installSkill', !draft.installSkill)}
            >
              <span className={ui.knob} />
            </button>
          </Row>
        </Group>

        <Group title={t('cfg.groupTrigger')} sectionRef={triggerGroup}>
          <Row {...field} name="triggerShell" problem={shellProblem}>
            <ShellSelect
              t={t}
              access={shells}
              value={draft.triggerShell}
              mode="default"
              disabled={locked}
              className={locked ? css.hostLocked : css.host}
              testId="wl-cfg-triggerShell"
              onChange={(value) => state.edit('triggerShell', value)}
              onProblem={setShellProblem}
            />
          </Row>
          <Row {...field} name="triggerOutputLines">
            <NumberInput {...field} name="triggerOutputLines" unit={t('cfg.lines')} />
          </Row>
          <Row {...field} name="triggerHost">
            <ListenHostSelect
              t={t}
              value={draft.triggerHost}
              interfaces={view.interfaces ?? []}
              locked={locked}
              onChange={(value) => state.edit('triggerHost', value)}
            />
          </Row>
          <Row {...field} name="triggerPort">
            <NumberInput {...field} name="triggerPort" />
          </Row>
          <ListenStatus t={t} rpc={props.rpc} />
        </Group>
      </div>

      {/* 保存条与保存后的提示都在页底这一条里：不在页顶插一行，把下面的设置项顶下去。 */}
      {(dirty || state.notice !== null) && (
        <div className={cx(css.bar, ui.rise)} data-testid={dirty ? 'wl-cfg-bar' : 'wl-cfg-notice'}>
          {state.notice !== null ? (
            <span className={css.barText} data-tone={state.notice.tone} role="status">
              <Icon name={state.notice.tone === 'ok' ? 'check' : 'alert'} size={14} />
              {state.notice.text}
            </span>
          ) : (
            <span className={css.barText}>
              {t('cfg.dirty').replace('{n}', String(state.dirty.length))}
            </span>
          )}
          {dirty && (
            <>
              <button
                type="button"
                className={cx(ui.btn, ui.small)}
                disabled={state.busy}
                data-testid="wl-cfg-discard"
                onClick={state.discard}
              >
                {t('cfg.discard')}
              </button>
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.primary)}
                disabled={state.busy || Object.keys(state.errors).length > 0}
                data-testid="wl-cfg-save"
                onClick={() => void state.save()}
              >
                {t('cfg.save')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Group(props: {
  title: string
  sectionRef?: React.RefObject<HTMLElement>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section ref={props.sectionRef} className={hub.section}>
      <h3 className={hub.sectionTitle}>{props.title}</h3>
      <div className={hub.box}>{props.children}</div>
    </section>
  )
}

interface FieldProps {
  t: T
  state: PluginConfigState
  locked: boolean
  name: PluginConfigKey
}

/** 一项一行：图标、名字（要重启的带个小标签）、说明、右边的控件；`wide` 的控件放到说明下面整行宽。 */
function Row(
  props: FieldProps & {
    wide?: boolean
    /** 有问题时说明处换成这句（标红）。 */
    problem?: string | null
    children: React.ReactNode
  },
): React.JSX.Element {
  const { t, state, name } = props
  const view = state.view
  const draft = state.draft
  const defaultText = view === null ? '' : shown(name, view.defaults, t)
  const atDefault = draft !== null && view !== null && sameAsDefault(name, draft, view)
  // 位置一直留着，只在和默认值不一样时显出来：按钮出现时控件那一列不变宽，说明不会换行、行不会变高。
  const off = atDefault || props.locked
  const reset = (
    <button
      type="button"
      className={css.reset}
      data-off={off || undefined}
      disabled={off}
      tabIndex={off ? -1 : undefined}
      aria-hidden={off || undefined}
      data-tip={off ? undefined : t('cfg.reset').replace('{v}', defaultText)}
      aria-label={t('cfg.reset').replace('{v}', defaultText)}
      data-testid={off ? undefined : `wl-cfg-${name}-reset`}
      onClick={() => state.toDefault(name)}
    >
      <Icon name="restore" size={14} />
    </button>
  )
  return (
    <div className={cx(hub.item, css.item)} data-wide={props.wide === true}>
      <span className={hub.itemIcon}>
        <Icon name={ICON[name]} size={16} />
      </span>
      <div className={hub.itemText}>
        <span className={hub.itemTitle}>
          {t(LABEL[name])}
          {RESTART_CONFIG_KEYS.includes(name) && (
            <span className={css.restart}>{t('cfg.restart')}</span>
          )}
        </span>
        <span
          className={cx(hub.itemDesc, css.desc)}
          data-tone={props.problem == null ? undefined : 'error'}
          role={props.problem == null ? undefined : 'alert'}
        >
          {props.problem ?? t(DESC[name])}
        </span>
        {props.wide === true && (
          <span className={css.wideControl}>
            {props.children}
            {reset}
          </span>
        )}
      </div>
      {props.wide !== true && (
        <div className={hub.itemEnd}>
          {reset}
          {props.children}
        </div>
      )}
    </div>
  )
}

/** 数字框里填得下的最大数（没有上限的几项）。 */
const NUMBER_CEILING = 99_999

/**
 * 数字设置：「− 数 +」，后面跟单位（单位占一列，几行的数字框上下对齐）。
 * 打出范围内的数当场写进草稿，超出范围的标红、离开时拉回边上；一步走多少按 {@link stepNumber}。
 */
function NumberInput(
  props: FieldProps & {
    name: NumberKey
    unit?: string
  },
): React.JSX.Element {
  const { t, state, name } = props
  const range = numberRange(name)
  const tip = (range.max === undefined ? t('cfg.atLeast') : t('cfg.range'))
    .replace('{min}', String(range.min))
    .replace('{max}', String(range.max ?? ''))
  const text = state.draft?.[name] ?? ''
  return (
    <span className={css.number} data-tip={tip}>
      <Stepper
        label={t(LABEL[name])}
        value={text === '' ? range.min : Number(text)}
        min={range.min}
        max={range.max ?? NUMBER_CEILING}
        next={(value, dir, big) => stepNumber(name, value, dir, big)}
        digits={5}
        disabled={props.locked}
        lessLabel={t('common.decrease')}
        moreLabel={t('common.increase')}
        testId={`wl-cfg-${name}`}
        onChange={(value) => state.edit(name, String(value))}
      />
      {/* 没有单位（端口）就不留那一格：数字框和别的控件一样靠右。 */}
      {props.unit !== undefined && <span className={css.unit}>{props.unit}</span>}
    </span>
  )
}

/** 默认值给人看的样子（提示「恢复默认（400）」用）。 */
function shown(
  name: PluginConfigKey,
  values: NonNullable<PluginConfigState['view']>['values'],
  t: T,
): string {
  switch (name) {
    case 'installSkill':
      return values.installSkill ? 'ON' : 'OFF'
    case 'maxResultBytes':
      return `${Math.round(values.maxResultBytes / 1024)} ${t('cfg.kb')}`
    case 'saveDebounceMs':
      return `${values.saveDebounceMs} ${t('cfg.ms')}`
    case 'triggerShell':
      return values.triggerShell === '' ? t('cfg.shellAutomatic') : values.triggerShell
    default:
      return String(values[name])
  }
}

function sameAsDefault(
  name: PluginConfigKey,
  draft: ConfigDraft,
  view: NonNullable<PluginConfigState['view']>,
): boolean {
  const value = draft[name]
  if (name === 'installSkill') return value === view.defaults.installSkill
  if (name === 'maxResultBytes')
    return value === String(Math.round(view.defaults.maxResultBytes / 1024))
  return String(value).trim() === String(view.defaults[name])
}
