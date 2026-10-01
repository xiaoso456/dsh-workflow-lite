/**
 * dsh-workflow-lite — 产出路径：根目录的规范化，与「根目录 + 产出文件名」的拼接。
 *
 * 这件事**只在这里做**：编译器、校验、画布预览都调这几个函数，不各写一份字符串拼接。
 * 规范化交给 `pathe`（Node `path` 的跨平台版本，浏览器里也能跑）：
 * - 分隔符统一成 `/`（Windows 的 `D:\out` → `D:/out`，执行者的文件工具两种都认）；
 * - 折叠重复的 `/`、`./`、`a/..`；盘符大写；UNC `\\srv\share` → `//srv/share`；
 * - 拼接时不管根目录有没有尾斜杠、产出名是不是 `./` 开头，结果都只有一个分隔符。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/outputPaths
 */

import { isAbsolute, join, normalize } from 'pathe'
import { CONTROL_CHARS, MAX_ROOT_CODEPOINTS } from './limits.ts'
import { codepointLength, type NameProblem } from './naming.ts'

/**
 * 根目录的规范写法：去首尾空白、`pathe.normalize`、去掉尾斜杠（`/`、`C:/`、`//srv/share` 这类根本身除外）。
 * 空串与 `.` 都表示"工作区根"，返回 `undefined`（= 不配置）。
 */
export function normalizeRoot(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  let value = normalize(trimmed)
  while (value.length > 1 && value.endsWith('/') && !/^[A-Za-z]:\/$/u.test(value)) {
    value = value.slice(0, -1)
  }
  return value === '.' || value === '' ? undefined : value
}

/** 根目录是不是绝对路径（`/x`、`C:/x`、`//srv/share`；`C:` 这种盘符相对写法规范化后也算）。 */
export function isAbsoluteRoot(root: string): boolean {
  return isAbsolute(root) || /^[A-Za-z]:\//u.test(root)
}

/**
 * 一个产出文件最终写到哪：`根目录 + 产出路径`，规范化。没配根目录就是规范化后的产出路径本身
 * （相对工作区）。产出路径自己永远是相对路径（保存时就拦掉了绝对路径与 `..`）。
 */
export function resolveOutputPath(root: string | undefined, path: string): string {
  const base = normalizeRoot(root)
  return base === undefined ? normalize(path.trim()) : join(base, path.trim())
}

/**
 * 一个产出文件的身份：规范化后的相对路径（`./a.md` 与 `a.md` 是同一份）。
 * 交接引用产出、统计「谁在用这份文件」都按它比较。
 */
export function outputKey(path: string): string {
  return resolveOutputPath(undefined, path)
}

/** 根目录合不合法：只拦控制字符、`~`（不会被展开）与超长；相对、绝对、`..` 都允许。 */
export function checkOutputRoot(raw: string): NameProblem | null {
  const value = raw.trim()
  if (value === '') return null
  if (CONTROL_CHARS.test(value)) {
    return { code: 'settings_invalid', message: '产出根目录不能包含换行或控制字符' }
  }
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    return { code: 'settings_invalid', message: '不支持 ~（不会被展开），请写完整路径' }
  }
  if (codepointLength(value) > MAX_ROOT_CODEPOINTS) {
    return {
      code: 'settings_invalid',
      message: `产出根目录不能超过 ${MAX_ROOT_CODEPOINTS} 个字`,
    }
  }
  return null
}
