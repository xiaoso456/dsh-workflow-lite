/**
 * dsh-workflow-lite — 看一个 skill 的 SKILL.md。
 *
 * 框子是 {@link DocViewer}：正文默认排版、可切源码；标题行能复制路径、用其他程序打开
 * SKILL.md 或在文件管理器里显示它所在的文件夹（插件运行时注册的 skill 没有文件，这两样不出现）。
 * 正文前是它的一句话说明和「什么时候用」。从选择框里点开时，底部带一个「选上 / 用这个」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/SkillPreview
 */

import { useEffect, useState } from 'react'
import type { HostSkillResponse } from '../../shared/wire.ts'
import type { HostAccess } from '../app/host.ts'
import type { T } from '../i18n.ts'
import { errorMessage } from '../rpc.ts'
import { type DocBody, DocViewer } from './DocViewer.tsx'
import { Icon, type IconName } from './Icon.tsx'
import overlay from './overlay.module.css'
import { cx } from './primitives.tsx'
import css from './resource.module.css'
import { fileMetadata, skillSource } from './resourceUi.ts'
import ui from './ui.module.css'

/** 底部的那个按钮（不给就没有底部）。 */
export interface SkillPreviewAction {
  label: string
  icon: IconName
  primary: boolean
  disabled?: boolean
  onClick(): void
}

/** 一个头部值怎么显示：字符串原样，数字、布尔转文字，一串简单值用顿号连起来，其余（对象、嵌套列表）压成一行 JSON。 */
function metaText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null)) {
    return value.map(String).join('、')
  }
  return JSON.stringify(value)
}

const WEB = /^https?:\/\/\S+$/iu

/** 值是一个网址就做成链接（新窗口、不带来源），否则就是文字。 */
function MetaValue(props: { text: string }): React.JSX.Element {
  const { text } = props
  if (!WEB.test(text)) return <>{text}</>
  return (
    <a href={text} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  )
}

/** 色点循环用几种颜色（见 resource.module.css 的 `data-tone`）。 */
const TONES = 8

/**
 * 正文前的元数据：SKILL.md 头部能读到的字段。`name` 一定有；`description`、`whenToUse` 没有就不显示；
 * 头部的其余键值（宿主解析出的 `metadata`）接在后面，有几条显示几条。
 * 每块一个色点（按排位循环换色）+ 等宽的字段名，前三个字段另带中文名，下面是值。
 */
function SkillMeta(props: { t: T; skill: HostSkillResponse }): React.JSX.Element {
  const { t, skill } = props
  const fields: { key: string; label?: string; value: string }[] = [
    { key: 'name', label: t('skill.fieldName'), value: skill.name },
  ]
  if (skill.description.trim() !== '') {
    fields.push({ key: 'description', label: t('skill.fieldDesc'), value: skill.description })
  }
  if (skill.whenToUse !== undefined && skill.whenToUse.trim() !== '') {
    fields.push({ key: 'whenToUse', label: t('skill.whenToUse'), value: skill.whenToUse })
  }
  for (const [key, value] of fileMetadata(skill.metadata)) {
    const text = metaText(value)
    if (value !== null && value !== undefined && text.trim() !== '')
      fields.push({ key, value: text })
  }
  return <SkillMetaList t={t} fields={fields} />
}

/** 元数据那一块：给好的几项（值是空的不显示），导出成 skill 时预览 SKILL.md 也用它。 */
export function SkillMetaList(props: {
  t: T
  fields: readonly { key: string; label?: string; value: string }[]
}): React.JSX.Element {
  const { t } = props
  const fields = props.fields.filter((field) => field.value.trim() !== '')
  return (
    <section className={css.skillMeta} data-testid="wl-skill-meta">
      <p className={css.skillMetaHead}>
        <span>{t('skill.meta')}</span>
        {t('skill.metaHint')}
      </p>
      <dl className={css.skillMetaList}>
        {fields.map((field, index) => (
          <div
            key={field.key}
            className={css.skillMetaField}
            data-field={field.key}
            data-tone={index % TONES}
          >
            <dt>
              <i aria-hidden="true" />
              <code>{field.key}</code>
              {field.label !== undefined && <span>{field.label}</span>}
            </dt>
            <dd>
              <MetaValue text={field.value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function SkillPreview(props: {
  t: T
  host: HostAccess
  name: string
  action?: SkillPreviewAction
  onClose(): void
}): React.JSX.Element {
  const { t, host, name } = props
  const [skill, setSkill] = useState<HostSkillResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSkill(null)
    setError(null)
    void host.skill(name).then(
      (next) => {
        if (alive) setSkill(next)
      },
      (reason: unknown) => {
        if (alive) setError(errorMessage(reason))
      },
    )
    return () => {
      alive = false
    }
  }, [host, name])

  const body: DocBody =
    error !== null
      ? { kind: 'state', icon: 'alert', text: error }
      : skill === null
        ? { kind: 'loading' }
        : { kind: 'text', text: skill.content, format: 'markdown' }
  const source = skill === null ? null : skillSource(skill.source, t)
  const action = props.action

  return (
    <DocViewer
      t={t}
      name={name}
      badge={
        <span className={cx(overlay.sheetIcon, css.skillHeadIcon)}>
          <Icon name="sparkle" size={16} />
        </span>
      }
      meta={
        source === null ? (
          ' '
        ) : (
          <span data-tip={source.full}>
            {source.short}
            {' · '}
            {skill?.path === undefined ? t('skill.virtual') : <code>{skill.path}</code>}
          </span>
        )
      }
      body={body}
      copyPath={skill?.path ?? null}
      openPath={skill?.path ?? null}
      desktop={host.desktop}
      testId="wl-skill-preview"
      className={css.skillViewer}
      lead={skill === null ? undefined : <SkillMeta t={t} skill={skill} />}
      footer={
        action === undefined ? undefined : (
          <footer className={css.skillViewerFoot}>
            <span className={ui.grow} />
            <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.small, action.primary && ui.primary)}
              disabled={action.disabled === true}
              data-testid="wl-skill-preview-action"
              onClick={action.onClick}
            >
              <Icon name={action.icon} size={13} />
              {action.label}
            </button>
          </footer>
        )
      }
      onClose={props.onClose}
    />
  )
}
