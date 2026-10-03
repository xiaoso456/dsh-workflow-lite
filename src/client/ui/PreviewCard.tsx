/**
 * dsh-workflow-lite — 右栏里一段只读的长文字：只露前几行，点这块或标题行的 👁 在弹窗里看全文（可复制）。
 *
 * 实例里步骤的提示词、连线的上游摘要与交接说明都用它，长短不一但样子一致。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/PreviewCard
 */

import { useState } from 'react'
import type { Desktop } from '../app/desktop.ts'
import type { T } from '../i18n.ts'
import { DocViewer } from './DocViewer.tsx'
import files from './files.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import run from './run.module.css'
import css from './runstep.module.css'
import ui from './ui.module.css'

export function PreviewCard(props: {
  t: T
  /** 小标题。 */
  label: string
  text: string
  /** 弹窗：标题、左边的图标块、标题下面一行、正文前的一段。 */
  name: string
  badge: React.ReactNode
  meta: string
  lead?: React.ReactNode
  copyLabel: string
  desktop: Desktop | undefined
  testId: string
  /** 露几行（缺省 4）。 */
  lines?: number
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  const text = props.text.trim()
  return (
    <section className={run.section} data-testid={props.testId}>
      <div className={css.titleRow}>
        <span className={files.groupTitle}>
          {props.label}
          <span className={files.groupCount}>
            {[...text].length} {t('ins.chars')}
          </span>
        </span>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
          data-tip={t('run.viewAll')}
          aria-label={t('run.viewAll')}
          data-testid={`${props.testId}-view`}
          onClick={() => setOpen(true)}
        >
          <Icon name="eye" size={15} />
        </button>
      </div>
      <button
        type="button"
        className={css.card}
        style={{ WebkitLineClamp: props.lines ?? 4 }}
        onClick={() => setOpen(true)}
      >
        {text}
      </button>
      {open && (
        <DocViewer
          t={t}
          name={props.name}
          badge={props.badge}
          meta={props.meta}
          body={{ kind: 'text', text, markdown: true }}
          copyPath={text}
          copyLabel={props.copyLabel}
          openPath={null}
          desktop={props.desktop}
          testId={`${props.testId}-viewer`}
          lead={props.lead}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  )
}
