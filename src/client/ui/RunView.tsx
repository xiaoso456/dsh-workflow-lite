/**
 * dsh-workflow-lite — 工作流实例视图。
 *
 * 和模板是同一张图、同一套画布：图是编译那一刻的快照，不能改；每张步骤卡挂上运行状态，
 * 走过的线亮、没走过的淡。状态能改，而且要顺手——卡片上的状态小标一点就改，右栏就地改字段；
 * 改动先攒成草稿，确认后一次写进状态文件，并以后台通知的形式告诉模型。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunView
 */

import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeGraph } from '../../shared/graph.ts'
import { isFile, isStep } from '../../shared/model.ts'
import {
  graphFacts,
  type InstanceSummary,
  NODE_STATUSES,
  type NodeStatus,
  progressOf,
  RUN_STATUSES,
  type RunLogEntry,
  type RunState,
  type RunStatus,
  type StateEdit,
  takenEdges,
} from '../../shared/runState.ts'
import type { FileNode, WorkflowDocument, WorkflowEntry } from '../../shared/types.ts'
import type { Desktop } from '../app/desktop.ts'
import type { FileTarget } from '../app/useRunFile.ts'
import { type Run, type Runs, useRun } from '../app/useRuns.ts'
import type { LocaleKey, T } from '../i18n.ts'
import type { Selection } from '../model/editor.ts'
import { fileBaseName } from '../model/fileKind.ts'
import { placeMissing } from '../model/layout.ts'
import { changeCount, downstreamOf, editedNodes, samePath } from '../model/runDraft.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { Canvas, RUN_TEXT, type RunDecor } from './Canvas.tsx'
import { ZoomDock } from './Dock.tsx'
import { FileViewer } from './FileViewer.tsx'
import { Icon, type IconName } from './Icon.tsx'
import css from './inspector.module.css'
import { copyText, cx, Popover } from './primitives.tsx'
import { RunFileDetail, StepFileList } from './RunFiles.tsx'
import run from './run.module.css'
import shell from './shell.module.css'
import top from './topbar.module.css'
import ui from './ui.module.css'

export interface RunViewProps {
  t: T
  rpc: WorkflowLiteRpc
  session: string | undefined
  id: string
  runs: Runs
  workflows: readonly WorkflowEntry[]
  narrow: boolean
  inspectorW: number
  onOpenRun(id: string): void
  onOpenTemplate(name: string): void
  onOpenHub(): void
  /** 用系统程序打开产出文件；宿主没有桌面能力时不给。 */
  desktop?: Desktop
}

const GAP = 12
/** 改状态小菜单的宽度（与 run.module.css 的 `.menu` 一致）。 */
const MENU_W = 220

export const RUN_STATUS_TEXT: Record<RunStatus, LocaleKey> = {
  pending: 'run.overall.pending',
  running: 'run.overall.running',
  waiting: 'run.overall.waiting',
  done: 'run.overall.done',
  failed: 'run.overall.failed',
  cancelled: 'run.overall.cancelled',
}

/** 步骤状态的一句话说明（悬停提示）。 */
function nodeHint(status: NodeStatus): LocaleKey {
  return status === 'skipped' ? 'run.hint.skipped' : (`run.nodeHint.${status}` as LocaleKey)
}

const NODE_ICON: Record<NodeStatus, IconName> = {
  pending: 'clock',
  running: 'play',
  waiting: 'hourglass',
  done: 'check',
  failed: 'alert',
  skipped: 'skip',
}

export { shortTime }

/** 实例的状态小标。 */
export function RunStatusBadge(props: {
  t: T
  status: RunStatus | undefined
  problem?: 'missing' | 'invalid' | undefined
  /** 这个实例不记运行状态（没有状态文件）。 */
  untracked?: boolean
}): React.JSX.Element {
  const { t } = props
  if (props.untracked === true) {
    return (
      <span className={run.status} data-run-status="untracked" data-testid="wl-run-status">
        <span className={run.dot} />
        {t('run.untracked')}
      </span>
    )
  }
  if (props.problem !== undefined || props.status === undefined) {
    return (
      <span className={run.status} data-run-status="failed">
        <Icon name="alert" size={11} />
        {t(props.problem === 'missing' ? 'run.stateMissing' : 'run.stateInvalid')}
      </span>
    )
  }
  return (
    <span className={run.status} data-run-status={props.status} data-testid="wl-run-status">
      <span className={run.dot} />
      {t(RUN_STATUS_TEXT[props.status])}
    </span>
  )
}

/** 快照在一个实例里不会变：只在换实例或第一次读回来时换，轮询不让画布重建。 */
function useSnapshot(id: string, document: WorkflowDocument | undefined): WorkflowDocument | null {
  const ref = useRef<{ id: string; doc: WorkflowDocument } | null>(null)
  if (document !== undefined && (ref.current === null || ref.current.id !== id)) {
    // 视口归零：实例视图打开时总是看全图（模板里存的视角不一定合适）。
    ref.current = { id, doc: { ...document, viewport: { x: 0, y: 0, zoom: 1 } } }
  }
  return ref.current?.id === id ? ref.current.doc : null
}

