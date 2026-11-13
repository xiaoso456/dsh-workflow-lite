import { describe, expect, it } from 'vitest'
import { advertisedHost, listenInterfaces } from '../../src/host/triggers/netAddress.ts'
import {
  hookFromName,
  hookIssue,
  isListenHost,
  isLoopbackHost,
  tokenIssue,
} from '../../src/shared/triggerHttp.ts'

describe('HTTP 触发的地址与令牌', () => {
  it('地址：各国文字、数字、- _ 都行；斜杠、空格、空串、太长不行', () => {
    expect(hookIssue('巡检-日报_2')).toBeNull()
    expect(hookIssue('deploy')).toBeNull()
    expect(hookIssue('')).toBe('empty')
    expect(hookIssue('a/b')).toBe('chars')
    expect(hookIssue('a b')).toBe('chars')
    expect(hookIssue('x'.repeat(65))).toBe('long')
    expect(hookIssue('字'.repeat(64))).toBeNull()
  })

  it('令牌：至少 16 个字，只用不用转义的那几样', () => {
    expect(tokenIssue('abcdefghijklmnop')).toBeNull()
    expect(tokenIssue('a.b-c_d~e1234567')).toBeNull()
    expect(tokenIssue('short')).toBe('short')
    expect(tokenIssue('abcdefghijklmnop&')).toBe('chars')
    expect(tokenIssue('中文令牌中文令牌中文令牌中文令牌')).toBe('chars')
    expect(tokenIssue('a'.repeat(257))).toBe('long')
  })

  it('缺省地址：工作流名里别的字换成 -，重了接 -2、-3；拼不出来交给调用方', () => {
    expect(hookFromName('巡检 日报', new Set())).toBe('巡检-日报')
    expect(hookFromName('  release / notes!! ', new Set())).toBe('release-notes')
    expect(hookFromName('patrol', new Set(['patrol', 'patrol-2']))).toBe('patrol-3')
    expect(hookFromName('!!!', new Set())).toBeUndefined()
    expect([...(hookFromName('长'.repeat(80), new Set()) ?? '')].length).toBe(60)
  })

  it('监听地址：只认 IPv4 点分十进制', () => {
    expect(isListenHost('127.0.0.1')).toBe(true)
    expect(isListenHost('0.0.0.0')).toBe(true)
    expect(isListenHost('192.168.1.20')).toBe(true)
    expect(isListenHost('192.168.1')).toBe(false)
    expect(isListenHost('256.0.0.1')).toBe(false)
    expect(isListenHost('01.2.3.4')).toBe(false)
    expect(isListenHost('localhost')).toBe(false)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
  })

  it('网卡：只列 IPv4、不列回环；监听所有网卡时网址用第一块的地址', () => {
    const table = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      'Wi-Fi': [
        { address: 'fe80::1', family: 'IPv6', internal: false },
        { address: '192.168.1.20', family: 'IPv4', internal: false },
      ],
    } as unknown as Parameters<typeof listenInterfaces>[0]
    expect(listenInterfaces(table)).toEqual([{ name: 'Wi-Fi', address: '192.168.1.20' }])
    expect(advertisedHost('0.0.0.0', table)).toBe('192.168.1.20')
    expect(advertisedHost('0.0.0.0', {})).toBe('127.0.0.1')
    expect(advertisedHost('10.0.0.5', table)).toBe('10.0.0.5')
  })
})
