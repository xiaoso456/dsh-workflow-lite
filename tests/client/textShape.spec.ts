import { describe, expect, it } from 'vitest'
import {
  columnName,
  delimiterOf,
  isNumeric,
  newLines,
  numberOf,
  numericColumns,
  parseDelimited,
  prettyJson,
  sortOrder,
  tableFormat,
} from '../../src/client/model/textShape.ts'
import { nextSort } from '../../src/client/ui/DataTable.tsx'

describe('tableFormat / delimiterOf', () => {
  it('按扩展名认 CSV、TSV', () => {
    expect(tableFormat('out/data.CSV')).toBe('csv')
    expect(tableFormat('a.tsv')).toBe('tsv')
    expect(tableFormat('a.tab')).toBe('tsv')
    expect(tableFormat('a.txt')).toBeNull()
  })

  it('CSV 第一行分号多就按分号拆', () => {
    expect(delimiterOf('csv', 'a,b,c\n1;2')).toBe(',')
    expect(delimiterOf('csv', 'a;b;c\n1,2')).toBe(';')
    expect(delimiterOf('tsv', 'a,b')).toBe('\t')
  })
})

describe('parseDelimited', () => {
  it('第一行是表头；引号里可以有逗号、换行和转义的引号；CRLF、末尾空行都认', () => {
    const table = parseDelimited(
      'name,note\r\n"Smith, J","说 ""好""\n第二行"\r\nLi,\r\n\r\n',
      ',',
      10,
    )
    expect(table.head).toEqual(['name', 'note'])
    expect(table.rows).toEqual([
      ['Smith, J', '说 "好"\n第二行'],
      ['Li', ''],
    ])
    expect(table.total).toBe(2)
    expect(table.columns).toBe(2)
  })

  it('长短不齐的行：列数按最宽的', () => {
    expect(parseDelimited('a\n1,2,3\n4', ',', 10).columns).toBe(3)
  })

  it('只排前几行，其余只数行数', () => {
    const text = ['h', ...Array.from({ length: 50 }, (_, n) => String(n))].join('\n')
    const table = parseDelimited(text, ',', 5)
    expect(table.rows).toHaveLength(5)
    expect(table.rows[4]).toEqual(['4'])
    expect(table.total).toBe(50)
    // 没排出来的那些里引号中的换行不算一行。
    const quoted = parseDelimited('h,n\n1,a\n2,"x\ny"\n3,"""q""\nz"\n\n4,b\n', ',', 1)
    expect(quoted.total).toBe(4)
    expect(parseDelimited('h,n\n1,a\n2,"x\ny"\n3,"""q""\nz"\n\n4,b\n', ',', 0).total).toBe(4)
  })

  it('没有换行结尾也收最后一行；空文件什么都没有', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t', 10).rows).toEqual([['1', '2']])
    expect(parseDelimited('', ',', 10)).toEqual({ head: [], rows: [], total: 0, columns: 0 })
  })
})

describe('数字列', () => {
  it('认千分位、小数、百分号、货币、短单位', () => {
    for (const cell of ['1240', '-3.5', '1,284.00', '¥1,284.00', '86%', '12.5ms', ' 7 ']) {
      expect(isNumeric(cell), cell).toBe(true)
    }
    for (const cell of ['v1.2.3', '2026-10-29', 'abc', '1,2', '12 apples']) {
      expect(isNumeric(cell), cell).toBe(false)
    }
  })

  it('七成以上像数字才算数字列；空格子不算', () => {
    const table = parseDelimited('名,P99,备注\na,1240,x\nb,610,\nc,—,y\nd,240,z', ',', 10)
    expect(numericColumns(table)).toEqual([false, true, false])
  })
})

describe('prettyJson', () => {
  it('一行的 JSON 展开；排过版的、不是 JSON 的、别的扩展名原样', () => {
    expect(prettyJson('a.json', '{"a":1,"b":[1,2]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
    )
    expect(prettyJson('a.json', '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}')).toBeNull()
    expect(prettyJson('a.json', '{"a":')).toBeNull()
    expect(prettyJson('a.jsonl', '{"a":1}')).toBeNull()
    expect(prettyJson('a.json', 'null')).toBeNull()
  })
})

describe('newLines', () => {
  it('在后面追加：标新加的几行；最后一行被续上也算', () => {
    expect([...newLines('a\nb\n', 'a\nb\nc\nd\n')]).toEqual([2, 3])
    expect([...newLines('a\nb', 'a\nbc\nd')]).toEqual([1, 2])
  })

  it('只读末尾、开头往后挪了：认出旧的最后几行，标那之后的', () => {
    const before = 'line 3\nline 4 ok\nline 5 ok\nline 6 ok\n'
    const after = 'line 5 ok\nline 6 ok\nline 7 new\nline 8 new\n'
    // 旧的最后三行（4、5、6）在新的里面只剩 5、6：找不到整段，退到逐行比。
    expect([...newLines(before, after)]).toEqual([2, 3])
    const longer = 'a long line 4\na long line 5\na long line 6\n'
    expect([...newLines(`old\n${longer}`, `${longer}fresh 7\nfresh 8\n`)]).toEqual([3, 4])
  })

  it('中间改了：逐行比，只标新的那几行', () => {
    expect([...newLines('a\nb\nc\nd\ne\n', 'a\nB\nc\nd\ne\n')]).toEqual([1])
  })

  it('一样、整份重写都不标', () => {
    expect(newLines('a\nb', 'a\nb').size).toBe(0)
    expect(newLines('a\nb\nc', 'x\ny\nz').size).toBe(0)
  })
})

describe('表格排序', () => {
  const rows = [
    ['b', '1,200 ms'],
    ['a10', ''],
    ['a2', '¥35.5'],
    ['', '-4'],
    ['c', 'n/a'],
  ]

  it('数字列按大小，空的、不像数的总在最后；倒过来时也在最后', () => {
    expect(sortOrder(rows, 1, true, false)).toEqual([3, 2, 0, 1, 4])
    expect(sortOrder(rows, 1, true, true)).toEqual([0, 2, 3, 1, 4])
  })

  it('文字列带数字的按数字大小', () => {
    expect(sortOrder(rows, 0, false, false)).toEqual([2, 1, 0, 4, 3])
  })

  it('格子里的数、列名', () => {
    expect(numberOf('¥1,284.00')).toBe(1284)
    expect(numberOf('12.5ms')).toBe(12.5)
    expect(numberOf('-3')).toBe(-3)
    expect(numberOf('n/a')).toBeNull()
    expect(columnName(['p99', ' ', 'name'], 1)).toBe('#2')
    expect(columnName(['p99'], 0)).toBe('p99')
  })

  it('点表头：从小到大 → 从大到小 → 不排；换一列从头来', () => {
    expect(nextSort(undefined, 'p99')).toEqual({ column: 'p99' })
    expect(nextSort({ column: 'p99' }, 'p99')).toEqual({ column: 'p99', desc: true })
    expect(nextSort({ column: 'p99', desc: true }, 'p99')).toBeUndefined()
    expect(nextSort({ column: 'p99', desc: true }, 'name')).toEqual({ column: 'name' })
  })
})