export function RunView(props: RunViewProps): React.JSX.Element {
  const { t, id, narrow, inspectorW } = props
  const current = useRun(props.rpc, id, props.session, t, () => void props.runs.refresh())
  const raw = useSnapshot(id, current.view?.document)
  // 快照里没摆过位置的节点（模型用工具建的图、还没在画布上打开过）：照模板那边的规矩补位，不写回。
  const [placed, setPlaced] = useState<{ id: string; doc: WorkflowDocument } | null>(null)
  useEffect(() => {
    if (raw === null) return
    let live = true
    void placeMissing(raw, analyzeGraph(raw)).then((positions) => {
      if (!live) return
      const moved = Object.keys(positions).length > 0
      setPlaced({
        id,
        doc: moved
          ? {
              ...raw,
              nodes: raw.nodes.map((node) => {
                const at = positions[node.id]
                return at === undefined ? node : { ...node, position: at }
              }),
            }
          : raw,
      })
    })
    return () => {
      live = false
    }
  }, [raw, id])
  const snapshot = placed?.id === id ? placed.doc : null
  const analysis = useMemo(() => (snapshot === null ? null : analyzeGraph(snapshot)), [snapshot])
  const facts = useMemo(() => (snapshot === null ? null : graphFacts(snapshot)), [snapshot])
  const shown = current.shown
  const flow = useReactFlow()
  const [selection, setSelection] = useState<Selection>(null)
  const [menu, setMenu] = useState<{
    id: string
    x: number
    y: number
    step: 'status' | 'verdict'
  } | null>(null)
  const [keysOpen, setKeysOpen] = useState(false)
  /** 悬停着的文件（画布上的文件卡、右栏的文件行）：画布高亮它和它的上下游。 */
  const [focusFile, setFocusFile] = useState<string | null>(null)
  /** 查看框里打开着的文件。 */
  const [viewer, setViewer] = useState<{ target: FileTarget; title: string } | null>(null)

  const edited = useMemo(() => editedNodes(current.draft), [current.draft])
  const insets = { left: 0, right: narrow ? 0 : inspectorW + GAP }
  const insetRight = insets.right

  const decor = useMemo<RunDecor | undefined>(() => {
    if (snapshot === null) return undefined
    const onStatus = (nodeId: string, anchor: Element): void => {
      const root = anchor.closest('[data-testid="wl-root"]')
      if (root === null) return
      const box = root.getBoundingClientRect()
      const rect = anchor.getBoundingClientRect()
      // 菜单贴着小标弹出，但不伸到右栏底下。
      const limit = box.width - insetRight - MENU_W - GAP
      setMenu({
        id: nodeId,
        x: Math.max(GAP, Math.min(rect.left - box.left, limit)),
        y: rect.bottom - box.top + 6,
        step: 'status',
      })
    }
    if (shown === null) {
      return {
        nodes: {},
        taken: new Set(snapshot.edges.map((edge) => edge.id)),
        files: {},
        onStatus,
      }
    }
    const nodes: Record<string, { status: NodeStatus; round: number; edited: boolean }> = {}
    for (const [nodeId, node] of Object.entries(shown.nodes)) {
      nodes[nodeId] = { status: node.status, round: node.round ?? 0, edited: edited.has(nodeId) }
    }
    return {
      nodes,
      taken: takenEdges(snapshot, shown),
      files: current.view?.files ?? {},
      onStatus,
    }
  }, [snapshot, shown, edited, current.view?.files, insetRight])

  const fitAll = useCallback((): void => {
    void flow.fitView({
      duration: 320,
      maxZoom: 1,
      padding: {
        top: '84px',
        bottom: '64px',
        left: '28px',
        right: `${insets.right + 28}px`,
      },
    })
  }, [flow, insets.right])

  const steps = useMemo(
    () => new Set((snapshot?.nodes ?? []).filter(isStep).map((node) => node.id)),
    [snapshot],
  )
  const rerunFrom = useCallback(
    (nodeId: string): void => {
      if (snapshot === null) return
      current.rerun(downstreamOf(snapshot.edges, steps, nodeId))
    },
    [snapshot, steps, current],
  )

  const pickStatus = (nodeId: string, status: NodeStatus): void => {
    const verdicts = facts?.verdicts[nodeId]
    const node = shown?.nodes[nodeId]
    // 有条件出边的步骤改成「完成」时要一个判定：先问判定，再一起改。
    if (status === 'done' && verdicts !== undefined && node?.verdict === undefined) {
      setMenu((open) => (open === null ? open : { ...open, step: 'verdict' }))
      return
    }
    current.setStatus(nodeId, status)
    setMenu(null)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target
    if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      return
    }
    const key = event.key.toLowerCase()
    if (key === 'escape') {
      if (menu !== null) setMenu(null)
      else setSelection(null)
    } else if (key === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      fitAll()
    }
  }

  const summary = current.view?.summary
  const selectedNode = selection?.kind === 'node' && steps.has(selection.id) ? selection.id : null
  const selectedFile =
    selection?.kind === 'node'
      ? snapshot?.nodes.find((node): node is FileNode => node.id === selection.id && isFile(node))
      : undefined
  const menuNode = menu === null ? undefined : shown?.nodes[menu.id]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 只在这一层收视图内冒上来的按键
    <div onKeyDown={onKeyDown} style={{ display: 'contents' }}>
      <div className={shell.canvas}>
        {snapshot !== null && analysis !== null && (
          <Canvas
            t={t}
            doc={snapshot}
            analysis={analysis}
            loadKey={`run:${id}`}
            selection={selection}
            problems={[]}
            insets={insets}
            onEdit={() => {}}
            onSelect={(next) => {
              setSelection(next)
              setMenu(null)
            }}
            onRequestAdd={() => {}}
            onDropSource={() => {}}
            onStarter={() => {}}
            focusFile={focusFile}
            onFocusFile={setFocusFile}
            {...(decor === undefined ? {} : { run: decor })}
          />
        )}
      </div>

      <div className={shell.top}>
        <RunTopBar {...props} summary={summary} state={shown} />
      </div>

      {!narrow && snapshot !== null && (
        <div className={shell.inspector}>
          <RunPanel
            t={t}
            rpc={props.rpc}
            instance={id}
            current={current}
            snapshot={snapshot}
            verdicts={facts?.verdicts ?? {}}
            selected={selectedNode}
            selectedFile={selectedFile ?? null}
            desktop={props.desktop}
            onSelect={(nodeId) =>
              setSelection(nodeId === null ? null : { kind: 'node', id: nodeId })
            }
            onRerun={rerunFrom}
            onFocusFile={setFocusFile}
            onView={(target, title) => setViewer({ target, title })}
          />
        </div>
      )}

      <ZoomDock t={t} keysOpen={keysOpen} setKeysOpen={setKeysOpen} onFit={fitAll} />

      {menu !== null && menuNode !== undefined && (
        <StatusMenu
          t={t}
          at={menu}
          node={menuNode}
          step={menu.step}
          verdicts={facts?.verdicts[menu.id] ?? []}
          onStatus={(status) => pickStatus(menu.id, status)}
          onVerdict={(verdict) => {
            current.setStatus(menu.id, 'done')
            current.setField(['nodes', menu.id, 'verdict'], verdict)
            setMenu(null)
          }}
          onRerun={() => {
            rerunFrom(menu.id)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}

      <Banners t={t} current={current} />

      {viewer !== null && (
        <FileViewer
          t={t}
          rpc={props.rpc}
          instance={id}
          target={viewer.target}
          title={viewer.title}
          desktop={props.desktop}
          onClose={() => setViewer(null)}
        />
      )}

      {(current.draft.length > 0 || current.conflicts.length > 0) && (
        <DraftBar t={t} current={current} />
      )}

      {current.toast !== null && (
        <div className={shell.toastSeat} key={current.toast.id}>
          <div className={cx(shell.toast, ui.rise)} data-tone={current.toast.tone} role="status">
            <Icon name={current.toast.tone === 'error' ? 'alert' : 'check'} size={14} />
            <span>{current.toast.text}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 顶栏
// ─────────────────────────────────────────────────────────────

function RunTopBar(
  props: RunViewProps & { summary: InstanceSummary | undefined; state: RunState | null },
): React.JSX.Element {
  const { t, summary, state } = props
  const [copied, setCopied] = useState(false)
  const progress = state === null ? null : progressOf(state)
  return (
    <div className={top.bar}>
      <div className={cx(ui.panel, top.pill)}>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.tip, ui.tipStart)}
          data-tip={t('hub.title')}
          aria-label={t('hub.title')}
          data-testid="wl-hub-open"
          onClick={props.onOpenHub}
        >
          <Icon name="hub" size={16} />
        </button>
        <span className={ui.divider} />
        <RunSwitcher
          t={t}
          runs={props.runs}
          activeId={props.id}
          workflows={props.workflows}
          onOpenRun={props.onOpenRun}
          onOpenTemplate={props.onOpenTemplate}
          onOpenHub={props.onOpenHub}
          trigger={(open) => (
            <span className={run.switch} data-open={open}>
              <span className={run.switchKind}>{t('run.kind')}</span>
              <span className={run.switchName}>{summary?.workflow ?? '…'}</span>
              <span className={run.switchTime}>{shortTime(summary?.createdAt)}</span>
              <Icon name="chevronDown" size={14} />
            </span>
          )}
        />
        {summary !== undefined && (
          <>
            <RunStatusBadge
              t={t}
              status={state?.status}
              problem={state === null ? summary.stateProblem : undefined}
              untracked={summary.statePath === undefined}
            />
            {progress !== null && (
              <span className={run.progress} data-testid="wl-run-progress">
                {progress.done}/{progress.total}
              </span>
            )}
          </>
        )}
      </div>
      <span className={ui.grow} />
      {summary !== undefined && (
        <div className={cx(ui.panel, top.pill, top.tools)}>
          <button
            type="button"
            className={cx(ui.btn, ui.small)}
            disabled={!props.workflows.some((entry) => entry.name === summary.workflow)}
            title={
              props.workflows.some((entry) => entry.name === summary.workflow)
                ? undefined
                : t('run.templateGone')
            }
            data-testid="wl-run-open-template"
            onClick={() => props.onOpenTemplate(summary.workflow)}
          >
            <Icon name="pencil" size={14} />
            {t('run.openTemplate')}
          </button>
          {summary.statePath !== undefined && (
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.tip, ui.tipEnd)}
              data-tip={summary.statePath}
              onClick={() =>
                void copyText(summary.statePath ?? '').then((ok) => {
                  setCopied(ok)
                  window.setTimeout(() => setCopied(false), 1400)
                })
              }
            >
              <Icon name={copied ? 'check' : 'copy'} size={14} />
              {copied ? t('common.copied') : t('run.copyPath')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 实例与工作流的下拉：本会话的实例（当前的那个带实心点）、工作流（打开模板）、全部实例与管理。
 * 模板编辑的顶栏也用它的实例那一段（见 {@link RunMenuSection}）。
 */
function RunSwitcher(props: {
  t: T
  runs: Runs
  activeId: string | null
  workflows: readonly WorkflowEntry[]
  onOpenRun(id: string): void
  onOpenTemplate(name: string): void
  onOpenHub(): void
  trigger(open: boolean): React.ReactNode
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t('run.pick')}
      className={top.menu}
      trigger={
        <button
          type="button"
          className={cx(top.switch, run.switchButton)}
          aria-expanded={open}
          data-testid="wl-run-switcher"
          onClick={() => {
            setOpen(!open)
            if (!open) void props.runs.refresh()
          }}
        >
          {props.trigger(open)}
        </button>
      }
    >
      <RunMenuSection
        t={t}
        runs={props.runs}
        activeId={props.activeId}
        onOpenRun={(id) => {
          setOpen(false)
          props.onOpenRun(id)
        }}
      />
      {props.runs.list.length > 0 && <div className={ui.menuSep} />}
      <p className={ui.menuTitle}>{t('run.workflows')}</p>
      <div className={top.list}>
        {props.workflows.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className={ui.menuItem}
            onClick={() => {
              setOpen(false)
              props.onOpenTemplate(entry.name)
            }}
          >
            <Icon name="folder" size={15} />
            <span className={ui.menuLabel}>{entry.name}</span>
          </button>
        ))}
      </div>
      <div className={ui.menuSep} />
      <button
        type="button"
        className={ui.menuItem}
        onClick={() => {
          setOpen(false)
          props.onOpenHub()
        }}
      >
        <Icon name="hub" size={15} />
        <span className={ui.menuLabel}>{t('run.manage')}</span>
      </button>
    </Popover>
  )
}

/** 下拉里「本会话的实例」那一段。没有实例就什么都不画。 */
export function RunMenuSection(props: {
  t: T
  runs: Runs
  activeId: string | null
  onOpenRun(id: string): void
}): React.JSX.Element | null {
  const { t, runs } = props
  if (runs.list.length === 0) return null
  return (
    <>
      <p className={ui.menuTitle}>{t('run.thisSession')}</p>
      <div className={top.list} data-testid="wl-run-list">
        {runs.list.map((item) => (
          <div key={item.id} className={run.row}>
            <button
              type="button"
              className={cx(ui.menuItem, run.item)}
              data-active={item.id === props.activeId}
              data-testid="wl-run-item"
              data-id={item.id}
              style={{ gridColumn: '1 / 3' }}
              onClick={() => props.onOpenRun(item.id)}
            >
              <span
                data-run-status={
                  item.statePath === undefined ? 'untracked' : (item.status ?? 'failed')
                }
              >
                <span
                  className={run.dot}
                  style={{ opacity: item.id === runs.current ? 1 : 0.45 }}
                />
              </span>
              <span className={run.rowMain}>
                <span className={run.rowTitle}>{item.workflow}</span>
                <span className={run.rowMeta}>
                  {shortTime(item.createdAt)}
                  {item.total !== undefined && ` · ${item.done}/${item.total}`}
                  {item.status !== undefined && ` · ${t(RUN_STATUS_TEXT[item.status])}`}
                  {item.statePath === undefined && ` · ${t('run.untracked')}`}
                </span>
              </span>
            </button>
            {item.id === runs.current ? (
              <span
                className={run.current}
                role="img"
                title={t('run.current')}
                aria-label={t('run.current')}
                data-testid="wl-run-current"
              >
                <Icon name="pin" size={14} />
              </span>
            ) : (
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd, run.bind)}
                data-tip={t('run.setCurrent')}
                aria-label={t('run.setCurrent')}
                data-testid="wl-run-bind"
                onClick={() => void runs.bind(item.id)}
              >
                <Icon name="pin" size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// 改状态的小菜单
// ─────────────────────────────────────────────────────────────

function StatusMenu(props: {
  t: T
  at: { x: number; y: number }
  node: { status: NodeStatus; verdict?: string }
  step: 'status' | 'verdict'
  verdicts: readonly string[]
  onStatus(status: NodeStatus): void
  onVerdict(verdict: string): void
  onRerun(): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) props.onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [props.onClose])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
  }, [props.step])
  return (
    <div
      ref={ref}
      className={cx(ui.panel, run.menu)}
      style={{ left: props.at.x, top: props.at.y }}
      role="menu"
      data-testid="wl-run-menu"
    >
      {props.step === 'verdict' ? (
        <>
          <p className={run.menuHint}>{t('run.pickVerdict')}</p>
          {props.verdicts.map((verdict) => (
            <button
              key={verdict}
              type="button"
              role="menuitem"
              className={ui.menuItem}
              data-testid="wl-run-verdict"
              onClick={() => props.onVerdict(verdict)}
            >
              <Icon name="check" size={14} />
              <span className={ui.menuLabel}>{verdict}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          {NODE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="menuitemradio"
              aria-checked={props.node.status === status}
              className={ui.menuItem}
              data-active={props.node.status === status}
              data-status={status}
              title={t(nodeHint(status))}
              onClick={() => props.onStatus(status)}
            >
              <span
                data-run-status={status}
                style={{ display: 'inline-flex', color: 'var(--wl-run)' }}
              >
                <Icon name={NODE_ICON[status]} size={14} />
              </span>
              <span className={ui.menuLabel}>{t(RUN_TEXT[status])}</span>
            </button>
          ))}
          {props.node.status !== 'pending' && (
            <>
              <div className={ui.menuSep} />
              <button
                type="button"
                role="menuitem"
                className={ui.menuItem}
                data-testid="wl-run-rerun"
                onClick={props.onRerun}
              >
                <Icon name="reload" size={14} />
                <span className={ui.menuLabel}>{t('run.rerun')}</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 右栏
// ─────────────────────────────────────────────────────────────

function isEdited(draft: readonly StateEdit[], path: readonly string[]): boolean {
  return draft.some((edit) => samePath(edit.path, path))
}

function EditedDot(props: { on: boolean }): React.JSX.Element | null {
  return props.on ? <span className={run.edited} aria-hidden="true" /> : null
}

function RunPanel(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  current: Run
  snapshot: WorkflowDocument
  verdicts: Readonly<Record<string, string[]>>
  selected: string | null
  selectedFile: FileNode | null
  desktop: Desktop | undefined
  onSelect(id: string | null): void
  onRerun(id: string): void
  onFocusFile(id: string | null): void
  onView(target: FileTarget, title: string): void
}): React.JSX.Element {
  const { t, current, snapshot, selected, selectedFile } = props
  const state = current.shown
  const summary = current.view?.summary
  const made = current.view?.files ?? {}
  const labelOf = (id: string): string => {
    const node = snapshot.nodes.find((candidate) => candidate.id === id)
    return node !== undefined &&
      isStep(node) &&
      node.data.label !== undefined &&
      node.data.label !== ''
      ? node.data.label
      : id
  }
  const title =
    selectedFile !== null
      ? t('file.title')
      : selected === null
        ? t('run.overview')
        : labelOf(selected)
  const overview = selectedFile === null && selected === null && state !== null
  let body: React.ReactNode
  if (selectedFile !== null) {
    body = (
      <RunFileDetail
        t={t}
        rpc={props.rpc}
        instance={props.instance}
        snapshot={snapshot}
        file={selectedFile}
        made={made[selectedFile.id] === true}
        state={state}
        version={current.view?.mtime ?? 0}
        desktop={props.desktop}
        onSelectStep={props.onSelect}
        onFocusFile={props.onFocusFile}
        onView={props.onView}
        onError={(text) => current.flash('error', text)}
      />
    )
  } else if (state === null && selected !== null) {
    // 没有状态（不记进度，或状态文件读不出来）：步骤只能看它读写哪些文件。
    body = (
      <StepFileList
        t={t}
        snapshot={snapshot}
        step={selected}
        reported={[]}
        made={made}
        onSelectFile={props.onSelect}
        onFocusFile={props.onFocusFile}
        onViewPath={(path) => props.onView({ path }, fileBaseName(path))}
      />
    )
  } else if (state === null && summary !== undefined && summary.statePath === undefined) {
    body = <Untracked t={t} summary={summary} snapshot={snapshot} />
  } else if (state === null) {
    body = <p className={css.help}>{current.view === null ? t('run.loading') : t('run.noState')}</p>
  } else if (selected === null) {
    body = (
      <Overview
        t={t}
        current={current}
        state={state}
        summary={summary}
        labelOf={labelOf}
        onSelect={props.onSelect}
      />
    )
  } else {
    body = (
      <NodeDetail
        t={t}
        current={current}
        id={selected}
        node={state.nodes[selected]}
        verdicts={props.verdicts[selected]}
        onRerun={() => props.onRerun(selected)}
        files={
          <StepFileList
            t={t}
            snapshot={snapshot}
            step={selected}
            reported={state.nodes[selected]?.outputs ?? []}
            made={made}
            onSelectFile={props.onSelect}
            onFocusFile={props.onFocusFile}
            onViewPath={(path) => props.onView({ path }, fileBaseName(path))}
          />
        }
      />
    )
  }
  return (
    <aside
      className={cx(ui.panel, css.panel)}
      data-testid="wl-run-panel"
      aria-label={t('run.panel')}
    >
      <header className={css.head}>
        {(selected !== null || selectedFile !== null) && (
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t('run.backToOverview')}
            title={t('run.backToOverview')}
            onClick={() => props.onSelect(null)}
          >
            <Icon name="chevronLeft" size={15} />
          </button>
        )}
        <span className={css.headTitle}>{title}</span>
      </header>
      <div className={cx(css.body, overview && run.bodyOverview)}>{body}</div>
    </aside>
  )
}

/** 不记运行状态的实例：右栏只讲清楚为什么看不到进度，再列几样基本信息。 */
function Untracked(props: {
  t: T
  summary: InstanceSummary
  snapshot: WorkflowDocument
}): React.JSX.Element {
  const { t, summary } = props
  return (
    <>
      <p className={css.help} data-testid="wl-run-untracked">
        {t('run.untrackedBanner')}
      </p>
      <section className={run.section}>
        <dl className={run.facts}>
          <dt>{t('run.mode')}</dt>
          <dd>{t(`settings.mode.${summary.mode}` as LocaleKey)}</dd>
          <dt>{t('run.started')}</dt>
          <dd>{shortTime(summary.createdAt)}</dd>
          <dt>{t('run.steps')}</dt>
          <dd>{props.snapshot.nodes.filter(isStep).length}</dd>
        </dl>
      </section>
    </>
  )
}

function Overview(props: {
  t: T
  current: Run
  state: RunState
  summary: InstanceSummary | undefined
  labelOf(id: string): string
  onSelect(id: string | null): void
}): React.JSX.Element {
  const { t, current, state, summary } = props
  const progress = progressOf(state)
  const log = [...state.log].reverse()
  return (
    <>
      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.overall')}
            <EditedDot on={isEdited(current.draft, ['status'])} />
          </span>
          <span className={run.progress}>
            {progress.done}/{progress.total}
          </span>
        </p>
        <div className={run.bar} aria-hidden="true">
          <div
            className={run.barFill}
            style={{
              transform: `scaleX(${progress.total === 0 ? 0 : progress.done / progress.total})`,
            }}
          />
        </div>
        <div className={run.choices} role="radiogroup" aria-label={t('run.overall')}>
          {RUN_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={state.status === status}
              className={run.choice}
              data-run-status={status}
              data-testid="wl-run-overall"
              data-value={status}
              title={t(`run.hint.${status}` as LocaleKey)}
              onClick={() => current.setField(['status'], status)}
            >
              <span className={run.dot} />
              {t(RUN_STATUS_TEXT[status])}
            </button>
          ))}
        </div>
      </section>

      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.note')}
            <EditedDot on={isEdited(current.draft, ['note'])} />
          </span>
        </p>
        <textarea
          className={cx(ui.textarea, run.autoArea)}
          rows={2}
          value={state.note ?? ''}
          placeholder={t('run.notePlaceholder')}
          data-testid="wl-run-note"
          onChange={(event) =>
            current.setField(
              ['note'],
              event.currentTarget.value === '' ? null : event.currentTarget.value,
            )
          }
        />
      </section>

      <section className={run.section}>
        <dl className={run.facts}>
          {summary?.goal !== undefined && (
            <>
              <dt>{t('run.goal')}</dt>
              <dd>{summary.goal}</dd>
            </>
          )}
          <dt>{t('run.mode')}</dt>
          <dd>{t(`settings.mode.${state.mode}` as LocaleKey)}</dd>
          <dt>{t('run.started')}</dt>
          <dd>{shortTime(summary?.createdAt)}</dd>
          <dt>{t('run.updated')}</dt>
          <dd>{shortTime(state.updatedAt)}</dd>
          {summary?.statePath !== undefined && (
            <>
              <dt>{t('run.stateFile')}</dt>
              <dd className={run.path}>
                <code>{summary.statePath}</code>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className={cx(run.section, run.timelineSection)}>
        <p className={run.sectionTitle}>
          <span>{t('run.timeline')}</span>
          {log.length > 0 && <span className={run.progress}>{log.length}</span>}
        </p>
        {log.length === 0 ? (
          <p className={css.help}>{t('run.noEvents')}</p>
        ) : (
          <ul className={cx(run.timeline, run.timelineScroll)} data-testid="wl-run-timeline">
            {log.map((entry, index) => (
              <TimelineItem
                // biome-ignore lint/suspicious/noArrayIndexKey: 流水只追加，倒序后的下标就是稳定身份
                key={`${entry.at}-${index}`}
                t={t}
                entry={entry}
                labelOf={props.labelOf}
                onSelect={props.onSelect}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

const EVENT_TEXT: Record<RunLogEntry['event'], LocaleKey> = {
  start: 'run.event.start',
  done: 'run.event.done',
  failed: 'run.event.failed',
  waiting: 'run.event.waiting',
  skipped: 'run.event.skipped',
  resume: 'run.event.resume',
  transfer: 'run.event.transfer',
  edit: 'run.event.edit',
  note: 'run.event.note',
}

function TimelineItem(props: {
  t: T
  entry: RunLogEntry
  labelOf(id: string): string
  onSelect(id: string | null): void
}): React.JSX.Element {
  const { t, entry } = props
  const time = new Date(entry.at)
  const clock = Number.isNaN(time.getTime())
    ? entry.at
    : `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 时间线行的键盘入口是右栏里的状态控件；点一下只是顺手定位
    <li className={run.event} onClick={() => props.onSelect(entry.node ?? null)}>
      <span className={run.eventTime}>{clock}</span>
      <span className={run.eventText}>
        {entry.by === 'user' && <span className={run.eventUser}>{t('run.byUser')} </span>}
        {entry.node !== undefined && <b>{props.labelOf(entry.node)} </b>}
        {t(EVENT_TEXT[entry.event])}
        {entry.round !== undefined &&
          entry.round > 1 &&
          ` · ${t('run.round').replace('{n}', String(entry.round))}`}
        {entry.verdict !== undefined && ` · ${entry.verdict}`}
        {entry.detail !== undefined && ` — ${entry.detail}`}
      </span>
    </li>
  )
}

function NodeDetail(props: {
  t: T
  current: Run
  id: string
  node: RunState['nodes'][string] | undefined
  verdicts: readonly string[] | undefined
  onRerun(): void
  /** 「产出 / 读取」那一块（文件列表由 `RunFiles` 画）。 */
  files: React.ReactNode
}): React.JSX.Element {
  const { t, current, id, node } = props
  if (node === undefined) return <p className={css.help}>{t('run.noNode')}</p>
  const path = (field: string): string[] => ['nodes', id, field]
  const round = node.round ?? 0
  return (
    <>
      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.nodeStatus')}
            <EditedDot on={isEdited(current.draft, path('status'))} />
          </span>
        </p>
        <div className={run.choices} role="radiogroup" aria-label={t('run.nodeStatus')}>
          {NODE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={node.status === status}
              className={run.choice}
              data-run-status={status}
              data-testid="wl-run-node-status"
              data-value={status}
              title={t(nodeHint(status))}
              onClick={() => {
                if (
                  status === 'done' &&
                  props.verdicts !== undefined &&
                  node.verdict === undefined
                ) {
                  current.setStatus(id, status)
                  current.setField(path('verdict'), props.verdicts[0] ?? null)
                  return
                }
                current.setStatus(id, status)
              }}
            >
              <Icon name={NODE_ICON[status]} size={12} />
              {t(RUN_TEXT[status])}
            </button>
          ))}
        </div>
        {node.status !== 'pending' && (
          <button type="button" className={cx(ui.btn, ui.small, ui.soft)} onClick={props.onRerun}>
            <Icon name="reload" size={13} />
            {t('run.rerun')}
          </button>
        )}
      </section>

      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.roundLabel')}
            <EditedDot on={isEdited(current.draft, path('round'))} />
          </span>
          <span className={run.stepper}>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('run.roundDown')}
              disabled={round <= 1}
              onClick={() => current.setField(path('round'), round - 1)}
            >
              <Icon name="minus" size={13} />
            </button>
            <span className={run.stepperValue}>{round === 0 ? '—' : round}</span>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('run.roundUp')}
              onClick={() => current.setField(path('round'), round + 1)}
            >
              <Icon name="plus" size={13} />
            </button>
          </span>
        </p>
      </section>

      {props.verdicts !== undefined && (
        <section className={run.section}>
          <p className={run.sectionTitle}>
            <span>
              {t('run.verdict')}
              <EditedDot on={isEdited(current.draft, path('verdict'))} />
            </span>
          </p>
          <div className={run.choices} role="radiogroup" aria-label={t('run.verdict')}>
            {props.verdicts.map((verdict) => (
              <button
                key={verdict}
                type="button"
                role="radio"
                aria-checked={node.verdict === verdict}
                className={run.choice}
                data-run-status={node.verdict === verdict ? 'running' : 'pending'}
                onClick={() =>
                  current.setField(path('verdict'), node.verdict === verdict ? null : verdict)
                }
              >
                {verdict}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.summary')}
            <EditedDot on={isEdited(current.draft, path('summary'))} />
          </span>
        </p>
        <textarea
          className={cx(ui.textarea, run.autoArea)}
          rows={3}
          value={node.summary ?? ''}
          placeholder={t('run.summaryPlaceholder')}
          data-testid="wl-run-summary"
          onChange={(event) =>
            current.setField(
              path('summary'),
              event.currentTarget.value === '' ? null : event.currentTarget.value,
            )
          }
        />
      </section>

      {(node.status === 'failed' || node.error !== undefined) && (
        <section className={run.section}>
          <p className={run.sectionTitle}>
            <span>
              {t('run.error')}
              <EditedDot on={isEdited(current.draft, path('error'))} />
            </span>
          </p>
          <textarea
            className={ui.textarea}
            rows={2}
            value={node.error ?? ''}
            onChange={(event) =>
              current.setField(
                path('error'),
                event.currentTarget.value === '' ? null : event.currentTarget.value,
              )
            }
          />
        </section>
      )}

      {props.files}

      {(node.by !== undefined || node.startedAt !== undefined || node.finishedAt !== undefined) && (
        <section className={run.section}>
          <dl className={run.facts}>
            {node.by !== undefined && (
              <>
                <dt>{t('run.by')}</dt>
                <dd>{node.by}</dd>
              </>
            )}
            {node.startedAt !== undefined && (
              <>
                <dt>{t('run.startedAt')}</dt>
                <dd>{shortTime(node.startedAt)}</dd>
              </>
            )}
            {node.finishedAt !== undefined && (
              <>
                <dt>{t('run.finishedAt')}</dt>
                <dd>{shortTime(node.finishedAt)}</dd>
              </>
            )}
          </dl>
        </section>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// 提示条与草稿栏
// ─────────────────────────────────────────────────────────────

function Banners(props: { t: T; current: Run }): React.JSX.Element | null {
  const { t, current } = props
  const view = current.view
  let tone: 'danger' | 'info' = 'info'
  let text: string | null = null
  let detail: string | null = null
  if (current.error !== null) {
    tone = 'danger'
    text = t('run.loadError')
    detail = current.error
  } else if (view !== null && view.summary.statePath === undefined) {
    // 不记运行状态：没有可报的问题，右栏里有说明。
  } else if (view !== null && view.state === null && view.mtime === 0) {
    tone = 'danger'
    text = t('run.stateMissing')
    detail = view.summary.statePath ?? null
  } else if (view !== null && view.state === null) {
    tone = 'danger'
    text = t('run.stateInvalidLong')
    detail = view.issues
      .slice(0, 3)
      .map((issue) => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`))
      .join('；')
  } else if (current.overwritten.length > 0) {
    text = t('run.overwritten')
    detail = current.overwritten.map((path) => path.join('.')).join('、')
  }
  if (text === null) return null
  return (
    <div className={shell.bannerSeat}>
      <div
        className={cx(ui.panel, shell.banner, tone === 'danger' && shell.bannerDanger, ui.rise)}
        role={tone === 'danger' ? 'alert' : 'status'}
        data-testid="wl-run-banner"
      >
        <Icon name={tone === 'danger' ? 'alert' : 'info'} size={15} />
        <span className={shell.bannerText}>
          {text}
          {detail !== null && <span className={shell.bannerIds}> · {detail}</span>}
        </span>
      </div>
    </div>
  )
}

function describe(t: T, edit: StateEdit): React.ReactNode {
  const where = edit.path.length === 1 ? t('run.overall') : edit.path[1]
  const field = edit.path[edit.path.length - 1] ?? ''
  const show = (value: StateEdit['to']): string => {
    if (value === null) return t('run.empty')
    if (field === 'status' && typeof value === 'string') {
      const key =
        edit.path.length === 1 ? RUN_STATUS_TEXT[value as RunStatus] : RUN_TEXT[value as NodeStatus]
      return key === undefined ? value : t(key)
    }
    const text = Array.isArray(value) ? value.join('、') : String(value)
    return text.length > 24 ? `${text.slice(0, 24)}…` : text
  }
  return (
    <>
      <b>{where}</b> · {field}：<s>{show(edit.from)}</s> → {show(edit.to)}
    </>
  )
}

function DraftBar(props: { t: T; current: Run }): React.JSX.Element {
  const { t, current } = props
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <div className={run.draftSeat}>
      <div className={cx(ui.panel, run.draft, ui.rise)} data-testid="wl-run-draft">
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          up
          label={t('run.changes')}
          className={run.draftList}
          trigger={
            <button
              type="button"
              className={cx(ui.btn, ui.small)}
              aria-expanded={open}
              data-testid="wl-run-draft-toggle"
              onClick={() => setOpen(!open)}
            >
              <span className={run.draftCount}>
                <span className={run.edited} style={{ margin: 0 }} />
                {t('run.changed').replace('{n}', String(changeCount(current.draft)))}
              </span>
              <Icon name="chevronDown" size={13} />
            </button>
          }
        >
          {current.conflicts.map((conflict) => (
            <div
              key={conflict.path.join('.')}
              className={run.conflict}
              data-testid="wl-run-conflict"
            >
              <span>
                {t('run.conflict')} <b>{conflict.path.join('.')}</b>
              </span>
              <span>
                {t('run.conflictMine')}：{String(conflict.to ?? t('run.empty'))} ·{' '}
                {t('run.conflictDisk')}：{String(conflict.disk ?? t('run.empty'))}
              </span>
              <span className={run.conflictActions}>
                <button
                  type="button"
                  className={cx(ui.btn, ui.small, ui.primary)}
                  onClick={() => current.resolve(conflict, 'mine')}
                >
                  {t('run.keepMine')}
                </button>
                <button
                  type="button"
                  className={cx(ui.btn, ui.small)}
                  onClick={() => current.resolve(conflict, 'theirs')}
                >
                  {t('run.useDisk')}
                </button>
              </span>
            </div>
          ))}
          {current.draft.map((edit) => (
            <div key={edit.path.join('.')} className={run.change}>
              <span className={run.changeText}>{describe(t, edit)}</span>
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small)}
                aria-label={t('run.undoChange')}
                onClick={() => current.undoEdit(edit.path)}
              >
                <Icon name="undo" size={13} />
              </button>
            </div>
          ))}
        </Popover>
        <input
          className={cx(ui.input, run.draftNote)}
          value={current.note}
          placeholder={t('run.notePrompt')}
          aria-label={t('run.notePrompt')}
          data-testid="wl-run-draft-note"
          onChange={(event) => current.setNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void current.save()
          }}
        />
        {confirm ? (
          <>
            <span className={run.draftCount}>{t('run.discardConfirm')}</span>
            <button
              type="button"
              className={cx(ui.btn, ui.small)}
              onClick={() => setConfirm(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.dangerSolid)}
              onClick={() => {
                setConfirm(false)
                current.discard()
              }}
            >
              {t('run.discard')}
            </button>
          </>
        ) : (
          <button type="button" className={cx(ui.btn, ui.small)} onClick={() => setConfirm(true)}>
            {t('run.discard')}
          </button>
        )}
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          disabled={current.saving || current.draft.length === 0 || current.conflicts.length > 0}
          title={current.conflicts.length > 0 ? t('run.resolveFirst') : undefined}
          data-testid="wl-run-save"
          onClick={() => void current.save()}
        >
          <Icon name="check" size={13} />
          {t('run.save')}
        </button>
      </div>
    </div>
  )
}
