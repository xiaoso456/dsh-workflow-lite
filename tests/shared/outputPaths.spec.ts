import { describe, expect, it } from 'vitest'
import { MAX_ROOT_CODEPOINTS } from '../../src/shared/limits.ts'
import {
  checkOutputRoot,
  isAbsoluteRoot,
  normalizeRoot,
  resolveOutputPath,
} from '../../src/shared/outputPaths.ts'

describe('normalizeRoot', () => {
  it('空串、空白、`.` 都是"工作区根"', () => {
    expect(normalizeRoot(undefined)).toBeUndefined()
    expect(normalizeRoot('')).toBeUndefined()
    expect(normalizeRoot('   ')).toBeUndefined()
    expect(normalizeRoot('.')).toBeUndefined()
    expect(normalizeRoot('./')).toBeUndefined()
  })

  it('统一成 / 分隔，折叠重复分隔符与 ./、a/..，去掉尾斜杠', () => {
    expect(normalizeRoot('out//sub/./')).toBe('out/sub')
    expect(normalizeRoot('docs\\out\\\\')).toBe('docs/out')
    expect(normalizeRoot('a/b/../c')).toBe('a/c')
    expect(normalizeRoot('../shared/out/')).toBe('../shared/out')
  })

  it('绝对路径：盘符大写、UNC 保留双斜杠、根本身的斜杠不去', () => {
    expect(normalizeRoot('d:\\work\\out\\')).toBe('D:/work/out')
    expect(normalizeRoot('\\\\srv\\share\\out')).toBe('//srv/share/out')
    expect(normalizeRoot('/')).toBe('/')
    expect(normalizeRoot('C:/')).toBe('C:/')
    expect(normalizeRoot('/var/tmp/')).toBe('/var/tmp')
  })
})

describe('resolveOutputPath', () => {
  it('没配根目录：只规范化产出路径本身', () => {
    expect(resolveOutputPath(undefined, './docs/plan.md')).toBe('docs/plan.md')
    expect(resolveOutputPath('', 'docs\\plan.md')).toBe('docs/plan.md')
  })

  it('不管两边有没有斜杠，拼出来都恰好一个分隔符', () => {
    for (const root of ['out', 'out/', './out/', 'out\\', 'out//']) {
      expect(resolveOutputPath(root, 'plan.md'), root).toBe('out/plan.md')
      expect(resolveOutputPath(root, './plan.md'), root).toBe('out/plan.md')
    }
  })

  it('绝对根目录拼出绝对路径', () => {
    expect(resolveOutputPath('D:\\work\\out', 'a/b.md')).toBe('D:/work/out/a/b.md')
    expect(resolveOutputPath('/srv/out/', 'plan.md')).toBe('/srv/out/plan.md')
    expect(resolveOutputPath('C:/', 'plan.md')).toBe('C:/plan.md')
  })
})

describe('isAbsoluteRoot', () => {
  it('认得 POSIX、盘符、UNC；相对路径不算', () => {
    expect(isAbsoluteRoot('/x')).toBe(true)
    expect(isAbsoluteRoot('D:/x')).toBe(true)
    expect(isAbsoluteRoot('//srv/share')).toBe(true)
    expect(isAbsoluteRoot('out')).toBe(false)
    expect(isAbsoluteRoot('../out')).toBe(false)
  })
})

describe('checkOutputRoot', () => {
  it('相对、绝对、带 .. 都合法；空串合法（= 工作区根）', () => {
    for (const ok of ['', 'out', '../out', 'D:/x', '\\\\srv\\share', '/tmp/x']) {
      expect(checkOutputRoot(ok), ok).toBeNull()
    }
  })

  it('拦控制字符、~、超长', () => {
    expect(checkOutputRoot('a\nb')?.message).toContain('控制字符')
    expect(checkOutputRoot('~/out')?.message).toContain('~')
    expect(checkOutputRoot('a'.repeat(MAX_ROOT_CODEPOINTS + 1))?.message).toContain('不能超过')
  })
})
