/**
 * dsh-workflow-lite — 查看框里的「版本」：一份产出每一轮存下的样子，挑一版看，或挑两版对比。
 *
 * - 标题行一个「版本」开关（{@link VersionsToggle}），点开正文右边一栏（{@link VersionsPanel}），新的在上；
 *   每行写哪一步第几轮、什么时候、比上一版大了多少、有判定的写判定。
 * - 「查看」：点一行，正文换成那一版。
 * - 「对比」：每行前面两个圈，分别选「旧」「新」；正文（{@link VersionCompare}）按格式比：
 *   文字逐行标出删了、加了什么，没变的长段折起来；Markdown、网页还能并排看排版后的样子；
 *   图片并排，或叠在一起拖一道线左右比。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FileHistory
 */

import { useRef, useState } from 'react'
import type { RunFileResponse } from '../../shared/wire.ts'
import { type FileTarget, useRunFile, useRunImage } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileKindOf, formatBytes } from '../model/fileKind.ts'
import { type DiffLine, diffCounts, diffLines, foldDiff } from '../model/lineDiff.ts'
import { dotIndex, type HistoryDot, type HistoryLine, versionName } from '../model/outputHistory.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { DocContent } from './DocViewer.tsx'
import css from './files.module.css'
import { Icon } from './Icon.tsx'
import { FadeMark, FadeText } from './motion.tsx'
import { cx } from './primitives.tsx'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'

/** 栏里在做什么：挑一版看，还是挑两版比。 */
export type VersionsMode = 'view' | 'compare'

/** 对比的两版（`null` = 最新：现在的文件）。 */
export interface VersionPair {
  old: number | null
  new: number | null
}

/** 读一版要带的目标：最新的读现在的文件。 */
export function versionTarget(
  target: { node: string; item: number },
  v: number | null,
): FileTarget {
  return v === null ? target : { ...target, version: v }
}

/** 默认拿哪两版比：`at` 这一版和它前面一版（`at` 是第一版就和第二版比）。 */
export function defaultPair(line: HistoryLine, at: number | null): VersionPair {
  const index = dotIndex(line, at)
  const newer = Math.max(1, index)
  return {
    old: line.dots[newer - 1]?.v ?? null,
    new: line.dots[newer]?.v ?? null,
  }
}

/** 标题行的开关：「版本」加个数，拉开时换成强调色（和「说明」开关同一套）。 */
export function VersionsToggle(props: {
  t: T
  count: number
  open: boolean
  onToggle(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(ui.btn, ui.small, ui.soft, ui.fillOn, css.noteToggle)}
      aria-expanded={props.open}
      data-on={props.open}
      data-testid="wl-viewer-versions-toggle"
      onClick={props.onToggle}
    >
      <FadeMark on={props.open}>
        <Icon name="history" size={14} />
      </FadeMark>
      <FadeText text={`${props.t('history.toggle')} ${props.count}`} on={props.open} />
    </button>
  )
}

/** 一行的大小变化：比前一版大了 / 小了多少；第一版、一样大不写。 */
function sizeDelta(size: number, before: number | undefined): string {
  if (before === undefined || before === size) return ''
  const diff = size - before
  return `${diff > 0 ? '+' : '−'}${formatBytes(Math.abs(diff))}`
}

function dotSize(dot: HistoryDot, live: RunFileResponse | null): number | undefined {
  if (dot.version !== null) return dot.version.size
  return live?.exists === true ? live.size : undefined
}

