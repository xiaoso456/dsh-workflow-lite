import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compileWorkflow } from '../../src/host/plan.ts'
import {
  createRepository,
  type Repository,
  reportProblems,
} from '../../src/host/store/repository.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { validateDocument } from '../../src/shared/validate.ts'

let dataDir: string
let repository: Repository

beforeEach(async () => {
  // 每个用例一个独立临时目录——绝不碰真实的 ~/.dsh。
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-plan-'))
  repository = createRepository({
    dataDir,
    validate: (document, workflow) =>
      reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 })),
  })
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

/** 建出黄金示例图（scan / auth-review / fix-auth / report）。 */
async function seedGolden(): Promise<void> {
  expect((await repository.create('code-review')).ok).toBe(true)
  const nodes = [
    { id: 'scan', content: '扫描仓库，把疑点写成 scan.json。', label: '扫描', output: 'scan.json' },
    {
      id: 'auth-review',
      content: '你是审查者，只审认证相关代码。',
      label: '认证审查',
      output: 'auth-findings.md',
    },
    { id: 'fix-auth', content: '按 auth-findings.md 修认证问题。', label: '修复', output: false },
    {
      id: 'report',
      content: '写一份给 owner 看的报告。',
      label: '报告',
      output: 'review-report.md',
    },
  ] as const
  for (const node of nodes) {
    const outcome = await repository.writeNode('code-review', {
      id: node.id,
      content: node.content,
      label: node.label,
      output: node.output,
    })
    expect(outcome.ok, `${node.id}: ${outcome.ok ? '' : outcome.error.message}`).toBe(true)
  }
  expect((await repository.connect('code-review', 'scan', 'auth-review')).ok).toBe(true)
  expect((await repository.connect('code-review', 'auth-review', 'fix-auth', 'fail')).ok).toBe(true)
  expect((await repository.connect('code-review', 'auth-review', 'report', 'pass')).ok).toBe(true)
  expect((await repository.connect('code-review', 'fix-auth', 'auth-review')).ok).toBe(true)
}

