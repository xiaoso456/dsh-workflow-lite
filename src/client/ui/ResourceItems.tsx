/**
 * dsh-workflow-lite — 资源里的内容：面板里的紧凑清单 + 「添加」菜单。
 *
 * 一项一行，只放「一眼看清」的东西：种类图标、名字、位置（路径 / 网址 / 种类），有说明的在行尾挂个小标。
 * 要看、要改就点这一行，在模态框里编辑（{@link ResourceItemDialog}）；悬停时行尾浮出「移除」。
 *
 * 添加：点「添加内容」弹出一个小菜单——
 * - 文件、文件夹：直接打开主机上的选择框，可以一次选好几个；
 * - Skill：打开会话里的 agent 能用的 skill 清单，可以一次勾好几个、点眼睛看 SKILL.md；
 * - 网址、自定义、手填路径（还不存在的文件，比如产出）：打开编辑框，写好了才加进来。
 * 和已有的重复的不再加。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ResourceItems
 */

import { useState } from 'react'
import { MAX_RESOURCE_ITEMS } from '../../shared/limits.ts'
import type { ResourceItem, ResourceKind } from '../../shared/types.ts'
import type { HostAccess } from '../app/host.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { HostPicker, type PickMode } from './HostPicker.tsx'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import { ResourceItemDialog } from './ResourceItemDialog.tsx'
import css from './resource.module.css'
import { addItems, itemLocation, itemName, KIND_ICON, KIND_LABEL, sameItem } from './resourceUi.ts'
import { SkillPicker } from './SkillPicker.tsx'
import ui from './ui.module.css'

/** 「添加内容」菜单里的一行：种类 + 怎么加。`manualFile` = 手填一个文件路径。 */
type AddChoice = ResourceKind | 'manualFile'

const ADD_MENU: readonly { choice: ResourceKind; hint: LocaleKey }[] = [
  { choice: 'file', hint: 'res.addHint.file' },
  { choice: 'folder', hint: 'res.addHint.folder' },
  { choice: 'url', hint: 'res.addHint.url' },
  { choice: 'skill', hint: 'res.addHint.skill' },
  { choice: 'text', hint: 'res.addHint.text' },
]

/** 正在模态框里改哪一项：已有的按位置认，新加的带上种类。 */
type Editing = { index: number } | { kind: ResourceKind }