/** 正文右边那一栏：各版的列表，新的在上。 */
export function VersionsPanel(props: {
  t: T
  line: HistoryLine
  names: Readonly<Record<string, string>>
  /** 现在的文件（最新那行的大小、时间）。 */
  live: RunFileResponse | null
  mode: VersionsMode
  onMode(mode: VersionsMode): void
  /** 「查看」里看的是哪一版。 */
  pick: number | null
  onPick(v: number | null): void
  pair: VersionPair
  onPair(pair: VersionPair): void
}): React.JSX.Element {
  const { t, line, names, mode } = props
  const rows = line.dots.map((dot, index) => ({ dot, index })).reverse()
  const compare = mode === 'compare'
  const oldAt = dotIndex(line, props.pair.old)
  const newAt = dotIndex(line, props.pair.new)
  const pickAt = dotIndex(line, props.pick)
  return (
    <aside
      className={css.versions}
      aria-label={t('history.title')}
      data-testid="wl-viewer-versions"
    >
      <div className={css.versionsHead}>
        <span className={css.noteDrawerTitle}>{t('history.title')}</span>
        <Segmented<VersionsMode>
          label={t('history.title')}
          value={mode}
          onChange={props.onMode}
          testId="wl-viewer-versions-mode"
          options={[
            { value: 'view', label: t('history.view') },
            { value: 'compare', label: t('history.compare') },
          ]}
        />
      </div>
      {compare && (
        <div className={css.versionsCols} aria-hidden="true">
          <span>{t('history.older')}</span>
          <span>{t('history.newerSide')}</span>
        </div>
      )}
      <ol className={css.versionsList}>
        {rows.map(({ dot, index }) => {
          const size = dotSize(dot, props.live)
          const before =
            index > 0 ? dotSize(line.dots[index - 1] as HistoryDot, props.live) : undefined
          const delta = size === undefined ? '' : sizeDelta(size, before)
          const at = dot.version?.at ?? (props.live?.exists === true ? props.live.mtime : undefined)
          const verdicts = dot.version?.verdicts ?? []
          const selected = compare ? index === oldAt || index === newAt : index === pickAt
          const body = (
            <>
              <span
                className={css.versionDot}
                data-tone={dot.tone ?? undefined}
                data-live={dot.v === null || undefined}
              />
              <span className={css.versionText}>
                <span className={css.versionName}>
                  {versionName(t, dot.version, names)}
                  {dot.v === null && dot.version !== null && (
                    <span className={css.versionLive}>{t('history.live')}</span>
                  )}
                </span>
                <span className={css.versionMeta}>
                  {[
                    at === undefined ? t('history.missing') : shortTime(at),
                    ...verdicts.map(
                      (verdict) => `${names[verdict.step] ?? verdict.step}：${verdict.value}`,
                    ),
                  ].join(' · ')}
                </span>
              </span>
              {delta !== '' && <span className={css.versionDelta}>{delta}</span>}
            </>
          )
          return (
            <li
              key={dot.key}
              className={css.versionRow}
              data-selected={selected || undefined}
              data-testid="wl-viewer-version"
            >
              {compare ? (
                <>
                  <span className={css.versionPicks}>
                    <input
                      type="radio"
                      name="wl-version-old"
                      className={css.versionRadio}
                      checked={index === oldAt}
                      // 旧的要在新的前面。
                      disabled={index >= newAt}
                      aria-label={`${t('history.pickOld')}：${versionName(t, dot.version, names)}`}
                      data-testid="wl-viewer-version-old"
                      onChange={() => props.onPair({ ...props.pair, old: dot.v })}
                    />
                    <input
                      type="radio"
                      name="wl-version-new"
                      className={css.versionRadio}
                      checked={index === newAt}
                      disabled={index <= oldAt}
                      aria-label={`${t('history.pickNew')}：${versionName(t, dot.version, names)}`}
                      data-testid="wl-viewer-version-new"
                      onChange={() => props.onPair({ ...props.pair, new: dot.v })}
                    />
                  </span>
                  <span className={css.versionStatic}>{body}</span>
                </>
              ) : (
                <button
                  type="button"
                  className={css.versionButton}
                  aria-pressed={index === pickAt}
                  onClick={() => props.onPick(dot.v)}
                >
                  {body}
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {line.dropped > 0 && (
        <p className={css.versionsNote}>
          {t('history.dropped').replace('{n}', String(line.dropped))}
        </p>
      )}
    </aside>
  )
}

type TextView = 'diff' | 'side'
type ImageView = 'side' | 'slider'

/** 正文换成两版对比。 */
export function VersionCompare(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: { node: string; item: number }
  /** 给人看的路径（认格式）。 */
  display: string
  line: HistoryLine
  names: Readonly<Record<string, string>>
  pair: VersionPair
}): React.JSX.Element {
  const { t, line, names, pair } = props
  const oldName = versionName(t, line.dots[dotIndex(line, pair.old)]?.version ?? null, names)
  const newName = versionName(t, line.dots[dotIndex(line, pair.new)]?.version ?? null, names)
  if (fileKindOf(props.display) === 'image') {
    return <ImageCompare {...props} oldName={oldName} newName={newName} />
  }
  return <TextCompare {...props} oldName={oldName} newName={newName} />
}

interface CompareProps {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: { node: string; item: number }
  pair: VersionPair
  oldName: string
  newName: string
}

/** 两版的说明：哪版在左（旧）、哪版在右（新）。 */
function CompareCaptions(props: { t: T; oldName: string; newName: string }): React.JSX.Element {
  return (
    <div className={css.compareCaptions}>
      <span data-side="old">
        <b>{props.t('history.older')}</b> {props.oldName}
      </span>
      <span data-side="new">
        <b>{props.t('history.newerSide')}</b> {props.newName}
      </span>
    </div>
  )
}

function TextCompare(props: CompareProps): React.JSX.Element {
  const { t } = props
  const before = useRunFile(props.rpc, props.instance, versionTarget(props.target, props.pair.old))
  const after = useRunFile(props.rpc, props.instance, versionTarget(props.target, props.pair.new))
  const [view, setView] = useState<TextView>('diff')
  const a = before.file
  const b = after.file
  const error = before.error ?? after.error
  if (error !== null) return <CompareState icon="alert" text={error} />
  if (a === null || b === null) return <CompareLoading t={t} />
  const readable = (file: RunFileResponse): boolean =>
    file.exists && (file.kind === 'text' || file.kind === 'markdown' || file.kind === 'html')
  if (!readable(a) || !readable(b)) return <CompareState icon="file" text={t('history.noDiff')} />
  const format = b.kind === 'markdown' || b.kind === 'html' ? b.kind : 'plain'
  const shown: TextView = format === 'plain' ? 'diff' : view
  return (
    <div className={css.compare} data-testid="wl-viewer-compare">
      <div className={css.compareBar}>
        <CompareCaptions t={t} oldName={props.oldName} newName={props.newName} />
        {format !== 'plain' && (
          <div className={css.compareViews}>
            <Segmented<TextView>
              label={t('history.compare')}
              value={shown}
              onChange={setView}
              testId="wl-viewer-compare-view"
              options={[
                { value: 'diff', label: t('history.diff') },
                { value: 'side', label: t('history.sideBySide') },
              ]}
            />
          </div>
        )}
      </div>
      {shown === 'diff' ? (
        <DiffView t={t} before={a.text ?? ''} after={b.text ?? ''} />
      ) : (
        <div className={css.compareSides}>
          {[a, b].map((file, index) => (
            <div key={index === 0 ? 'old' : 'new'} className={css.compareSide}>
              <DocContent
                t={t}
                body={{ kind: 'text', text: file.text ?? '', format }}
                view="rendered"
                name={index === 0 ? props.oldName : props.newName}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 逐行差异：两列行号、一列 +/−、正文；没变的长段折起来，点一下展开。 */
function DiffView(props: { t: T; before: string; after: string }): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const lines = diffLines(props.before, props.after)
  const counts = diffCounts(lines)
  if (counts.add === 0 && counts.del === 0) {
    return <CompareState icon="check" text={t('history.same')} />
  }
  const row = (line: DiffLine, key: string): React.JSX.Element => (
    <div key={key} className={css.diffRow} data-kind={line.kind}>
      <span className={css.diffNo}>{line.a ?? ''}</span>
      <span className={css.diffNo}>{line.b ?? ''}</span>
      <span className={css.diffSign} aria-hidden="true">
        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
      </span>
      <span className={css.diffText}>{line.text === '' ? ' ' : line.text}</span>
    </div>
  )
  return (
    <div className={css.diff} data-testid="wl-viewer-diff">
      <p className={css.diffCounts}>
        {t('history.lines')
          .replace('{add}', String(counts.add))
          .replace('{del}', String(counts.del))}
      </p>
      <div className={css.diffBody}>
        {foldDiff(lines).flatMap((chunk) => {
          if (chunk.kind === 'lines') {
            return chunk.lines.map((line) =>
              row(line, `${line.a ?? ''}:${line.b ?? ''}:${line.kind}`),
            )
          }
          if (open.has(chunk.at)) {
            return chunk.lines.map((line) => row(line, `${line.a ?? ''}:${line.b ?? ''}:same`))
          }
          return [
            <button
              key={`fold:${chunk.at}`}
              type="button"
              className={css.diffFold}
              data-testid="wl-viewer-diff-fold"
              onClick={() => setOpen((previous) => new Set([...previous, chunk.at]))}
            >
              <Icon name="chevronDown" size={12} />
              {t('history.unfold').replace('{n}', String(chunk.lines.length))}
            </button>,
          ]
        })}
      </div>
    </div>
  )
}

function ImageCompare(props: CompareProps): React.JSX.Element {
  const { t } = props
  const before = useRunImage(props.rpc, props.instance, versionTarget(props.target, props.pair.old))
  const after = useRunImage(props.rpc, props.instance, versionTarget(props.target, props.pair.new))
  const [view, setView] = useState<ImageView>('side')
  const error = before.error ?? after.error
  if (error !== null) return <CompareState icon="alert" text={error} />
  if (before.url === null || after.url === null) return <CompareLoading t={t} />
  return (
    <div className={css.compare} data-testid="wl-viewer-compare">
      <div className={css.compareBar}>
        <CompareCaptions t={t} oldName={props.oldName} newName={props.newName} />
        <div className={css.compareViews}>
          <Segmented<ImageView>
            label={t('history.compare')}
            value={view}
            onChange={setView}
            testId="wl-viewer-compare-view"
            options={[
              { value: 'side', label: t('history.sideBySide') },
              { value: 'slider', label: t('history.slider') },
            ]}
          />
        </div>
      </div>
      {view === 'side' ? (
        <div className={css.compareSides} data-image="true">
          <div className={css.compareImage}>
            <img src={before.url} alt={props.oldName} draggable={false} />
          </div>
          <div className={css.compareImage}>
            <img src={after.url} alt={props.newName} draggable={false} />
          </div>
        </div>
      ) : (
        <SliderCompare
          t={t}
          before={before.url}
          after={after.url}
          oldName={props.oldName}
          newName={props.newName}
        />
      )}
    </div>
  )
}

/**
 * 两张叠在一起：左边露旧的、右边露新的，中间一道线拖着走（方向键每次挪 5%）。
 * 新的那张按 `clip-path` 裁（动效例外：跟手拖动，不是过渡动画；只重画这一层，不重排）。
 */
function SliderCompare(props: {
  t: T
  before: string
  after: string
  oldName: string
  newName: string
}): React.JSX.Element {
  const [at, setAt] = useState(50)
  const frame = useRef<HTMLDivElement>(null)
  const follow = (clientX: number): void => {
    const box = frame.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return
    setAt(Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100)))
  }
  return (
    <div className={css.slider}>
      <div
        ref={frame}
        className={css.sliderFrame}
        style={{ '--at': `${at}%` } as React.CSSProperties}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          follow(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event.clientX)
        }}
      >
        <img src={props.before} alt={props.oldName} draggable={false} />
        <img className={css.sliderAfter} src={props.after} alt={props.newName} draggable={false} />
        <div
          className={css.sliderHandle}
          role="slider"
          tabIndex={0}
          aria-label={props.t('history.sliderHandle')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(at)}
          data-testid="wl-viewer-slider"
          onKeyDown={(event) => {
            const step = event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0
            if (step === 0) return
            event.preventDefault()
            setAt((value) => Math.max(0, Math.min(100, value + step)))
          }}
        />
      </div>
    </div>
  )
}

function CompareState(props: {
  icon: 'alert' | 'file' | 'check'
  text: string
}): React.JSX.Element {
  return (
    <div className={css.viewerState} data-testid="wl-viewer-state">
      <span className={css.viewerStateIcon}>
        <Icon name={props.icon} size={20} />
      </span>
      <span>{props.text}</span>
    </div>
  )
}

function CompareLoading(props: { t: T }): React.JSX.Element {
  return <DocContent t={props.t} body={{ kind: 'loading' }} view="rendered" name="" />
}
