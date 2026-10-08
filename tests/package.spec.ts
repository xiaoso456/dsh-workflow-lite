import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Supported DSH line: every 0.2.0 build (rc / beta / final) and nothing past it.
// DSH checks peers with `includePrerelease`, so `^` would also admit 0.2.x.
const DSH_RANGE = '>=0.2.0-0 <0.2.1-0'
const BADGE = 'DeepSeek%20Harness-0.2.0--x-'

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json')) as Record<string, Record<string, string>>
const isDsh = (name: string) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')

describe('DSH version pinning', () => {
  it('declares one 0.2.0-x range for every DSH peer', () => {
    const peers = Object.entries(pkg.peerDependencies).filter(([name]) => isDsh(name))
    expect(peers.length).toBeGreaterThan(0)
    for (const [name, range] of peers) expect(range, name).toBe(DSH_RANGE)
  })

  it('builds against exact 0.2.0 versions, never a range', () => {
    const dev = Object.entries(pkg.devDependencies).filter(
      ([name]) => isDsh(name) || name === '@deepseek-ai/cordis',
    )
    for (const [name, version] of dev)
      expect(version, name).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/)
    for (const [name, version] of dev.filter(([n]) => isDsh(n)))
      expect(version, name).toMatch(/^0\.2\.0(-|$)/)
  })

  it('shows the same line in both README badges', () => {
    for (const file of ['README.md', 'README.en.md']) expect(read(file), file).toContain(BADGE)
  })
})

// 宿主（0.2.0-rc.2）展示插件时：标题描述读导出的 locale，`package.json.icon` 单独读成一张 data URL。
// 它只收清单目录下的相对路径，只认 SVG / PNG / JPEG / WebP，最大 256 KiB；越界的处理是留一条诊断
// 然后在界面上静默回退成默认图——所以这几条规矩得由测试钉住，不能靠肉眼。
const ICON_LIMIT = 256 * 1024
const PACKAGE_ROOT = realpathSync(fileURLToPath(new URL('../', import.meta.url)))

/** 最小的 glob：只认 `*`（一段之内）与 `**`（跨段），够用来问一句 files 收没收下这个文件。 */
function coveredByFiles(relPath: string, files: readonly string[]): boolean {
  const asRegExp = (glob: string): RegExp => {
    const segment = (part: string): string =>
      part.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*')
    return new RegExp(`^${glob.split('**').map(segment).join('.*')}$`, 'u')
  }
  return files.some((glob) => asRegExp(glob).test(relPath))
}

describe('插件图标', () => {
  const manifest = JSON.parse(read('package.json')) as { icon?: string; files?: string[] }
  const icon = manifest.icon ?? ''
  const relPath = icon.replace(/^\.\//u, '')
  /** 图标在盘上的真实路径；路径不合法时这里抛，交给断言去报。 */
  const iconOnDisk = (): string =>
    realpathSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)))

  it('顶层 icon 是包内相对路径，指着一张真图', () => {
    expect(icon, 'package.json 顶层 icon').toMatch(/^\.\/.+\.(svg|png|jpe?g|webp)$/u)
    expect(icon, '宿主不收绝对路径与 URL').not.toMatch(/^(\/|[a-z][a-z0-9+.-]*:)/iu)
    expect(() => iconOnDisk()).not.toThrow()
    expect(statSync(iconOnDisk()).isFile()).toBe(true)
    expect(iconOnDisk().startsWith(PACKAGE_ROOT), '路径不许跳出清单目录').toBe(true)
  })

  it('不超过宿主的 256 KiB 上限，也不是一张空图', () => {
    const { size } = statSync(iconOnDisk())
    expect(size, '超限时宿主留一条诊断、界面上静默换成默认图').toBeLessThanOrEqual(ICON_LIMIT)
    expect(size).toBeGreaterThan(1024)
  })

  it('本体与扩展名对得上：没被截断，也没改过名', () => {
    const bytes = readFileSync(iconOnDisk())
    const ext = extname(relPath).toLowerCase()
    if (ext === '.webp') {
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
      expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP')
      expect(bytes.readUInt32LE(4), 'RIFF 长度字段 = 文件长度 - 8').toBe(bytes.length - 8)
    } else if (ext === '.png') {
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(bytes.subarray(-12).toString('hex'), 'PNG 结尾要有完整的 IEND 块').toBe(
        '0000000049454e44ae426082',
      )
    } else if (ext === '.svg') {
      expect(bytes.toString('utf8')).toContain('<svg')
    } else {
      expect(bytes.subarray(0, 3).toString('hex'), 'JPEG 以 SOI 开头').toBe('ffd8ff')
    }
  })

  it('随包发布：files 里能覆盖到它', () => {
    expect(coveredByFiles(relPath, manifest.files ?? [])).toBe(true)
  })

  // 两张图同一份底稿、只差裁没裁，最容易被"顺手统一"成一张。分工是刻意的：
  // 插件图标要脸大（缩略图里认得出人），README 头图要完整（别把构图裁掉）。
  it('README 引完整那张，插件图标引裁过的那张', () => {
    for (const file of ['README.md', 'README.en.md']) {
      const html = read(file)
      expect(html, `${file} 该引整幅不裁的完整版`).toContain('src="./assets/icon-full.webp"')
      expect(html, `${file} 引了插件图标：那张裁过，README 要完整的`).not.toContain(
        'src="./assets/icon.webp"',
      )
    }
  })
})

