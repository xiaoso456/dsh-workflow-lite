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
 * 空串与 `.` 都表示"工作区根"，返回 `undefined`（拼接时不加前缀）。
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

/** 根目录里的这个记号建实例时换成实例 id（每次执行的产出各放各的）。 */
export const INSTANCE_TOKEN = '{instance}'

/** 没配产出根目录时用它：和状态文件放在一起，每个实例一个 `out`。 */
export const DEFAULT_OUTPUT_ROOT = `.workflow-lite/runs/${INSTANCE_TOKEN}/out`

/** 写 `.` = 明确要写在工作区根目录（和"没配"区分开：没配是 {@link DEFAULT_OUTPUT_ROOT}）。 */
export const WORKSPACE_ROOT = '.'

/** 一张图实际用的产出根目录（还没换实例 id）：没配就是默认值。 */
export function rootOf(settings: { outputRoot?: string } | undefined): string {
  return settings?.outputRoot ?? DEFAULT_OUTPUT_ROOT
}

/** 把根目录里的 {@link INSTANCE_TOKEN} 换成 `instance`，再规范化；结果是工作区根时回 `.`。 */
export function bindRoot(root: string, instance: string): string {
  return normalizeRoot(root.split(INSTANCE_TOKEN).join(instance)) ?? WORKSPACE_ROOT
}

/** 根目录是不是绝对路径（`/x`、`C:/x`、`//srv/share`；`C:` 这种盘符相对写法规范化后也算）。 */
export function isAbsoluteRoot(root: string): boolean {
  return isAbsolute(root) || /^[A-Za-z]:\//u.test(root)
}

/**
 * 一个产出文件最终写到哪：`根目录 + 产出路径`，规范化。没配根目录就是规范化后的产出路径本身
 * （相对工作区）。产出路径本身是绝对路径时原样用（规范化），不拼根目录。
 */
export function resolveOutputPath(root: string | undefined, path: string): string {
  const value = path.trim()
  if (isAbsoluteRoot(value) || /^[A-Za-z]:[/]/u.test(value)) return normalize(value)
  const base = normalizeRoot(root)
  return base === undefined ? normalize(value) : join(base, value)
}

/**
 * 资源里一个文件 / 文件夹实际在哪：绝对路径原样用；相对路径在有步骤写这个资源时放在产出根目录下
 * （它是这次执行的产出），只被读时相对工作区（它是现成的东西）。
 */
export function resolveItemPath(root: string | undefined, path: string, written: boolean): string {
  return resolveOutputPath(written ? root : undefined, path)
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
