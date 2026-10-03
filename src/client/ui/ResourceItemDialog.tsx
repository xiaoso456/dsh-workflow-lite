/**
 * dsh-workflow-lite — 编辑（或新加）资源里的一项：模态框。
 *
 * 面板里的清单一行只放名字和位置；值、说明、「浏览」「从清单选」这些交互都在这里，有地方好好写。
 * - 文件 / 文件夹：路径 +「浏览」（主机上选）；下面写出实际位置（相对路径看有没有步骤写它）。
 * - 网址：一行网址，旁边能直接打开看一眼。
 * - Skill：skill 名 +「从清单选」；DSH 认得这个名字就把它的一句话说明带出来，还能点开看 SKILL.md。
 * - 自定义：一大块文字，就是一段原样交给执行者的提示词（它本身就是正文，没有说明）。
 * 「完成」时才一次交出去（一次改动 = 一条撤销步），交出去的永远是写法合法、不重复的一项。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ResourceItemDialog
 */

import { useEffect, useRef, useState } from 'react'
import { MAX_RESOURCE_TEXT_CODEPOINTS, MAX_TEXT_CODEPOINTS } from '../../shared/limits.ts'
import { codepointLength } from '../../shared/naming.ts'
import { isAbsoluteRoot, resolveItemPath } from '../../shared/outputPaths.ts'
import type { ResourceItem, ResourceKind } from '../../shared/types.ts'
import { itemProblem } from '../../shared/validate.ts'
import type { HostSkillsResponse } from '../../shared/wire.ts'
import type { HostAccess } from '../app/host.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { HostPicker } from './HostPicker.tsx'
import { Icon } from './Icon.tsx'
import ins from './inspector.module.css'
import overlay from './overlay.module.css'
import { cx, Modal } from './primitives.tsx'
import css from './resource.module.css'
import { KIND_ICON, KIND_LABEL, sameItem } from './resourceUi.ts'
import { SkillPicker } from './SkillPicker.tsx'
import { SkillPreview } from './SkillPreview.tsx'
import ui from './ui.module.css'

/** 每种内容的值叫什么、输入框里的提示。 */
const VALUE_LABEL: Record<ResourceKind, LocaleKey> = {
  file: 'res.valueFile',
  folder: 'res.valueFolder',
  url: 'res.valueUrl',
  skill: 'res.valueSkill',
  text: 'res.valueText',
}

const PLACEHOLDER: Record<ResourceKind, LocaleKey> = {
  file: 'res.filePlaceholder',
  folder: 'res.folderPlaceholder',
  url: 'res.urlPlaceholder',
  skill: 'res.skillPlaceholder',
  text: 'res.textPlaceholder',
}

/** 路径的上一级（「浏览」从那儿开始看）；相对路径没法定位就从工作区看。 */
function parentOf(path: string): string | undefined {
  const value = path.trim().replace(/\\/gu, '/')
  if (!isAbsoluteRoot(value)) return undefined
  const cut = value.replace(/\/$/u, '').lastIndexOf('/')
  return cut <= 0 ? value : value.slice(0, cut + 1)
}

/** 一行的值：路径、网址、skill 名都不许换行；skill 名统一小写。 */
function oneLine(kind: ResourceKind, value: string): string {
  const flat = value.replace(/[\r\n]+/gu, '')
  return kind === 'skill' ? flat.toLowerCase() : flat
}

