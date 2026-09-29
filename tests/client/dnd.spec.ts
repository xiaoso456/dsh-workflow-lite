/**
 * 拖放载荷编解码单测（契约：docs/.review/交互重设计.md §4.1）。
 *
 * 这个模块只有两种失败方式，而且都很难在真机上复现：
 * 1. 外部应用拖进来的东西让解码抛异常，整个 drop 处理器跟着炸；
 * 2. 一段"看起来像"的字符串被认成我们的载荷，安静地建出一个莫名其妙的节点。
 * 所以下面攻的是解码的输入面，不是"正常路径能不能跑通"。
 *
 * @module tests/client/dnd.spec
 */

import { describe, expect, it } from 'vitest'
import {
  DND_MIME,
  type DragPayload,
  decodeDragPayload,
  encodeDragPayload,
  readDragPayload,
} from '../../src/client/core/dnd.ts'

/** 造一个只实现 getData 的假 dataTransfer（测试跑在 node，没有 DOM 构造函数）。 */
function transferOf(data: string): DataTransfer {
  return { getData: (format: string) => (format === DND_MIME ? data : '') } as DataTransfer
}

/** 把"必须解得出载荷"的用例从可空里取出来，不用非空断言。 */
function mustDecode(raw: string | null | undefined): DragPayload {
  const payload = decodeDragPayload(raw)
  if (payload === null) throw new Error(`期望解出载荷，实得 null：${String(raw).slice(0, 40)}`)
  return payload
}

describe('DND_MIME', () => {
  it('是自定义 MIME，不跟 text/plain 撞车', () => {
    expect(DND_MIME).toBe('application/x-workflow-lite-node')
    expect(DND_MIME).not.toBe('text/plain')
  })
})

describe('encodeDragPayload / decodeDragPayload 往返', () => {
  it('preset 往返', () => {
    const payload: DragPayload = { kind: 'preset', id: 'scan' }
    expect(decodeDragPayload(encodeDragPayload(payload))).toEqual(payload)
  })

  it('template 往返（含空格、引号、中文、短横线）', () => {
    const payload: DragPayload = { kind: 'template', name: '我的 模板 "A"-2' }
    const raw = encodeDragPayload(payload)
    expect(typeof raw).toBe('string')
    expect(decodeDragPayload(raw)).toEqual(payload)
  })

  it('encode 出来就是一个 JSON 对象（不是数组、不是裸字符串）', () => {
    expect(JSON.parse(encodeDragPayload({ kind: 'preset', id: 'a' }))).toEqual({
      kind: 'preset',
      id: 'a',
    })
  })
})

/** 认不出来的输入：全部必须不抛且给 null。 */
const JUNK_INPUTS: string[] = [
  '',
  'not json',
  '{',
  '[]',
  '123',
  '"str"',
  'null',
  'true',
  '{}',
  '   ',
  '{"kind":"nope"}',
  '{"kind":"PRESET","id":"x"}',
  '{"kind":["preset"],"id":"x"}',
  '{"kind":{"kind":"preset"}}',
  '{"kind":"preset"}',
  '{"kind":"preset","id":""}',
  '{"kind":"preset","id":42}',
  '{"kind":"preset","id":null}',
  '{"kind":"preset","id":{}}',
  '{"kind":"template"}',
  '{"kind":"template","name":null}',
  '{"kind":"template","name":""}',
  '{"kind":"template","name":{"a":1}}',
  '[{"kind":"preset","id":"x"}]',
  '{"constructor":{"kind":"preset","id":"x"}}',
  '{"toString":{"kind":"preset","id":"x"}}',
]

