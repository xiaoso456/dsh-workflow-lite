/**
 * dsh-workflow-lite — 产出文件的查看框。
 *
 * 能看的：小文本（原样）、Markdown（默认预览，相对路径的图片按文档所在目录读）、HTML（默认在沙箱里渲染），
 * 后两种可切源码；图片整张显示、点一下放大。
 * 大文件、二进制、还没生成的只说明原因，
 * 并留着「用其他程序打开」。框子本身是 {@link DocViewer}。
 * 资源里的文件存过几版的（循环迭代时每一轮一版），标题行多一个「版本」：挑一版看、挑两版对比（见 `FileHistory.tsx`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FileViewer
 */

import { useState } from 'react'
import { textWraps } from '../../shared/display.ts'
import { extensionOf } from '../../shared/fileKind.ts'
import type { LineFilter } from '../../shared/types.ts'
import type { RunFileResponse, RunLinesResponse } from '../../shared/wire.ts'
import type { Desktop } from '../app/desktop.ts'
import { type FileTarget, useRunFile, useRunHistory, useRunImages } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName, fileKindOf, formatBytes } from '../model/fileKind.ts'
import { dotIndex, historyLine, versionName } from '../model/outputHistory.ts'
import { prettyJson, tableFormat } from '../model/textShape.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { tableSize } from './DataTable.tsx'
import { type DocBody, DocViewer } from './DocViewer.tsx'
import {
  defaultPair,
  VersionCompare,
  type VersionPair,
  type VersionsMode,
  VersionsPanel,
  VersionsToggle,
  versionTarget,
} from './FileHistory.tsx'
import { FileTag } from './FileTag.tsx'
import { Icon } from './Icon.tsx'
import { RunImagePreview } from './ImagePreview.tsx'
import { LogViewer } from './LogViewer.tsx'
import css from './runres.module.css'

/** 只读了末尾一截：正文上面一行说明读了多少、前面还有多少。 */
function TailNote(props: { t: T; file: RunFileResponse | null }): React.JSX.Element | null {
  const { file } = props
  if (file?.cut === undefined || file.text === undefined) return null
  const shown = file.size - file.cut
  return (
    <p className={css.tailNote} data-testid="wl-viewer-tail">
      <Icon name="info" size={13} />
      {props
        .t('file.tailNote')
        .replace('{shown}', formatBytes(shown))
        .replace('{cut}', formatBytes(file.cut))}
    </p>
  )
}

/** 按行读回来的元信息当成一份文件的样子（标题行、版本、「用其他程序打开」用）。 */
function metaFile(meta: RunLinesResponse | null): RunFileResponse | null {
  if (meta === null) return null
  return {
    path: meta.path,
    display: meta.display,
    exists: meta.exists,
    size: meta.size,
    mtime: meta.mtime,
    kind: meta.exists ? 'text' : 'missing',
    limit: 0,
  }
}

/** 正文前的「说明」一块（网址这种小详情框用；大的查看框收在「说明」开关里）。 */
export function NoteLead(props: { t: T; text: string }): React.JSX.Element {
  return (
    <p className={css.lead} data-testid="wl-item-note">
      <span className={css.leadLabel}>{props.t('res.note')}</span>
      {props.text}
    </p>
  )
}

/**
 * 读回来的文件怎么摆：读不了说原因、还没读到是骨架、是图片就交给 `image`（从哪读图由调用方定），其余按格式给正文。
 * 查看框和文件夹浏览（右边预览）共用。
 */
export function fileBody(props: {
  t: T
  file: RunFileResponse | null
  error: string | null
  loading: boolean
  /** 是图片时摆什么（`name` 是文件名）。 */
  image(name: string): React.ReactNode
}): DocBody {
  const { t, file } = props
  if (props.error !== null) return { kind: 'state', icon: 'alert', text: props.error }
  if (file === null || props.loading) return { kind: 'loading' }
  if (file.kind === 'missing') return { kind: 'state', icon: 'clock', text: t('file.missing') }
  if (file.kind === 'folder') return { kind: 'state', icon: 'folder', text: t('res.kind.folder') }
  if (fileKindOf(file.display) === 'image') {
    return { kind: 'node', node: props.image(fileBaseName(file.display)) }
  }
  if (file.kind === 'binary') return { kind: 'state', icon: 'file', text: t('file.binary') }
  if (file.kind === 'tooLarge') {
    return {
      kind: 'state',
      icon: 'file',
      text: t('file.tooLarge')
        .replace('{size}', formatBytes(file.size))
        .replace('{limit}', formatBytes(file.limit)),
    }
  }
  const text = file.text ?? ''
  if (file.kind === 'markdown' || file.kind === 'html')
    return { kind: 'text', text, format: file.kind }
  const table = tableFormat(file.display)
  if (table !== null) return { kind: 'text', text, format: table }
  const pretty = prettyJson(file.display, text)
  if (pretty !== null) return { kind: 'text', text, format: 'json', pretty }
  return { kind: 'text', text, format: 'plain' }
}

