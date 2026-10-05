/**
 * 线格式的**目标合法性**单测。
 *
 * 这一组存在的理由是一次真实事故：客户端把 `(WORKFLOW_LITE_CHANNEL, endpointName(e))`
 * 当成 `(channel, endpoint)` 传给了 `connection.rpc.call`，于是运行时拼出
 * `workflow-lite/workflow-lite/graph/list`，DSH 的 `assertTarget` 当场抛
 * `connection: invalid RPC target`——**画布一个字节都加载不出来**。
 *
 * 而当时的端到端脚本是**自己拼 URL + method** 的（`${channel}/${method}`），
 * 恰好拼对了，所以它一路全绿。教训：验收脚本绕过了被测代码，就是在测验收脚本。
 *
 * 所以这里**复刻 DSH 自己的校验规则**（不是复刻它的实现细节），把
 * `rpcTarget()` 的产物按它的规则验一遍——任何一侧单独改动都会被这条测试抓住。
 *
 * @module tests/shared/wire.spec
 */

import { describe, expect, it } from 'vitest'
import {
  API_CHANNEL,
  endpointName,
  routePath,
  rpcTarget,
  WORKFLOW_LITE_CHANNEL,
  WORKFLOW_LITE_ENDPOINTS,
} from '../../src/shared/wire.ts'

// ── DSH 的校验规则（逐字抄自 @deepseek-ai/dsh-client-connection 的 assertTarget）──
/** 通道必须带前导斜杠 + 只含 URL 安全字符。 */
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
/** endpoint 的每一段（`/` 分隔）的字符集。 */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** 复刻载波的 assertTarget：不合法就返回原因，合法返回 null。 */
function assertTarget(channel: string, endpoint: string): string | null {
  if (!CHANNEL_PATTERN.test(channel)) return `channel ${JSON.stringify(channel)} 不合法`
  for (const segment of endpoint.split('/')) {
    if (segment === '' || segment === '.' || segment === '..')
      return `endpoint 段 ${JSON.stringify(segment)} 不合法`
    if (!ENDPOINT_SEGMENT_PATTERN.test(segment))
      return `endpoint 段 ${JSON.stringify(segment)} 字符集不合法`
  }
  return null
}

/** 复刻载波的 URL 构造：`` `${channel}/${endpoint}`.slice(1) ``。 */
function transportUrl(channel: string, endpoint: string): string {
  return `${channel}/${endpoint}`.slice(1)
}

describe('RPC 目标', () => {
  it('API_CHANNEL 就是 /api（DSH 只认这一个通道）', () => {
    expect(API_CHANNEL).toBe('/api')
    expect(CHANNEL_PATTERN.test(API_CHANNEL)).toBe(true)
  })

  it('命名空间不含分隔符（否则会多出一段 target）', () => {
    expect(WORKFLOW_LITE_CHANNEL).toBe('workflow-lite')
    expect(WORKFLOW_LITE_CHANNEL.includes('/')).toBe(false)
  })

  it.each(WORKFLOW_LITE_ENDPOINTS)('%s 的 rpcTarget 通过 DSH 的 assertTarget', (endpoint) => {
    const { channel, endpoint: method } = rpcTarget(endpoint)
    expect(assertTarget(channel, method)).toBeNull()
  })

  it.each(WORKFLOW_LITE_ENDPOINTS)('%s 的传输 URL 是相对路径 api/<ns>/<op>', (endpoint) => {
    const { channel, endpoint: method } = rpcTarget(endpoint)
    // 载波给 fetch 的是**文档相对**路径（`.slice(1)` 砍掉前导斜杠），浏览器自己补 host。
    expect(transportUrl(channel, method)).toBe(`api/workflow-lite/${endpoint}`)
  })

  it('端点名不重复带通道名——这正是那次事故的形状', () => {
    for (const endpoint of WORKFLOW_LITE_ENDPOINTS) {
      const { channel, endpoint: method } = rpcTarget(endpoint)
      // 反例：`(WORKFLOW_LITE_CHANNEL, endpointName(e))` 会拼成重复的一段（4 段）。
      const doubled = `${WORKFLOW_LITE_CHANNEL}/${endpointName(endpoint)}`
      expect(doubled.split('/')).toHaveLength(4)
      expect(doubled.startsWith('workflow-lite/workflow-lite/')).toBe(true)
      expect(`${channel}/${method}`).not.toBe(doubled)
      // 合法形状：`/api` 两段 + 命名空间一段 + 动作两段 = 5 段
      expect(`${channel}/${method}`.split('/')).toHaveLength(5)
    }
  })

  it('routePath 是传输 URL 的绝对形式（host 注册的路由必须就是客户端打的那条）', () => {
    for (const endpoint of WORKFLOW_LITE_ENDPOINTS) {
      const { channel, endpoint: method } = rpcTarget(endpoint)
      expect(routePath(endpoint)).toBe(`/${transportUrl(channel, method)}`)
      expect(routePath(endpoint).startsWith('/api/')).toBe(true)
    }
  })

  it('端点名 = 命名空间 + 动作，且信封 method 用同一个串', () => {
    expect(endpointName('graph/list')).toBe('workflow-lite/graph/list')
    expect(rpcTarget('graph/list').endpoint).toBe(endpointName('graph/list'))
  })

  it('端点两两不同，且数量就是契约里的那几条', () => {
    const names = WORKFLOW_LITE_ENDPOINTS.map((endpoint) => endpointName(endpoint))
    expect(new Set(names).size).toBe(names.length)
    // 十二条图与模板、六条版本、一条计划、八条工作流实例，加三条看主机（host/list · host/skills · host/skill）。
    expect(names).toHaveLength(30)
  })
})
