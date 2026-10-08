/**
 * 生成 `THIRD_PARTY_NOTICES.md`——**构建时自动跑，别手改**。
 *
 * 为什么要有这份文件：浏览器侧产物 `lib/client.js` 是**内联**打包的，第三方代码的字节
 * 进了我们的发布物，就得逐条声明。打包器一条许可证正文都不带（实测 MIT / ISC / BSD-3 /
 * EPL 的正文全部没有，只剩两条短横幅，其中 React 那条还写着"完整许可证见源码树里的
 * LICENSE 文件"——等于指了个空）。而 `elkjs` 里 vendored 的 `web-worker`（Apache-2.0）
 * 连消费者的 `node_modules` 里都没有，靠"装包自带证书"兜不住。
 *
 * 为什么是生成而不是手写：内联清单跟着依赖走，手抄一定会烂。这里的事实来源有两处——
 * 源码地图（`node_modules/.pnpm/...` 里的包）与产物里的版权横幅（vendored 进预打包产物的包），
 * 两处都对不上就**报错**，绝不静默出一份过期的声明。
 *
 * usage:
 *   node scripts/notices.mjs          # 重写 THIRD_PARTY_NOTICES.md
 *   node scripts/notices.mjs --check  # 只比对，过期就非零退出（构建/测试/发版前用）
 *
 * @module scripts/notices
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PNPM = join(ROOT, 'node_modules/.pnpm')
const BUNDLE_MAP = join(ROOT, 'lib/client.js.map')
const BUNDLE = join(ROOT, 'lib/client.js')
const TARGET = join(ROOT, 'THIRD_PARTY_NOTICES.md')

/**
 * vendored 在某个依赖的预打包产物里的代码——源码地图看不到它们，只能手写事实。
 *
 * 手写的事实会被**逐条核对**（见 `assertVendored`）：产物里的横幅没了，这里就报错，
 * 不会留一条过期的声明在那儿谁也不知道。
 */
const VENDORED = [
  {
    package: 'web-worker',
    license: 'Apache-2.0',
    /** 必须在产物里找到的横幅（用来说明"这条声明有据可查"）。 */
    banner: 'Copyright 2020 Google LLC',
    note:
      '`elkjs/lib/elk.bundled.js` 里的第 4 号 browserify 模块，横幅写着 `Copyright 2020 Google LLC`。\n' +
      '`elkjs` 自己的 `dependencies` 是空的——它把这支代码直接 vendored 进去了，所以消费者的\n' +
      '`node_modules` 里既没有 `web-worker` 这个包，也没有它的 LICENSE 文件。\n' +
      '源码取自 <https://www.npmjs.com/package/web-worker>；版本随 `elkjs` 走，上游没标。',
  },
]

/** GitHub 的标题锚点：小写、去掉除连字符外的标点、空格转连字符（`EPL-2.0` → `epl-20`）。 */
const anchor = (license) => license.toLowerCase().replace(/[^\w\s-]/gu, '').replace(/\s+/gu, '-')

