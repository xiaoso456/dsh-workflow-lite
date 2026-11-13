/**
 * dsh-workflow-lite — 触发卡片的属性面板：只放摘要，长的设置都在对话框里（`dialogs/`，草稿，「保存」才写进图）。
 *
 * 从上到下：
 * - **现在怎么样**（只在模板视图）：开关与状态、确认命令、「立即触发一次」；
 * - **触发方式**：五种触发方式的分段 + 和画布卡片一样的速览，点开是「触发方式」对话框；
 * - **过滤**（轮询、监听、HTTP 才有）：一行摘要，点开是「过滤」对话框；
 * - **触发条件、触发说明**：各两行预览，点开是同一个对话框，焦点落在点的那一段；
 * - **执行设置**：会话方式、工作区（打开开关前就要选好，留在面板上），「保护」一行摘要点开是对话框；
 * - **触发记录**（只在模板视图）：最近三次，「全部记录」到工作流中心「触发」页。
 *
 * 标题旁不再挂触发源的小标：下面「触发方式」的分段里就写着。
 *
 * 触发源、过滤、条件、说明、启动方式写在图里；开关、工作区、会话、令牌是这台机器上的事（见 `triggerEnv.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerPanel
 */

import { useState } from 'react'
import { idKey } from '../../../shared/model.ts'
import { filterOf, isFilterKind, triggerName } from '../../../shared/trigger.ts'
import type { TriggerData, TriggerNode } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import type { Edit, Selection } from '../../model/editor.ts'
import { filterSummary } from '../../model/triggerSummary.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { EDIT_VIEW, useSwap } from '../motion/swap.tsx'
import { FieldHead } from '../panel/FieldHead.tsx'
import { cleanName } from '../panel/NodeHeads.tsx'
import { PanelHead } from '../panel/PanelHead.tsx'
import ins from '../panel/panel.module.css'
import { TitleField } from '../panel/TitleField.tsx'
import { FilterDialog } from './dialogs/FilterDialog.tsx'
import { NotesDialog, type NotesField } from './dialogs/NotesDialog.tsx'
import { LaunchField } from './LaunchField.tsx'
import { SummaryList, SummaryRow } from './SummaryRow.tsx'
import { TriggerLog, TriggerStatus } from './TriggerStatus.tsx'
import { useTriggerEnv } from './triggerEnv.ts'
import { WhenCard } from './WhenCard.tsx'

export interface TriggerPanelProps {
  t: T
  node: TriggerNode
  onEdit(edit: Edit): void
  onSelect(selection: Selection): void
  onSeal(): void
  onRemove(id: string): void
  /** 标题栏里关闭按钮左边的切换（实例视图里「运行 / 编辑」）。 */
  tabs?: React.ReactNode
}

export function TriggerPanel(props: TriggerPanelProps): React.JSX.Element {
  const { t, node, onEdit } = props
  const env = useTriggerEnv()
  const swap = useSwap<HTMLElement>(idKey(node.id), node.position.x, EDIT_VIEW)
  const data = node.data
  const name = triggerName(node)
  /** 开着的详细设置对话框（「触发方式」「保护」的在各自那一节里）。 */
  const [dialog, setDialog] = useState<
    { kind: 'filter' } | { kind: 'notes'; focus: NotesField } | null
  >(null)
  const patch = (next: Partial<TriggerData>, field?: string): void => {
    onEdit({
      type: 'patchTrigger',
      id: node.id,
      patch: next,
      ...(field === undefined ? {} : { merge: `${idKey(node.id)}:trigger:${field}` }),
    })
  }

  return (
    <aside
      ref={swap}
      className={cx(ui.panel, ins.panel)}
      // 短标签那一列的宽度按语言给：各行控件左边对齐（见 trigger.module.css 的 .lead）。
      style={{ '--wl-trigger-lead': t('trigger.leadWidth') } as React.CSSProperties}
      data-testid="wl-inspector"
      aria-label={t('trigger.title')}
    >
      <PanelHead
        t={t}
        lead={
          <span className={cx(ins.triggerIcon, ins.headIcon)}>
            <Icon name="bolt" size={16} />
          </span>
        }
        title={
          <TitleField
            t={t}
            value={data.label ?? ''}
            placeholder={node.id}
            ariaLabel={t('trigger.name')}
            testId="wl-trigger-name"
            onType={(value) => patch({ label: cleanName(value) }, 'label')}
            onBlur={props.onSeal}
          />
        }
        id={node.id}
        extra={props.tabs}
        onClose={() => props.onSelect(null)}
      />

      <div className={ins.body}>
        {env === null ? (
          <p className={ins.help}>{t('trigger.snapshot')}</p>
        ) : (
          <TriggerStatus t={t} env={env} node={node.id} data={data} />
        )}

        <WhenCard
          t={t}
          node={node.id}
          name={name}
          source={data.source}
          env={env}
          onChange={(source) => patch({ source })}
        />

        {/* 触发之后依次经过的几关：过滤（不花模型调用）→ 触发条件（模型判断）→ 触发说明（交给模型的话）。
            单独一组、带组标题，不和上面「触发方式」那张卡看成一组。 */}
        <section className={ins.field} data-testid="wl-trigger-notes">
          <FieldHead title={t('trigger.afterFire')} />
          <SummaryList>
            {isFilterKind(data.source.kind) && (
              <SummaryRow
                title={t('trigger.filter')}
                summary={filterSummary(t, filterOf(data))}
                editLabel={t('trigger.edit')}
                testId="wl-trigger-filter-edit"
                onEdit={() => setDialog({ kind: 'filter' })}
              />
            )}
            <SummaryRow
              title={t('trigger.condition')}
              summary={data.condition ?? ''}
              empty={t('trigger.conditionEmpty')}
              lines={2}
              editLabel={t('trigger.edit')}
              testId="wl-trigger-condition-edit"
              onEdit={() => setDialog({ kind: 'notes', focus: 'condition' })}
            />
            <SummaryRow
              title={t('trigger.note')}
              summary={data.note ?? ''}
              empty={t('trigger.noteEmpty')}
              lines={2}
              editLabel={t('trigger.edit')}
              testId="wl-trigger-note-edit"
              onEdit={() => setDialog({ kind: 'notes', focus: 'note' })}
            />
          </SummaryList>
        </section>

        <LaunchField
          t={t}
          node={node.id}
          name={name}
          data={data}
          env={env}
          onLaunch={(launch) => patch({ launch })}
        />

        {env !== null && <TriggerLog t={t} env={env} node={node.id} />}

        {dialog?.kind === 'filter' && (
          <FilterDialog
            t={t}
            name={name}
            data={data}
            onSave={(filter) => patch({ filter })}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'notes' && (
          <NotesDialog
            t={t}
            name={name}
            data={data}
            focus={dialog.focus}
            onSave={(change) => patch(change)}
            onClose={() => setDialog(null)}
          />
        )}
      </div>

      <footer className={ins.foot}>
        <span className={ui.grow} />
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.danger)}
          data-tip={t('trigger.delete')}
          aria-label={t('trigger.delete')}
          data-testid="wl-delete-node"
          onClick={() => props.onRemove(node.id)}
        >
          <Icon name="trash" size={15} />
        </button>
      </footer>
    </aside>
  )
}
