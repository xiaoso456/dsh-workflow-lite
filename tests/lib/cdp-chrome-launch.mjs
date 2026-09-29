/**
 * 启动一个私有 headless Chrome（带 DevTools 端口），给 `tests/cdp-*.mjs` 用。
 *
 * Chrome 在**前台**跑、stdio 转发，所以外围的 shell / 后台作业拥有整棵进程树：
 * 停作业（或 Ctrl-C）就停 Chrome，不留孤儿浏览器。
 *
 * usage: node tests/lib/cdp-chrome-launch.mjs <port> [profileDir]
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const port = process.argv[2] ?? '9222'
const profile = resolve(process.argv[3] ?? join(tmpdir(), `dsh-cdp-chrome-${port}`))
mkdirSync(profile, { recursive: true })

const args = [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
]

console.log(`[cdp-chrome-launch] "${CHROME}" ${args.join(' ')}`)
const child = spawn(CHROME, args, { stdio: 'inherit' })
console.log(`[cdp-chrome-launch] chrome pid ${child.pid}`)
child.on('error', (error) => {
  process.stderr.write(`[cdp-chrome-launch] chrome failed to start: ${error.message}\n`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  console.log(`[cdp-chrome-launch] chrome exited code=${code} signal=${signal}`)
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill())
}
