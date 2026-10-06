/**
 * dsh-workflow-lite — 工作流中心「设置」页：插件自己的几项设置，分「存储 / 画布 / 模型」三组。
 *
 * - 改在草稿上，底下浮出一条「有 N 处改动还没保存 · 放弃 · 保存」，点保存才写；
 *   数据目录这种改错了很麻烦的东西，不能一敲字就生效。
 * - 和默认值不一样的项，右边有个「恢复默认」的小按钮（提示里写着默认是多少）。
 * - 要重启才生效的项标一个小标签；保存后的提示也会再说一遍。
 * - 没有设置服务、或 profile 不让改：照样显示现值，控件都禁用，顶上说明为什么。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubSettings
 */

import { type PluginConfigKey, RESTART_CONFIG_KEYS } from '../../shared/wire.ts'
import type { ConfigDraft, PluginConfigState } from '../app/usePluginConfig.ts'
import { LABEL, usePluginConfig } from '../app/usePluginConfig.ts'
import type { LocaleKey, T } from '../i18n.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import hub from './hub.module.css'
import css from './hubSettings.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

const DESC: Record<PluginConfigKey, LocaleKey> = {
  dataDir: 'cfg.dataDirDesc',
  maxNodes: 'cfg.maxNodesDesc',
  saveDebounceMs: 'cfg.saveDebounceDesc',
  maxResultBytes: 'cfg.maxResultDesc',
  installSkill: 'cfg.skillDesc',
}

const ICON: Record<PluginConfigKey, IconName> = {
  dataDir: 'folder',
  maxNodes: 'library',
  saveDebounceMs: 'clock',
  maxResultBytes: 'download',
  installSkill: 'bookmark',
}

export function HubSettings(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 保存成功：画布要用的上限、自动保存等待跟着换。 */
  onSaved(): void
}): React.JSX.Element {
  const { t } = props
  const state = usePluginConfig(props.rpc, t, props.onSaved)
  const { view, draft } = state

  if (view === null || draft === null) {
    return (
      <div className={hub.page}>
        {state.loadError !== null ? (
          <div className={hub.notice} data-tone="error" role="status">
            <Icon name="alert" size={14} />
            {state.loadError}
          </div>
        ) : (
          <div className={hub.loading}>
            <span className={hub.spinner} />
            {t('hub.loading')}
          </div>
        )}
      </div>
    )
  }

  const locked = !view.writable || state.busy
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
        {state.notice !== null && (
          <div className={cx(hub.notice, ui.rise)} data-tone={state.notice.tone} role="status">
            <Icon name={state.notice.tone === 'ok' ? 'check' : 'alert'} size={14} />
            {state.notice.text}
          </div>
        )}

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
              data-testid="wl-cfg-dataDir"
              onChange={(event) => state.edit('dataDir', event.currentTarget.value)}
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
      </div>

      {state.dirty.length > 0 && view.writable && (
        <div className={cx(css.bar, ui.rise)} data-testid="wl-cfg-bar">
          <span className={css.barText}>
            {t('cfg.dirty').replace('{n}', String(state.dirty.length))}
          </span>
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
        </div>
      )}
    </div>
  )
}

function Group(props: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className={hub.section}>
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
function Row(props: FieldProps & { wide?: boolean; children: React.ReactNode }): React.JSX.Element {
  const { t, state, name } = props
  const view = state.view
  const draft = state.draft
  const defaultText = view === null ? '' : shown(name, view.defaults, t)
  const atDefault = draft !== null && view !== null && sameAsDefault(name, draft, view)
  const error = state.errors[name]
  const reset = !atDefault && !props.locked && (
    <button
      type="button"
      className={css.reset}
      data-tip={t('cfg.reset').replace('{v}', defaultText)}
      aria-label={t('cfg.reset').replace('{v}', defaultText)}
      data-testid={`wl-cfg-${name}-reset`}
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
        <span className={hub.itemDesc}>{t(DESC[name])}</span>
        {props.wide === true && (
          <span className={css.wideControl}>
            {props.children}
            {reset}
          </span>
        )}
        {error !== undefined && <span className={css.error}>{error}</span>}
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

function NumberInput(
  props: FieldProps & { name: 'maxNodes' | 'saveDebounceMs' | 'maxResultBytes'; unit?: string },
): React.JSX.Element {
  const { t, state, name } = props
  return (
    <span className={css.number}>
      <input
        className={cx(ui.input, css.numberInput)}
        inputMode="numeric"
        value={state.draft?.[name] ?? ''}
        disabled={props.locked}
        aria-label={t(LABEL[name])}
        aria-invalid={state.errors[name] !== undefined}
        data-testid={`wl-cfg-${name}`}
        onChange={(event) => state.edit(name, event.currentTarget.value)}
      />
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
