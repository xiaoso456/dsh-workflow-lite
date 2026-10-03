/**
 * `src/host/hostFs.ts`：给资源选文件、文件夹、Skill 时列出主机上有什么。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listHostDir,
  listSkills,
  readSkill,
  type SkillLister,
  type SkillViewer,
} from '../../src/host/hostFs.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wl-host-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'b.md'), 'b')
  await writeFile(join(root, 'a10.txt'), 'a')
  await writeFile(join(root, 'a2.txt'), 'a')
  await writeFile(join(root, '.env'), 'x')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const slash = (path: string): string => path.replace(/\\/gu, '/')

describe('listHostDir', () => {
  it('不给路径就列工作区：文件夹在前、按名字（数字按大小）排；隐藏项也给，由前端决定显不显示', async () => {
    const listed = await listHostDir({ cwd: root })
    if (!listed.ok) throw new Error(listed.error.message)
    expect(listed.result.path).toBe(slash(root))
    expect(listed.result.entries).toEqual([
      { name: 'docs', dir: true },
      { name: 'src', dir: true },
      { name: '.env', dir: false },
      { name: 'a2.txt', dir: false },
      { name: 'a10.txt', dir: false },
      { name: 'b.md', dir: false },
    ])
    expect(listed.result.truncated).toBe(false)
    expect(listed.result.places[0]).toEqual({ label: 'workspace', path: slash(root) })
    expect(listed.result.places.some((place) => place.label === 'home')).toBe(true)
  })

  it('相对路径按工作区解析；能往上走；不存在 / 不是目录各有说法', async () => {
    const inner = await listHostDir({ cwd: root, path: 'src' })
    if (!inner.ok) throw new Error(inner.error.message)
    expect(inner.result.path).toBe(slash(join(root, 'src')))
    expect(inner.result.parent).toBe(slash(root))
    expect(inner.result.entries).toEqual([])
    const missing = await listHostDir({ cwd: root, path: 'nope' })
    expect(!missing.ok && missing.error.code).toBe('not_found')
    const notDir = await listHostDir({ cwd: root, path: 'b.md' })
    expect(!notDir.ok && notDir.error.code).toBe('invalid_args')
  })
})

describe('listSkills / readSkill', () => {
  const SCOPE = { preset: 'default' }
  const skill = (name: string, modelInvocable = true, path?: string) => ({
    name,
    description: `说明 ${name}`,
    source: 'user-agents',
    ...(path === undefined ? {} : { path }),
    invocation: { modelInvocable },
  })

  /** 记下每次读用的选项，和作用域有没有还回去。 */
  function fixture(scope: object | null = SCOPE) {
    const asked: unknown[] = []
    let released = 0
    const skills: SkillLister = {
      list: async (options) => {
        asked.push(options)
        return [
          skill('pdf', true, 'C:\\Users\\me\\.agents\\skills\\pdf\\SKILL.md'),
          skill('secret', false),
        ]
      },
      get: async (name, options) => {
        asked.push({ name, ...options })
        return name === 'pdf'
          ? {
              ...skill('pdf', true, 'C:\\s\\pdf\\SKILL.md'),
              whenToUse: '要读 PDF 时',
              content: '# PDF',
            }
          : undefined
      },
    }
    const sessions: (string | undefined)[] = []
    const viewer: SkillViewer = async (session) => {
      sessions.push(session)
      return {
        skills,
        ...(scope === null ? {} : { scope }),
        release: async () => {
          released += 1
        },
      }
    }
    return { viewer, asked, sessions, released: () => released }
  }

  it('按会话的视角读（带上作用域与工作区）、只列模型能用的、路径统一成 /，读完还回作用域', async () => {
    const { viewer, asked, sessions, released } = fixture()
    expect(await listSkills(viewer, { cwd: '/w', session: 's1' })).toEqual({
      available: true,
      skills: [
        {
          name: 'pdf',
          description: '说明 pdf',
          source: 'user-agents',
          path: 'C:/Users/me/.agents/skills/pdf/SKILL.md',
        },
      ],
    })
    expect(sessions).toEqual(['s1'])
    expect(asked).toEqual([{ cwd: '/w', scope: SCOPE }])
    expect(released()).toBe(1)
  })

  it('没装 skill 服务就说不可用', async () => {
    expect(await listSkills(undefined, { cwd: '/w' })).toEqual({ available: false, skills: [] })
    expect(await listSkills(async () => undefined, {})).toEqual({ available: false, skills: [] })
  })

  it('读全文：带上说明、什么时候用、路径；认不出的名字回 not_found；读失败也还回作用域', async () => {
    const { viewer, asked, released } = fixture(null)
    expect(await readSkill(viewer, { name: 'pdf' })).toEqual({
      ok: true,
      result: {
        name: 'pdf',
        description: '说明 pdf',
        source: 'user-agents',
        path: 'C:/s/pdf/SKILL.md',
        whenToUse: '要读 PDF 时',
        content: '# PDF',
      },
    })
    expect(asked).toEqual([{ name: 'pdf' }])
    const missing = await readSkill(viewer, { name: 'nope' })
    expect(missing.ok === false && missing.error.code).toBe('not_found')
    expect(released()).toBe(2)

    let freed = false
    const broken: SkillViewer = async () => ({
      skills: {
        list: async () => [],
        get: async () => {
          throw new Error('boom')
        },
      },
      release: async () => {
        freed = true
      },
    })
    await expect(readSkill(broken, { name: 'pdf' })).rejects.toThrow('boom')
    expect(freed).toBe(true)
    const off = await readSkill(undefined, { name: 'pdf' })
    expect(off.ok === false && off.error.code).toBe('blocked')
  })
})
