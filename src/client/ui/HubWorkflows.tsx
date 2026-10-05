/**
 * dsh-workflow-lite — 工作流中心「工作流」页：左边全部工作流，右边选中那张的版本（{@link VersionList}）。
 *
 * 哪张都能直接看、存、切版本，改名、删除也在左边那一行上（{@link HubWorkflowList}），
 * 不用先在编辑页打开它；要编辑就点「打开」。
 * 正在编辑的那张：动手前先把编辑页的改动写下去，切换之后编辑页按磁盘重新加载。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubWorkflows
 */

import { useCallback, useEffect, useState } from 'react'
import { normalizeName } from '../../shared/naming.ts'
import type { WorkflowEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { HubWorkflowList } from './HubWorkflowList.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'
import { VersionList } from './VersionList.tsx'

export function HubWorkflows(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 编辑页正开着的那张。 */
  current: string | null
  flush(): Promise<boolean>
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

  if (workflows === null) {
    return (
      <div className={hub.loading}>
        <span className={hub.spinner} />
        {t('hub.loading')}
      </div>
    )
  }
  if (workflows.length === 0) {
    return (
      <div className={hub.empty}>
        <span className={hub.emptyIcon}>
          <Icon name="folder" size={20} />
        </span>
        <p className={hub.emptyTitle}>{error ?? t('hub.wfEmpty')}</p>
      </div>
    )
  }

  const selected = workflows.find((entry) => entry.name === picked) ?? workflows[0]
  if (selected === undefined) return <div />
  const editing = selected.name === current
  return (
    <div className={hub.wfPage}>
      <HubWorkflowList
        t={t}
        workflows={workflows}
        selected={selected.name}
        current={current}
        onPick={setPicked}
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
      <div className={hub.wfDetail}>
        <div className={hub.wfHead}>
          <div className={hub.wfHeadText}>
            <p className={hub.wfTitle}>{selected.name}</p>
            <p className={hub.wfSub}>
              {t('ver.steps').replace('{n}', String(selected.nodeCount))} ·{' '}
              {shortTime(selected.updatedAt)}
            </p>
          </div>
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
    </div>
  )
}
