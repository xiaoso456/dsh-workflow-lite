import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  hashOf,
  readFileText,
  removeTree,
  unlinkFile,
  writeFileAtomic,
} from '../../../src/host/store/atomic.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-atomic-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function tempLeftovers(dir: string): Promise<string[]> {
  const entries = await readdir(dir)
  return entries.filter((name) => name.startsWith('.tmp-'))
}

describe('writeFileAtomic', () => {
  it('写出与内容逐字节相同，且不留临时文件', async () => {
    const target = join(root, 'a.json')
    const content = '{\n  "nodes": []\n}\n'
    await writeFileAtomic(target, content)
    expect(await readFile(target, 'utf8')).toBe(content)
    expect(await tempLeftovers(root)).toEqual([])
  })

  it('覆盖已有文件', async () => {
    const target = join(root, 'a.json')
    await writeFile(target, 'old')
    await writeFileAtomic(target, 'new')
    expect(await readFile(target, 'utf8')).toBe('new')
    expect(await tempLeftovers(root)).toEqual([])
  })

  it('内容按 utf8 原样落盘：不补尾换行、不改 EOL、无 BOM', async () => {
    const target = join(root, 'prompt.md')
    const content = '第一行\r\n第二行（没有尾换行）'
    await writeFileAtomic(target, content)
    const bytes = await readFile(target)
    expect(bytes.equals(Buffer.from(content, 'utf8'))).toBe(true)
    expect(bytes[0]).not.toBe(0xef)
  })

  it('目标不可写（父目录不存在）⇒ 抛错且不留临时文件', async () => {
    const target = join(root, 'missing-dir', 'a.json')
    await expect(writeFileAtomic(target, 'x')).rejects.toThrow()
    expect(await tempLeftovers(root)).toEqual([])
  })

  it('目标是目录 ⇒ rename 失败、抛错且清掉临时文件', async () => {
    const target = join(root, 'a-dir')
    await mkdir(target)
    await expect(writeFileAtomic(target, 'x')).rejects.toThrow()
    expect(await tempLeftovers(root)).toEqual([])
  })
})

describe('readFileText', () => {
  it('不存在 ⇒ null', async () => {
    expect(await readFileText(join(root, 'nope.json'))).toBeNull()
  })

  it('目标是目录 ⇒ null', async () => {
    const dir = join(root, 'a-dir')
    await mkdir(dir)
    expect(await readFileText(dir)).toBeNull()
  })

  it('存在 ⇒ 原文（不做任何规范化）', async () => {
    const target = join(root, 'a.txt')
    await writeFile(target, 'x\r\ny')
    expect(await readFileText(target)).toBe('x\r\ny')
  })
})

describe('hashOf', () => {
  it('同文本同值、异文本异值、稳定可复现', async () => {
    const first = await hashOf('{"nodes":[]}\n')
    expect(first).toBe(await hashOf('{"nodes":[]}\n'))
    expect(first).not.toBe(await hashOf('{"nodes":[]}'))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('删除助手', () => {
  it('unlinkFile 幂等', async () => {
    const target = join(root, 'a.json')
    await writeFile(target, 'x')
    await unlinkFile(target)
    await expect(unlink(target)).rejects.toThrow()
    await unlinkFile(target)
  })

  it('removeTree 幂等（目录不在也算成功）', async () => {
    const tree = join(root, 'dispatch', 'a')
    await mkdir(tree, { recursive: true })
    await writeFile(join(tree, 'scan.md'), 'x')
    await removeTree(tree)
    await removeTree(tree)
  })
})
