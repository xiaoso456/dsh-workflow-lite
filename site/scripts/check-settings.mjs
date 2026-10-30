/**
 * 检查「插件设置」页是否写全了设置页里的每一项。
 *
 * 做法：从 src/shared/wire.ts 读设置页能改的键（PLUGIN_CONFIG_KEYS），换成界面上显示的名字
 * （src/client/i18n.ts 的中文文案），逐个确认 settings/plugin.md 里出现过。
 * 新增了设置项却没写文档，构建会在这里失败。
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/** 设置键 → i18n 里界面名称的键。新增设置项时在这里补一行。 */
const LABEL_KEY = {
  dataDir: 'cfg.dataDir',
  maxNodes: 'cfg.maxNodes',
  saveDebounceMs: 'cfg.saveDebounce',
  maxResultBytes: 'cfg.maxResult',
  installSkill: 'cfg.skill',
}

const PAGE = '../src/content/docs/settings/plugin.md'
if (!existsSync(fileURLToPath(new URL(PAGE, import.meta.url)))) {
  throw new Error(`缺少页面 ${PAGE.replace('../', 'site/')}`)
}

const wire = read('../../src/shared/wire.ts')
const block = wire.match(/PLUGIN_CONFIG_KEYS\s*=\s*\[([^\]]*)\]/u)
if (block === null) throw new Error('src/shared/wire.ts 里找不到 PLUGIN_CONFIG_KEYS')
const keys = [...block[1].matchAll(/'([^']+)'/gu)].map((m) => m[1])

const i18n = read('../../src/client/i18n.ts')
const page = read(PAGE)

const problems = []
for (const key of keys) {
  const labelKey = LABEL_KEY[key]
  if (labelKey === undefined) {
    problems.push(`设置项 ${key} 没有登记界面名称：先在 scripts/check-settings.mjs 的 LABEL_KEY 里补上`)
    continue
  }
  const label = i18n.match(new RegExp(`'${labelKey}':\\s*'([^']+)'`, 'u'))?.[1]
  if (label === undefined) {
    problems.push(`i18n 里找不到 ${labelKey}`)
    continue
  }
  if (!page.includes(label)) problems.push(`设置页缺少「${label}」（设置项 ${key}）`)
}

if (problems.length > 0) {
  console.error(`check-settings 失败：\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`check-settings: ${keys.length} 项都有说明`)
