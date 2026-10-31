/**
 * 把一版的「版本更新卡片」截成图：`tests/runs/release/v<版本>.zh.png`、`v<版本>.en.png`（不进库，拿去发就行）。
 *
 * 内容来自三处：`tests/readme/release.json`（插件是什么、各版的亮点，手写）、`CHANGELOG.md`（这一版的日期，
 * 版本号必须在里面）、`package.json`（包名、缺省的版本号、仓库地址）。亮点的图标取插件自己的图标集
 * （`src/client/ui/Icon.tsx`、`stepIcons.ts`），和界面上的同一套。排版在 `tests/readme/release.html`。
 *
 * 只需要一个带 DevTools 端口的 Chrome（`node tests/lib/cdp-chrome-launch.mjs 9222`），不用起 DSH。
 * 在 CDP 浏览器里另开一个标签页渲染，截完关掉。
 *
 * 发版前想先看效果：给一个 CHANGELOG 里还没有的版本号，只要 Unreleased 一节有内容，就按它出图、日期写今天。
 *
 * usage: node tests/readme-release.mjs [版本号] [zh|en]（版本号缺省取 package.json 的）
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..')
const PAGE = pathToFileURL(join(HERE, 'readme', 'release.html')).href
const OUT = join(HERE, 'runs', 'release')
// 按手机上看来定：560 宽、2 倍像素，出图 1120 宽，发进聊天里不糊也不大。
const WIDTH = 560
const SCALE = 2
const TONES = new Set(['blue', 'green', 'gold', 'teal'])

const args = process.argv.slice(2)
const langArg = args.find((arg) => arg === 'zh' || arg === 'en')
const versionArg = args.find((arg) => /^\d+\.\d+\.\d+/u.test(arg))
const LANGS = langArg === undefined ? ['zh', 'en'] : [langArg]

/** 插件图标集：`name: 'path'`（路径可能折到下一行）。 */
async function readIcons() {
  const files = ['Icon.tsx', 'stepIcons.ts'].map((name) => join(ROOT, 'src', 'client', 'ui', name))
  const icons = new Map()
  for (const text of await Promise.all(files.map((file) => readFile(file, 'utf8')))) {
    for (const match of text.matchAll(/^\s*(\w+):\s*'([^']+)'/gmu)) icons.set(match[1], match[2])
  }
  return icons
}

async function build(lang) {
  const [changelog, spec, pkgText, icons] = await Promise.all([
    readFile(join(ROOT, 'CHANGELOG.md'), 'utf8'),
    readFile(join(HERE, 'readme', 'release.json'), 'utf8'),
    readFile(join(ROOT, 'package.json'), 'utf8'),
    readIcons(),
  ])
  const pkg = JSON.parse(pkgText)
  const { intro, versions } = JSON.parse(spec)
  const version = versionArg ?? pkg.version
  const released = new RegExp(
    `^## \\[${version.replaceAll('.', '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})`,
    'mu',
  ).exec(changelog)?.[1]
  // 发版前预览：版本号还不在 CHANGELOG 里，但 Unreleased 一节有内容，就当它是这一版、日期写今天。
  const unreleased = /^## \[Unreleased\]\s*\n+(?!## )\S/mu.test(changelog)
  if (released === undefined && !unreleased) {
    throw new Error(`CHANGELOG.md 里没有 ${version} 这一版`)
  }
  if (released === undefined) {
    console.log(`⚠ CHANGELOG 里还没有 ${version}：按 Unreleased 预览，日期写今天`)
  }
  const date = released ?? new Date().toISOString().slice(0, 10)
  const release = versions[version]?.[lang]
  if (release === undefined) throw new Error(`release.json 里没有 ${version} 的 ${lang} 内容`)
  const items = release.items.map((item) => {
    const path = icons.get(item.icon)
    if (path === undefined) throw new Error(`图标集里没有 ${item.icon}`)
    if (!TONES.has(item.tone))
      throw new Error(`tone 只能是 ${[...TONES].join(' / ')}：${item.tone}`)
    return { path, tone: item.tone, title: item.title, tag: item.tag, text: item.text }
  })
  const repo = String(pkg.repository?.url ?? '')
    .replace(/^git\+/u, '')
    .replace(/^https?:\/\//u, '')
    .replace(/\.git$/u, '')
  return {
    lang,
    pkg: pkg.name,
    version,
    date,
    cmd: `dsh plugin --profile web add ${pkg.name}@${version}`,
    repo,
    intro: intro[lang],
    headline: release.headline,
    items,
  }
}

const target = await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' }).then((r) =>
  r.json(),
)
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', () => reject(new Error('cdp socket failed')), { once: true })
})
let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  pending.get(message.id)?.(message)
  pending.delete(message.id)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, (message) =>
      message.error === undefined
        ? resolve(message.result)
        : reject(new Error(message.error.message)),
    )
    socket.send(JSON.stringify({ id, method, params }))
  })

try {
  await mkdir(OUT, { recursive: true })
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: 600,
    deviceScaleFactor: SCALE,
    mobile: false,
  })
  await send('Page.enable')
  for (const lang of LANGS) {
    const data = await build(lang)
    await send('Page.navigate', { url: PAGE })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const { result } = await send('Runtime.evaluate', {
      expression: `(async () => {
        window.render(${JSON.stringify(data)})
        await document.fonts.ready
        await Promise.all([...document.images].map((image) => image.decode()))
        return Math.ceil(document.querySelector('.card').getBoundingClientRect().height)
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    const height = result.value
    const { data: png } = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 },
      captureBeyondViewport: true,
    })
    const file = join(OUT, `v${data.version}.${lang}.png`)
    await writeFile(file, Buffer.from(png, 'base64'))
    console.log(
      `✅ tests/runs/release/v${data.version}.${lang}.png（${WIDTH * SCALE} × ${height * SCALE}）`,
    )
  }
} finally {
  socket.close()
  await fetch(`${CDP_HTTP}/json/close/${target.id}`).catch(() => {})
}
