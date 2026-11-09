/**
 * `src/client/ui/canvas/hooks/useCanvasGeometry.ts`：卡片尺寸表按画布共用。
 */

import { describe, expect, it } from 'vitest'
import { sizeTableOf } from '../../src/client/ui/canvas/hooks/useCanvasGeometry.ts'

describe('sizeTableOf', () => {
  it('同一画布各处拿到的 store 包装不同，表是同一张；不同画布各一张', () => {
    const getState = (): void => {}
    // `useStoreApi()` 每处调用各包一层：画布、整理排版、看全图拿到的对象都不一样。
    const inCanvas = { getState }
    const inShell = { getState }
    sizeTableOf(inCanvas).set('a', { width: 200, height: 80 })
    expect(sizeTableOf(inShell).get('a')).toEqual({ width: 200, height: 80 })
    expect(sizeTableOf({ getState: (): void => {} }).size).toBe(0)
  })
  it('画布换了文档（loadKey 变了）先清空；不带 owner 的只读不清', () => {
    const store = { getState: (): void => {} }
    sizeTableOf(store, 'a#1').set('s1', { width: 216, height: 76 })
    expect(sizeTableOf(store).get('s1')).toEqual({ width: 216, height: 76 })
    expect(sizeTableOf(store, 'a#1').size).toBe(1)
    // 换到实例画布：同名卡片的尺寸是模板量的，不能留。
    expect(sizeTableOf(store, 'run:x').size).toBe(0)
  })
})
