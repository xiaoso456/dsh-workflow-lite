import { describe, expect, it } from 'vitest'
import { MAX_WHEN_CODEPOINTS } from '../../src/shared/limits.ts'
import {
  checkLabel,
  checkName,
  checkOutput,
  checkWhen,
  codepointLength,
  isVerdictWhen,
  normalizeName,
  sameName,
} from '../../src/shared/naming.ts'

describe('normalizeName', () => {
  it('trim 尾部空白与尾随点（Windows 会静默吞掉尾点）', () => {
    expect(normalizeName('scan ')).toBe('scan')
    expect(normalizeName('scan.')).toBe('scan')
    expect(normalizeName('scan. . ')).toBe('scan')
  })
  it('统一 NFC', () => {
    // e + 组合尖音符 → 预组合 é
    expect(normalizeName('cafe\u0301')).toBe('café'.normalize('NFC'))
  })
})

describe('codepointLength', () => {
  it('按码点数而不是 UTF-16 长度', () => {
    expect(codepointLength('ab')).toBe(2)
    expect(codepointLength('修复认证')).toBe(4)
    expect(codepointLength('👍')).toBe(1)
  })
})

describe('checkName —— 禁止集', () => {
  it('中文名合法（这是刻意的：写成禁止集，中文天然可用）', () => {
    expect(checkName('修复认证')).toBeNull()
    expect(checkName('code-review')).toBeNull()
    expect(checkName('review_2')).toBeNull()
  })

  it('Windows 非法字符一律拒绝', () => {
    for (const bad of ['a<b', 'a>b', 'a:b', 'a"b', 'a/b', 'a\\b', 'a|b', 'a?b', 'a*b']) {
      expect(checkName(bad)?.code, bad).toBe('name_invalid')
    }
  })

  it('空白、逗号、等号不算非法字符但空白要被拒', () => {
    expect(checkName('a b')?.code).toBe('name_invalid')
    // 逗号与等号在命名约束里没有单列，交给文件名约束之外的上层规则
    expect(checkName('a,b')).toBeNull()
    expect(checkName('a=b')).toBeNull()
  })

  it('空名、以点开头、以点结尾都要拒', () => {
    expect(checkName('')?.code).toBe('name_invalid')
    expect(checkName('   ')?.code).toBe('name_invalid')
    expect(checkName('.hidden')?.code).toBe('name_invalid')
    expect(checkName('trailing.')?.code).toBe('name_invalid')
  })

  it('Windows 保留名（大小写不敏感，含带扩展名形式）', () => {
    for (const bad of ['CON', 'con', 'Con', 'prn', 'AUX', 'nul', 'COM1', 'lpt9']) {
      expect(checkName(bad)?.code, bad).toBe('name_invalid')
    }
    expect(checkName('console')).toBeNull()
  })

  it('长度上限 64 码点', () => {
    expect(checkName('a'.repeat(64))).toBeNull()
    expect(checkName('a'.repeat(65))?.code).toBe('name_invalid')
  })

  it('控制字符要拒', () => {
    expect(checkName('a\u0000b')?.code).toBe('name_invalid')
    expect(checkName('a\u001fb')?.code).toBe('name_invalid')
  })
})

describe('checkWhen', () => {
  it('预置值与中文自由文本都合法', () => {
    expect(checkWhen('pass')).toBeNull()
    expect(checkWhen('fail')).toBeNull()
    expect(checkWhen('当测试通过时')).toBeNull()
    expect(checkWhen('a-b_c1')).toBeNull()
  })

  it('空串非法——要"无条件边"就整条不写 when', () => {
    expect(checkWhen('')?.code).toBe('when_invalid')
  })

  it('软编排：一整句自然语言条件也合法（空格、标点、引号都行）', () => {
    for (const ok of ['a b', 'a,b', 'a=b', 'a"b', "a'b", '测试全绿，且没有新增 "warning"。']) {
      expect(checkWhen(ok), ok).toBeNull()
    }
  })

  it('只拒三样：全空白、换行 / 控制字符、超长——报错说的就是真实原因', () => {
    expect(checkWhen('   ')?.message).toContain('不能为空')
    expect(checkWhen('a\nb')?.message).toContain('换行')
    expect(checkWhen('a'.repeat(MAX_WHEN_CODEPOINTS))).toBeNull()
    expect(checkWhen('a'.repeat(MAX_WHEN_CODEPOINTS + 1))?.message).toContain('不能超过')
  })
})

describe('isVerdictWhen', () => {
  it('短的英文标识是判定词，中文短句与一句话都是自然语言条件', () => {
    expect(isVerdictWhen('pass')).toBe(true)
    expect(isVerdictWhen('retry-2')).toBe(true)
    expect(isVerdictWhen('需要人工复核')).toBe(false)
    expect(isVerdictWhen('测试全绿且没有新增警告，可以合并')).toBe(false)
    expect(isVerdictWhen('a b')).toBe(false)
    expect(isVerdictWhen('a'.repeat(33))).toBe(false)
  })
})

describe('checkLabel', () => {
  it('普通显示名（含空格与中文）合法', () => {
    expect(checkLabel('认证审查')).toBeNull()
    expect(checkLabel('Auth Review')).toBeNull()
  })
  it('换行与竖线要拒（会打断计划里的 markdown 表格）', () => {
    expect(checkLabel('a\nb')?.code).toBe('label_invalid')
    expect(checkLabel('a\rb')?.code).toBe('label_invalid')
    expect(checkLabel('a|b')?.code).toBe('label_invalid')
  })
})

describe('checkOutput', () => {
  it('相对路径（含子路径）合法', () => {
    expect(checkOutput('auth-findings.md')).toBeNull()
    expect(checkOutput('docs/auth/findings.md')).toBeNull()
    expect(checkOutput('docs\\auth\\findings.md')).toBeNull()
  })
  it('绝对路径要拒', () => {
    expect(checkOutput('/tmp/x.md')?.code).toBe('output_invalid')
    expect(checkOutput('C:\\x.md')?.code).toBe('output_invalid')
    expect(checkOutput('c:/x.md')?.code).toBe('output_invalid')
  })
  it('.. 要拒', () => {
    expect(checkOutput('../x.md')?.code).toBe('output_invalid')
    expect(checkOutput('a/../../x.md')?.code).toBe('output_invalid')
  })
  it('空串要拒（不产出请显式写 false）', () => {
    expect(checkOutput('')?.code).toBe('output_invalid')
  })
})

describe('sameName', () => {
  it('大小写不敏感（Windows 落盘不区分大小写，而这三样都是文件名）', () => {
    expect(sameName('Scan', 'scan')).toBe(true)
    expect(sameName('scan', 'scan ')).toBe(true)
    expect(sameName('scan', 'scan2')).toBe(false)
  })
})
