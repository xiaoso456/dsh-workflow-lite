import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { materialize } from '../../../src/host/store/materialize.ts'
import { dispatchRoot, pathKind, payloadDir, payloadFile } from '../../../src/host/store/paths.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-materialize-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function listDir(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort()
}

describe('materialize', () => {
  it('物化路径与字节内容：不补尾换行、不改 EOL、无 BOM', async () => {
    // 启动时不该建 .dispatch —— 只有编译才建。
    expect(await pathKind(dispatchRoot(root))).toBe('missing')

    const windowsPrompt = '第一行\r\n第二行（没有尾换行）'
    const unixPrompt = 'line1\nline2\n'
    await materialize(
      payloadDir(root, 'graph', 'plan0001'),
      new Map([
        ['scan', windowsPrompt],
        ['fix', unixPrompt],
      ]),
    )

    expect(await pathKind(dispatchRoot(root))).toBe('dir')
    expect(await listDir(payloadDir(root, 'graph', 'plan0001'))).toEqual(['fix.md', 'scan.md'])

    const windowsBytes = await readFile(payloadFile(root, 'graph', 'plan0001', 'scan'))
    expect(windowsBytes.equals(Buffer.from(windowsPrompt, 'utf8'))).toBe(true)
    expect(windowsBytes[0]).not.toBe(0xef)

    const unixBytes = await readFile(payloadFile(root, 'graph', 'plan0001', 'fix'))
    expect(unixBytes.equals(Buffer.from(unixPrompt, 'utf8'))).toBe(true)
  })

  it('同 planId 重编先清空该目录再写（幂等覆盖，不留上一轮的残骸）', async () => {
    await materialize(
      payloadDir(root, 'graph', 'plan0001'),
      new Map([
        ['a', 'A'],
        ['b', 'B'],
      ]),
    )
    expect(await listDir(payloadDir(root, 'graph', 'plan0001'))).toEqual(['a.md', 'b.md'])

    await materialize(payloadDir(root, 'graph', 'plan0001'), new Map([['a', 'A2']]))
    expect(await listDir(payloadDir(root, 'graph', 'plan0001'))).toEqual(['a.md'])
    expect(await readFile(payloadFile(root, 'graph', 'plan0001', 'a'), 'utf8')).toBe('A2')
  })

  it('不同 planId 各自成目录、互不影响；不同图名隔离', async () => {
    await materialize(payloadDir(root, 'graph', 'plan0001'), new Map([['a', 'A1']]))
    await materialize(payloadDir(root, 'graph', 'plan0002'), new Map([['a', 'A2']]))
    await materialize(payloadDir(root, 'other', 'plan0001'), new Map([['a', 'OTHER']]))

    expect(await readFile(payloadFile(root, 'graph', 'plan0001', 'a'), 'utf8')).toBe('A1')
    expect(await readFile(payloadFile(root, 'graph', 'plan0002', 'a'), 'utf8')).toBe('A2')
    expect(await readFile(payloadFile(root, 'other', 'plan0001', 'a'), 'utf8')).toBe('OTHER')
    expect(await listDir(join(dispatchRoot(root), 'graph')).then((names) => names.sort())).toEqual([
      'plan0001',
      'plan0002',
    ])
  })

  it('空载荷集 ⇒ 只留下一个空目录（不抛错）', async () => {
    await materialize(payloadDir(root, 'graph', 'plan0001'), new Map())
    expect(await listDir(payloadDir(root, 'graph', 'plan0001'))).toEqual([])
  })

  it('不留 .tmp- 临时文件', async () => {
    await materialize(payloadDir(root, 'graph', 'plan0001'), new Map([['a', 'A']]))
    expect(await listDir(dispatchRoot(root))).toEqual(['graph'])
    expect(await listDir(payloadDir(root, 'graph', 'plan0001'))).toEqual(['a.md'])
  })

  it('不可写（dataDir 被文件占位）⇒ 抛错，绝不返回一份路径不存在的计划', async () => {
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'x')
    await expect(
      materialize(payloadDir(join(blocker, 'sub'), 'graph', 'plan0001'), new Map([['a', 'A']])),
    ).rejects.toThrow()
  })

  it('非法节点 id ⇒ 抛错（纵深防御：id 同时是文件名）', async () => {
    await expect(
      materialize(payloadDir(root, 'graph', 'plan0001'), new Map([['../escape', 'A']])),
    ).rejects.toThrow()
  })

  it('物化目录是派生物：整个删掉后重编照常重建', async () => {
    await materialize(payloadDir(root, 'graph', 'plan0001'), new Map([['a', 'A']]))
    await rm(dispatchRoot(root), { recursive: true, force: true })
    expect(await pathKind(dispatchRoot(root))).toBe('missing')

    await materialize(payloadDir(root, 'graph', 'plan0001'), new Map([['a', 'A']]))
    expect(await readFile(payloadFile(root, 'graph', 'plan0001', 'a'), 'utf8')).toBe('A')
  })
})

describe('materialize 与 .dispatch 的扫描隔离', () => {
  it('.dispatch 以 . 开头 ⇒ 不会被当成图文件扫到', async () => {
    await mkdir(join(root, 'workflows'), { recursive: true })
    await writeFile(join(root, 'workflows', 'graph.json'), '{"nodes":[],"edges":[]}\n')
    await materialize(payloadDir(root, 'graph', 'plan0001'), new Map([['a', 'A']]))

    const entries = await readdir(join(root, 'workflows'))
    expect(entries).toEqual(['graph.json'])
  })
})
