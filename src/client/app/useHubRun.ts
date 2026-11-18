import { useEffect, useState } from 'react'
import type { InstanceSummary, InstanceView } from '../../shared/runState.ts'
import type { FireRecord } from '../../shared/wire/trigger.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { useStable } from './useStable.ts'

interface HubRun {
  view: InstanceView | null
  fires: readonly FireRecord[]
  error: string | null
}

const EMPTY: HubRun = { view: null, fires: [], error: null }
const SEEN_MAX = 40

function stampOf(item: InstanceSummary): string {
  return `${item.status}|${item.done}|${item.updatedAt}|${item.stateProblem}`
}

export function createHubRunReader(rpc: WorkflowLiteRpc) {
  const seen = new Map<string, { stamp: string; run: HubRun }>()
  const pending = new Map<string, { stamp: string; reading: Promise<HubRun> }>()

  const peek = ({ id }: InstanceSummary): HubRun => seen.get(id)?.run ?? EMPTY

  const read = (item: InstanceSummary, refresh = false): Promise<HubRun> => {
    const { id } = item
    const stamp = stampOf(item)
    const active = pending.get(id)
    if (active?.stamp === stamp) return active.reading
    const cached = seen.get(id)
    if (!refresh && cached?.stamp === stamp) {
      seen.delete(id)
      seen.set(id, cached)
      return Promise.resolve(cached.run)
    }
    const reading = Promise.allSettled([
      rpc.call('run/load', { id }),
      rpc.call('trigger/of-instance', { instance: id }),
    ]).then(([loaded, related]) => {
      const view =
        loaded.status === 'fulfilled' && !('unchanged' in loaded.value)
          ? loaded.value
          : (cached?.run.view ?? null)
      const run: HubRun = {
        view,
        fires: related.status === 'fulfilled' ? related.value.fires : (cached?.run.fires ?? []),
        error: loaded.status === 'rejected' ? errorMessage(loaded.reason) : null,
      }
      if (pending.get(id)?.reading === reading) {
        pending.delete(id)
        seen.delete(id)
        seen.set(id, { stamp, run })
        const oldest = seen.keys().next().value
        if (seen.size > SEEN_MAX && oldest !== undefined) seen.delete(oldest)
      }
      return run
    })
    pending.set(id, { stamp, reading })
    return reading
  }
  return { peek, read }
}

const readers = new WeakMap<WorkflowLiteRpc, ReturnType<typeof createHubRunReader>>()

function readerOf(rpc: WorkflowLiteRpc): ReturnType<typeof createHubRunReader> {
  const known = readers.get(rpc)
  if (known !== undefined) return known
  const reader = createHubRunReader(rpc)
  readers.set(rpc, reader)
  return reader
}

export function primeHubRun(rpc: WorkflowLiteRpc, item: InstanceSummary): Promise<HubRun> | null {
  const reader = readerOf(rpc)
  const reading = reader.read(item, true)
  return reader.peek(item).view === null ? reading : null
}

export function useHubRun(rpc: WorkflowLiteRpc, item: InstanceSummary): HubRun & { retry(): void } {
  const reader = readerOf(rpc)
  const [read, setRead] = useState({ reader, id: item.id, run: reader.peek(item) })
  const [attempt, setAttempt] = useState(0)
  const current = useStable(
    item,
    (old, next) => old.id === next.id && stampOf(old) === stampOf(next),
  )
  useEffect(() => {
    let live = true
    void reader.read(current, attempt > 0 && reader.peek(current).error !== null).then((run) => {
      if (live) setRead({ reader, id: current.id, run })
    })
    return () => {
      live = false
    }
  }, [reader, current, attempt])
  const run = read.reader === reader && read.id === item.id ? read.run : reader.peek(item)
  return { ...run, retry: () => setAttempt((value) => value + 1) }
}