/**
 * 打包守卫：**清单广告出去的每一条路径，发布物里都必须真的存在**。
 *
 * 先例是隔壁 `dsh-bash-plus` 踩过的那个坑（v0.1.7-beta.0）：`build` 先跑 `tsc` 生成
 * `lib/types`，紧接着 `tsdown` 把自己的 outDir 整个清掉——声明文件在打包前就没了，
 * 而 `types` / `exports[*].types` 还指着 `lib/types/**`，用户装上就报
 * `TS7016: Could not find a declaration file`。这类错不会让构建失败，只会让包坏掉。
 *
 * 需要构建产物，所以没构建过时（干净 checkout）整块跳过，而不是判红。
 */
describe.skipIf(!existsSync(fileURLToPath(new URL('../lib/index.mjs', import.meta.url))))(
  '打包守卫',
  () => {
    const manifest = JSON.parse(read('package.json')) as {
      types?: string
      files?: string[]
      exports?: Record<string, string | { types?: string; default?: string }>
    }
    const onDisk = (rel: string) =>
      fileURLToPath(new URL(`../${rel.replace(/^\.\//u, '')}`, import.meta.url))

    /** 清单广告出去的所有 `.d.ts` 入口。 */
    const advertisedDeclarations = (): string[] => {
      const declared: Array<string | undefined> = [manifest.types]
      for (const target of Object.values(manifest.exports ?? {})) {
        if (typeof target === 'object' && target !== null) declared.push(target.types)
        else declared.push(target)
      }
      return declared
        .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.d.ts'))
        .map((entry) => entry.replace(/^\.\//u, ''))
    }

    /** 一份 `.d.ts` 里写着的相对 import 说明符。 */
    const relativeSpecifiers = (file: string): string[] =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/gu)].map(
        (match) => match[1] as string,
      )

    /** `lib/types/a/b.d.ts` + `./c.ts` → `lib/types/a/c.d.ts`；非 `.ts` 的说明符不管。 */
    const declarationTarget = (from: string, specifier: string): string | null =>
      specifier.endsWith('.ts')
        ? resolve(dirname(from), `${specifier.slice(0, -'.ts'.length)}.d.ts`)
        : null

    it('广告了根与客户端的声明入口', () => {
      const advertised = advertisedDeclarations()
      expect(advertised).toContain('lib/types/index.d.ts')
      expect(advertised).toContain('lib/types/client/index.d.ts')
    })

    it.each(advertisedDeclarations())('发布物里有 %s，而且不是空文件', (file) => {
      const path = onDisk(file)
      expect(existsSync(path), `${file} 被 package.json 广告了，却没有产出`).toBe(true)
      expect(statSync(path).size).toBeGreaterThan(0)
    })

    it('声明之间的相对引用都指得到实处', () => {
      const pending = advertisedDeclarations().map(onDisk)
      const visited = new Set<string>()
      const dangling: string[] = []
      while (pending.length > 0) {
        const current = pending.pop() as string
        if (visited.has(current)) continue
        visited.add(current)
        for (const specifier of relativeSpecifiers(current)) {
          const target = declarationTarget(current, specifier)
          if (target === null) continue
          if (existsSync(target)) pending.push(target)
          else dangling.push(`${relative(PACKAGE_ROOT, current)} → ${specifier}`)
        }
      }
      expect(dangling).toEqual([])
      // 走查真的跟进去了，而不是停在入口。拿"去重后的入口数"当基准，不钉死具体是哪个深模块——
      // 钉死会变成一改就红的装饰。
      const entries = new Set(advertisedDeclarations().map(onDisk))
      expect(visited.size, '相对引用没被跟进去，这条检查就是空过的').toBeGreaterThan(entries.size)
    })

    it('exports 里指到具体文件的每一处都真存在', () => {
      const concrete = Object.entries(manifest.exports ?? {}).filter(([key]) => !key.includes('*'))
      expect(concrete.length).toBeGreaterThan(0)
      for (const [key, target] of concrete) {
        const file = typeof target === 'string' ? target : target.default
        expect(file, `${key} 没有 default`).toBeTruthy()
        expect(existsSync(onDisk(file as string)), `${key} → ${String(file)} 不存在`).toBe(true)
      }
    })

    it('README 里引用的本地图都在 files 里，npm 上不会裂图', () => {
      const referenced = new Set<string>()
      for (const file of ['README.md', 'README.en.md']) {
        for (const match of read(file).matchAll(/src="\.\/([^"]+)"/gu))
          referenced.add(match[1] as string)
      }
      expect(referenced.size, '两版 README 至少各引用一张图').toBeGreaterThan(0)
      for (const rel of referenced) {
        expect(
          coveredByFiles(rel, manifest.files ?? []),
          `${rel} 被 README 引用却不在 files 里`,
        ).toBe(true)
      }
    })
  },
)

