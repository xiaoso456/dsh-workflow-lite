/**
 * dsh-workflow-lite — 实例视图里点开资源的一项：文件夹、网址、自定义文字各自的详情框。
 *
 * 文件用 {@link FileViewer}（能读正文），Skill 用 {@link SkillPreview}（读 SKILL.md），都不在这里。
 * 三个框都是 {@link DocViewer} 的小号：标题行同样有复制、用其他程序打开（文件夹）、关闭，
 * 网址的说明放在正文前（框小、说明就是主要内容）；文件夹、自定义文字的说明收在「说明」开关里。
 * - 文件夹：左边浏览（搜索、进子目录），右边预览选中的文件，可以复制路径、用其他程序打开或在文件管理器里显示；
 * - 网址：整条网址（点了在浏览器里开），底部一个「在浏览器中打开」；
 * - 自定义文字：整段排版显示，可以复制。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunItemDialog
 */

import { useMemo } from 'react'
import type { ResourceItem } from '../../shared/types.ts'
import type { Desktop } from '../app/desktop.ts'
import { type FileTarget, useRunFile } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName } from '../model/fileKind.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { type DocBody, DocViewer } from './DocViewer.tsx'
import { NoteLead } from './FileViewer.tsx'
import { FolderBrowser } from './FolderBrowser.tsx'
import folderCss from './folder.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import res from './resource.module.css'
import { itemName, KIND_ICON, KIND_LABEL } from './resourceUi.ts'
import css from './runres.module.css'
import ui from './ui.module.css'

function Badge(props: { kind: ResourceItem['kind'] }): React.JSX.Element {
  return (
    <span className={cx(res.kindIcon, css.icon)} data-kind={props.kind}>
      <Icon name={KIND_ICON[props.kind]} size={15} />
    </span>
  )
}

function lead(t: T, item: ResourceItem): React.ReactNode {
  const note = item.note?.trim() ?? ''
  return note === '' ? null : <NoteLead t={t} text={note} />
}

/**
 * 文件夹：左边浏览（搜索、进子目录、面包屑），右边预览选中的文件，见 {@link FolderBrowser}。
 * 这一项的说明（要求写在这里的东西）收在标题行的「说明」开关里，不占正文。
 */
export function FolderDialog(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  node: string
  index: number
  item: ResourceItem
  desktop: Desktop | undefined
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const target = useMemo<FileTarget>(
    () => ({ node: props.node, item: props.index }),
    [props.node, props.index],
  )
  const { file, error } = useRunFile(props.rpc, props.instance, target)
  const folder = file?.kind === 'folder' ? file.path : null
  const display = file?.display ?? props.item.value
  const name = fileBaseName(display) || itemName(props.item)

  let body: DocBody
  if (error !== null) body = { kind: 'state', icon: 'alert', text: error }
  else if (file === null) body = { kind: 'loading' }
  else if (folder === null) body = { kind: 'state', icon: 'folder', text: t('res.folderMissing') }
  else {
    body = {
      kind: 'node',
      node: (
        <FolderBrowser
          t={t}
          rpc={props.rpc}
          instance={props.instance}
          node={props.node}
          index={props.index}
          rootName={name}
          desktop={props.desktop}
        />
      ),
    }
  }

  return (
    <DocViewer
      t={t}
      name={name}
      badge={<Badge kind="folder" />}
      meta={
        <>
          <code>{display}</code>
          {folder !== null && file !== null && ` · ${t('file.modified')} ${shortTime(file.mtime)}`}
        </>
      }
      body={body}
      copyPath={file?.path ?? null}
      openPath={folder}
      desktop={props.desktop}
      testId="wl-folder-viewer"
      note={props.item.note ?? ''}
      className={folderCss.dialog}
      onClose={props.onClose}
    />
  )
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
          <div className={css.pane}>
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

/** 自定义文字：整段排版显示。 */
export function TextDialog(props: {
  t: T
  item: ResourceItem
  desktop: Desktop | undefined
  onClose(): void
}): React.JSX.Element {
  const { t, item } = props
  const text = item.value.trim()
  return (
    <DocViewer
      t={t}
      name={itemName(item) || t(KIND_LABEL.text)}
      badge={<Badge kind="text" />}
      meta={t('res.textChars').replace('{n}', String([...text].length))}
      body={{ kind: 'text', text, format: 'markdown' }}
      copyPath={text === '' ? null : text}
      copyLabel={t('res.copyText')}
      openPath={null}
      desktop={props.desktop}
      testId="wl-text-viewer"
      note={item.note ?? ''}
      onClose={props.onClose}
    />
  )
}
