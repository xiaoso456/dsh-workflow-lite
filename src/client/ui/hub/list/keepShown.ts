/**
 * dsh-workflow-lite — 工作流中心各页换分组、排序、筛选时，右栏还看着原来那一项。
 *
 * 没点过左栏时右栏看的是列表第一项；换了排法第一项一换，右栏就跟着换成另一项（还放一次换内容的动效，菜单里的选中块
 * 也因此不滑）。换之前先把正看着的那一项记成点过的，之后只有点了别的才换。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/list/keepShown
 */

/**
 * @param picked - 点过的那一项的键；没点过是 `null`。
 * @param shown - 右栏此刻看的那一项的键；列表空着是 `undefined`。
 */
export function keepShown(
  picked: string | null,
  shown: string | undefined,
  pick: (key: string) => void,
): void {
  if (picked === null && shown !== undefined) pick(shown)
}
