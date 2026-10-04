/**
 * dsh-workflow-lite — 实例视图右栏：选中一张资源卡。
 *
 * 右栏只放缩略信息，细节都在点开之后的详情框里：
 * - 描述（最多三行）；
 * - **内容**：每项一行——图标、名字，下面一行是它此刻的样子（文件：生成没有 · 大小 · 修改时间；
 *   文件夹：在不在 · 修改时间；网址：路径；Skill：一句话说明；自定义：字数）；有说明的挂一个「说明」小签
 *   （和模板里一样，全文在悬停提示与查看框里）。行尾是「查看」和
 *   「打开」（文件 / 文件夹交给系统程序，网址在浏览器里开）；点这一行也是查看。
 *   查看按种类不同：文件读正文（{@link FileViewer}），文件夹列里面有什么，网址、自定义文字显示全文，
 *   Skill 读 SKILL.md；每种都把这一项的说明放在正文前。
 * - **用到它的步骤**：谁产出、谁更新、谁读，带各自的运行状态，点一下跳过去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunResource
 */

import { useEffect, useMemo, useState } from 'react'
import { isStep } from '../../shared/model.ts'
import { resourceGraph } from '../../shared/resources.ts'
import type { RunState } from '../../shared/runState.ts'
import type { ResourceItem, ResourceNode, WorkflowDocument } from '../../shared/types.ts'
import type { Desktop } from '../app/desktop.ts'
import type { HostAccess } from '../app/host.ts'
import { type FileTarget, useRunFile } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName, formatBytes } from '../model/fileKind.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import files from './files.module.css'
import { Icon } from './Icon.tsx'
import ins from './inspector.module.css'
import row from './linkrow.module.css'
import { OpenWith } from './OpenWith.tsx'
import { cx } from './primitives.tsx'
import { itemDisplayPath } from './RunFiles.tsx'
import { FolderDialog, TextDialog, UrlDialog } from './RunItemDialog.tsx'
import { StatusChip } from './RunNodeState.tsx'
import res from './resource.module.css'
import { itemName, KIND_ICON, KIND_LABEL } from './resourceUi.ts'
import css from './runres.module.css'
import { SkillPreview } from './SkillPreview.tsx'
import { lookOf, StepMark } from './StepMark.tsx'
import ui from './ui.module.css'

