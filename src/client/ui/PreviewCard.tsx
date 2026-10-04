/**
 * dsh-workflow-lite — 右栏里的一段长文字：只露前几行，点这块或标题行的 👁 在弹窗里看全文（可复制）。
 *
 * 实例里步骤的提示词、摘要、失败原因，连线的上游摘要与交接说明，模板里步骤的提示词都用它，长短不一但样子一致。
 * 能改的（给了 `edit`）标题行多一支笔，弹窗里多一个「编辑」：大段文字都在弹窗里改，右栏只露一截。
 * 空着的能改的那块写着占位，点一下直接进「编辑」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/PreviewCard
 */

import { useState } from 'react'
import type { Desktop } from '../app/desktop.ts'
import type { T } from '../i18n.ts'
import { type DocEdit, DocViewer } from './DocViewer.tsx'
import files from './files.module.css'
import { Icon } from './Icon.tsx'
import ins from './inspector.module.css'
import { cx } from './primitives.tsx'
import run from './run.module.css'
import css from './runstep.module.css'
import ui from './ui.module.css'

/** 能改时怎么交出去。 */
export interface PreviewEdit extends Omit<DocEdit, 'start'> {
  /** 弹窗关上（一次编辑结束）：断开撤销合并。 */
  onSeal?(): void
}

export function PreviewCard(props: {
  t: T
  /** 小标题（可以带改过的小圆点）。 */
  label: React.ReactNode
  text: string
  /** 弹窗：标题、左边的图标块、标题下面一行、收在「说明」开关里的说明。 */
  name: string
  badge: React.ReactNode
  meta: string
  note?: string
  copyLabel: string
  desktop: Desktop | undefined
  testId: string
  /** 露几行（缺省 4）。 */
  lines?: number
  /** 卡片下面的一行说明。 */
  help?: React.ReactNode
  edit?: PreviewEdit
  /** 一出来就打开弹窗、进「编辑」（刚加的空白步骤写提示词）。 */
  autoEdit?: boolean
}): React.JSX.Element {
  const { t, edit } = props
  const [open, setOpen] = useState<'view' | 'edit' | null>(
    props.autoEdit === true && edit !== undefined ? 'edit' : null,
  )
  const text = edit === undefined ? props.text.trim() : props.text
  const empty = text.trim() === ''
  const close = (): void => {
    setOpen(null)
    edit?.onSeal?.()
  }
  return (
    <section className={run.section} data-testid={props.testId}>
      <div className={css.titleRow}>
        <span className={files.groupTitle}>
          {props.label}
          <span className={files.groupCount}>
            {[...text].length} {t('ins.chars')}
          </span>
        </span>
        <span className={css.titleActions}>
          {edit !== undefined && (
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
              data-tip={t('file.edit')}
              aria-label={t('file.edit')}
              data-testid={`${props.testId}-edit`}
              onClick={() => setOpen('edit')}
            >
              <Icon name="pencil" size={14} />
            </button>
          )}
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
            data-tip={t('run.viewAll')}
            aria-label={t('run.viewAll')}
            data-testid={`${props.testId}-view`}
            onClick={() => setOpen('view')}
          >
            <Icon name="eye" size={15} />
          </button>
        </span>
      </div>
      <button
        type="button"
        className={css.card}
        style={{ WebkitLineClamp: props.lines ?? 4 }}
        data-empty={empty}
        data-testid={`${props.testId}-card`}
        onClick={() => setOpen(empty && edit !== undefined ? 'edit' : 'view')}
      >
        {empty ? (edit?.placeholder ?? '') : text}
      </button>
      {props.help !== undefined && <p className={ins.help}>{props.help}</p>}
      {open !== null && (
        <DocViewer
          t={t}
          name={props.name}
          badge={props.badge}
          meta={props.meta}
          body={{ kind: 'text', text, format: 'markdown' }}
          copyPath={text}
          copyLabel={props.copyLabel}
          openPath={null}
          desktop={props.desktop}
          testId={`${props.testId}-viewer`}
          {...(props.note === undefined ? {} : { note: props.note })}
          {...(edit === undefined ? {} : { edit: { ...edit, start: open === 'edit' } })}
          onClose={close}
        />
      )}
    </section>
  )
}
