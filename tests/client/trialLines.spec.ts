/**
 * 试运行输出里被换行断开的事件：只看标准输出，位置按两路混排的输出算。
 */

import { describe, expect, it } from 'vitest'
import { brokenLines } from '../../src/client/model/trialLines.ts'

describe('试运行里断开的事件', () => {
  it('错误输出夹在中间不打断，标出的是混排输出里的位置', () => {
    const broken = brokenLines([
      { stream: 'out', text: '::trigger:: 支付失败 Error: timeout' },
      { stream: 'err', text: 'warn: retry' },
      { stream: 'out', text: '    at pay (a.js:1:1)' },
      { stream: 'out', text: '[watch] 下一轮' },
    ])
    expect(broken?.count).toBe(1)
    expect([...(broken?.cut ?? [])]).toEqual([2])
  })

  it('错误输出里的堆栈不算', () => {
    expect(
      brokenLines([
        { stream: 'out', text: '::trigger:: 支付失败' },
        { stream: 'err', text: '    at pay (a.js:1:1)' },
      ]),
    ).toBeNull()
  })
})
