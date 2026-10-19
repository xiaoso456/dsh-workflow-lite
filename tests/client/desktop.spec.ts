import { describe, expect, it, vi } from 'vitest'
import { createDesktop, type DesktopApp, type SessionRemote } from '../../src/client/app/desktop.ts'

const app = (id: string): DesktopApp => ({ id, name: id, default: false, icon: null })

function remoteOf(
  lookup: (path: string) => Promise<{ ok: true; value: readonly DesktopApp[] } | { ok: false }>,
): SessionRemote & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    canOpenWorkspacePath: async () => ({ ok: true, value: true }),
    workspacePathApplications: ({ path }) => {
      calls.push(path)
      return lookup(path)
    },
    openWorkspacePath: async () => ({ ok: true, value: null }),
  }
}

describe('desktop 程序表缓存', () => {
  it('同扩展名只问一次，换扩展名才再问', async () => {
    const remote = remoteOf(async () => ({ ok: true, value: [app('viewer')] }))
    const desktop = createDesktop()
    desktop.attach(remote)
    const signal = new AbortController().signal
    expect(desktop.cached('C:\\a\\one.PNG')).toBeUndefined()
    await desktop.applications('C:\\a\\one.PNG', signal)
    expect(desktop.cached('/b/two.png')?.[0]?.id).toBe('viewer')
    await desktop.applications('/b/two.png', signal)
    await desktop.applications('/b/three.md', signal)
    expect(remote.calls).toEqual(['C:\\a\\one.PNG', '/b/two.png', '/b/three.md'])
  })

  it('同类文件正在查就并进去，不重复问', async () => {
    const release: Array<() => void> = []
    const remote = remoteOf(
      () =>
        new Promise((resolve) => {
          release.push(() => resolve({ ok: true, value: [app('x')] }))
        }),
    )
    const desktop = createDesktop()
    desktop.attach(remote)
    desktop.warm('/a/1.txt')
    const second = desktop.applications('/a/2.txt', new AbortController().signal)
    expect(remote.calls).toHaveLength(1)
    release[0]?.()
    expect((await second)?.[0]?.id).toBe('x')
  })

  it('查失败不记，下次还会再问；没有扩展名的按完整路径记', async () => {
    const lookup = vi
      .fn<(path: string) => Promise<{ ok: true; value: readonly DesktopApp[] } | { ok: false }>>()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true, value: [] })
    const remote = remoteOf(lookup)
    const desktop = createDesktop()
    desktop.attach(remote)
    const signal = new AbortController().signal
    expect(await desktop.applications('/a/x.zip', signal)).toBeNull()
    expect(desktop.cached('/a/y.zip')).toBeUndefined()
    await desktop.applications('/a/x.zip', signal)
    expect(desktop.cached('/a/y.zip')).toEqual([])
    await desktop.applications('/a/Makefile', signal)
    expect(desktop.cached('/b/Makefile')).toBeUndefined()
  })

  it('重新接上宿主后清掉旧表', async () => {
    const remote = remoteOf(async () => ({ ok: true, value: [app('a')] }))
    const desktop = createDesktop()
    desktop.attach(remote)
    await desktop.applications('/a/x.png', new AbortController().signal)
    desktop.attach(remote)
    expect(desktop.cached('/a/x.png')).toBeUndefined()
  })
})
