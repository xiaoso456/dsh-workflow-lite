/**
 * 文件类型分类（图标、颜色用的 `fileGroupOf`）的单测。
 */

import { describe, expect, it } from 'vitest'
import { fileGroupOf, stripAnsi } from '../../src/client/model/fileKind.ts'

describe('fileGroupOf', () => {
  it.each([
    ['README.md', 'markdown'],
    ['notes.txt', 'text'],
    ['report.docx', 'doc'],
    ['paper.pdf', 'pdf'],
    ['data.csv', 'sheet'],
    ['budget.xlsx', 'sheet'],
    ['deck.pptx', 'slides'],
    ['package.json', 'data'],
    ['config.yaml', 'config'],
    ['main.ts', 'code'],
    ['style.css', 'code'],
    ['index.html', 'web'],
    ['run.sh', 'shell'],
    ['schema.sql', 'database'],
    ['shot.PNG', 'image'],
    ['song.mp3', 'audio'],
    ['clip.mp4', 'video'],
    ['bundle.zip', 'archive'],
    ['font.woff2', 'font'],
    ['pnpm.lock', 'lock'],
    ['tool.exe', 'binary'],
  ] as const)('%s → %s', (name, group) => {
    expect(fileGroupOf(name)).toBe(group)
  })

  it('没有扩展名：看名字，点开头的是配置，认不出的是 other', () => {
    expect(fileGroupOf('Dockerfile')).toBe('config')
    expect(fileGroupOf('Makefile')).toBe('shell')
    expect(fileGroupOf('LICENSE')).toBe('text')
    expect(fileGroupOf('.gitignore')).toBe('config')
    expect(fileGroupOf('.env')).toBe('config')
    expect(fileGroupOf('mystery')).toBe('other')
    expect(fileGroupOf('thing.unknownext')).toBe('other')
  })

  it('路径里的目录不影响判断', () => {
    expect(fileGroupOf('a/b.c/d.png')).toBe('image')
    expect(fileGroupOf('srcapp.py')).toBe('code')
  })
})

describe('stripAnsi', () => {
  const ESC = String.fromCharCode(27)
  it('去掉日志里的颜色码、标题序列；不带 ESC 的方括号原样留着', () => {
    expect(stripAnsi(`${ESC}[32mINFO ${ESC}[0m ok`)).toBe('INFO  ok')
    expect(stripAnsi(`${ESC}[1;31mERROR${ESC}[0m`)).toBe('ERROR')
    expect(stripAnsi(`${ESC}]0;title${String.fromCharCode(7)}x`)).toBe('x')
    expect(stripAnsi('plain [32m kept')).toBe('plain [32m kept')
  })
})
