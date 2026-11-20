/**
 * dsh-workflow-lite — 每个会话上次在「工作流」tab 里看的是什么：哪张工作流、在不在看某个实例。记在本机浏览器里。
 *
 * 同一个会话再进这个 tab 时先按它恢复（见 `useFreshRun`、`useWorkflow` 的 `prefer`）；记着的实例、工作流
 * 已经不在了（删掉、改了名）就照没记过的来。只记最近用过的若干个会话；记坏了、存不下也当没记过。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/sessionPick
 */

const KEY = 'workflow-lite.sessionPick'

/** 最多记几个会话（多了丢掉最久没用的）。 */
const KEEP = 200

/** 一个会话上次看的。 */
export interface SessionPick {
  /** 上次打开的工作流（看实例时也记着底下那张）。 */
  workflow?: string
  /** 正在看的实例；在编辑工作流时没有。 */
  run?: string
}

interface Stored extends SessionPick {
  /** 最后一次记的时刻（按它丢最久没用的）。 */
  at: number
}

function read(): Record<string, Stored> {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        (pair): pair is [string, Stored] =>
          typeof pair[1] === 'object' && pair[1] !== null && typeof pair[1].at === 'number',
      ),
    )
  } catch {
    return {}
  }
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/** 这个会话上次看的；没记过是 `null`。 */
export function readSessionPick(session: string | undefined): SessionPick | null {
  if (session === undefined) return null
  const stored = read()[session]
  if (stored === undefined) return null
  const workflow = text(stored.workflow)
  const run = text(stored.run)
  return {
    ...(workflow === undefined ? {} : { workflow }),
    ...(run === undefined ? {} : { run }),
  }
}

/** 记下这个会话现在看的。 */
export function writeSessionPick(session: string | undefined, pick: SessionPick): void {
  if (session === undefined) return
  try {
    const all = read()
    const before = all[session]
    if (before?.workflow === pick.workflow && before.run === pick.run) return
    all[session] = { ...pick, at: Date.now() }
    const kept = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, KEEP)
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // 存不下：下次进来照没记过的来。
  }
}

/**
 * 进来时看哪个实例（`undefined` = 编辑工作流）：
 * 上次在看的实例还在就看它；上次在编辑、那张工作流还在就接着编辑；都不是（没记过、记着的不在了）照常看本会话的当前实例。
 * @param found - 记着的实例、工作流现在还在不在。
 * @param current - 本会话的当前实例。
 */
export function restoredRun(
  pick: SessionPick | null,
  found: { run: boolean; workflow: boolean },
  current: string | undefined,
): string | undefined {
  if (pick?.run !== undefined && found.run) return pick.run
  if (pick !== null && pick.run === undefined && pick.workflow !== undefined && found.workflow) {
    return undefined
  }
  return current
}
