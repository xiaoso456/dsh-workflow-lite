/**
 * dsh-workflow-lite — 命名约束。
 *
 * 图名、模板名与 `node.id` **共用同一套文件名约束**（这三样都要落成文件名：
 * `workflows/<图名>.json`、`templates/**\/<名>.json`、`.dispatch/<图名>/<planId>/<id>.md`）。
 * `label` **不在**这套里——它不是文件名，只受"不得含换行或 `|`"一条。
 *
 * 写成**禁止集**而不是允许集：规则是"不许有什么"，所以中文名天然可用（`修复认证` 合法）。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/naming
 */

import {
  CONTROL_CHARS,
  ILLEGAL_NAME_CHARS,
  MAX_LABEL_CODEPOINTS,
  MAX_NAME_CODEPOINTS,
  MAX_WHEN_CODEPOINTS,
  WINDOWS_RESERVED,
} from './limits.ts'
import type { ValidationCode } from './types.ts'

/** 一条命名/取值问题：`code` 给机器，`message` 给人。 */
export interface NameProblem {
  code: ValidationCode
  message: string
}

function fail(code: ValidationCode, message: string): NameProblem {
  return { code, message }
}

/** 码点数（不是 UTF-16 长度——emoji 与增补平面字符按 1 个数）。 */
export function codepointLength(value: string): number {
  return [...value].length
}

/**
 * 归一：trim 尾部空白与尾随 `.`（Windows 会静默吞掉尾点），再统一 NFC。
 * **比较与落盘都走这一步。**
 */
export function normalizeName(raw: string): string {
  return raw.replace(/[\s.]+$/u, '').normalize('NFC')
}

/** 只做归一，不做校验——给"用户输入 → 待校验名字"这一步用。 */
export function normalizeWhen(raw: string): string {
  return raw.normalize('NFC')
}

/**
 * 校验一个名字（图名 / 模板名 / `node.id`）。
 * @returns `null` = 合法；否则是一条问题。
 */
export function checkName(raw: string): NameProblem | null {
  // 只做 NFC 归一，**不 trim**：尾部的空白与点是被**拒绝**的，不是被静默改掉的
  // （静默改名会让“图叫什么”与“盘上叫什么”静默分叉）。要清理用户输入请先调 normalizeName。
  const name = raw.normalize('NFC')
  if (name === '') return fail('name_invalid', '名字不能为空')
  if (ILLEGAL_NAME_CHARS.test(name)) {
    return fail('name_invalid', '名字不得包含 Windows 非法字符 < > : " / \\ | ? *')
  }
  if (/\s/u.test(name)) return fail('name_invalid', '名字不得包含空白')
  if (CONTROL_CHARS.test(name)) return fail('name_invalid', '名字不得包含控制字符')
  if (name.startsWith('.')) {
    return fail('name_invalid', '名字不得以 . 开头（以 . 开头的条目永远扫不到）')
  }
  if (name.endsWith('.')) return fail('name_invalid', '名字不得以 . 结尾')
  if (codepointLength(name) > MAX_NAME_CODEPOINTS) {
    return fail('name_invalid', `名字长度不得超过 ${MAX_NAME_CODEPOINTS} 个码点`)
  }
  if (WINDOWS_RESERVED.has(name.toLowerCase())) {
    return fail('name_invalid', `"${name}" 是 Windows 保留名`)
  }
  return null
}

/**
 * 校验 `when` 的值（条件出边的判据）。
 *
 * 允许中文、字母、数字、`-`、`_`；**不许**空白、`,`、`=`、引号、换行；
 * 长度 ≤ {@link MAX_WHEN_CODEPOINTS} 码点；**空串非法**（缺省才是"无条件边"）。
 */
export function checkWhen(raw: string): NameProblem | null {
  if (raw === '') return fail('when_invalid', 'when 不得为空串——要"无条件边"就整条不写 when')
  const value = normalizeWhen(raw)
  if (codepointLength(value) > MAX_WHEN_CODEPOINTS) {
    return fail('when_invalid', `when 长度不得超过 ${MAX_WHEN_CODEPOINTS} 个码点`)
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(value)) {
    return fail(
      'when_invalid',
      'when 只允许中文、字母、数字、- 与 _（不许空白、逗号、等号、引号、换行）',
    )
  }
  return null
}

/** 校验 `label`：只禁换行与竖线 `|`（它们会打断计划里的 markdown 表格）。 */
export function checkLabel(raw: string): NameProblem | null {
  if (/[\r\n]/u.test(raw)) return fail('label_invalid', 'label 不得包含换行')
  if (raw.includes('|')) return fail('label_invalid', 'label 不得包含竖线 |（会打断计划里的表格）')
  if (codepointLength(raw) > MAX_LABEL_CODEPOINTS) {
    return fail('label_invalid', `label 长度不得超过 ${MAX_LABEL_CODEPOINTS} 个码点`)
  }
  return null
}

/**
 * 校验 `output`：相对工作区根的路径，允许子路径，**禁止绝对路径与 `..`**。
 * `false`（显式不产出）与缺省都合法，由调用方先分流。
 */
export function checkOutput(raw: string): NameProblem | null {
  if (raw === '') return fail('output_invalid', 'output 不得为空串——不产出请写 false')
  if (/^([A-Za-z]:|[\\/])/u.test(raw)) {
    return fail('output_invalid', 'output 必须是相对工作区根的路径，不得是绝对路径')
  }
  const segments = raw.split(/[\\/]/u)
  if (segments.includes('..')) {
    return fail('output_invalid', 'output 不得包含 ..')
  }
  if (CONTROL_CHARS.test(raw)) return fail('output_invalid', 'output 不得包含控制字符')
  return null
}

/** 大小写不敏感的撞名比较（Windows 落盘不区分大小写，而这三样都是文件名）。 */
export function sameName(a: string, b: string): boolean {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase()
}
