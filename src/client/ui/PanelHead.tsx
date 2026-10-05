/**
 * dsh-workflow-lite — 右栏的标题栏：模板的属性面板与实例的右栏共用，两边长得一样。
 *
 * 左边一个图标块（步骤的外观、资源 / 输入 / 连线的图标；实例里是「在看什么」的切换），中间是名字，
 * 名字下面一行小字是 ID（点一下复制，复制图标悬停才露），右边是关闭。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/PanelHead
 */

import { useEffect, useState } from 'react'
import type { T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import css from './inspector.module.css'
import { copyText, cx } from './primitives.tsx'
import ui from './ui.module.css'

export function PanelHead(props: {
  t: T
  lead: React.ReactNode
  /** 名字：能改的是输入框，只看的是一段字。 */
  title: React.ReactNode
  /** 节点 id（连线、概览没有）。 */
  id?: string | undefined
  /** 名字右边的小标（输入的题型）。 */
  extra?: React.ReactNode
  onClose(): void
  closeTestId?: string
}): React.JSX.Element {
  const { t } = props
  return (
    <header className={css.head}>
      {props.lead}
      <div className={css.headMain}>
        {props.title}
        {props.id !== undefined && <IdLine t={t} id={props.id} />}
      </div>
      {props.extra}
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small)}
        aria-label={t('common.close')}
        data-tip={t('common.close')}
        data-testid={props.closeTestId}
        onClick={props.onClose}
      >
        <Icon name="x" size={15} />
      </button>
    </header>
  )
}

function IdLine(props: { t: T; id: string }): React.JSX.Element {
  const { t, id } = props
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setCopied(false)
  }, [id])
  return (
    <button
      type="button"
      className={css.idLine}
      data-tip={copied ? t('common.copied') : t('ins.copyId')}
      aria-label={t('ins.copyId')}
      data-testid="wl-panel-id"
      onClick={() => {
        void copyText(id).then((ok) => setCopied(ok))
      }}
    >
      <span className={css.idKey}>ID</span>
      <code>{id}</code>
      <Icon name={copied ? 'check' : 'copy'} size={11} />
    </button>
  )
}
