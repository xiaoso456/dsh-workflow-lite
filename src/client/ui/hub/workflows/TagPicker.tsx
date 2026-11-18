/**
 * dsh-workflow-lite — 给一个工作流打标签的下拉：搜索框 + 全部已有标签（勾着的是这个工作流打了的），
 * 点一项就勾上 / 去掉、立即生效，菜单留着接着挑；搜索框里的字不是已有标签时，末尾一项「新建标签「…」」。
 *
 * 右栏标签那一排末尾的「+ 标签」开它；每项前面是这个标签的颜色。
 * 浮层挂到视图根（{@link useFloat}）：从滚动的列表里开也不被裁掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/TagPicker
 */

import { normalizeTag, sameTag, tagColorOf } from '../../../../shared/tags.ts'
import type { T } from '../../../i18n.ts'
import type { TagUse } from '../../../model/workflowList.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { SelectMenu } from '../../kit/SelectMenu.tsx'
import ui from '../../kit/ui.module.css'
import { FLOAT_EXIT_MS, useFloat } from '../../kit/useFloat.tsx'
import { type TagColors, TagMark } from './TagMark.tsx'
import css from './tags.module.css'

const PICKER_W = 232
const LIST_MAX = 232

/** 勾上 / 去掉一个标签之后的那一组。 */
export function toggleTag(value: readonly string[], tag: string): string[] {
  return value.some((known) => sameTag(known, tag))
    ? value.filter((known) => !sameTag(known, tag))
    : [...value, tag]
}

export function TagPicker(props: {
  t: T
  /** 全部工作流上打过的标签。 */
  catalog: readonly TagUse[]
  /** 挑过颜色的标签。 */
  colors: TagColors
  /** 这个工作流打了的。 */
  value: readonly string[]
  onChange(next: string[]): void
  /** 读屏念的（「给 周报 打标签」）。 */
  label: string
  testId: string
}): React.JSX.Element {
  const { t, value } = props
  const menu = useFloat<HTMLButtonElement>({
    openMs: 0,
    closeMs: 0,
    width: PICKER_W,
    align: 'start',
    exitMs: FLOAT_EXIT_MS,
    initialFocus: 'input',
  })
  const open = menu.state !== 'off'
  // 已有的用目录里的写法；这个工作流上有、目录里还没有的（刚建、列表还没刷新）补在后面。
  const tags = [
    ...props.catalog.map((use) => use.tag),
    ...value.filter((tag) => !props.catalog.some((use) => sameTag(use.tag, tag))),
  ]
  const checked = new Set(tags.filter((tag) => value.some((known) => sameTag(known, tag))))
  const toggle = (): void => menu.setState(open ? 'off' : 'pinned')

  return (
    <>
      <button
        ref={menu.anchorRef}
        type="button"
        className={css.add}
        data-fit="add"
        aria-label={props.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip={open ? undefined : t('hub.addTagTip')}
        data-testid={props.testId}
        onClick={toggle}
        onKeyDown={menu.onKeyDown}
      >
        <Icon name="plus" size={12} />
        {t('hub.addTag')}
      </button>
      {menu.render({
        className: cx(ui.confirmPop, css.picker),
        role: 'dialog',
        label: props.label,
        testId: `${props.testId}-menu`,
        children: (
          <SelectMenu<string>
            open={open}
            label={t('hub.tags')}
            options={tags.map((tag) => ({
              value: tag,
              label: tag,
              lead: <TagMark color={tagColorOf(props.colors, tag)} />,
              count: props.catalog.find((use) => sameTag(use.tag, tag))?.count ?? 0,
            }))}
            checked={checked}
            searchable
            t={t}
            testId={`${props.testId}-item`}
            listMax={LIST_MAX}
            placeholder={t('hub.tagSearch')}
            emptyText={t('hub.tagNone')}
            create={{
              label: (text) => t('hub.tagCreate').replace('{tag}', normalizeTag(text) ?? text),
              exists: (text) => {
                const tag = normalizeTag(text)
                return tag === null || tags.some((known) => sameTag(known, tag))
              },
              onCreate: (text) => {
                const tag = normalizeTag(text)
                if (tag !== null) props.onChange(toggleTag(value, tag))
              },
            }}
            onPick={(tag) => props.onChange(toggleTag(value, tag))}
          />
        ),
      })}
    </>
  )
}
