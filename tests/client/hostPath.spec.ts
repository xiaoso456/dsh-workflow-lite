/**
 * `src/client/model/hostPath.ts`：主机路径拆成面包屑。
 */

import { describe, expect, it } from 'vitest'
import { crumbs } from '../../src/client/model/hostPath.ts'

describe('crumbs', () => {
  it('Windows 盘符：根是「C:」（跳去 C:/），后面逐级累加', () => {
    expect(crumbs('c:/Users/me/')).toEqual([
      { label: 'C:', path: 'C:/' },
      { label: 'Users', path: 'C:/Users' },
      { label: 'me', path: 'C:/Users/me' },
    ])
    expect(crumbs('D:/')).toEqual([{ label: 'D:', path: 'D:/' }])
    expect(crumbs('D:\\code\\x')).toEqual([
      { label: 'D:', path: 'D:/' },
      { label: 'code', path: 'D:/code' },
      { label: 'x', path: 'D:/code/x' },
    ])
  })

  it('POSIX 与 UNC：根分别是「/」和「//server/share」', () => {
    expect(crumbs('/home/me')).toEqual([
      { label: '/', path: '/' },
      { label: 'home', path: '/home' },
      { label: 'me', path: '/home/me' },
    ])
    expect(crumbs('/')).toEqual([{ label: '/', path: '/' }])
    expect(crumbs('//nas/share/docs')).toEqual([
      { label: '//nas/share', path: '//nas/share' },
      { label: 'docs', path: '//nas/share/docs' },
    ])
  })

  it('认不出的写法原样当一节；空串没有面包屑', () => {
    expect(crumbs('relative/x')).toEqual([{ label: 'relative/x', path: 'relative/x' }])
    expect(crumbs('')).toEqual([])
  })
})