describe('decodeDragPayload —— 非法输入一律 null 且绝不抛', () => {
  it.each(JUNK_INPUTS)('非法输入 %j', (raw) => {
    expect(() => decodeDragPayload(raw)).not.toThrow()
    expect(decodeDragPayload(raw)).toBeNull()
  })

  it('null / undefined 也给 null', () => {
    expect(decodeDragPayload(null)).toBeNull()
    expect(decodeDragPayload(undefined)).toBeNull()
  })

  it('认得出的载荷照原样解出，多余字段忽略，两侧空白不影响', () => {
    expect(decodeDragPayload('{"kind":"preset","id":"scan"}')).toEqual({
      kind: 'preset',
      id: 'scan',
    })
    expect(decodeDragPayload('{"kind":"template","name":"ok"}')).toEqual({
      kind: 'template',
      name: 'ok',
    })
    expect(decodeDragPayload('{"kind":"preset","id":"scan","extra":1}')).toEqual({
      kind: 'preset',
      id: 'scan',
    })
    expect(decodeDragPayload('  {"kind":"preset","id":"scan"}  ')).toEqual({
      kind: 'preset',
      id: 'scan',
    })
    // 自有键压过原型链上的同名键。
    expect(
      decodeDragPayload('{"__proto__":{"kind":"preset","id":"x"},"kind":"template","name":"ok"}'),
    ).toEqual({ kind: 'template', name: 'ok' })
  })

  it('超长字符串不抛：非 JSON 给 null，合法载荷照样解得出', () => {
    const huge = 'x'.repeat(200_000)
    expect(() => decodeDragPayload(huge)).not.toThrow()
    expect(decodeDragPayload(huge)).toBeNull()

    const longId = 'y'.repeat(100_000)
    expect(() => decodeDragPayload(encodeDragPayload({ kind: 'preset', id: longId }))).not.toThrow()
    expect(mustDecode(encodeDragPayload({ kind: 'preset', id: longId }))).toEqual({
      kind: 'preset',
      id: longId,
    })
  })

  it('深层嵌套不抛', () => {
    const nested = '['.repeat(200) + ']'.repeat(200)
    expect(() => decodeDragPayload(nested)).not.toThrow()
    expect(decodeDragPayload(nested)).toBeNull()
    const deepObject = ['{"kind":'.repeat(200), '1', '}'.repeat(200)].join('')
    expect(() => decodeDragPayload(deepObject)).not.toThrow()
    expect(decodeDragPayload(deepObject)).toBeNull()
  })

  /**
   * 原型污染形状。
   *
   * 契约是"顶层没有认得出的 `kind` 一律 null"。`toRecord` 用 `record[key] = item` 逐键搬运，
   * 撞上 `__proto__` 这个键会走 Object.prototype 上的 setter，把**搬进来的对象挂成原型**，
   * 于是 `record.kind` 顺着原型链读得到，一段从没声明过 kind 的输入被认成了载荷。
   * 期望 null，实际会给载荷（见汇报）。
   */
  it('原型污染形状不该被认成载荷，也不许污染 Object.prototype', () => {
    expect(decodeDragPayload('{"__proto__":{"kind":"preset","id":"x"}}')).toBeNull()
    expect(decodeDragPayload('{"__proto__":{"kind":"template","name":"x"}}')).toBeNull()
    // 全局原型不能被弄脏（无论认不认这个载荷）。
    expect((Object.prototype as Record<string, unknown>).kind).toBeUndefined()
    expect(({} as Record<string, unknown>).kind).toBeUndefined()
  })
})

describe('readDragPayload', () => {
  it('没有 dataTransfer 给 null', () => {
    expect(readDragPayload(null)).toBeNull()
  })

  it('只读我们自己的 MIME', () => {
    const seen: string[] = []
    const transfer = {
      getData: (format: string) => {
        seen.push(format)
        return format === DND_MIME ? '{"kind":"preset","id":"scan"}' : '外部应用的文字'
      },
    } as DataTransfer
    expect(readDragPayload(transfer)).toEqual({ kind: 'preset', id: 'scan' })
    expect(seen).toEqual([DND_MIME])
  })

  it('自定义 MIME 里是垃圾也给 null（外部应用能往任何 MIME 塞任意字符串）', () => {
    expect(readDragPayload(transferOf('一段选中的文字'))).toBeNull()
    expect(readDragPayload(transferOf(''))).toBeNull()
    expect(readDragPayload(transferOf('null'))).toBeNull()
    expect(readDragPayload(transferOf('{"kind":"template","name":"ok"}'))).toEqual({
      kind: 'template',
      name: 'ok',
    })
  })
})
