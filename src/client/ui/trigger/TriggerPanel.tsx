/**
 * dsh-workflow-lite — 触发卡片的属性面板。
 *
 * 一张触发卡片 = 什么时候自动执行这个工作流：
 * - **现在怎么样**（只在模板视图）：开关与状态、确认命令、「立即触发一次」、最近的输出、触发记录；
 * - **何时触发**：定时 / 条件轮询 / 监听程序 / HTTP，以及那一种的设置；
 * - **过滤**（有背景信息的才有）：合并、去重、关键字；
 * - **触发条件**：每次先由模型判断要不要执行；
 * - **触发说明**：每次触发时原样交给模型的话；
 * - **怎么运行**：发进哪个会话、在哪个工作区、上一次没跑完怎么办、两项保护。
 *
 * 触发源、过滤、条件、说明、启动方式写在图里；开关、工作区、会话、令牌是这台机器上的事（见 `triggerEnv.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerPanel
 */

import { idKey } from '../../../shared/model.ts'
import type { TriggerData, TriggerNode, TriggerSourceKind } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import type { Edit, Selection } from '../../model/editor.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { TextArea } from '../kit/TextArea.tsx'
import ui from '../kit/ui.module.css'
import { EDIT_VIEW, useSwap } from '../motion/swap.tsx'
import { cleanName } from '../panel/NodeHeads.tsx'
import { PanelHead } from '../panel/PanelHead.tsx'
import ins from '../panel/panel.module.css'
import { TitleField } from '../panel/TitleField.tsx'
import { FilterField } from './FilterField.tsx'
import { LaunchField } from './LaunchField.tsx'
import { SourceField } from './SourceField.tsx'
import { TriggerStatus } from './TriggerStatus.tsx'
import css from './trigger.module.css'
import { useTriggerEnv } from './triggerEnv.ts'

const BADGE: Record<TriggerSourceKind, LocaleKey> = {
  schedule: 'trigger.source.schedule',
  poll: 'trigger.source.poll',
  listen: 'trigger.source.listen',
  http: 'trigger.source.http',
}

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
        extra={
          <>
            <span className={ins.badge}>{t(BADGE[data.source.kind])}</span>
            {props.tabs}
          </>
        }
        onClose={() => props.onSelect(null)}
      />

      <div className={ins.body}>
        {env === null ? (
          <p className={ins.help}>{t('trigger.snapshot')}</p>
        ) : (
          <TriggerStatus t={t} env={env} node={node.id} data={data} />
        )}

        <SourceField
          t={t}
          node={node.id}
          source={data.source}
          env={env}
          onChange={(source, typing) =>
            patch({ source }, typing === true ? `source:${source.kind}` : undefined)
          }
          onSeal={props.onSeal}
        />

        {data.source.kind !== 'schedule' && (
          <FilterField t={t} data={data} onFilter={(filter) => patch({ filter })} />
        )}

        <section className={ins.field}>
          <div className={ins.label}>
            <span>{t('trigger.condition')}</span>
          </div>
          <TextArea
            className={cx(ui.textarea, css.note)}
            value={data.condition ?? ''}
            rows={2}
            placeholder={t('trigger.conditionPlaceholder')}
            aria-label={t('trigger.condition')}
            data-testid="wl-trigger-condition"
            onChange={(event) => {
              const value = event.currentTarget.value
              patch({ condition: value === '' ? undefined : value }, 'condition')
            }}
            onBlur={props.onSeal}
          />
          <p className={ins.help}>{t('trigger.conditionHint')}</p>
        </section>

        <section className={ins.field}>
          <div className={ins.label}>
            <span>{t('trigger.note')}</span>
          </div>
          <TextArea
            className={cx(ui.textarea, css.note)}
            value={data.note ?? ''}
            rows={3}
            placeholder={t('trigger.notePlaceholder')}
            aria-label={t('trigger.note')}
            data-testid="wl-trigger-note"
            onChange={(event) => {
              const value = event.currentTarget.value
              patch({ note: value === '' ? undefined : value }, 'note')
            }}
            onBlur={props.onSeal}
          />
          <p className={ins.help}>{t('trigger.noteHint')}</p>
        </section>

        <LaunchField
          t={t}
          node={node.id}
          data={data}
          env={env}
          onLaunch={(launch) => patch({ launch })}
        />
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