export function ResourceItemDialog(props: {
  t: T
  kind: ResourceKind
  /** `null` = 新加一项。 */
  initial: ResourceItem | null
  /** 属于哪个资源（副标题）。 */
  owner: string
  host: HostAccess
  /** 有步骤写这个资源（相对路径落在产出根目录下）。 */
  written: boolean
  /** 产出根目录（还没换实例 id；写在工作区根时为 `undefined`）。 */
  root: string | undefined
  /** 同一资源里的其它项（查重）。 */
  others: readonly ResourceItem[]
  onSave(item: ResourceItem): void
  onRemove?: (() => void) | undefined
  onClose(): void
}): React.JSX.Element {
  const { t, kind, initial } = props
  const [value, setValue] = useState(initial?.value ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [browsing, setBrowsing] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<HostSkillsResponse | null>(null)
  const valueRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const pathLike = kind === 'file' || kind === 'folder'

  // 新加的：光标进值；已有的：多半是来补说明的，光标进说明（自定义没有说明，进正文）。
  useEffect(() => {
    const target = initial === null || kind === 'text' ? valueRef.current : noteRef.current
    if (target === null) return
    target.focus()
    target.setSelectionRange(target.value.length, target.value.length)
  }, [])

  useEffect(() => {
    if (kind !== 'skill') return
    let alive = true
    void props.host.skills().then(
      (next) => {
        if (alive) setCatalog(next)
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [kind, props.host])

  const draft: ResourceItem =
    kind === 'text' || note.trim() === ''
      ? { kind, value: kind === 'text' ? value : value.trim() }
      : { kind, value: value.trim(), note: note.trim() }
  const blank = value.trim() === ''
  const duplicate = !blank && props.others.some((other) => sameItem(other, draft))
  const problem = itemProblem(draft)?.message ?? null
  const valueError = duplicate ? t('res.duplicateHint') : problem
  const valid = !blank && valueError === null
  const dirty = value !== (initial?.value ?? '') || note !== (initial?.note ?? '')

  const trimmed = value.trim()
  const located =
    pathLike && !blank && !isAbsoluteRoot(trimmed.replace(/\\/gu, '/'))
      ? resolveItemPath(props.root, trimmed, props.written)
      : null
  const openable = kind === 'url' && /^https?:\/\/\S+$/iu.test(trimmed)
  const known =
    kind === 'skill' && catalog !== null && catalog.available
      ? catalog.skills.find((entry) => entry.name === trimmed)
      : undefined

  const submit = (): void => {
    if (valid) props.onSave(draft)
  }

  const title = t(KIND_LABEL[kind])
  return (
    <>
      <Modal
        label={title}
        testId="wl-resource-item-dialog"
        className={css.itemSheet}
        // 有没写完的改动时，点遮罩不关；Esc 和「取消」照常。
        onDismiss={() => {
          if (!dirty) props.onClose()
        }}
      >
        <form
          className={overlay.sheetForm}
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              props.onClose()
              return
            }
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        >
          <header className={overlay.sheetHead}>
            <span className={cx(overlay.sheetIcon, css.sheetKind)} data-kind={kind}>
              <Icon name={KIND_ICON[kind]} size={16} />
            </span>
            <div className={overlay.sheetTitles}>
              <p className={overlay.sheetTitle}>
                {initial === null ? t('res.addKindTitle').replace('{kind}', title) : title}
              </p>
              <p className={overlay.sheetSub}>{props.owner}</p>
            </div>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('common.close')}
              onClick={props.onClose}
            >
              <Icon name="x" size={15} />
            </button>
          </header>

          <div className={overlay.sheetBody}>
            <section className={ins.field}>
              <label className={ins.label} htmlFor="wl-resource-value">
                <span>{t(VALUE_LABEL[kind])}</span>
                {kind === 'text' && (
                  <span className={ins.count}>
                    {codepointLength(value)} / {MAX_RESOURCE_TEXT_CODEPOINTS}
                  </span>
                )}
              </label>
              {kind === 'text' ? (
                <textarea
                  id="wl-resource-value"
                  ref={valueRef}
                  className={cx(ui.textarea, css.textArea)}
                  value={value}
                  placeholder={t(PLACEHOLDER[kind])}
                  aria-invalid={valueError !== null}
                  data-testid="wl-resource-value"
                  onChange={(event) => setValue(event.currentTarget.value)}
                />
              ) : (
                <div className={css.valueRow}>
                  <input
                    id="wl-resource-value"
                    ref={valueRef}
                    className={cx(ui.input, css.value, kind !== 'url' && ui.mono)}
                    value={value}
                    type={kind === 'url' ? 'url' : 'text'}
                    placeholder={t(PLACEHOLDER[kind])}
                    aria-invalid={valueError !== null}
                    spellCheck={false}
                    autoComplete="off"
                    data-testid="wl-resource-value"
                    onChange={(event) => setValue(oneLine(kind, event.currentTarget.value))}
                  />
                  {pathLike && (
                    <button
                      type="button"
                      className={cx(ui.btn, ui.small, ui.soft, css.valueAction)}
                      data-testid="wl-resource-browse"
                      onClick={() => setBrowsing(true)}
                    >
                      <Icon name="folderOpen" size={13} />
                      {t('res.browse')}
                    </button>
                  )}
                  {kind === 'skill' && (
                    <button
                      type="button"
                      className={cx(ui.btn, ui.small, ui.soft, css.valueAction)}
                      data-testid="wl-resource-choose-skill"
                      onClick={() => setChoosing(true)}
                    >
                      <Icon name="sparkle" size={13} />
                      {t('res.chooseSkill')}
                    </button>
                  )}
                  {kind === 'url' && (
                    <a
                      className={cx(ui.btn, ui.small, ui.soft, css.valueAction)}
                      href={openable ? trimmed : undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-disabled={!openable}
                      data-testid="wl-resource-open-url"
                    >
                      <Icon name="external" size={13} />
                      {t('res.openUrl')}
                    </a>
                  )}
                </div>
              )}
              {valueError !== null && !blank ? (
                <p className={ins.error}>{valueError}</p>
              ) : located !== null ? (
                <div className={ins.rootPreview} data-testid="wl-resource-located">
                  <span className={ins.rootPreviewLabel}>
                    {props.written ? t('res.locatedOut') : t('res.locatedWorkspace')}
                  </span>
                  <code className={ins.rootPreviewResult}>{located}</code>
                </div>
              ) : known !== undefined ? (
                <div className={css.skillKnown} data-testid="wl-resource-skill-known">
                  <Icon name="check" size={12} />
                  <span>{known.description === '' ? t('res.skillKnown') : known.description}</span>
                  <button
                    type="button"
                    className={css.skillKnownPeek}
                    data-testid="wl-resource-skill-preview"
                    onClick={() => setPreviewing(known.name)}
                  >
                    <Icon name="eye" size={12} />
                    {t('skill.preview')}
                  </button>
                </div>
              ) : (
                <p className={ins.help}>
                  {kind === 'skill' && catalog?.available === true && !blank
                    ? t('res.skillUnknown')
                    : t(
                        pathLike
                          ? isAbsoluteRoot(trimmed.replace(/\\/gu, '/'))
                            ? 'res.absoluteHint'
                            : 'res.pathHint'
                          : kind === 'url'
                            ? 'res.urlHint'
                            : kind === 'skill'
                              ? 'res.skillHint'
                              : 'res.textHint',
                      )}
                </p>
              )}
            </section>

            {kind !== 'text' && (
              <section className={ins.field}>
                <label className={ins.label} htmlFor="wl-resource-note">
                  <span>
                    {t('res.note')}
                    <span className={ins.optional}>{t('out.optional')}</span>
                  </span>
                  <span className={ins.count}>
                    {codepointLength(note)} / {MAX_TEXT_CODEPOINTS}
                  </span>
                </label>
                <textarea
                  id="wl-resource-note"
                  ref={noteRef}
                  className={cx(ui.textarea, css.noteArea)}
                  value={note}
                  placeholder={
                    pathLike && props.written
                      ? t('res.notePlaceholderWrite')
                      : t('res.notePlaceholder')
                  }
                  data-testid="wl-resource-note"
                  onChange={(event) => setNote(event.currentTarget.value)}
                />
                <p className={ins.help}>{t('res.noteHint')}</p>
              </section>
            )}
          </div>

          <footer className={overlay.sheetFoot}>
            {props.onRemove !== undefined && (
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.danger)}
                data-testid="wl-resource-item-remove"
                onClick={props.onRemove}
              >
                <Icon name="trash" size={14} />
                {t('res.removeItem')}
              </button>
            )}
            <span className={ui.grow} />
            <span className={overlay.sheetKeys}>{t('out.submitKeys')}</span>
            <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={cx(ui.btn, ui.small, ui.primary)}
              disabled={!valid}
              data-testid="wl-resource-item-done"
            >
              <Icon name="check" size={14} />
              {initial === null ? t('res.addDone') : t('out.done')}
            </button>
          </footer>
        </form>
      </Modal>

      {/* 选择框放在表单外面：它们自己的表单（路径栏）提交时，React 的事件会顺着组件树冒到这张表单上。 */}
      {browsing && (
        <HostPicker
          t={t}
          host={props.host}
          mode={kind === 'folder' ? 'folder' : 'file'}
          single
          {...(() => {
            const start = parentOf(value)
            return start === undefined ? {} : { start }
          })()}
          onPick={(paths) => {
            setBrowsing(false)
            const [first] = paths
            if (first !== undefined) setValue(first)
            requestAnimationFrame(() => valueRef.current?.focus())
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
      {choosing && (
        <SkillPicker
          t={t}
          host={props.host}
          single
          existing={props.others
            .filter((other) => other.kind === 'skill')
            .map((other) => other.value.trim())}
          onPick={(names) => {
            setChoosing(false)
            const [first] = names
            if (first !== undefined) setValue(first)
          }}
          onClose={() => setChoosing(false)}
        />
      )}
      {previewing !== null && (
        <SkillPreview
          t={t}
          host={props.host}
          name={previewing}
          onClose={() => setPreviewing(null)}
        />
      )}
    </>
  )
}
