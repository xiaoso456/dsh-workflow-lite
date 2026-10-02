/**
 * dsh-workflow-lite — 运行状态文件的校验脚本（随 skill `workflow-run-state` 分发）。
 *
 * 用法：`node validate-state.mjs <状态文件>`。合法打印 `OK`、退出码 0；不合法逐条打印
 * `路径: 问题`、退出码 1；用法错 / 文件读不了退出码 2。
 *
 * tsdown 把它连同 `yaml` 与 `shared/*` 打成一个**没有外部依赖**的 ESM 文件，`node` 直接能跑。
 * 规则只有一份：`shared/runState.ts`（插件读状态文件时用的也是它）。
 *
 * @module @xiaoso/dsh-workflow-lite/skill/validate-state
 */

import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import { readDocument } from '../shared/model.ts'
import { graphFacts, type RunGraphFacts, validateRunState } from '../shared/runState.ts'

function main(argv: readonly string[]): number {
  const file = argv[0]
  if (file === undefined || file === '--help' || file === '-h') {
    process.stderr.write('用法：node validate-state.mjs <状态文件路径>\n')
    return 2
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    process.stderr.write(
      `读不了 ${file}：${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 2
  }

  const doc = parseDocument(text, { prettyErrors: true })
  if (doc.errors.length > 0) {
    for (const error of doc.errors) process.stdout.write(`YAML 写法有误：${error.message}\n`)
    return 1
  }
  const value = doc.toJS() as unknown

  // 对照图快照：步骤齐不齐、判定取值对不对。快照读不了就只查格式，并说一声。
  let facts: RunGraphFacts | undefined
  const graph =
    typeof value === 'object' && value !== null && 'graph' in value
      ? (value as { graph: unknown }).graph
      : undefined
  if (typeof graph === 'string') {
    try {
      const parsed = readDocument(readFileSync(graph, 'utf8'))
      if (parsed.document !== null) facts = graphFacts(parsed.document)
    } catch {
      // 落到下面的提示。
    }
  }

  const { issues } = validateRunState(value, facts)
  if (facts === undefined) {
    process.stdout.write('提示：读不到 graph 指向的图快照，只检查了格式，没对照步骤与判定。\n')
  }
  if (issues.length === 0) {
    process.stdout.write('OK\n')
    return 0
  }
  for (const issue of issues) {
    process.stdout.write(`${issue.path === '' ? '（整份文件）' : issue.path}: ${issue.message}\n`)
  }
  process.stdout.write(`共 ${issues.length} 处问题。改好后再运行一次。\n`)
  return 1
}

process.exitCode = main(process.argv.slice(2))
