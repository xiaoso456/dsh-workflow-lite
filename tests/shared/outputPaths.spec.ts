import { describe, expect, it } from 'vitest'
import { MAX_ROOT_CODEPOINTS } from '../../src/shared/limits.ts'
import {
  bindAssetsPath,
  checkOutputRoot,
  isAbsoluteRoot,
  isAssetsPath,
  normalizeRoot,
  resolveItemPath,
  resolveOutputPath,
} from '../../src/shared/outputPaths.ts'
import { bindAssets } from '../../src/shared/resources.ts'
import { RESOURCE_TYPE, type WorkflowDocument } from '../../src/shared/types.ts'

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

describe('{assets}：工作流资料目录', () => {
  it('认得记号本身与它下面的路径', () => {
    expect(isAssetsPath('{assets}')).toBe(true)
    expect(isAssetsPath(' {assets}/a.md ')).toBe(true)
    expect(isAssetsPath('{assets}\\a.md')).toBe(true)
    expect(isAssetsPath('{assets}x/a.md')).toBe(false)
    expect(isAssetsPath('docs/{assets}/a.md')).toBe(false)
  })

  it('不拼产出根目录，规范化之后记号留着', () => {
    expect(resolveOutputPath('out', '{assets}/./a//b.md')).toBe('{assets}/a/b.md')
    expect(resolveItemPath('out', '{assets}', true)).toBe('{assets}')
  })

  it('换成资料目录下的绝对路径；别的路径原样', () => {
    expect(bindAssetsPath('{assets}/a/b.md', 'C:\\data\\assets\\w')).toBe('C:/data/assets/w/a/b.md')
    expect(bindAssetsPath('{assets}', '/data/assets/w/')).toBe('/data/assets/w/')
    expect(bindAssetsPath('docs/a.md', '/x')).toBe('docs/a.md')
  })

  it('整张图：只换文件、文件夹里的记号，没有就原样返回同一个对象', () => {
    const document: WorkflowDocument = {
      nodes: [
        {
          id: 'r',
          type: RESOURCE_TYPE,
          position: { x: 0, y: 0 },
          data: {
            items: [
              { kind: 'file', value: '{assets}/a.md' },
              { kind: 'text', value: '{assets}/a.md' },
            ],
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const bound = bindAssets(document, '/data/assets/w')
    expect(bound.nodes[0]?.data).toMatchObject({
      items: [
        { kind: 'file', value: '/data/assets/w/a.md' },
        { kind: 'text', value: '{assets}/a.md' },
      ],
    })
    expect(JSON.stringify(document)).toContain('{assets}/a.md')
    const plain = { ...document, nodes: [] }
    expect(bindAssets(plain, '/x')).toBe(plain)
  })
})
