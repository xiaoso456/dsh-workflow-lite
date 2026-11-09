/**
 * dsh-workflow-lite — 实例视图里点开网址资源的详情框。
 *
 * 文件用 {@link FileViewer}（能读正文），Skill 用 {@link SkillPreview}（读 SKILL.md），文件夹、自定义文字用
 * {@link FolderDialog}、{@link TextDialog}（在 files/），都不在这里。
 * 框子是 {@link DocViewer} 的小号：标题行有复制、关闭，网址的说明放在正文前（框小、说明就是主要内容）：
 * - 网址：整条网址（点了在浏览器里开），底部一个「在浏览器中打开」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/UrlDialog
 */

import type { ResourceItem } from '../../../shared/types.ts'
import type { Desktop } from '../../app/desktop.ts'
import type { T } from '../../i18n.ts'
import { Badge } from '../files/Badge.tsx'
import { DocViewer } from '../files/DocViewer.tsx'
import { NoteLead } from '../files/FileViewer.tsx'
import viewer from '../files/fileViewer.module.css'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { itemName, KIND_LABEL } from '../kit/resourceUi.ts'
import ui from '../kit/ui.module.css'
import css from './runres.module.css'

function lead(t: T, item: ResourceItem): React.ReactNode {
  const note = item.note?.trim() ?? ''
  return note === '' ? null : <NoteLead t={t} text={note} />
}

/** 网址：整条网址、说明，底部在浏览器中打开。 */
export function UrlDialog(props: {
  t: T
  item: ResourceItem
  desktop: Desktop | undefined
  onClose(): void
}): React.JSX.Element {
  const { t, item } = props
  const url = item.value.trim()
  return (
    <DocViewer
      t={t}
      name={itemName(item) || t(KIND_LABEL.url)}
      badge={<Badge kind="url" />}
      meta={t(KIND_LABEL.url)}
      body={{
        kind: 'node',
        node: (
          <div className={viewer.pane}>
            {lead(t, item)}
            <a className={css.link} href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </div>
        ),
      }}
      copyPath={url === '' ? null : url}
      copyLabel={t('res.copyUrl')}
      openPath={null}
      desktop={props.desktop}
      testId="wl-url-viewer"
      className={css.small}
      footer={
        <div className={css.footer}>
          <a
            className={cx(ui.btn, ui.primary)}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="wl-url-open"
          >
            <Icon name="external" size={14} />
            {t('res.openLink')}
          </a>
        </div>
      }
      onClose={props.onClose}
    />
  )
}
