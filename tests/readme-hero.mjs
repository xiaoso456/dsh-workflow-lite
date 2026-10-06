/**
 * 把 `tests/readme/hero.html` 按 2 倍像素截成 README 的封面图：`assets/hero.zh.png`、`assets/hero.en.png`。
 *
 * 素材（tests/runs/hero/<lang>/ 下的 canvas.png、run-*.png）先用 `tests/readme-shots.mjs` 拍好。
 * 在 CDP 浏览器里另开一个标签页渲染，截完关掉，不碰 DSH 那一页。
 *
 * usage: node tests/readme-hero.mjs [zh|en]
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PAGE = pathToFileURL(join(HERE, 'readme', 'hero.html')).href
const LANGS = process.argv[2] === undefined ? ['zh', 'en'] : [process.argv[2]]
const WIDTH = 1040
const SCALE = 2

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
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: 900,
    deviceScaleFactor: SCALE,
    mobile: false,
  })
  await send('Page.enable')
  for (const lang of LANGS) {
    await send('Page.navigate', { url: `${PAGE}?lang=${lang}` })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const { result } = await send('Runtime.evaluate', {
      expression: `(async () => {
        while (!window.__heroReady) await new Promise((r) => setTimeout(r, 50))
        await Promise.all([...document.images].map((img) => img.decode()))
        return Math.ceil(document.documentElement.scrollHeight)
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    const height = result.value
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 },
      captureBeyondViewport: true,
    })
    await writeFile(join(HERE, '..', 'assets', `hero.${lang}.png`), Buffer.from(data, 'base64'))
    console.log(`✅ assets/hero.${lang}.png（${WIDTH * SCALE} × ${height * SCALE}）`)
  }
} finally {
  socket.close()
  await fetch(`${CDP_HTTP}/json/close/${target.id}`).catch(() => {})
}
