/**
 * 把 README 里的「版本线」截成图：`assets/versions.zh.png`、`assets/versions.en.png`。
 *
 * 内容来自三处：`tests/readme/versions.json`（挑出的重要变化，一条一站，各写落在哪个版本、标题、一句话，手写）、
 * `CHANGELOG.md`（核对版本号都存在；Unreleased 有没有内容）、`package.json`（现在是哪一版，亮那一版的站）。
 * 版本线按变化的先后等距排，不按日期；每站都标版本号（改过几个版本的写成 v起~v止）。排版在 `tests/readme/versions.html`，页里只管画，数据在这里算好递进去。
 *
 * 只需要一个带 DevTools 端口的 Chrome（`node tests/lib/cdp-chrome-launch.mjs 9222`），不用起 DSH。
 * 在 CDP 浏览器里另开一个标签页渲染，截完关掉。
 *
 * 还没定版本的规划写 `"planned"`：排在最后，不核对 CHANGELOG，也不参与「现在是哪一版」。
 *
 * 会报错的情况（图和文档对不上就不出图）：json 里写了 CHANGELOG 里没有的版本；
 * CHANGELOG 里有比 json 新的小版本（0.x.0 以上）没写进 json——提醒补上它的重要变化。
 *
 * usage: node tests/readme-versions.mjs [zh|en]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..')
const PAGE = pathToFileURL(join(HERE, 'readme', 'versions.html')).href
const LANGS = process.argv[2] === undefined ? ['zh', 'en'] : [process.argv[2]]
const WIDTH = 1040
const SCALE = 2

const LABELS = {
  zh: { current: '当前', next: '未发布', planned: '规划中' },
  en: { current: 'Latest', next: 'Unreleased', planned: 'Planned' },
}

const compare = (a, b) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** 不是发布过的版本号：还没发（next）、还没定版本（planned）。 */
const UNNUMBERED = new Set(['next', 'planned'])

/** CHANGELOG 里的各版：版本号 → 日期；再加 Unreleased 下面有没有写东西。 */
function readChangelog(text) {
  const dates = new Map()
  for (const match of text.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/gmu)) {
    dates.set(match[1], match[2])
  }
  const unreleased = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/mu.exec(text)
  return { dates, hasUnreleased: unreleased !== null && unreleased[1].trim().length > 0 }
}

async function build(lang) {
  const [changelog, spec, pkg] = await Promise.all([
    readFile(join(ROOT, 'CHANGELOG.md'), 'utf8'),
    readFile(join(HERE, 'readme', 'versions.json'), 'utf8'),
    readFile(join(ROOT, 'package.json'), 'utf8'),
  ])
  const { dates, hasUnreleased } = readChangelog(changelog)
  const { stops } = JSON.parse(spec)
  const installed = JSON.parse(pkg).version

  for (const stop of stops) {
    for (const version of [stop.version, stop.to]) {
      if (version !== undefined && !UNNUMBERED.has(version) && !dates.has(version)) {
        throw new Error(`versions.json 里的 ${version} 在 CHANGELOG.md 里找不到`)
      }
    }
  }
  /** 一站排在哪个版本上：写了 to 的按 to（改到的最后一版）算。 */
  const at = (stop) => stop.to ?? stop.version
  const listed = stops.filter((stop) => !UNNUMBERED.has(at(stop))).map(at)
  const newest = listed.sort(compare).at(-1) ?? '0.0.0'
  const missed = [...dates.keys()].filter(
    (version) => version.endsWith('.0') && compare(version, newest) > 0,
  )
  if (missed.length > 0) {
    throw new Error(`CHANGELOG.md 里有新的小版本没写进 versions.json：${missed.join('、')}`)
  }

  const shown = stops.filter((stop) => stop.version !== 'next' || hasUnreleased)
  // 最新发布的那一版（不晚于 package.json 版本的最后一个版本号；发了补丁版而没有单独一站时，亮它所属的那一版）。
  const released = [...new Set(shown.filter((stop) => !UNNUMBERED.has(stop.version)).map(at))]
  const current = released
    .filter((version) => compare(version, installed) <= 0)
    .sort(compare)
    .at(-1)
  return {
    lang,
    labels: LABELS[lang],
    stops: shown.map((stop) => ({
      label:
        stop.label ??
        (stop.version === 'next'
          ? 'next'
          : stop.version === 'planned'
            ? 'later'
            : stop.to === undefined
              ? `v${stop.version}`
              : `v${stop.version}~v${stop.to}`),
      state: UNNUMBERED.has(stop.version)
        ? stop.version
        : at(stop) === current
          ? 'current'
          : 'past',
      title: stop[lang].title,
      tag: stop[lang].tag,
      lines: stop[lang].lines,
    })),
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: 400,
    deviceScaleFactor: SCALE,
    mobile: false,
  })
  // 背景透明：卡片的圆角之外不留底色。
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  await send('Page.enable')
  for (const lang of LANGS) {
    const data = await build(lang)
    await send('Page.navigate', { url: PAGE })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const { result } = await send('Runtime.evaluate', {
      expression: `(async () => {
        window.render(${JSON.stringify(data)})
        await document.fonts.ready
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
    await writeFile(join(ROOT, 'assets', `versions.${lang}.png`), Buffer.from(png, 'base64'))
    console.log(
      `✅ assets/versions.${lang}.png（${WIDTH * SCALE} × ${height * SCALE}，${data.stops.length} 站）`,
    )
  }
} finally {
  socket.close()
  await fetch(`${CDP_HTTP}/json/close/${target.id}`).catch(() => {})
}
