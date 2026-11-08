/**
 * dsh-workflow-lite — 拼类名，跳过假值。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/cx
 */

/** 拼类名，跳过假值。 */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter((name) => typeof name === 'string' && name !== '').join(' ')
}
