import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getListDensity,
  resetListDensityCache,
  setListDensity,
} from '../../src/client/app/listDensity.ts'

describe('工作流中心左栏的行高记在浏览器里', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    })
    resetListDensityCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('没记过、记坏了都是紧凑；换成标准记下来，换回紧凑不留记录', () => {
    expect(getListDensity()).toBe('compact')
    store.set('workflow-lite.hubDensity', 'tiny')
    resetListDensityCache()
    expect(getListDensity()).toBe('compact')
    store.clear()
    setListDensity('standard')
    expect(store.get('workflow-lite.hubDensity')).toBe('standard')
    resetListDensityCache()
    expect(getListDensity()).toBe('standard')
    setListDensity('compact')
    expect(store.size).toBe(0)
  })
})
