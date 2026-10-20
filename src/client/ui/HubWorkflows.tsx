/**
 * dsh-workflow-lite — 工作流中心「工作流」页：左边全部工作流，右边选中那张的版本（{@link VersionList}）。
 *
 * 哪张都能直接看、存、切版本，改名、删除也在左边那一行上（{@link HubWorkflowList}），
 * 不用先在编辑页打开它；要编辑就点「打开」。
 * 正在编辑的那张：动手前先把编辑页的改动写下去，切换之后编辑页按磁盘重新加载。
 *
 * 导入导出也在这一页：右栏换成导出（{@link HubExport}，标题栏「导出」）或导入（{@link HubImport}，
 * 左栏顶上「导入」，也可以直接把包拖到这一页上）。做完回到版本，顶上一句结果。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubWorkflows
 */

import { useCallback, useEffect, useState } from 'react'
import { normalizeName } from '../../shared/naming.ts'
import type { WorkflowEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { HubExport, type PackScope } from './HubExport.tsx'
import { HubImport } from './HubImport.tsx'
import { HubWorkflowList } from './HubWorkflowList.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { useResizeFlip } from './motion.tsx'
import { Callout } from './PackRow.tsx'
import css from './pack.module.css'
import { cx } from './primitives.tsx'
import { Skeleton } from './Skeleton.tsx'
import ui from './ui.module.css'
import { useFileDrop } from './useFileDrop.ts'
import { VersionList } from './VersionList.tsx'

/** 右栏现在是什么：版本（缺省）、导出选中那张、导入。 */
type Pane = 'versions' | 'export' | 'import'

export function HubWorkflows(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 编辑页正开着的那张。 */
  current: string | null
  /** 看 skill 时站在哪个会话、哪个工作区（导入导出盘点 skill 用）。 */
  scope: PackScope
  flush(): Promise<boolean>
  /** 一进来就是导出 `current` 那张（画布顶栏的「导出」），不是版本。 */
  startExport?: boolean
  /** 正开着的那张切了版本：编辑页按磁盘重新加载。 */
  onReload(): void
  onOpen(name: string): void
  /** 改名、删除：走编辑页同一套（正开着的那张跟着变）。回 `false` = 没成，已经提示过。 */
  rename(from: string, to: string): Promise<boolean>
  remove(name: string): Promise<boolean>
  /** 版本数变了：外面的工作流目录跟上。 */
  onChanged(): void
}): React.JSX.Element {
  const { t, rpc, current } = props
  const [workflows, setWorkflows] = useState<WorkflowEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(current)
  const [pane, setPane] = useState<Pane>(props.startExport === true ? 'export' : 'versions')
  /** 拖到页面上的包（交给导入页）。 */
  const [dropped, setDropped] = useState<File | null>(null)
  /** 导入导出做完的那句结果。 */
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await rpc.call('graph/list', {})
      setWorkflows([...list.workflows].sort((a, b) => b.updatedAt - a.updatedAt))
    } catch (caught) {
      setError(errorMessage(caught))
      setWorkflows([])
    }
  }, [rpc])
  useEffect(() => {
    void load()
  }, [load])

  const openImport = (file: File | null): void => {
    setNotice(null)
    setDropped(file)
    setPane('import')
  }

  // 把包拖到这一页上：直接进导入（宿主那层「拖动到此处即可添加」不弹，见 useFileDrop）。
  const dragging = useFileDrop(openImport)
  // 顶上的结果条收掉：条在原地淡出，下面的版本列表滑上来；新出现的从左边浮入。
  const detailRef = useResizeFlip({ exit: true, enter: true })

  if (workflows === null) {
    return <Skeleton label={t('hub.loading')} />
  }

  const importPane = (
    <HubImport
      t={t}
      rpc={rpc}
      scope={props.scope}
      file={dropped}
      over={dragging}
      taken={new Set(workflows.map((entry) => entry.name.toLowerCase()))}
      current={current}
      flush={props.flush}
      onBack={() => {
        setDropped(null)
        setPane('versions')
      }}
      onDone={(name, text, reload) => {
        setDropped(null)
        setPane('versions')
        setPicked(name)
        setNotice(text)
        if (reload) props.onReload()
        void load()
        props.onChanged()
      }}
    />
  )

  if (workflows.length === 0) {
    if (pane === 'import') {
      return (
        <div className={cx(hub.wfPage, dragging && css.dropping)} data-wl-file-drop="">
          <div className={hub.side} />
          {importPane}
        </div>
      )
    }
    return (
      <div className={cx(hub.empty, dragging && css.dropping)} data-wl-file-drop="">
        <span className={hub.emptyIcon}>
          <Icon name="folder" size={20} />
        </span>
        <p className={hub.emptyTitle}>{error ?? t('hub.wfEmpty')}</p>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.soft)}
          data-tip={t('pack.importTip')}
          data-testid="wl-hub-wf-import"
          onClick={() => openImport(null)}
        >
          <Icon name="upload" size={14} />
          {t('pack.import')}
        </button>
      </div>
    )
  }

  const selected = workflows.find((entry) => entry.name === picked) ?? workflows[0]
  if (selected === undefined) return <div />
  // 画布上正开着的还没落盘（没在列表里）：不拿别的一张顶替去导出，停在版本。
  const shown = pane === 'export' && selected.name !== picked ? 'versions' : pane
  const editing = selected.name === current
  return (
    <div className={cx(hub.wfPage, dragging && css.dropping)} data-wl-file-drop="">
      <div className={hub.side}>
        <div className={css.tools}>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            aria-pressed={pane === 'import'}
            data-tip={t('pack.importTip')}
            data-testid="wl-hub-wf-import"
            onClick={() => openImport(null)}
          >
            <Icon name="upload" size={14} />
            {t('pack.import')}
          </button>
        </div>
        <HubWorkflowList
          t={t}
          className={hub.sideList}
          workflows={workflows}
          selected={selected.name}
          current={current}
          onPick={(name) => {
            setPicked(name)
            setNotice(null)
            setDropped(null)
            setPane('versions')
          }}
          rename={async (from, to) => {
            const ok = await props.rename(from, to)
            if (!ok) return false
            // 主机按同一套规矩收拾名字：选中的跟着换成新名字。
            if (from === selected.name) setPicked(normalizeName(to.trim()) || from)
            await load()
            return true
          }}
          remove={async (name) => {
            // 删的是正看着的那张：选中挪到它下面一张（最后一张就挪到上面）。
            const index = workflows.findIndex((entry) => entry.name === name)
            const next = workflows[index + 1] ?? workflows[index - 1]
            const ok = await props.remove(name)
            if (ok && name === selected.name) setPicked(next?.name ?? null)
            await load()
            return ok
          }}
        />
      </div>
      {shown === 'import' ? (
        importPane
      ) : shown === 'export' ? (
        <HubExport
          key={selected.name}
          t={t}
          rpc={rpc}
          name={selected.name}
          scope={props.scope}
          onBack={() => setPane('versions')}
          onDone={(text) => {
            setNotice(text)
            setPane('versions')
          }}
        />
      ) : (
        /* 换了一张就换一整块：标题、版本列表重新入场。 */
        /* 标题、存版本那一栏钉在上面，版本多了只在版本框里滚（见 VersionList）。 */
        <div
          key={selected.name}
          ref={detailRef}
          className={cx(hub.wfDetail, hub.pinned, hub.paneIn)}
        >
          <div className={hub.wfHead}>
            <div className={hub.wfHeadText}>
              <p className={hub.wfTitle}>{selected.name}</p>
              <p className={hub.wfSub}>
                {t('ver.steps').replace('{n}', String(selected.nodeCount))} ·{' '}
                {shortTime(selected.updatedAt)}
              </p>
            </div>
            <button
              type="button"
              className={cx(ui.btn, ui.small)}
              data-tip={t('pack.exportTip')}
              data-testid="wl-hub-wf-export"
              onClick={() => {
                setNotice(null)
                setPane('export')
              }}
            >
              <Icon name="download" size={14} />
              {t('pack.export')}
            </button>
            {editing ? (
              <span className={hub.tag}>{t('hub.wfEditing')}</span>
            ) : (
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.soft)}
                data-tip={t('hub.wfOpenTip')}
                data-testid="wl-hub-wf-open"
                onClick={() => props.onOpen(selected.name)}
              >
                <Icon name="external" size={14} />
                {t('hub.wfOpen')}
              </button>
            )}
          </div>
          {notice !== null && (
            <Callout
              tone="ok"
              testId="wl-pack-notice"
              closeLabel={t('common.close')}
              onClose={() => setNotice(null)}
            >
              {notice}
            </Callout>
          )}
          <VersionList
            key={selected.name}
            t={t}
            rpc={rpc}
            name={selected.name}
            {...(editing ? { before: props.flush } : {})}
            onRestored={() => {
              if (editing) props.onReload()
              void load()
            }}
            onChanged={() => {
              void load()
              props.onChanged()
            }}
          />
        </div>
      )}
    </div>
  )
}
