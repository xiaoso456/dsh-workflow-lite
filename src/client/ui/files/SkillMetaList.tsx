/**
 * dsh-workflow-lite — SKILL.md 头部的元数据块：`name`、`description` 等字段排成几项，每项一个色点 + 字段名，下面是值。
 *
 * 看一个 skill 的 SKILL.md（{@link SkillPreview}）和浏览 skill 包时看 SKILL.md（{@link FolderBrowser}）都用它。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/files/SkillMetaList
 */

import type { T } from '../../i18n.ts'
import css from './skillMetaList.module.css'

/** 一个头部值怎么显示：字符串原样，数字、布尔转文字，一串简单值用顿号连起来，其余（对象、嵌套列表）压成一行 JSON。 */
export function metaText(value: unknown): string {
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

/** 色点循环用几种颜色（见 skillMetaList.module.css 的 `data-tone`）。 */
const TONES = 8

/**
 * 一份 Markdown 的 YAML 头部（解析好的键值）排成元数据的几项：`name`、`description`、`whenToUse` 在前、
 * 带中文名，其余按原顺序接在后面。浏览 skill 包时看 SKILL.md 用。
 */
export function headFields(
  t: T,
  head: Readonly<Record<string, unknown>>,
): { key: string; label?: string; value: string }[] {
  const known: [string, string][] = [
    ['name', t('skill.fieldName')],
    ['description', t('skill.fieldDesc')],
    ['whenToUse', t('skill.whenToUse')],
  ]
  const fields: { key: string; label?: string; value: string }[] = []
  for (const [key, label] of known) {
    if (head[key] !== undefined && head[key] !== null)
      fields.push({ key, label, value: metaText(head[key]) })
  }
  for (const [key, value] of Object.entries(head)) {
    if (known.some(([name]) => name === key) || value === null || value === undefined) continue
    fields.push({ key, value: metaText(value) })
  }
  return fields
}

/** 元数据那一块：给好的几项（值是空的不显示），导出成 skill 时预览 SKILL.md 也用它。 */
export function SkillMetaList(props: {
  t: T
  fields: readonly { key: string; label?: string; value: string }[]
  /** 标题旁的小字（缺省「SKILL.md 头部读到的字段」）。 */
  hint?: string
}): React.JSX.Element {
  const { t } = props
  const fields = props.fields.filter((field) => field.value.trim() !== '')
  return (
    <section className={css.skillMeta} data-testid="wl-skill-meta">
      <p className={css.skillMetaHead}>
        <span>{t('skill.meta')}</span>
        {props.hint ?? t('skill.metaHint')}
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
