/**
 * dsh-workflow-lite — 步骤库条目的详情（右侧面板）：点一下库里的条目就在这里看它。
 *
 * - **常用步骤**是内置的：只读展示提示词与产出，不能改。能做的只有"添加到画布"和
 *   "复制为我的步骤"（复制出来的那份就可以随便改了）。连接这类只对画布上的步骤有意义的
 *   东西，这里不出现。
 * - **我的步骤**就是 `templates/nodes/<ID>.json`：可以改 ID、名称、描述、提示词、产出，
 *   显式保存（Ctrl+S 也行），也可以删除。离开时还有没保存的改动，就顺手保存一次——
 *   改了一半一点别处就丢，比"多保存了一次"糟糕得多。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/StepPanel
 */

import { useEffect, useRef, useState } from 'react'
import { appearanceOf, presetAppearance } from '../../shared/appearance.ts'
import { checkName, normalizeName } from '../../shared/naming.ts'
import type { NodeData } from '../../shared/types.ts'
import type { Workflow } from '../app/useWorkflow.ts'
import type { T } from '../i18n.ts'
import { type LibraryFocus, PRESETS, presetData, type StepSource } from '../model/library.ts'
import { AppearancePicker } from './AppearancePicker.tsx'
import { useConfirm } from './Confirm.tsx'
import { Icon } from './Icon.tsx'
import { DescriptionField } from './Inspector.tsx'
import css from './inspector.module.css'
import { OutputField, OutputList } from './Outputs.tsx'
import { PreviewCard } from './PreviewCard.tsx'
import { cx } from './primitives.tsx'
import { StepMark } from './StepMark.tsx'
import ui from './ui.module.css'

export interface StepPanelProps {
  t: T
  wf: Workflow
  focus: LibraryFocus
  onFocus(focus: LibraryFocus | null): void
  onAddToCanvas(source: StepSource): void
  /** 把一份内容带去新建「我的步骤」（复制内置步骤用）。 */
  onCopyToMine(seed: NodeData, name: string): void
}

export function StepPanel(props: StepPanelProps): React.JSX.Element | null {
  const { focus } = props
  if (focus.kind === 'preset') return <PresetView {...props} id={focus.id} />
  if (focus.kind === 'template') {
    // 按文件名认实例：改名保存之后换一个实例，从磁盘重新读一遍。
    return <MineEditor key={`mine:${focus.name}`} {...props} original={focus.name} seed={null} />
  }
  return <MineEditor key="mine:new" {...props} original={null} seed={focus} />
}

// ─────────────────────────────────────────────────────────────
// 常用步骤（只读）
// ─────────────────────────────────────────────────────────────

function PresetView(props: StepPanelProps & { id: string }): React.JSX.Element | null {
  const { t } = props
  const preset = PRESETS.find((candidate) => candidate.id === props.id)
  if (preset === undefined) return null
  const data = presetData(preset, t)
  const prompt = data.prompt ?? ''
  return (
    <aside
      className={cx(ui.panel, css.panel)}
      data-testid="wl-step-panel"
      aria-label={t(preset.labelKey)}
    >
      <header className={css.head}>
        <StepMark look={presetAppearance(preset.id)} size={16} />
        <span className={css.headTitle}>{t(preset.labelKey)}</span>
        <span className={css.badge}>{t('step.builtin')}</span>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={() => props.onFocus(null)}
        >
          <Icon name="x" size={15} />
        </button>
      </header>
      <p className={css.subtitle}>{t(preset.descKey)}</p>

      <div className={css.body}>
        <PreviewCard
          t={t}
          label={t('ins.prompt')}
          text={prompt}
          name={t(preset.labelKey)}
          badge={<StepMark look={presetAppearance(preset.id)} size={15} />}
          meta={`${t('ins.prompt')} · ${[...prompt].length} ${t('ins.chars')}`}
          copyLabel={t('run.copyPrompt')}
          desktop={undefined}
          testId="wl-step-prompt"
          lines={8}
        />
        <section className={css.field}>
          <div className={css.label}>
            <span>{t('ins.output')}</span>
          </div>
          <OutputList t={t} output={data.output} owner={t(preset.labelKey)} />
        </section>
        <p className={css.note}>
          <Icon name="info" size={13} />
          <span>{t('step.readonlyNote')}</span>
        </p>
      </div>

      <footer className={css.foot}>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          data-testid="wl-step-add"
          onClick={() => props.onAddToCanvas({ kind: 'preset', id: preset.id })}
        >
          <Icon name="plus" size={14} />
          {t('step.addToCanvas')}
        </button>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.soft)}
          data-testid="wl-step-copy"
          onClick={() => props.onCopyToMine(data, preset.id)}
        >
          <Icon name="copy" size={14} />
          {t('step.copyToMine')}
        </button>
      </footer>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────
