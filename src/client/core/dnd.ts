/**
 * dsh-workflow-lite — 节点库 → 画布 的拖放载荷编解码。
 *
 * 节点库的条目是 `<button draggable>`，拖动时往 `dataTransfer` 里塞一段 JSON；
 * 画布的放置区把同一段字符串解回来。两边**必须用同一份编解码**——各写一份的话，
 * 一边改字段名另一边不会报错，只会安静地拖不动。
 *
 * **解码永不抛异常**：`dataTransfer` 里可能是别的应用拖进来的任意内容
 * （一段选中的文字、一个文件、一个链接），那不是错误，是"不归我们管"。
 * 一律返回 `null` 让调用方静默忽略。
 *
 * @module @xiaoso/dsh-workflow-lite/client/core/dnd
 */

/** 拖放用的自定义 MIME。用自定义类型而不是 `text/plain`，免得跟别处的拖放撞车。 */
export const DND_MIME = 'application/x-workflow-lite-node'

/** 从节点库拖出来的东西：内置起点，或者磁盘上的节点模板。 */
export type DragPayload = { kind: 'preset'; id: string } | { kind: 'template'; name: string }

/** 编码成 `dataTransfer` 里那个字符串。 */
export function encodeDragPayload(payload: DragPayload): string {
  return JSON.stringify(payload)
}

/**
 * 收窄成一个**只认自有键**的查找表。
 *
 * 为什么是 `Map` 而不是"拷进一个普通对象"：
 *
 * 1. **原型链污染**。`JSON.parse('{"__proto__":{"kind":"preset","id":"x"}}')` 会得到一个
 *    带**自有** `__proto__` 键的对象（`JSON.parse` 走的是 DefineOwnProperty）。
 *    把它逐键拷进 `{}` 时，`record['__proto__'] = …` 触发的不是普通赋值而是
 *    `Object.prototype` 上那个 setter——于是 `{}` 的**原型**被换成了那个对象，
 *    接着 `record.kind` 顺着原型链读出了 `'preset'`。一个根本没有 `kind` 字段的载荷
 *    就这么"通过"了校验。这不是理论问题：`verify-eng` 用这条用例证伪出来了。
 *    `Map.get` 只查自有键，整类问题不存在。
 * 2. 顺带，`Map` 也没有 `constructor` / `toString` 这类会让人误读继承来的键。
 *
 * （`rpc.ts` 那边把 `details` 拷进普通对象是同一形状——但那里的键来自 host 自己的
 * 信封、不进 `Object.entries` 的判定路径，所以不构成同样的洞；这里不一样：
 * 输入是**任意网页内容**塞进 `dataTransfer` 的。）
 */
function toLookup(value: unknown): Map<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return new Map(Object.entries(value))
}

/**
 * 解码。任何不认识的输入一律返回 `null`，**永不抛异常**。
 *
 * 要扛住的：`null` / `undefined` / 空串 / 非 JSON / JSON 但不是对象（数字、字符串、数组、
 * `null`）/ `kind` 不认识 / `kind` 对但字段缺失或不是非空字符串 / 原型污染形状。
 *
 * @param raw - `dataTransfer.getData(DND_MIME)` 的结果。
 * @returns 认得出来就给出载荷，否则 `null`。
 */
export function decodeDragPayload(raw: string | null | undefined): DragPayload | null {
  if (typeof raw !== 'string' || raw === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const lookup = toLookup(parsed)
  if (lookup === null) return null

  const kind = lookup.get('kind')
  if (kind === 'preset') {
    const id = lookup.get('id')
    return typeof id === 'string' && id !== '' ? { kind: 'preset', id } : null
  }
  if (kind === 'template') {
    const name = lookup.get('name')
    return typeof name === 'string' && name !== '' ? { kind: 'template', name } : null
  }
  return null
}

/** 从一次拖放事件里读出载荷（读不到就给 `null`）。 */
export function readDragPayload(transfer: DataTransfer | null): DragPayload | null {
  if (transfer === null) return null
  return decodeDragPayload(transfer.getData(DND_MIME))
}
