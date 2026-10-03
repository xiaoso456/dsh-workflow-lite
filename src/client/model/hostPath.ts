/**
 * dsh-workflow-lite — 主机路径拆成面包屑（选择文件 / 文件夹时的路径栏）。
 *
 * 只认分隔符已统一成 `/` 的绝对路径（`host/list` 回的就是这种）：
 * `C:/Users/me` → `C:`、`Users`、`me`；`/home/me` → `/`、`home`、`me`；`//server/share/x` → `//server/share`、`x`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/hostPath
 */

export interface Crumb {
  /** 显示的名字。 */
  label: string
  /** 点它跳去的绝对路径。 */
  path: string
}

export function crumbs(path: string): Crumb[] {
  const value = path.replace(/\\/gu, '/')
  const unc = /^\/\/[^/]+\/[^/]+/u.exec(value)
  const drive = /^[A-Za-z]:/u.exec(value)
  let root: Crumb
  let rest: string
  if (unc !== null) {
    root = { label: unc[0], path: unc[0] }
    rest = value.slice(unc[0].length)
  } else if (drive !== null) {
    root = { label: drive[0].toUpperCase(), path: `${drive[0].toUpperCase()}/` }
    rest = value.slice(drive[0].length)
  } else if (value.startsWith('/')) {
    root = { label: '/', path: '/' }
    rest = value
  } else {
    return value === '' ? [] : [{ label: value, path: value }]
  }
  const out = [root]
  let at = root.path.endsWith('/') ? root.path.slice(0, -1) : root.path
  for (const part of rest.split('/')) {
    if (part === '') continue
    at = `${at}/${part}`
    out.push({ label: part, path: at })
  }
  return out
}
