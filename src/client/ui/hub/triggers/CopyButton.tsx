/**
 * dsh-workflow-lite — 「复制」小按钮（图标 + 字）：复制好了图标换成对勾、字换成「已复制」，一会儿回去。只换内容，不插拔。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/CopyButton
 */

import type { T } from '../../../i18n.ts'
import { copyText } from '../../kit/clipboard.ts'
import { cx } from '../../kit/cx.ts'
import ui from '../../kit/ui.module.css'
import { useCopied } from '../../kit/useCopied.ts'
import { SwapIcon } from '../../motion/swapText.tsx'
import css from './live.module.css'

export function CopyButton(props: {
  t: T
  text: string
  disabled?: boolean
  testId: string
}): React.JSX.Element {
  const { t } = props
  const [copied, setCopied] = useCopied(props.text)
  return (
    <button
      type="button"
      className={cx(ui.btn, ui.small, css.ghost)}
      disabled={props.disabled === true}
      data-testid={props.testId}
      onClick={() => void copyText(props.text).then(setCopied)}
    >
      <SwapIcon name={copied ? 'check' : 'copy'} size={12} />
      <span className={css.copyText} data-text={t('trigger.copied')}>
        {t(copied ? 'trigger.copied' : 'trigger.copy')}
      </span>
    </button>
  )
}
