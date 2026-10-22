/**
 * 路径变量（`src/shared/pathVars.ts`）：`{workflow}`、`{instance}`、`{skill}` 的认、拼、换，旧写法 `{assets}` 的兼容。
 */

import { describe, expect, it } from 'vitest'
import { readDocument } from '../../src/shared/model.ts'
import { bindRoot, resolveItemPath, resolveOutputPath } from '../../src/shared/outputPaths.ts'
import {
  bindInstance,
  bindWorkflowPath,
  hasInstanceVar,
  isSkillPath,
  isWorkflowPath,
  skillPath,
  upgradeWorkflowPath,
  workflowPath,
  workflowRelative,
} from '../../src/shared/pathVars.ts'
import { bindWorkflowDir } from '../../src/shared/resources.ts'
import { RESOURCE_TYPE, type WorkflowDocument } from '../../src/shared/types.ts'

describe('{workflow}：认路径、拼路径', () => {
  it('认得变量本身与它下面的路径', () => {
    expect(isWorkflowPath('{workflow}')).toBe(true)
    expect(isWorkflowPath(' {workflow}/a.md ')).toBe(true)
    expect(isWorkflowPath('{workflow}\\a.md')).toBe(true)
    expect(isWorkflowPath('{workflow}x/a.md')).toBe(false)
    expect(isWorkflowPath('docs/{workflow}/a.md')).toBe(false)
  })

  it('相对部分与拼回去互为逆运算，都规范化', () => {
    expect(workflowRelative('{workflow}/./a//b.md')).toBe('a/b.md')
    expect(workflowRelative('{workflow}\\a\\b.md')).toBe('a/b.md')
    expect(workflowRelative('{workflow}')).toBe('')
    expect(workflowPath('a//b.md')).toBe('{workflow}/a/b.md')
    expect(workflowPath('/a.md')).toBe('{workflow}/a.md')
    expect(workflowPath('')).toBe('{workflow}')
    expect(workflowPath(workflowRelative('{workflow}/x/y'))).toBe('{workflow}/x/y')
  })

  it('不拼产出根目录，规范化之后变量留着', () => {
    expect(resolveOutputPath('out', '{workflow}/./a//b.md')).toBe('{workflow}/a/b.md')
    expect(resolveItemPath('out', '{workflow}', true)).toBe('{workflow}')
  })

  it('换成给定目录下的路径；别的路径原样', () => {
    expect(bindWorkflowPath('{workflow}/a/b.md', 'C:\\data\\assets\\w')).toBe(
      'C:/data/assets/w/a/b.md',
    )
    expect(bindWorkflowPath('{workflow}', '/data/assets/w/')).toBe('/data/assets/w/')
    expect(bindWorkflowPath('{workflow}/a.md', '{skill}/assets')).toBe('{skill}/assets/a.md')
    expect(bindWorkflowPath('docs/a.md', '/x')).toBe('docs/a.md')
  })
})

describe('{workflow} 的旧写法 {assets}', () => {
  it('照样认、照样换；规范化时写成 {workflow}', () => {
    expect(isWorkflowPath('{assets}/a.md')).toBe(true)
    expect(isWorkflowPath('{assets}x/a.md')).toBe(false)
    expect(workflowRelative('{assets}/a.md')).toBe('a.md')
    expect(resolveOutputPath('out', '{assets}/./a.md')).toBe('{workflow}/a.md')
    expect(bindWorkflowPath('{assets}/a.md', '/data/assets/w')).toBe('/data/assets/w/a.md')
  })

  it('改写只换开头的变量，后面原样', () => {
    expect(upgradeWorkflowPath(' {assets}\\a.md')).toBe('{workflow}\\a.md')
    expect(upgradeWorkflowPath('{assets}')).toBe('{workflow}')
    expect(upgradeWorkflowPath('{workflow}/a.md')).toBe('{workflow}/a.md')
    expect(upgradeWorkflowPath('docs/{assets}/a.md')).toBe('docs/{assets}/a.md')
  })

  it('读图：文件、文件夹里的改写成 {workflow}，自定义文本不动', () => {
    const text = JSON.stringify({
      nodes: [
        {
          id: 'r',
          type: RESOURCE_TYPE,
          position: { x: 0, y: 0 },
          data: {
            items: [
              { kind: 'file', value: '{assets}/memory/m.md' },
              { kind: 'folder', value: '{assets}/memory/m' },
              { kind: 'text', value: '{assets}/a.md' },
            ],
          },
        },
      ],
      edges: [],
    })
    expect(readDocument(text).document?.nodes[0]?.data).toMatchObject({
      items: [
        { kind: 'file', value: '{workflow}/memory/m.md' },
        { kind: 'folder', value: '{workflow}/memory/m' },
        { kind: 'text', value: '{assets}/a.md' },
      ],
    })
  })
})

describe('bindWorkflowDir：整张图', () => {
  it('只换文件、文件夹里的变量，没有就原样返回同一个对象', () => {
    const document: WorkflowDocument = {
      nodes: [
        {
          id: 'r',
          type: RESOURCE_TYPE,
          position: { x: 0, y: 0 },
          data: {
            items: [
              { kind: 'file', value: '{workflow}/a.md' },
              { kind: 'text', value: '{workflow}/a.md' },
            ],
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const bound = bindWorkflowDir(document, '/data/assets/w')
    expect(bound.nodes[0]?.data).toMatchObject({
      items: [
        { kind: 'file', value: '/data/assets/w/a.md' },
        { kind: 'text', value: '{workflow}/a.md' },
      ],
    })
    expect(JSON.stringify(document)).toContain('{workflow}/a.md')
    const plain = { ...document, nodes: [] }
    expect(bindWorkflowDir(plain, '/x')).toBe(plain)
  })
})

describe('{instance}', () => {
  it('路径里任意位置、出现几次都换', () => {
    expect(hasInstanceVar('.workflow-lite/runs/{instance}/out')).toBe(true)
    expect(hasInstanceVar('out')).toBe(false)
    expect(bindInstance('{instance}/a/{instance}.md', 'r1')).toBe('r1/a/r1.md')
    expect(bindInstance('out', 'r1')).toBe('out')
  })

  it('根目录：换完再规范化，换成空就是工作区根', () => {
    expect(bindRoot('.workflow-lite/runs/{instance}/out/', 'r1')).toBe('.workflow-lite/runs/r1/out')
    expect(bindRoot('{instance}', '')).toBe('.')
  })
})

describe('{skill}', () => {
  it('认得变量本身与它下面的路径；拼路径时规范化', () => {
    expect(isSkillPath('{skill}/steps/a.md')).toBe(true)
    expect(isSkillPath('{skill}')).toBe(true)
    expect(isSkillPath('{skills}/a.md')).toBe(false)
    expect(skillPath('steps/a.md')).toBe('{skill}/steps/a.md')
    expect(skillPath('')).toBe('{skill}')
  })

  it('产出路径在 skill 目录里时不拼根目录', () => {
    expect(resolveOutputPath('out', '{skill}/assets//a.md')).toBe('{skill}/assets/a.md')
  })
})
