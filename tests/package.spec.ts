import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname } from 'node:path'
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
})