export function RunResourceDetail(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  host: HostAccess
  snapshot: WorkflowDocument
  resource: ResourceNode
  /** 每一项在不在（不是路径的项为 `null`）。 */
  made: readonly (boolean | null)[]
  state: RunState | null
  /** 状态文件的修改时间：变了就重读文件信息（模型写完文件通常也会更新状态）。 */
  version: number
  desktop: Desktop | undefined
  onSelectStep(id: string): void
  onFocusFile(id: string | null): void
  onView(target: FileTarget, title: string, note: string | undefined): void
  onError(text: string): void
}): React.JSX.Element {
  const { t, snapshot, resource } = props
  const info = useMemo(() => resourceGraph(snapshot).get(resource.id), [snapshot, resource.id])
  const written = (info?.writers.length ?? 0) > 0
  const items = resource.data.items
  /** 正在看哪一项（文件夹、网址、Skill、自定义；文件交给右栏外面的查看框）。 */
  const [open, setOpen] = useState<number | null>(null)
  const openItem = open === null ? undefined : items[open]
  const description = resource.data.description?.trim() ?? ''

  const view = (index: number): void => {
    const item = items[index]
    if (item === undefined) return
    if (item.kind === 'file') {
      const display = itemDisplayPath(snapshot, resource, index)
      props.onView({ node: resource.id, item: index }, fileBaseName(display), item.note)
      return
    }
    setOpen(index)
  }

  const steps = [
    ...(info?.writers ?? []).map((writer) => ({
      id: writer.id,
      mode: writer.update ? ('update' as const) : ('produce' as const),
    })),
    ...(info?.readers ?? []).map((reader) => ({ id: reader, mode: 'read' as const })),
  ]

  return (
    <div
      className={css.detail}
      data-testid="wl-run-resource"
      onPointerEnter={() => props.onFocusFile(resource.id)}
      onPointerLeave={() => props.onFocusFile(null)}
    >
      {description !== '' && (
        <p className={css.desc} title={description}>
          {description}
        </p>
      )}

      <section className={css.section} data-testid="wl-run-resource-items">
        <p className={files.groupTitle}>
          {t('res.items')}
          <span className={files.groupCount}>{items.length}</span>
        </p>
        <ul className={res.list}>
          {items.map((item, index) => (
            <ItemRow
              // biome-ignore lint/suspicious/noArrayIndexKey: 资源里的一项没有自己的身份
              key={index}
              t={t}
              rpc={props.rpc}
              instance={props.instance}
              host={props.host}
              node={resource.id}
              index={index}
              item={item}
              written={written}
              made={props.made[index] ?? null}
              version={props.version}
              desktop={props.desktop}
              onView={() => view(index)}
              onError={props.onError}
            />
          ))}
        </ul>
      </section>

      <section className={css.section}>
        <p className={files.groupTitle}>
          {t('run.resSteps')}
          <span className={files.groupCount}>{steps.length}</span>
        </p>
        {steps.length === 0 ? (
          <p className={css.hint}>{t('res.sharedRun')}</p>
        ) : (
          <div className={ins.links}>
            {steps.map((step) => (
              <button
                key={`${step.mode}:${step.id}`}
                type="button"
                className={row.row}
                data-testid="wl-run-file-step"
                data-id={step.id}
                onClick={() => props.onSelectStep(step.id)}
              >
                <span className={row.lead}>
                  <StepMark look={stepLook(snapshot, step.id)} size={13} />
                </span>
                <span className={row.name}>
                  <span className={row.nameText}>{stepLabel(snapshot, step.id)}</span>
                </span>
                <span className={row.end}>
                  <span className={files.mode} data-mode={step.mode}>
                    {t(`file.${step.mode}`)}
                  </span>
                  <StatusChip t={t} status={props.state?.nodes[step.id]?.status} />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {openItem !== undefined && open !== null && openItem.kind === 'folder' && (
        <FolderDialog
          t={t}
          rpc={props.rpc}
          instance={props.instance}
          host={props.host}
          node={resource.id}
          index={open}
          item={openItem}
          desktop={props.desktop}
          onClose={() => setOpen(null)}
        />
      )}
      {openItem?.kind === 'url' && (
        <UrlDialog t={t} item={openItem} desktop={props.desktop} onClose={() => setOpen(null)} />
      )}
      {openItem?.kind === 'text' && (
        <TextDialog t={t} item={openItem} desktop={props.desktop} onClose={() => setOpen(null)} />
      )}
      {openItem?.kind === 'skill' && (
        <SkillPreview
          t={t}
          host={props.host}
          name={openItem.value.trim()}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

/** 内容里的一行：图标、名字、它此刻的样子；行尾查看与打开。 */
function ItemRow(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  host: HostAccess
  node: string
  index: number
  item: ResourceItem
  written: boolean
  made: boolean | null
  version: number
  desktop: Desktop | undefined
  onView(): void
  onError(text: string): void
}): React.JSX.Element {
  const { t, item } = props
  const pathLike = item.kind === 'file' || item.kind === 'folder'
  const target = useMemo<FileTarget | null>(
    () => (pathLike && item.value.trim() !== '' ? { node: props.node, item: props.index } : null),
    [pathLike, item.value, props.node, props.index],
  )
  // 文件 / 文件夹：读一下元信息（在不在、多大、什么时候改的），状态文件一变就重读。
  const meta = useRunFile(props.rpc, props.instance, target, `${props.made}:${props.version}`).file
  const exists = meta?.exists ?? props.made === true
  const name = itemName(item) || t('res.itemBlank')
  // 这一项的说明（写文件时就是生成要求）：行尾挂「说明」小签，全文在悬停提示与查看框里。
  const note = item.kind === 'text' ? '' : (item.note?.trim() ?? '')
  const title = note === '' ? item.value.trim() : `${item.value.trim()}\n${note}`

  let line: React.ReactNode
  if (pathLike) {
    const label =
      item.kind === 'file' && props.written
        ? t(exists ? 'file.generated' : 'file.notGenerated')
        : t(exists ? 'file.present' : 'file.absent')
    line = (
      <>
        <span
          className={cx(css.state, css.metaPart)}
          data-on={exists}
          data-testid="wl-run-item-state"
        >
          <span className={css.dot} />
          {label}
        </span>
        {exists && meta !== null && item.kind === 'file' && (
          <span className={css.metaPart}>{formatBytes(meta.size)}</span>
        )}
        {exists && meta !== null && meta.mtime > 0 && (
          <span className={css.metaPart}>{shortTime(meta.mtime)}</span>
        )}
      </>
    )
  } else if (item.kind === 'url') {
    const rest = item.value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/iu, '')
    line = (
      <span className={css.metaText}>{rest === '' || rest === '/' ? t(KIND_LABEL.url) : rest}</span>
    )
  } else if (item.kind === 'skill') {
    line = <SkillLine t={t} host={props.host} name={item.value.trim()} />
  } else {
    line = (
      <span className={css.metaText}>
        {t('res.textChars').replace('{n}', String([...item.value.trim()].length))}
      </span>
    )
  }

  return (
    <li className={css.row} data-kind={item.kind} data-testid="wl-run-resource-item">
      <button type="button" className={css.main} title={title} onClick={props.onView}>
        <span className={cx(res.kindIcon, css.icon)} data-kind={item.kind}>
          <Icon name={KIND_ICON[item.kind]} size={14} />
        </span>
        <span className={css.name}>{name}</span>
        <span className={css.meta} data-mono={item.kind === 'url'}>
          {line}
        </span>
        {note !== '' && (
          <span className={css.noteTag} data-testid="wl-run-item-note">
            {t('res.note')}
          </span>
        )}
      </button>
      <span className={css.actions}>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
          data-tip={item.kind === 'file' ? t('file.view') : t('res.detail')}
          aria-label={item.kind === 'file' ? t('file.view') : t('res.detail')}
          data-testid="wl-run-item-view"
          onClick={props.onView}
        >
          <Icon name="eye" size={15} />
        </button>
        {pathLike && (
          <OpenWith
            t={t}
            desktop={props.desktop}
            path={exists && meta !== null ? meta.path : null}
            compact
            onError={props.onError}
          />
        )}
        {item.kind === 'url' && item.value.trim() !== '' && (
          <a
            className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
            href={item.value.trim()}
            target="_blank"
            rel="noopener noreferrer"
            data-tip={t('res.openLink')}
            aria-label={t('res.openLink')}
          >
            <Icon name="external" size={14} />
          </a>
        )}
      </span>
    </li>
  )
}

/** Skill 那一行的一句话说明（Skill 清单一页只问一次，问不到就写「Skill」）。 */
function SkillLine(props: { t: T; host: HostAccess; name: string }): React.JSX.Element {
  const [description, setDescription] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    props.host
      .skills()
      .then((list) => {
        const found = list.skills.find((skill) => skill.name === props.name)
        if (alive) setDescription(found?.description ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [props.host, props.name])
  return <span className={css.metaText}>{description ?? props.t(KIND_LABEL.skill)}</span>
}

function stepLook(doc: WorkflowDocument, id: string) {
  const node = doc.nodes.find((candidate) => candidate.id === id)
  return lookOf(id, node !== undefined && isStep(node) ? node.data : undefined)
}

function stepLabel(doc: WorkflowDocument, id: string): string {
  const node = doc.nodes.find((candidate) => candidate.id === id)
  return node !== undefined &&
    isStep(node) &&
    node.data.label !== undefined &&
    node.data.label !== ''
    ? node.data.label
    : id
}
