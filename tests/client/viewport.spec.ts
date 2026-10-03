import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recallViewport, rememberViewport } from '../../src/client/app/viewport.ts'

describe('视口记在浏览器里', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('按图名各记各的，读得回来', () => {
    rememberViewport('a', { x: 10, y: -20, zoom: 0.8 })
    rememberViewport('b', { x: 1, y: 2, zoom: 1.5 })
    expect(recallViewport('a')).toEqual({ x: 10, y: -20, zoom: 0.8 })
    expect(recallViewport('b')).toEqual({ x: 1, y: 2, zoom: 1.5 })
    expect(recallViewport('c')).toBeNull()
  })

  it('记坏了、存储不可用都当没记过', () => {
    store.set('workflow-lite.viewport.bad', '{"x":1,"y":"2","zoom":1}')
    store.set('workflow-lite.viewport.junk', 'not json')
    expect(recallViewport('bad')).toBeNull()
    expect(recallViewport('junk')).toBeNull()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('denied')
        },
      },
    })
    expect(recallViewport('a')).toBeNull()
    expect(() => rememberViewport('a', { x: 0, y: 0, zoom: 1 })).not.toThrow()
  })
})