/** 内联进 `lib/client.js` 的包 —— 从源码地图的 sources 反查，不手抄。 */
function inlinedPackages() {
  let map
  try {
    map = JSON.parse(readFileSync(BUNDLE_MAP, 'utf8'))
  } catch {
    throw new Error(
      `读不到 ${relative(ROOT, BUNDLE_MAP)}——先跑 \`pnpm run build\`。` +
        '没有源码地图就没法确认内联了谁，这里不许猜。',
    )
  }
  const found = new Map()
  for (const source of map.sources ?? []) {
    const match = /node_modules\/\.pnpm\/(.+?)@([0-9][^/]*)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//u.exec(
      source,
    )
    if (match === null) continue
    // pnpm 的目录名带 peer 后缀（`12.12.0_@type_97cf…`），版本号只取 `_` 前面那段
    const version = match[2].split('_')[0]
    found.set(`${match[3]}@${version}`, { name: match[3], version })
  }
  if (found.size === 0) throw new Error('源码地图里一个 node_modules 包都没认出来，解析规则该更新了')
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 从 pnpm store 里读某个包自己的 package.json 与 LICENSE 正文。 */
function readPackage(name, version) {
  const prefix = `${name.replace('/', '+')}@${version}`
  for (const dir of readdirSync(PNPM).filter((entry) => entry.startsWith(prefix))) {
    const base = join(PNPM, dir, 'node_modules', name)
    try {
      const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
      const file = readdirSync(base).find((entry) => /^licen[cs]e/i.test(entry))
      return {
        license: manifest.license,
        text: file === undefined ? undefined : readFileSync(join(base, file), 'utf8'),
      }
    } catch {
      /* 换个候选目录继续找 */
    }
  }
  throw new Error(`读不到 ${name}@${version} 的 package.json / LICENSE`)
}

/** 手写的 vendored 事实必须能在产物里找到据；找不到就报错，别让过期声明留在文件里。 */
function assertVendored(bundle) {
  for (const entry of VENDORED) {
    if (!bundle.includes(entry.banner)) {
      throw new Error(
        `产物里找不到 \`${entry.banner}\` 这条横幅——${entry.package} 的声明可能已经过时，` +
          '或者它已经不再被内联了。核一遍再动 scripts/notices.mjs。',
      )
    }
  }
}

/**
 * 渲染整份声明。
 * @returns {string} `THIRD_PARTY_NOTICES.md` 的完整内容。
 */
