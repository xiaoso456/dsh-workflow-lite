/**
 * 由仓库根 CHANGELOG.md 生成「更新日志」页，不手改生成物。
 *
 * - 去掉文件开头的标题和说明，页面标题由 frontmatter 提供。
 * - 小节名换成与 GitHub Release 一致的叫法（新增功能 / 体验优化 / 问题修复 / 其他变更）。
 * - 版本标题去掉方括号，`Unreleased` 写成「未发布」。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url))
const TARGET = fileURLToPath(new URL('../src/content/docs/changelog.md', import.meta.url))

const SECTION = {
  Added: '新增功能',
  Changed: '体验优化',
  Fixed: '问题修复',
  Other: '其他变更',
}

const raw = readFileSync(SOURCE, 'utf8').replace(/\r\n/gu, '\n')
const start = raw.search(/^## \[/mu)
if (start < 0) throw new Error('CHANGELOG.md 里找不到版本小节（## [版本]）')

const body = raw
  .slice(start)
  .replace(/^## \[Unreleased\].*$/mu, '## 未发布')
  .replace(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/gmu, '## $1（$2）')
  .replace(/^### (Added|Changed|Fixed|Other)$/gmu, (_, name) => `### ${SECTION[name]}`)

const front = [
  '---',
  'title: 更新日志',
  'description: 各版本的新增功能、体验优化与问题修复。',
  'editUrl: false',
  '---',
  '',
  '> 本页由仓库中的 `CHANGELOG.md` 自动生成。',
  '',
].join('\n')

writeFileSync(TARGET, `${front}\n${body}`)
console.log(`gen-changelog: ${(body.match(/^## /gmu) ?? []).length} 个版本小节`)
