/**
 * skill `workflow-trigger` 随包发布的那个目录：注册时正文取 `SKILL.md`、参考文件经 `resourceBase` 交给 DSH；
 * 正文点到的文件都在、目录里的文件都被点到；示例脚本至少语法对（监视的例子照文档原样跑一遍在 triggerExamples.spec.ts）。
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  registerTriggerSkill,
  TRIGGER_SKILL,
  TRIGGER_SKILL_PATH,
  triggerSkillDir,
} from '../../src/host/triggerSkill.ts'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIR = join(ROOT, TRIGGER_SKILL_PATH)

/** 目录下所有 .md（相对目录、用 `/` 分隔）。 */
function files(dir = DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : entry.name.endsWith('.md')
        ? [relative(DIR, join(dir, entry.name)).replaceAll('\\', '/')]
        : [],
  )
}

const read = (rel: string): string => readFileSync(join(DIR, rel), 'utf8')
const main = read('SKILL.md')

describe('skill workflow-trigger', () => {
  it('从源码位置找得到随包的目录', () => {
    expect(triggerSkillDir()).toBe(DIR)
  })

  it('注册：正文是 SKILL.md，参考文件的目录交给 resourceBase', () => {
    let registered: Record<string, unknown> | undefined
    const ctx = {
      skills: {
        register: (skill: Record<string, unknown>) => {
          registered = skill
          return () => {}
        },
      },
    }
    expect(typeof registerTriggerSkill(ctx as never)).toBe('function')
    expect(registered?.name).toBe(TRIGGER_SKILL)
    expect(registered?.content).toBe(main)
    expect(registered?.resourceBase).toEqual({ kind: 'directory', path: DIR })
  })

  it('正文点到的文件都在，目录里的文件都被正文点到', () => {
    const named = new Set(
      [...main.matchAll(/`((?:examples\/)?[\w-]+\.md)`/gu)].map((match) => match[1] as string),
    )
    const present = files().filter((file) => file !== 'SKILL.md')
    for (const file of named) expect(present, `SKILL.md 点到的 ${file} 不在`).toContain(file)
    for (const file of present) expect([...named], `${file} 没被 SKILL.md 点到`).toContain(file)
  })

  it('参考文件之间点到的也都在（路径相对 skill 目录）', () => {
    const present = new Set(files())
    for (const file of files()) {
      for (const match of read(file).matchAll(/`((?:\.\.\/|examples\/)?[\w-]+\.md)`/gu)) {
        expect(present.has(match[1] as string), `${file} 点到的 ${match[1]} 不在`).toBe(true)
      }
    }
  })

  it('随包发布：package.json 的 files 收了这个目录', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      files: string[]
    }
    expect(manifest.files).toContain(`${TRIGGER_SKILL_PATH.replaceAll('\\', '/')}/**/*.md`)
    expect(manifest.files).toContain(`${TRIGGER_SKILL_PATH.replaceAll('\\', '/')}/kit/*.mjs`)
  })

  it('监视的底子 kit/watch.mjs：在、能过 node --check；kit.md 讲的是它，正文点到 kit.md；示例 import 的名字它都导出了', () => {
    expect(() =>
      execFileSync(process.execPath, ['--check', join(DIR, 'kit', 'watch.mjs')], { stdio: 'pipe' }),
    ).not.toThrow()
    expect(read('kit.md')).toContain('`kit/watch.mjs`')
    expect(main).toContain('`kit.md`')
    const kit = read('kit/watch.mjs')
    let imports = 0
    for (const file of files()) {
      for (const match of read(file).matchAll(/import \{([^}]+)\} from '\.\.\/watch\.mjs'/gu)) {
        for (const name of (match[1] as string)
          .split(',')
          .map((item) => item.trim())
          .filter((name) => /^[A-Za-z_$][\w$]*$/u.test(name))) {
          imports += 1
          expect(kit, `${file} 用到的 ${name}`).toMatch(
            new RegExp(`export (async )?(function|const) ${name}\\b`, 'u'),
          )
        }
      }
    }
    expect(imports).toBeGreaterThan(10)
  })

  it('找示例：「找示例」一节列全了所有示例，流程和自检都指向它；各参考文件也点到要照着改的示例', () => {
    const section = main.slice(main.indexOf('## 找示例'), main.indexOf('## 背景信息'))
    expect(section.startsWith('## 找示例')).toBe(true)
    for (const file of files().filter((file) => file.startsWith('examples/'))) {
      expect(section, `「找示例」没列 ${file}`).toContain(`\`${file}\``)
    }
    const steps = main.slice(main.indexOf('## 流程'), main.indexOf('## 选触发方式'))
    expect(steps).toContain('「找示例」')
    expect(main.slice(main.indexOf('## 交付前自检'))).toContain('「找示例」')
    const guides = [
      'listen.md',
      'schedule.md',
      'http.md',
      'after.md',
      'scripts.md',
      'kit.md',
      'fast.md',
    ]
    for (const file of guides)
      expect(read(file), `${file} 没点到示例`).toMatch(/`examples\/[\w-]+\.md`|「找示例」/u)
  })

  it('监视的示例都用底子：卡片目录里的脚本 import 自 ../watch.mjs，不自己再写一份 emit', () => {
    for (const file of files().filter((file) => file.startsWith('examples/'))) {
      const text = read(file)
      expect(text, `${file} 自己写了 emit`).not.toMatch(/const emit =|console\.log\(`::trigger::/u)
      if (/^# .*（监视/u.test(text) && text.includes('```js')) {
        expect(text, `${file} 没用底子`).toContain("from '../watch.mjs'")
      }
    }
  })

  it('这种触发方式叫「监视」（和界面一致）；「监听」只用在 HTTP 的监听地址', () => {
    for (const file of files()) {
      const stray = read(file)
        .split('\n')
        .filter((line) => line.replaceAll('监听地址', '').includes('监听'))
      expect(stray, file).toEqual([])
    }
  })

  it('示例里的 JS 都能过 node --check', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'wl-trigger-skill-'))
    try {
      let count = 0
      for (const file of files()) {
        for (const match of read(file).matchAll(/```js\n([\s\S]*?)```/gu)) {
          const path = join(scratch, `${String(count++)}.mjs`)
          writeFileSync(path, match[1] as string)
          expect(() =>
            execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }),
          ).not.toThrow()
        }
      }
      expect(count).toBeGreaterThan(5)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
