import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  dispatchDir,
  dispatchRoot,
  legacyStructureDetected,
  payloadDir,
  payloadFile,
  scanTemplateDir,
  scanWorkflowDir,
  templateFile,
  templateOccupant,
  tempName,
  workflowFile,
  workflowNamesOnDisk,
  workflowOccupant,
  workflowsDir,
} from '../../../src/host/store/paths.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-paths-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('路径构造', () => {
  it('图文件 / 模板 / 派发目录的形状符合约定', () => {
    expect(relative(root, workflowFile(root, 'code-review'))).toBe(
      join('workflows', 'code-review.json'),
    )
    expect(relative(root, templateFile(root, 'workflows', 'feature-dev'))).toBe(
      join('templates', 'workflows', 'feature-dev.json'),
    )
    expect(relative(root, templateFile(root, 'nodes', 'reviewer'))).toBe(
      join('templates', 'nodes', 'reviewer.json'),
    )
    expect(relative(root, dispatchDir(root, 'code-review'))).toBe(join('.dispatch', 'code-review'))
    expect(relative(root, payloadDir(root, 'code-review', '3f9a1c2e'))).toBe(
      join('.dispatch', 'code-review', '3f9a1c2e'),
    )
    expect(relative(root, payloadFile(root, 'code-review', '3f9a1c2e', 'scan'))).toBe(
      join('.dispatch', 'code-review', '3f9a1c2e', 'scan.md'),
    )
    expect(relative(root, workflowsDir(root))).toBe('workflows')
    expect(relative(root, dispatchRoot(root))).toBe('.dispatch')
  })
})

describe('tempName', () => {
  it('与目标同目录、以 .tmp- 开头、天然隐藏、每次不同', () => {
    const target = workflowFile(root, 'a')
    const first = tempName(target)
    const second = tempName(target)
    expect(first.startsWith(join(workflowsDir(root), '.tmp-'))).toBe(true)
    expect(first).not.toBe(target)
    expect(first).not.toBe(second)
  })
})

describe('扫描判据（什么算一个图文件）', () => {
  it('只认普通文件 + 非隐藏 + .json（后缀不区分大小写），其余各归 ignored / directories', async () => {
    const dir = workflowsDir(root)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'code-review.json'), '{}')
    await writeFile(join(dir, 'Scan.JSON'), '{}')
    await writeFile(join(dir, '.hidden.json'), '{}')
    await writeFile(join(dir, '.tmp-abc123'), '{}')
    await writeFile(join(dir, 'notes.txt'), 'not json')
    await writeFile(join(dir, 'scan.json~'), '{}')
    await mkdir(join(dir, 'legacy-graph'))

    expect(await workflowNamesOnDisk(root)).toEqual(['Scan', 'code-review'])

    const scan = await scanWorkflowDir(root)
    expect(scan.ignored).toEqual(['.hidden.json', '.tmp-abc123', 'notes.txt', 'scan.json~'])
    expect(scan.directories).toEqual(['legacy-graph'])
  })

  it('目录不存在 = 空，不抛错', async () => {
    const scan = await scanWorkflowDir(join(root, 'nowhere'))
    expect(scan).toEqual({ names: [], ignored: [], directories: [] })
    expect(await workflowNamesOnDisk(join(root, 'nowhere'))).toEqual([])
  })

  it('模板目录同样只认 .json（两类子目录分开扫）', async () => {
    await mkdir(join(root, 'templates', 'nodes'), { recursive: true })
    await writeFile(join(root, 'templates', 'nodes', 'reviewer.json'), '{}')
    await writeFile(join(root, 'templates', 'nodes', 'README.md'), '#')
    const scan = await scanTemplateDir(root, 'nodes')
    expect(scan.names).toEqual(['reviewer'])
    expect(scan.ignored).toEqual(['README.md'])
    expect((await scanTemplateDir(root, 'workflows')).names).toEqual([])
  })
})

describe('占位判定：同名目录也算被占用', () => {
  it('workflowOccupant 给出 file / dir / both / null', async () => {
    const dir = workflowsDir(root)
    await mkdir(dir, { recursive: true })
    expect(await workflowOccupant(root, 'a')).toBeNull()

    await writeFile(join(dir, 'a.json'), '{}')
    expect(await workflowOccupant(root, 'a')).toBe('file')

    await mkdir(join(dir, 'b'))
    expect(await workflowOccupant(root, 'b')).toBe('dir')

    await writeFile(join(dir, 'c.json'), '{}')
    await mkdir(join(dir, 'c'))
    expect(await workflowOccupant(root, 'c')).toBe('both')
  })

  it('templateOccupant 同理，且两类模板互不干扰', async () => {
    await mkdir(join(root, 'templates', 'workflows'), { recursive: true })
    await mkdir(join(root, 'templates', 'workflows', 'feature-dev'))
    expect(await templateOccupant(root, 'workflows', 'feature-dev')).toBe('dir')
    expect(await templateOccupant(root, 'nodes', 'feature-dev')).toBeNull()
  })
})

describe('旧结构探测', () => {
  it('workflows/ 下有目录 ⇒ true', async () => {
    await mkdir(join(root, 'workflows', 'legacy'), { recursive: true })
    expect(await legacyStructureDetected(root)).toBe(true)
  })

  it('顶层有 nodes/ ⇒ true', async () => {
    await mkdir(join(root, 'nodes'), { recursive: true })
    expect(await legacyStructureDetected(root)).toBe(true)
  })

  it('只有正经图文件 ⇒ false', async () => {
    await mkdir(workflowsDir(root), { recursive: true })
    await writeFile(workflowFile(root, 'a'), '{}')
    expect(await legacyStructureDetected(root)).toBe(false)
  })
})
