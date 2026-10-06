import { readFileSync } from 'node:fs'
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