export function ResourceItems(props: {
  t: T
  items: readonly ResourceItem[]
  host: HostAccess
  /** 资源的显示名（编辑框的副标题）。 */
  owner: string
  /** 有步骤写这个资源（相对路径落在产出根目录下）。 */
  written: boolean
  /** 产出根目录（还没换实例 id；写在工作区根时为 `undefined`）。 */
  root: string | undefined
  /** 改内容：整份换掉。一次改动 = 一条撤销步。 */
  onChange(items: ResourceItem[]): void
}): React.JSX.Element {
  const { t, items } = props
  const [menu, setMenu] = useState(false)
  const [picking, setPicking] = useState<PickMode | null>(null)
  const [skills, setSkills] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const full = items.length >= MAX_RESOURCE_ITEMS

  const add = (fresh: ResourceItem[]): void => {
    const next = addItems(items, fresh, MAX_RESOURCE_ITEMS)
    if (next.length !== items.length) props.onChange(next)
  }

  const choose = (choice: AddChoice): void => {
    setMenu(false)
    if (choice === 'file' || choice === 'folder') setPicking(choice)
    else if (choice === 'skill') setSkills(true)
    else setEditing({ kind: choice === 'manualFile' ? 'file' : choice })
  }

  const editingIndex = editing !== null && 'index' in editing ? editing.index : null
  const editingItem = editingIndex === null ? null : (items[editingIndex] ?? null)

  return (
    <div className={css.items}>
      {items.length === 0 ? (
        <p className={css.itemsEmpty}>{t('res.itemsEmpty')}</p>
      ) : (
        <ul className={css.list} data-testid="wl-resource-list">
          {items.map((item, index) => (
            <ItemRow
              // 内容没有 id：按位置认。
              // biome-ignore lint/suspicious/noArrayIndexKey: 资源里的一项没有自己的身份
              key={index}
              t={t}
              item={item}
              duplicate={
                item.value.trim() !== '' &&
                items.findIndex((other) => sameItem(other, item)) !== index
              }
              written={props.written}
              root={props.root}
              onOpen={() => setEditing({ index })}
              onRemove={() => props.onChange(items.filter((_item, at) => at !== index))}
            />
          ))}
        </ul>
      )}

      <Popover
        open={menu}
        onClose={() => setMenu(false)}
        label={t('res.add')}
        className={css.addMenu}
        trigger={
          <button
            type="button"
            className={css.addButton}
            aria-expanded={menu}
            disabled={full}
            data-testid="wl-resource-add"
            onClick={() => setMenu((open) => !open)}
          >
            <Icon name="plus" size={13} />
            {full ? t('res.full').replace('{n}', String(MAX_RESOURCE_ITEMS)) : t('res.add')}
          </button>
        }
      >
        {ADD_MENU.map((entry) => (
          <button
            key={entry.choice}
            type="button"
            className={css.addItem}
            data-testid={`wl-resource-add-${entry.choice}`}
            onClick={() => choose(entry.choice)}
          >
            <span className={css.addIcon} data-kind={entry.choice}>
              <Icon name={KIND_ICON[entry.choice]} size={14} />
            </span>
            <span className={css.addText}>
              <span className={css.addName}>{t(KIND_LABEL[entry.choice])}</span>
              <span className={css.addHint}>{t(entry.hint)}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          className={css.addManual}
          data-testid="wl-resource-add-manual"
          onClick={() => choose('manualFile')}
        >
          <Icon name="pencil" size={12} />
          {t('res.addManual')}
        </button>
      </Popover>

      {picking !== null && (
        <HostPicker
          t={t}
          host={props.host}
          mode={picking}
          onPick={(paths) => {
            setPicking(null)
            add(paths.map((value) => ({ kind: picking, value })))
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {skills && (
        <SkillPicker
          t={t}
          host={props.host}
          existing={items.filter((item) => item.kind === 'skill').map((item) => item.value.trim())}
          onManual={() => {
            setSkills(false)
            setEditing({ kind: 'skill' })
          }}
          onPick={(names) => {
            setSkills(false)
            add(names.map((value) => ({ kind: 'skill', value })))
          }}
          onClose={() => setSkills(false)}
        />
      )}
      {editing !== null && (editingIndex === null || editingItem !== null) && (
        <ResourceItemDialog
          t={t}
          kind={editingItem?.kind ?? ('kind' in editing ? editing.kind : 'file')}
          initial={editingItem}
          owner={props.owner}
          host={props.host}
          written={props.written}
          root={props.root}
          others={items.filter((_item, at) => at !== editingIndex)}
          onSave={(item) => {
            setEditing(null)
            if (editingIndex === null) add([item])
            else props.onChange(items.map((old, at) => (at === editingIndex ? item : old)))
          }}
          onRemove={
            editingIndex === null
              ? undefined
              : () => {
                  setEditing(null)
                  props.onChange(items.filter((_item, at) => at !== editingIndex))
                }
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/**
 * 清单里的一行：图标、名字、位置，有说明的挂一个「说明」小签；这一块就是「打开它」的按钮。
 * 「移除」在行尾自己占一格（悬停或聚焦时才显出来，红色），不压在任何东西上面。
 */
function ItemRow(props: {
  t: T
  item: ResourceItem
  duplicate: boolean
  written: boolean
  root: string | undefined
  onOpen(): void
  onRemove(): void
}): React.JSX.Element {
  const { t, item } = props
  const name = itemName(item)
  const blank = name === ''
  const where = itemLocation(item, props.root, props.written)
  const note = item.note?.trim() ?? ''
  return (
    <li
      className={cx(css.row, ui.rise)}
      data-kind={item.kind}
      data-blank={blank}
      data-duplicate={props.duplicate}
      data-testid="wl-resource-item"
    >
      <button
        type="button"
        className={css.rowMain}
        data-tip={item.value.trim() === '' ? undefined : item.value.trim()}
        onClick={props.onOpen}
      >
        <span className={css.rowIcon} data-kind={item.kind}>
          <Icon name={KIND_ICON[item.kind]} size={14} />
        </span>
        <span className={css.rowName}>{blank ? t('res.itemBlank') : name}</span>
        <span className={css.rowWhere} data-mono={where.mono}>
          {props.duplicate
            ? t('res.duplicate')
            : where.text === ''
              ? t(KIND_LABEL[item.kind])
              : where.text}
        </span>
        {note !== '' && (
          <span className={css.rowNote} data-tip={note}>
            {t('res.note')}
          </span>
        )}
      </button>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, ui.danger, css.rowRemove)}
        aria-label={t('res.removeItem')}
        data-tip={t('res.removeItem')}
        data-testid="wl-resource-item-remove"
        onClick={props.onRemove}
      >
        <Icon name="x" size={13} />
      </button>
    </li>
  )
}