export function FileViewer(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: FileTarget
  /** 文件还没读回来时标题先用它。 */
  title: string
  desktop: Desktop | undefined
  /** 这一项的说明（产出文件就是它的生成要求）：收在标题行的「说明」开关里。 */
  note?: string | undefined
  /** 步骤 id → 名字（版本列表里写「改稿 · 第 2 轮」）。 */
  names?: Readonly<Record<string, string>> | undefined
  /** 卡片上「只看」的筛选：日志打开时带上。 */
  filter?: LineFilter | undefined
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  // 日志、纯文本太大时读最后一截（打开就停在末尾），不说「太大」。
  const tail = textWraps(props.title)
  const target: FileTarget =
    tail && 'node' in props.target ? { ...props.target, tail: true } : props.target
  // 资源里的日志、纯文本按行分段读（LogViewer）：不整份读进来；UTF-16 的退回整份读。
  const [linesMeta, setLinesMeta] = useState<RunLinesResponse | null>(null)
  const byLines = tail && 'node' in props.target && linesMeta?.kind !== 'utf16'
  const live = useRunFile(props.rpc, props.instance, byLines ? null : target)
  const liveFile: RunFileResponse | null = byLines ? metaFile(linesMeta) : live.file
  // 资源里的一个文件（不是文件夹里的一份、不是随手的路径）才可能存过几版。
  const item =
    'node' in props.target && props.target.sub === undefined
      ? { node: props.target.node, item: props.target.item }
      : null
  // 现在的文件读回来了再问各版（文件变了再问一次）。
  const history = useRunHistory(
    props.rpc,
    props.instance,
    item,
    liveFile === null ? 0 : liveFile.mtime + 1,
  )
  const line = historyLine(history, liveFile ?? undefined)
  const names = props.names ?? {}
  const [panel, setPanel] = useState(false)
  const [mode, setMode] = useState<VersionsMode>('view')
  const [pick, setPick] = useState<number | null>(null)
  const [pair, setPair] = useState<VersionPair | null>(null)
  const hasVersions = item !== null && line.dots.length >= 2
  // 看的是哪一版：栏收起来就回到最新。
  const kept = hasVersions && panel ? (line.dots[dotIndex(line, pick)]?.v ?? null) : null
  const keptTarget =
    item !== null && kept !== null
      ? { ...versionTarget(item, kept), ...(tail ? { tail: true } : {}) }
      : target
  const old = useRunFile(props.rpc, props.instance, kept === null || byLines ? null : keptTarget)
  const { file, error, loading } = kept === null ? live : old
  const image = useRunImages(props.rpc, props.instance, keptTarget)
  const name = liveFile === null ? props.title : fileBaseName(liveFile.display)
  const note = props.note?.trim() ?? ''
  const comparing = hasVersions && panel && mode === 'compare' && item !== null
  const shownPair = pair ?? defaultPair(line, pick)
  const keptVersion = kept === null ? null : (line.dots[dotIndex(line, kept)]?.version ?? null)
  const cut = file?.cut ?? 0
  const body = comparing
    ? {
        kind: 'node' as const,
        node: (
          <VersionCompare
            t={t}
            rpc={props.rpc}
            instance={props.instance}
            target={item}
            display={liveFile?.display ?? props.title}
            line={line}
            names={names}
            pair={shownPair}
          />
        ),
      }
    : byLines && 'node' in props.target
      ? {
          kind: 'node' as const,
          node: (
            <LogViewer
              key={kept ?? 'live'}
              t={t}
              rpc={props.rpc}
              instance={props.instance}
              target={{
                node: props.target.node,
                item: props.target.item,
                ...(props.target.sub === undefined ? {} : { sub: props.target.sub }),
                ...(kept === null ? {} : { version: kept }),
              }}
              name={props.title}
              filter={props.filter}
              onMeta={(response) => {
                if (kept === null) setLinesMeta(response)
              }}
            />
          ),
        }
      : fileBody({
          t,
          file,
          error,
          loading,
          image: (alt) => (
            <RunImagePreview
              t={t}
              rpc={props.rpc}
              instance={props.instance}
              target={keptTarget}
              name={alt}
            />
          ),
        })

  return (
    <DocViewer
      t={t}
      name={name}
      badge={<FileTag path={file?.display ?? props.title} large />}
      meta={
        <>
          <code>{liveFile?.display ?? props.title}</code>
          {!comparing &&
            body.kind === 'text' &&
            (body.format === 'csv' || body.format === 'tsv') &&
            ` · ${tableSize(t, body.text, body.format)}`}
          {keptVersion !== null && !comparing
            ? ` · ${versionName(t, keptVersion, names)} · ${formatBytes(keptVersion.size)} · ${t('history.saved').replace('{time}', shortTime(keptVersion.at))}`
            : liveFile?.exists === true &&
              ` · ${formatBytes(liveFile.size)} · ${t('file.modified')} ${shortTime(liveFile.mtime)}`}
        </>
      }
      body={body}
      lead={cut > 0 && !comparing && !byLines && <TailNote t={t} file={file} />}
      startAtEnd={!comparing && !byLines && (cut > 0 || extensionOf(props.title) === 'log')}
      copyPath={liveFile?.path ?? null}
      // 看着旧版时「用其他程序打开」打开的是现在的文件，容易看岔：先收起来。
      openPath={kept === null && liveFile?.exists === true ? liveFile.path : null}
      desktop={props.desktop}
      testId="wl-file-viewer"
      note={note}
      image={image}
      tools={
        hasVersions && (
          <VersionsToggle
            t={t}
            count={line.dots.length}
            open={panel}
            onToggle={() => setPanel((open) => !open)}
          />
        )
      }
      side={
        hasVersions && panel ? (
          <VersionsPanel
            t={t}
            line={line}
            names={names}
            live={liveFile}
            mode={mode}
            onMode={setMode}
            pick={pick}
            onPick={(v) => {
              setPick(v)
              setPair(null)
            }}
            pair={shownPair}
            onPair={setPair}
          />
        ) : undefined
      }
      onClose={props.onClose}
    />
  )
}