describe('compileWorkflow —— 端到端：图 → 计划 + 物化', () => {
  it('对着实例编译：出计划，任务描述写进实例目录的 tasks/（提示词原文 + 这一步的资源）', async () => {
    await seedGolden()
    const dir = join(dataDir, 'ws', '.workflow-lite', 'runs', '20261002-143012-a3f9')
    const outcome = await compileWorkflow(
      repository,
      dataDir,
      'code-review',
      {
        goal: '把认证模块的安全问题清干净',
        instance: { id: '20261002-143012-a3f9', dir, tracked: false },
      },
      join(dataDir, 'ws'),
    )
    expect(outcome.ok, outcome.ok ? '' : outcome.error.message).toBe(true)
    if (!outcome.ok) return

    const { plan, planId, problems, warnings, payloadPaths } = outcome.result
    expect(problems).toEqual([])
    expect(planId).toMatch(/^[0-9a-f]{8}$/)
    expect(plan).not.toBe('')

    // 派发计划：五段齐全、正文一个字都不在里面、路径引用指向实例目录里的任务描述。
    for (const marker of [
      '## 你拿到的是什么',
      '## 图的事实',
      '## 分发纪律',
      '## 交付契约',
      '## 本次执行',
    ]) {
      expect(plan).toContain(marker)
    }
    expect(plan).not.toContain('你是审查者')
    expect(plan).not.toContain('{instance}')
    expect(plan).toContain('工作流实例：`20261002-143012-a3f9`')
    expect(payloadPaths['auth-review']).toBe(join(dir, 'tasks', 'auth-review.md'))
    expect(plan).toContain(payloadPaths['auth-review'] ?? '')
    // 没配产出根目录：默认落在实例自己的 out 下。
    expect(plan).toContain('`.workflow-lite/runs/20261002-143012-a3f9/out`')

    const written = await readFile(join(dir, 'tasks', 'auth-review.md'), 'utf8')
    expect(written.startsWith('你是审查者，只审认证相关代码。\n\n---\n\n')).toBe(true)
    // 末尾附上这一步读写的资源（路径按实例拼好）与判定行要求，执行者不必等编排者转述。
    expect(written).toContain('**这一步的资源**')
    expect(written).toContain('`.workflow-lite/runs/20261002-143012-a3f9/out/')
    expect(written).toContain('**判定**：回复的最后一行写')
    // 工作区的 .workflow-lite 不进版本库。
    expect(await readFile(join(dataDir, 'ws', '.workflow-lite', '.gitignore'), 'utf8')).toBe('*\n')

    // 警告与提示走同一条通道（这张图上 auth-review 有入边但 fix-auth 显式 false ⇒ 不该有 missing_output）。
    expect(warnings.some((warning) => warning.nodes?.includes('auth-review') === true)).toBe(false)
  })

  it('预览（不给实例）：同一份计划，实例 id 处留 {instance}，什么文件都不写', async () => {
    await seedGolden()
    expect((await repository.configure('code-review', { runState: true })).ok).toBe(true)
    const outcome = await compileWorkflow(
      repository,
      dataDir,
      'code-review',
      {},
      join(dataDir, 'ws'),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const { plan, payloadPaths } = outcome.result
    expect(payloadPaths.scan).toBe(
      join(dataDir, 'ws', '.workflow-lite', 'runs', '{instance}', 'tasks', 'scan.md'),
    )
    expect(plan).toContain('工作流实例：`{instance}`')
    expect(plan).toContain('## 运行状态')
    expect(plan).toContain('"instance":"{instance}"')
    const { access } = await import('node:fs/promises')
    await expect(access(join(dataDir, 'ws'))).rejects.toThrow()
  })

  it('planId 由图内容决定：同内容重复编译得同一目录（幂等覆盖）', async () => {
    await seedGolden()
    const first = await compileWorkflow(repository, dataDir, 'code-review', {})
    const second = await compileWorkflow(repository, dataDir, 'code-review', {})
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.result.planId).toBe(first.result.planId)
    expect(second.result.plan).toBe(first.result.plan)
  })

  it('编译级（空正文）⇒ plan 为空串、problems 非空，且**不写任务描述**', async () => {
    await seedGolden()
    expect((await repository.writeNode('code-review', { id: 'scan', content: '' })).ok).toBe(true)
    const dir = join(dataDir, 'inst')
    const outcome = await compileWorkflow(repository, dataDir, 'code-review', {
      instance: { id: '20261002-143012-a3f9', dir, tracked: false },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.plan).toBe('')
    expect(outcome.result.problems.map((problem) => problem.code)).toContain('prompt_empty')
    // 不写：目录不该出现（否则会留下与"没有计划"对不上的任务描述）。
    const { access } = await import('node:fs/promises')
    await expect(access(join(dir, 'tasks'))).rejects.toThrow()
  })

  it('整卷版：内联全部正文、不物化', async () => {
    await seedGolden()
    const outcome = await compileWorkflow(repository, dataDir, 'code-review', { full: true })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.plan).toContain('你是审查者，只审认证相关代码。')
    expect(outcome.result.plan).toContain('扫描仓库，把疑点写成 scan.json。')
    // 路径引用退位
    expect(outcome.result.plan).not.toContain(outcome.result.payloadPaths.scan ?? '')
  })

  it('图不存在 ⇒ not_found（绝不隐式创建）', async () => {
    const outcome = await compileWorkflow(repository, dataDir, 'nope', {})
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('not_found')
  })

  it('保存级破损（悬空 edge）⇒ blocked，错误里带问题清单', async () => {
    await seedGolden()
    // 手写一个指向不存在节点的边：绕过工具的 connect（它不会让端点悬空）。
    const { writeFileAtomic } = await import('../../src/host/store/atomic.ts')
    const { workflowFile } = await import('../../src/host/store/paths.ts')
    const load = await repository.load('code-review')
    expect(load.document).not.toBeNull()
    if (load.document === null) return
    const broken = {
      ...load.document,
      edges: [
        ...load.document.edges,
        {
          id: 'scan->ghost',
          source: 'scan',
          target: 'ghost',
          sourceHandle: null,
          targetHandle: null,
        },
      ],
    }
    await writeFileAtomic(
      workflowFile(dataDir, 'code-review'),
      `${JSON.stringify(broken, null, 2)}\n`,
    )
    const outcome = await compileWorkflow(repository, dataDir, 'code-review', {})
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('blocked')
    expect(outcome.error.detail).toBeDefined()
  })

  it('cwd 缺省时 ⑤ 渲染「未指定」、goal 缺省时不写目标；给了就照写', async () => {
    await seedGolden()
    const bare = await compileWorkflow(repository, dataDir, 'code-review', {})
    expect(bare.ok).toBe(true)
    if (!bare.ok) return
    expect(bare.result.plan).not.toContain('目标：')
    expect(bare.result.plan).toContain('工作区路径：未指定')

    const given = await compileWorkflow(
      repository,
      dataDir,
      'code-review',
      { goal: '跑完它' },
      'D:\\work\\repo',
    )
    expect(given.ok).toBe(true)
    if (!given.ok) return
    expect(given.result.plan).toContain('目标：跑完它')
    expect(given.result.plan).toContain('工作区路径：D:\\work\\repo')
  })
})

describe('compileWorkflow 与校验层的接线', () => {
  it('图的警告与提示会出现在 ⑥ 段（有警告时）', async () => {
    await seedGolden()
    // 两个步骤都整份写同一个资源，制造一条 resource_overwritten 警告。
    expect(
      (
        await repository.writeResource('code-review', {
          id: 'shared',
          items: [{ kind: 'file', value: 'shared.md' }],
        })
      ).ok,
    ).toBe(true)
    const load = await repository.load('code-review')
    const [first, second] = (load.document?.nodes ?? []).filter((node) => node.type === 'wfNode')
    expect(
      (
        await repository.connect(
          'code-review',
          first?.id ?? '',
          'shared',
          undefined,
          undefined,
          false,
        )
      ).ok,
    ).toBe(true)
    expect(
      (
        await repository.connect(
          'code-review',
          second?.id ?? '',
          'shared',
          undefined,
          undefined,
          false,
        )
      ).ok,
    ).toBe(true)
    const outcome = await compileWorkflow(repository, dataDir, 'code-review', {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.warnings.some((warning) => warning.code === 'resource_overwritten')).toBe(
      true,
    )
    expect(outcome.result.plan).toContain('## 图的注意事项')
  })

  it('回边不计入批次但计入前置（黄金图的 auth-review 在批次 2）', async () => {
    await seedGolden()
    const load = await repository.load('code-review')
    expect(load.document).not.toBeNull()
    if (load.document === null) return
    const analysis = analyzeGraph(load.document)
    expect(analysis.batches[0]?.nodes).toEqual(['scan'])
    expect(analysis.batches[1]?.nodes).toEqual(['auth-review'])
    expect(analysis.backEdges.has('fix-auth->auth-review')).toBe(true)
  })
})
