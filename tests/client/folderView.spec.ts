import { describe, expect, it } from 'vitest'
import { folderOrder, nameMatcher } from '../../src/client/model/folderView.ts'
import { readView } from '../../src/shared/model.ts'

const entry = (name: string, size: number, mtime: number, dir = false) => ({
  name,
  size,
  mtime,
  dir,
})

describe('文件夹「只看」', () => {
  it('带 * ? 的按整个名字对，不带的当「名字里有」；几个写法任一对上就要；不分大小写', () => {
    const keep = nameMatcher('*.PNG, report-?')
    expect(keep('a.png')).toBe(true)
    expect(keep('report-1')).toBe(true)
    expect(keep('report-10')).toBe(false)
    expect(keep('a.png.bak')).toBe(false)
    expect(nameMatcher('heap')('old-heap.json')).toBe(true)
    expect(nameMatcher('a.b')('axb')).toBe(false)
    expect(nameMatcher('  ')('anything')).toBe(true)
    expect(nameMatcher(undefined)('anything')).toBe(true)
  })
})

describe('文件夹顺序', () => {
  const list = [entry('frame-10', 5, 1), entry('frame-2', 9, 3), entry('a', 9, 2)]
  const names = (order: Parameters<typeof folderOrder>[0]) =>
    [...list].sort(folderOrder(order)).map((item) => item.name)

  it('最新在前、按名字（数字按大小）、大的在前（一样大按名字）', () => {
    expect(names(undefined)).toEqual(['frame-2', 'a', 'frame-10'])
    expect(names('name')).toEqual(['a', 'frame-2', 'frame-10'])
    expect(names('size')).toEqual(['a', 'frame-2', 'frame-10'])
  })
})

describe('文件夹设置读进来', () => {
  it('认得的留下，「只看」去掉两头空白、空的不留；上下文最多 10 行', () => {
    const view = readView({
      width: 320,
      height: 216,
      gallery: { show: 'files', order: 'size', match: '  *.json ', list: 'grid', time: true },
      lines: { filter: { pattern: 'x', context: 99 } },
    })
    expect(view?.gallery).toEqual({
      show: 'files',
      order: 'size',
      match: '*.json',
      list: 'grid',
      time: true,
    })
    expect(view?.lines?.filter?.context).toBe(10)
    expect(
      readView({ width: 320, height: 216, gallery: { show: 'x', match: ' ', list: 'rows' } })
        ?.gallery,
    ).toBeUndefined()
  })
})
