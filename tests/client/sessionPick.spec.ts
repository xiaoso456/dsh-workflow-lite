import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSessionPick, restoredRun, writeSessionPick } from '../../src/client/app/sessionPick.ts'

describe('每个会话记着上次在「工作流」tab 里看的', () => {
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
  })
  afterEach(() => vi.unstubAllGlobals())

  it('按会话分开记；没有会话、没记过、记坏了都是 null', () => {
    writeSessionPick('s1', { workflow: '日报', run: 'r1' })
    writeSessionPick('s2', { workflow: '巡检' })
    expect(readSessionPick('s1')).toEqual({ workflow: '日报', run: 'r1' })
    expect(readSessionPick('s2')).toEqual({ workflow: '巡检' })
    expect(readSessionPick('s3')).toBeNull()
    expect(readSessionPick(undefined)).toBeNull()
    writeSessionPick(undefined, { workflow: 'x' })
    store.set('workflow-lite.sessionPick', '{oops')
    expect(readSessionPick('s1')).toBeNull()
  })

  it('换回编辑工作流时不再记着实例', () => {
    writeSessionPick('s1', { workflow: '日报', run: 'r1' })
    writeSessionPick('s1', { workflow: '日报' })
    expect(readSessionPick('s1')).toEqual({ workflow: '日报' })
  })
})

describe('进来时看哪个实例', () => {
  const both = { run: true, workflow: true }

  it('上次在看的实例还在就看它，不管本会话现在的当前实例', () => {
    expect(restoredRun({ workflow: '日报', run: 'r1' }, both, 'r9')).toBe('r1')
  })

  it('上次在编辑、那张还在：接着编辑，不跳到当前实例', () => {
    expect(restoredRun({ workflow: '日报' }, both, 'r9')).toBeUndefined()
  })

  it('记着的不在了、没记过：照常看本会话的当前实例', () => {
    expect(restoredRun({ workflow: '日报', run: 'r1' }, { run: false, workflow: true }, 'r9')).toBe(
      'r9',
    )
    expect(restoredRun({ workflow: '日报' }, { run: false, workflow: false }, 'r9')).toBe('r9')
    expect(restoredRun(null, { run: false, workflow: false }, 'r9')).toBe('r9')
    expect(restoredRun(null, { run: false, workflow: false }, undefined)).toBeUndefined()
  })
})