export function renderNotices() {
  const bundle = readFileSync(BUNDLE, 'utf8')
  assertVendored(bundle)

  const packages = inlinedPackages().map((p) => ({ ...p, ...readPackage(p.name, p.version) }))

  /** 同类许可证只抄一份正文；逐字取，不改标点。 */
  const groups = new Map()
  const group = (license) => {
    if (!groups.has(license)) groups.set(license, { license, texts: new Map(), members: [] })
    return groups.get(license)
  }
  for (const p of packages) {
    const g = group(p.license)
    g.members.push(`\`${p.name}\` ${p.version}`)
    const digest = createHash('sha256').update(p.text ?? '').digest('hex').slice(0, 12)
    if (!g.texts.has(digest)) g.texts.set(digest, p.text ?? '(该包未随附许可证正文)')
  }
  for (const v of VENDORED) {
    const g = group(v.license)
    g.members.push(`\`${v.package}\``)
    // Apache-2.0 的正文随仓库放一份：那支包根本没被装出来，本地没有它的 LICENSE 可取
    if (!g.texts.has('apache')) {
      g.texts.set('apache', readFileSync(join(ROOT, 'scripts/licenses/apache-2.0.txt'), 'utf8'))
    }
  }

  const order = ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'EPL-2.0']
  const sorted = [...groups.values()].sort(
    (a, b) => order.indexOf(a.license) - order.indexOf(b.license),
  )

  let body = ''
  for (const g of sorted) {
    body += `## ${g.license}\n\n`
    if (g.license === 'EPL-2.0') {
      body +=
        '本插件发布的 `lib/client.js` 以目标代码形式内联了 `elkjs/lib/elk.bundled.js`，' +
        '而那个文件里含一份经 GWT 从 Java 编译来的 [Eclipse Layout Kernel (ELK)]' +
        '(https://www.eclipse.org/elk/)（产物字符串里能直接看到 `org.eclipse.elk`），同样按 EPL-2.0 发布。\n\n' +
        '**这两者的源码一行都没有改动过**，因此不产生 EPL-2.0 §3.2 那条"发布修改后源码"的义务。\n' +
        '按 §3.1(a)，这里说明源码从哪里取：\n\n' +
        '- elkjs 0.9.3 —— <https://github.com/kieler/elkjs>（tag `v0.9.3`）\n' +
        '- Eclipse ELK —— <https://github.com/eclipse/elk>（elkjs 各版本对应的 ELK 版本见其仓库说明）\n\n' +
        '下为 Eclipse Public License 2.0 正文。\n\n'
    }
    body += `${g.members.join('、')}\n\n`
    for (const text of g.texts.values()) body += `\`\`\`\n${text.trimEnd()}\n\`\`\`\n\n`
  }

  const rows = (list) =>
    list.map((p) => `| \`${p.name}\` | ${p.version} | [${p.license}](#${anchor(p.license)}) |`).join('\n')

  const notices = `# Third-Party Notices

本插件发布的浏览器侧产物 \`lib/client.js\` 里**内联**了下列第三方代码。

Node 侧（\`lib/index.mjs\`）不内联：\`dependencies\` 里的 \`pathe\`、\`yaml\` 与 \`@deepseek-ai/*\`
都以外部 import 的形式保留，由消费者自己的依赖树解析，它们的许可证随各自的上游包分发。

**这份文件由 \`scripts/notices.mjs\` 生成，别手改**——\`pnpm run build\` 会重写它，
\`pnpm run notices:check\` 与 \`tests/package.spec.ts\` 会盯着它有没有过期。
内联了新的包、或者产物里冒出了新的版权声明而这里没跟着变，都会红。

## 内联清单

| 包 | 版本 | 许可证 |
|---|---|---|
${rows(packages)}

## 随依赖的预打包产物一起进来的

${VENDORED.map((v) => v.note).join('\n\n')}

| 包 | 版本 | 许可证 |
|---|---|---|
${rows(VENDORED.map((v) => ({ name: v.package, version: '未标明', license: v.license })))}

${body}`

  // 产物里冒出的每一条版权行都得在声明里有出处。这条兜的是生成器**自己看不见**的东西：
  // 某个依赖在自己打好的包里又 vendored 了一支代码，源码地图对它一无所知。真碰上了就红，
  // 让人去核一遍（多半是要往 VENDORED 里加一条），而不是静默出一份漏了人的声明。
  const unaccounted = copyrightLines().filter((line) => !notices.includes(line))
  if (unaccounted.length > 0) {
    throw new Error(
      `产物里这些版权行在声明里找不到出处：\n  ${unaccounted.join('\n  ')}\n` +
        '多半是某个依赖的预打包产物里又 vendored 了一支代码——核清楚它是什么，' +
        '再往 scripts/notices.mjs 的 VENDORED 里加一条。',
    )
  }

  return notices
}

/** 产物里出现过的版权行——用来盯住"冒出了新的第三方代码而声明没跟上"。 */
export function copyrightLines() {
  const bundle = readFileSync(BUNDLE, 'utf8')
  const found = new Set()
  for (const match of bundle.matchAll(/Copyright[^\n]{0,100}/gu)) {
    found.add(match[0].replace(/\s+/gu, ' ').replace(/[.,;]\s*$/u, '').trim())
  }
  return [...found].sort()
}

if (process.argv[1] !== undefined && /notices\.mjs$/u.test(process.argv[1])) {
  const rendered = renderNotices()
  const current = (() => {
    try {
      return readFileSync(TARGET, 'utf8')
    } catch {
      return undefined
    }
  })()
  if (process.argv.includes('--check')) {
    if (current !== rendered) {
      console.error('THIRD_PARTY_NOTICES.md 与构建产物对不上了：跑 `node scripts/notices.mjs` 重写一遍。')
      process.exit(1)
    }
    console.log('THIRD_PARTY_NOTICES.md 是最新的。')
  } else {
    writeFileSync(TARGET, rendered)
    console.log(
      `写了 THIRD_PARTY_NOTICES.md：${rendered.split('\n').length} 行，` +
        `${(rendered.length / 1024).toFixed(1)} KiB` +
        `${current === rendered ? '（内容没变）' : ''}`,
    )
  }
}
