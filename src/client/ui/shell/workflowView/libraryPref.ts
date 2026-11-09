/**
 * dsh-workflow-lite — 步骤库开没开的偏好（存浏览器，跨会话记住）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/libraryPref
 */

/** 步骤库开没开（跨会话记住）。 */
const LIBRARY_KEY = 'workflow-lite.library'

export function readLibraryPref(): boolean | null {
  try {
    const value = window.localStorage.getItem(LIBRARY_KEY)
    return value === null ? null : value === 'open'
  } catch {
    return null
  }
}

export function writeLibraryPref(open: boolean): void {
  try {
    window.localStorage.setItem(LIBRARY_KEY, open ? 'open' : 'closed')
  } catch {
    // 偏好持久化是尽力而为。
  }
}
