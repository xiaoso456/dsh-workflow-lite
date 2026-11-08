/**
 * dsh-workflow-lite — 模板视图里的「上次执行」：那个实例里那一份，读法和实例视图一样。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/LatestView
 */

import { useMemo } from 'react'
import type { ResourceItem, TableView } from '../../../../shared/types.ts'
import type { RunLatestOutput } from '../../../../shared/wire.ts'
import { displayKey } from '../../../app/useDisplayStats.ts'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { RunFileView } from './RunFileView.tsx'

/** 模板里的「上次执行」：那个实例里那一份，读法和实例视图一样（那边的项号、修改时间）。 */
export function LatestView(props: {
  t: T
  rpc: WorkflowLiteRpc
  found: RunLatestOutput
  node: string
  item: ResourceItem
  display: Display
  interactive: boolean
  onTable?: ((table: TableView | undefined) => void) | undefined
}): React.JSX.Element {
  const { found } = props
  const run = useMemo(
    () => ({
      rpc: props.rpc,
      instance: found.instance,
      stats: {
        [displayKey(props.node, found.item)]: {
          exists: true,
          size: found.size,
          mtime: found.mtime,
          versions: 0,
          revision: 0,
        },
      },
    }),
    [props.rpc, props.node, found.instance, found.item, found.size, found.mtime],
  )
  return (
    <RunFileView
      t={props.t}
      run={run}
      node={props.node}
      item={props.item}
      display={{ ...props.display, item: found.item }}
      interactive={props.interactive}
      writing={false}
      onTable={props.onTable}
    />
  )
}