// 我的步骤（可编辑）
// ─────────────────────────────────────────────────────────────

interface Draft {
  name: string
  data: NodeData
}

const snapshot = (draft: Draft): string => JSON.stringify(draft)

function MineEditor(
  props: StepPanelProps & {
    /** 已存在的文件名；`null` = 新建。 */
    original: string | null
    seed: { seed: NodeData; name: string } | null
  },
): React.JSX.Element {
  const { t, wf, original } = props
  const [draft, setDraft] = useState<Draft | null>(
    props.seed === null ? null : { name: props.seed.name, data: props.seed.seed },
  )
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const remove = useConfirm<HTMLButtonElement>()
  const nameRef = useRef<HTMLInputElement>(null)

  // 已存在的：从磁盘读一份（提示词空着的半成品也读得出来）。
  useEffect(() => {
    if (original === null) {
      nameRef.current?.select()
      return
    }
    let alive = true
    void wf.loadTemplateDraft(original).then((data) => {
      if (!alive) return
      if (data === null) {
        props.onFocus(null)
        return
      }
      const loaded = { name: original, data }
      setDraft(loaded)
      setSaved(snapshot(loaded))
    })
    return () => {
      alive = false
    }
  }, [original])

  const normalized = draft === null ? '' : normalizeName(draft.name.trim())
  const nameProblem = draft === null ? null : checkName(normalized)
  const dirty = draft !== null && (saved === null || snapshot(draft) !== saved)
  const canSave = draft !== null && dirty && nameProblem === null && !saving

  const save = async (): Promise<boolean> => {
    if (draft === null || nameProblem !== null) return false
    setSaving(true)
    try {
      if (original === null) {
        const ok = await wf.saveTemplate(normalized, draft.data)
        if (ok) props.onFocus({ kind: 'template', name: normalized })
        return ok
      }
      const name = await wf.updateTemplate(normalized, draft.data, original)
      if (name === null) return false
      // 同步地记一笔"已经存过了"：改名会立刻换实例，卸载时读到的还是这一帧之前的状态。
      leaving.current = { ...leaving.current, dirty: false }
      const next = { name, data: draft.data }
      setDraft(next)
      setSaved(snapshot(next))
      if (name !== original) props.onFocus({ kind: 'template', name })
      return true
    } finally {
      setSaving(false)
    }
  }

  // 离开时还有没保存的改动：顺手存一次（只对已存在的那份；新建的半成品不偷偷落盘）。
  const leaving = useRef({ dirty, canSave, save, original })
  leaving.current = { dirty, canSave, save, original }
  useEffect(
    () => () => {
      const last = leaving.current
      if (last.original !== null && last.dirty && last.canSave) void last.save()
    },
    [],
  )

  const patch = (next: Partial<NodeData>): void => {
    setDraft((current) => {
      if (current === null) return current
      const data: NodeData = { ...current.data, ...next }
      for (const key of ['label', 'description', 'icon', 'color', 'prompt', 'output'] as const) {
        if (key in next && next[key] === undefined) delete data[key]
      }
      return { ...current, data }
    })
  }

  if (draft === null) {
    return (
      <aside className={cx(ui.panel, css.panel)} data-testid="wl-step-panel">
        <div className={css.loading}>{t('step.loading')}</div>
      </aside>
    )
  }

  const prompt = draft.data.prompt ?? ''
  return (
    <aside
      className={cx(ui.panel, css.panel)}
      data-testid="wl-step-panel"
      aria-label={original === null ? t('step.newTitle') : t('step.mine')}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          if (canSave) void save()
        }
      }}
    >
      <header className={css.head}>
        {/* 我的步骤的样子：新建时已挑好一个不重样的，点这里换；存进模板，拖到画布上的步骤照着它。 */}
        <AppearancePicker
          t={t}
          look={appearanceOf(normalized === '' ? 'step' : normalized, draft.data)}
          custom={draft.data.icon !== undefined || draft.data.color !== undefined}
          onChange={(next) => patch(next)}
        />
        <input
          className={css.titleInput}
          value={draft.data.label ?? ''}
          placeholder={normalized === '' ? t('step.labelPlaceholder') : normalized}
          aria-label={t('ins.name')}
          data-testid="wl-step-label"
          onChange={(event) => {
            // 名称会进计划里的表格：换行与竖线直接不让打进来。
            const value = event.currentTarget.value.replace(/[\r\n|]/gu, '')
            patch({ label: value === '' ? undefined : value })
          }}
        />
        <span className={css.badge}>{original === null ? t('step.newTitle') : t('step.mine')}</span>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={() => props.onFocus(null)}
        >
          <Icon name="x" size={15} />
        </button>
      </header>

      <div className={css.body}>
        <section className={css.field}>
          <div className={css.label}>
            <span>{t('step.id')}</span>
          </div>
          <input
            ref={nameRef}
            className={cx(ui.input, ui.mono)}
            value={draft.name}
            placeholder={t('tpl.placeholder')}
            aria-label={t('step.id')}
            aria-invalid={nameProblem !== null && draft.name !== ''}
            data-testid="wl-step-name"
            spellCheck={false}
            onChange={(event) => {
              const name = event.currentTarget.value
              setDraft((current) => (current === null ? current : { ...current, name }))
            }}
          />
          {nameProblem !== null && draft.name !== '' ? (
            <p className={css.error}>{nameProblem.message}</p>
          ) : (
            <p className={css.help}>{t('step.idHint')}</p>
          )}
        </section>

        <DescriptionField
          t={t}
          value={draft.data.description ?? ''}
          onChange={(description) =>
            patch({ description: description === '' ? undefined : description })
          }
        />
        <PreviewCard
          t={t}
          label={t('ins.prompt')}
          text={prompt}
          name={draft.data.label ?? (normalized === '' ? t('ins.prompt') : normalized)}
          badge={
            <StepMark
              look={appearanceOf(normalized === '' ? 'step' : normalized, draft.data)}
              size={15}
            />
          }
          meta={`${t('ins.prompt')} · ${[...prompt].length} ${t('ins.chars')}`}
          copyLabel={t('run.copyPrompt')}
          desktop={undefined}
          testId="wl-step-prompt-card"
          lines={8}
          edit={{
            placeholder: t('ins.promptPlaceholder'),
            testId: 'wl-step-prompt',
            onChange: (value) => patch({ prompt: value }),
          }}
        />

        <OutputField
          t={t}
          value={draft.data.output}
          suggest={`${normalized === '' ? 'output' : normalized}.md`}
          owner={draft.data.label ?? normalized}
          onChange={(output) => patch({ output })}
        />
      </div>

      <footer className={css.foot}>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          disabled={!canSave}
          data-testid="wl-step-save"
          onClick={() => void save()}
        >
          <Icon name="check" size={14} />
          {saving ? t('step.saving') : t('step.save')}
        </button>
        {original !== null && (
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            data-testid="wl-step-add"
            onClick={() => {
              // 先把改动存下去，拖到画布上的才是现在看到的这一版。
              void (dirty ? save() : Promise.resolve(true)).then((ok) => {
                if (ok) props.onAddToCanvas({ kind: 'template', name: normalized })
              })
            }}
          >
            <Icon name="plus" size={14} />
            {t('step.addToCanvas')}
          </button>
        )}
        <span className={css.saveState} data-dirty={dirty}>
          {dirty ? t('step.unsaved') : ''}
        </span>
        <span className={ui.grow} />
        {original !== null && (
          <button
            ref={remove.anchorRef}
            type="button"
            className={cx(ui.btn, ui.icon, ui.small, ui.danger)}
            data-tip={remove.open ? undefined : t('step.delete')}
            aria-label={t('step.delete')}
            aria-expanded={remove.open}
            data-testid="wl-step-delete"
            onClick={remove.toggle}
          >
            <Icon name="trash" size={15} />
          </button>
        )}
        {original !== null &&
          remove.render({
            t,
            title: t('step.deleteTitle').replace('{name}', original),
            desc: t('step.deleteConfirm'),
            confirmText: t('common.delete'),
            testId: 'wl-step-delete-confirm',
            onConfirm: () => {
              // 删掉之后不要再走"离开时顺手保存"。
              leaving.current = { ...leaving.current, dirty: false }
              setSaved(snapshot(draft))
              void wf.deleteTemplate(original).then((ok) => {
                if (ok) props.onFocus(null)
              })
            },
          })}
      </footer>
    </aside>
  )
}
