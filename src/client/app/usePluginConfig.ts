/**
 * dsh-workflow-lite — 工作流中心「设置」页的状态：读插件设置、在草稿上改、一次保存。
 *
 * - 输入框里的数字先按文字存（打字途中可以是空的），保存时才换成数；「读取上限」给人看 KB，存的是字节。
 * - 保存时只送改了的几项：改回默认值的发「恢复」（删掉 profile 里那一项），其余发「设成」。
 * - 别处先改过（修订号对不上）：重新读一遍，草稿留着，告诉人再保存一次。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/usePluginConfig
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PLUGIN_CONFIG_KEYS,
  type PluginConfigKey,
  type PluginConfigValues,
  type PluginConfigView,
  RESTART_CONFIG_KEYS,
} from '../../shared/wire.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { errorCode, errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

/** 草稿：文字框里的原样。 */
export interface ConfigDraft {
  dataDir: string
  maxNodes: string
  saveDebounceMs: string
  /** 以 KB 计。 */
  maxResultBytes: string
  installSkill: boolean
}

export type ConfigErrors = Partial<Record<PluginConfigKey, string>>

export interface PluginConfigState {
  view: PluginConfigView | null
  draft: ConfigDraft | null
  /** 读不出来时的原因。 */
  loadError: string | null
  errors: ConfigErrors
  /** 和已保存的值不一样的几项。 */
  dirty: PluginConfigKey[]
  busy: boolean
  notice: { tone: 'ok' | 'error'; text: string } | null
  edit<K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]): void
  /** 草稿里这一项换回默认值（保存后生效）。 */
  toDefault(key: PluginConfigKey): void
  discard(): void
  save(): Promise<void>
}

const MIN: Record<'maxNodes' | 'saveDebounceMs' | 'maxResultBytes', number> = {
  maxNodes: 1,
  saveDebounceMs: 0,
  maxResultBytes: 1,
}

export function toDraft(values: PluginConfigValues): ConfigDraft {
  return {
    dataDir: values.dataDir,
    maxNodes: String(values.maxNodes),
    saveDebounceMs: String(values.saveDebounceMs),
    maxResultBytes: String(Math.round(values.maxResultBytes / 1024)),
    installSkill: values.installSkill,
  }
}

/**
 * 草稿 → 值。`saved` 用来认「读取上限没动过」：KB 四舍五入回去和原来的字节数对不上时，原值照留。
 * @returns 有错的项给出原因；没错的项给出值。
 */
export function fromDraft(
  draft: ConfigDraft,
  saved: PluginConfigValues,
  t: T,
): { values: PluginConfigValues; errors: ConfigErrors } {
  const errors: ConfigErrors = {}
  const values: PluginConfigValues = { ...saved, installSkill: draft.installSkill }
  const dataDir = draft.dataDir.trim()
  if (dataDir === '') errors.dataDir = t('cfg.required')
  else values.dataDir = dataDir
  for (const key of ['maxNodes', 'saveDebounceMs', 'maxResultBytes'] as const) {
    const text = draft[key].trim()
    if (text === '') {
      errors[key] = t('cfg.required')
      continue
    }
    if (!/^\d+$/u.test(text)) {
      errors[key] = t('cfg.int')
      continue
    }
    const number = Number(text)
    if (number < MIN[key]) {
      errors[key] = t('cfg.min').replace('{n}', String(MIN[key]))
      continue
    }
    if (key !== 'maxResultBytes') values[key] = number
    else if (text !== toDraft(saved).maxResultBytes) values.maxResultBytes = number * 1024
  }
  return { values, errors }
}

export function usePluginConfig(
  rpc: WorkflowLiteRpc,
  t: T,
  onSaved: () => void,
): PluginConfigState {
  const [view, setView] = useState<PluginConfigView | null>(null)
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<PluginConfigState['notice']>(null)
  const outer = useRef({ t, onSaved })
  outer.current = { t, onSaved }

  useEffect(() => {
    let live = true
    rpc
      .call('config/get', {})
      .then((loaded) => {
        if (!live) return
        setView(loaded)
        setDraft(toDraft(loaded.values))
      })
      .catch((caught: unknown) => {
        if (live) setLoadError(errorMessage(caught))
      })
    return () => {
      live = false
    }
  }, [rpc])

  // 成功的提示 4 秒后收起；错误留着，直到下一次动作。
  useEffect(() => {
    if (notice?.tone !== 'ok') return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const parsed = view !== null && draft !== null ? fromDraft(draft, view.values, t) : null
  const dirty =
    parsed === null || view === null
      ? []
      : PLUGIN_CONFIG_KEYS.filter(
          (key) => parsed.errors[key] !== undefined || parsed.values[key] !== view.values[key],
        )

  const edit = useCallback(<K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]): void => {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }))
  }, [])

  const toDefault = useCallback(
    (key: PluginConfigKey): void => {
      if (view === null) return
      const defaults = toDraft(view.defaults)
      setDraft((current) => (current === null ? current : { ...current, [key]: defaults[key] }))
    },
    [view],
  )

  const discard = useCallback((): void => {
    if (view !== null) setDraft(toDraft(view.values))
  }, [view])

  const save = useCallback(async (): Promise<void> => {
    if (view === null || draft === null) return
    const { t: tr, onSaved: saved } = outer.current
    const next = fromDraft(draft, view.values, tr)
    if (Object.keys(next.errors).length > 0) return
    const changed = PLUGIN_CONFIG_KEYS.filter((key) => next.values[key] !== view.values[key])
    if (changed.length === 0) return
    const set: Partial<PluginConfigValues> = {}
    const reset: PluginConfigKey[] = []
    for (const key of changed) {
      if (next.values[key] === view.defaults[key] && view.overridden.includes(key)) reset.push(key)
      else Object.assign(set, { [key]: next.values[key] })
    }
    setBusy(true)
    try {
      const result = await rpc.call('config/set', { revision: view.revision, set, reset })
      setView(result)
      setDraft(toDraft(result.values))
      const restart = changed.filter((key) => RESTART_CONFIG_KEYS.includes(key))
      setNotice({
        tone: 'ok',
        text:
          restart.length === 0
            ? tr('cfg.saved')
            : tr('cfg.savedRestart').replace(
                '{keys}',
                restart.map((key) => tr(LABEL[key])).join('、'),
              ),
      })
      saved()
    } catch (caught) {
      setNotice({ tone: 'error', text: errorMessage(caught) })
      if (errorCode(caught) === 'conflict') {
        // 别处先改过：换上最新的修订号与已保存的值，草稿不动，人再点一次保存就行。
        await rpc
          .call('config/get', {})
          .then(setView)
          .catch(() => {})
      }
    } finally {
      setBusy(false)
    }
  }, [rpc, view, draft])

  return {
    view,
    draft,
    loadError,
    errors: parsed?.errors ?? {},
    dirty,
    busy,
    notice,
    edit,
    toDefault,
    discard,
    save,
  }
}

/** 各项的名字（提示里拼「数据目录、给模型的使用指南要重启」用）。 */
export const LABEL = {
  dataDir: 'cfg.dataDir',
  maxNodes: 'cfg.maxNodes',
  saveDebounceMs: 'cfg.saveDebounce',
  maxResultBytes: 'cfg.maxResult',
  installSkill: 'cfg.skill',
} as const satisfies Record<PluginConfigKey, LocaleKey>