/**
 * 第三方声明不许过期。
 *
 * `lib/client.js` 是**内联**打包的：第三方代码的字节进了我们的发布物，就得逐条声明。
 * 声明本身由 `scripts/notices.mjs` 生成（`pnpm run build` 会重写它），这里只管它跟产物对不对得上——
 * 规则不在这儿重抄一遍，直接跑生成器自己的 `--check`：内联清单变了、产物里冒出了没处交代的
 * 版权行（依赖的预打包产物里又 vendored 了一支代码），都归它报。
 * 需要构建产物，没构建过就跳过。
 */
describe.skipIf(!existsSync(fileURLToPath(new URL('../lib/client.js.map', import.meta.url))))(
  '第三方声明',
  () => {
    it('与构建产物对得上（跑生成器的 --check）', () => {
      const root = fileURLToPath(new URL('../', import.meta.url))
      const run = (args: string[]) =>
        spawnSync(process.execPath, [join(root, 'scripts/notices.mjs'), ...args], {
          cwd: root,
          encoding: 'utf8',
        })

      // 先确认它真的会读产物：把声明临时改脏，--check 必须非零退出
      const before = read('THIRD_PARTY_NOTICES.md')
      writeFileSync(
        fileURLToPath(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)),
        `${before}\n<!-- 探针：故意改脏 -->\n`,
      )
      try {
        const dirty = run(['--check'])
        expect(dirty.status, '声明被改脏了 --check 却过了，这条检查是空过的').not.toBe(0)
      } finally {
        writeFileSync(fileURLToPath(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)), before)
      }

      const clean = run(['--check'])
      expect(clean.status, `--check 没过：${clean.stderr || clean.stdout}`).toBe(0)
    })
  },
)
