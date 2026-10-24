/**
 * dsh-workflow-lite — 编辑页的「版本」对话框：上面分「工作流 / 记忆」两栏。
 *
 * - 工作流：正开着这张的版本（{@link VersionList}）；动手之前先把还没写下去的改动存掉（版本存的是磁盘上那份），
 *   切换写回之后按磁盘重新加载画布。这张引用了记忆时，存的那一栏能勾「连同记忆一起存」。
 * - 记忆：这张引用的记忆（库里有的），一条一个小块，选一条看它的版本（{@link MemoryVersionList}）；
 *   记忆的版本线各管各的，切记忆的版本不动工作流。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/VersionsDialog
 */

import { useState } from 'react'
import { memoryTitle } from '../../shared/memoryLib.ts'
import { idKey } from '../../shared/model.ts'
import { memoryRefs } from '../../shared/presets.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import type { Desktop } from '../app/desktop.ts'
import { findMemory, type MemoryStore, useMemories } from '../app/memories.ts'
import type { T } from '../i18n.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { Icon } from './Icon.tsx'
import overlay from './overlay.module.css'
import { cx, Modal } from './primitives.tsx'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'
import { MemoryVersionList, VersionList } from './VersionList.tsx'
import v from './versions.module.css'

type Area = 'workflow' | 'memory'

export function VersionsDialog(props: {
  t: T
  rpc: WorkflowLiteRpc
  name: string
  /** 正开着的这张（找它引用的记忆）。 */
  doc: WorkflowDocument | null
  memories: MemoryStore
  desktop: Desktop | undefined
  flush(): Promise<boolean>
  onRestored(): void
  onChanged(): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const { entries } = useMemories(props.memories)
  // 库里有的才列（删掉了的没有版本可看）。
  const refs = (props.doc === null ? [] : memoryRefs(props.doc)).flatMap((id) => {
    const entry = findMemory(entries, id)
    return entry === undefined || entry.invalid === true ? [] : [entry]
  })
  const [area, setArea] = useState<Area>('workflow')
  const [picked, setPicked] = useState<string | null>(null)
  const shownArea = refs.length === 0 ? 'workflow' : area
  const selected =
    refs.find((entry) => picked !== null && idKey(entry.id) === idKey(picked)) ?? refs[0]

  return (
    <Modal
      label={t('ver.title')}
      onDismiss={props.onClose}
      className={cx(overlay.sheet, v.dialog)}
      testId="wl-versions-dialog"
    >
      <header className={overlay.sheetHead}>
        <span className={overlay.sheetIcon}>
          <Icon name="history" size={16} />
        </span>
        <div className={overlay.sheetTitles}>
          <p className={overlay.sheetTitle}>{t('ver.title')}</p>
          <p className={overlay.sheetSub}>{props.name}</p>
        </div>
        {refs.length > 0 && (
          <div className={v.areas}>
            <Segmented<Area>
              label={t('ver.title')}
              value={shownArea}
              onChange={setArea}
              testId="wl-ver-area"
              options={[
                { value: 'workflow', label: t('ver.areaWorkflow') },
                {
                  value: 'memory',
                  label: t('ver.areaMemory').replace('{n}', String(refs.length)),
                },
              ]}
            />
          </div>
        )}
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={props.onClose}
        >
          <Icon name="x" size={15} />
        </button>
      </header>
      <div className={cx(overlay.sheetBody, v.body)}>
        {shownArea === 'workflow' || selected === undefined ? (
          <VersionList
            t={t}
            rpc={props.rpc}
            name={props.name}
            before={props.flush}
            onRestored={props.onRestored}
            onChanged={props.onChanged}
            memories={refs.length}
            onMemoriesSaved={() => void props.memories.refresh()}
          />
        ) : (
          <>
            <div className={v.memChips} role="tablist" aria-label={t('mem.title')}>
              {refs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  className={v.memChip}
                  aria-selected={entry === selected}
                  data-testid="wl-ver-memory"
                  data-memory-id={entry.id}
                  data-tip={entry.id}
                  onClick={() => setPicked(entry.id)}
                >
                  <Icon name="memory" size={13} />
                  <span>{memoryTitle(entry)}</span>
                </button>
              ))}
            </div>
            <MemoryVersionList
              key={selected.id}
              t={t}
              rpc={props.rpc}
              store={props.memories}
              id={selected.id}
              desktop={props.desktop}
            />
          </>
        )}
      </div>
    </Modal>
  )
}
