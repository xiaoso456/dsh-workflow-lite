/**
 * 导入导出的真浏览器验收：工作流中心「工作流」页，结论以磁盘 / RPC 为准。
 *
 * 建一张读一个绝对路径文件（再加一个本机已装的 skill，有的话）的工作流、存一版 →
 * 导出：选版本 → 资源清单（文件缺省勾上）→ 下载 zip →
 * 导入同一个包：名字撞了，另存为新名字（预览里写明资料放到哪、skill 内容一样跳过）→ 确认卡 → 落盘、图里改成 {workflow}/… →
 * 再导入一次，选并入：版本全都重复，不再存。
 * 图里另有两张触发卡片（一张跑命令、关着；一张定时、开着），卡片目录里有脚本、密钥、脚本数据：
 * 导出清单里卡片缺省都带、密钥和数据缺省不带、去掉跑命令的那张脚本就不带；包里的开关都是关的；
 * 导入预览写出几张卡片、带了密钥；导入后脚本、密钥落进新工作流的卡片目录。
 * 另外导出成 skill：换到「Skill」→ 单选版本 → 资源 → Skill 信息（名字、预填的描述、SKILL.md 预览）→
 * 下载 zip（看包里的布局）→ 装到本机 → 再装一次要先确认覆盖。
 *
 * 导入不往 `~/.agents/skills` 写东西：只引用本机已经装着的 skill（导回来是「内容一样，跳过」）。
 * 导出成 skill 的「装到本机」会写：用一个一次性的名字（`wl-cdp-…`），验完删掉。
 *
 * usage: DSH_WEB_TOKEN=<token> DSH_BASE=http://127.0.0.1:3190 node --experimental-strip-types tests/cdp-pack.mjs
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { assetsDir } from '../src/host/store/paths.ts'
import { bootToCanvas, screenshot, setReactInput } from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'

const NAME = `pack-${Date.now().toString(36)}`
const COPY = `${NAME}-copy`
const DOWNLOADS = resolve('tests/runs/pack-downloads')
const EXT = join(tmpdir(), `${NAME}-ext`)
const SPEC = join(EXT, 'spec.md').replace(/\\/gu, '/')
/** 导出成 skill 用的名字（装到本机的那份验完删掉）。 */
const SKILL = `wl-cdp-${Date.now().toString(36)}`
let installedAt = null
const sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))

let step = 0
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
function pass(message) {
  step += 1
  console.log(`  ${String(step).padStart(2)} ${message}`)
}

const exists = (testId) => `document.querySelector('[data-testid="${testId}"]') !== null`
const gone = (testId) => `document.querySelector('[data-testid="${testId}"]') === null`
const clickTestId = (testId) =>
  `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) return false; el.click(); return true })()`
const textOf = (testId) =>
  `(document.querySelector('[data-testid="${testId}"]')?.textContent || '')`
const hubRow = (name) => `[data-testid="wl-hub-wf"][data-value=${JSON.stringify(name)}]`

/** 插件现在用的数据目录（`~` 开头的换成家目录）。 */
async function dataDir() {
  const dir = (await rpc('config/get', {})).values.dataDir
  return dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir
}

/** 一个工作流里一张触发卡片的目录。 */
const cardHome = (data, workflow, node) => join(assetsDir(data, workflow), 'triggers', node)

/** 文件在不在。 */
const present = (path) =>
  stat(path).then(
    () => true,
    () => false,
  )

/** 本机已经装在 ~/.agents/skills 里、模型能用的一个 skill（没有就不带 skill）。 */
async function installedSkill() {
  const { skills } = await rpc('host/skills', {})
  return skills.find((skill) => skill.path?.includes('/.agents/skills/'))?.name
}

async function waitDownload(timeoutMs = 20_000, suffix = '.wflite.zip') {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const names = await readdir(DOWNLOADS).catch(() => [])
    const done = names.find((name) => name.endsWith(suffix))
    if (done !== undefined) return join(DOWNLOADS, done)
    await sleep(250)
  }
  throw new Error('FAIL: 等不到下载的包')
}

/** 给导入页的文件框塞一个文件（等同用户选了它）。 */
async function chooseFile(session, path) {
  const { root } = await session.send('DOM.getDocument', { depth: 0 })
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-testid="wl-pack-file"]',
  })
  check(nodeId !== 0, '应有文件选择框')
  await session.send('DOM.setFileInputFiles', { nodeId, files: [path] })
}

async function confirmImport(session) {
  await waitFor(session, `!document.querySelector('[data-testid="wl-pack-do-import"]').disabled`)
  await session.evaluate(clickTestId('wl-pack-do-import'))
  await waitFor(session, exists('wl-pack-confirm-pop'))
  await sleep(400)
  await screenshot(session, 'pack-05-confirm.png')
  await session.evaluate(clickTestId('wl-pack-confirm'))
  await waitFor(session, exists('wl-pack-notice'), { timeoutMs: 30_000 })
}

async function run(session) {
  console.log(`# 导入导出验收：${NAME}`)
  await mkdir(EXT, { recursive: true })
  await writeFile(join(EXT, 'spec.md'), '# 需求\n')
  await rm(DOWNLOADS, { recursive: true, force: true })
  await mkdir(DOWNLOADS, { recursive: true })
  const skill = await installedSkill()

  await rpc('graph/create', { name: NAME })
  const data = await dataDir()
  // 跑命令那张卡片的目录：脚本、密钥、脚本自己记的东西。
  const inbox = cardHome(data, NAME, 'inbox')
  await mkdir(join(inbox, 'secrets'), { recursive: true })
  await mkdir(join(inbox, 'data'), { recursive: true })
  await writeFile(join(inbox, 'tick.mjs'), 'setInterval(() => {}, 60_000)\n')
  await writeFile(join(inbox, 'secrets', 'token.txt'), 'example-token\n')
  await writeFile(join(inbox, 'data', 'seen.json'), '[]\n')
  const loaded = await rpc('graph/load', { name: NAME })
  const items = [{ kind: 'file', value: SPEC }]
  if (skill !== undefined) items.push({ kind: 'skill', value: skill })
  await rpc('graph/save', {
    name: NAME,
    baseHash: loaded.hash,
    document: {
      nodes: [
        { id: 'docs', type: 'wfResource', position: { x: 0, y: 0 }, data: { items } },
        { id: 'a', type: 'wfNode', position: { x: 480, y: 0 }, data: { prompt: '读需求' } },
        {
          id: 'inbox',
          type: 'wfTrigger',
          position: { x: 0, y: -320 },
          data: {
            label: '收件',
            source: { kind: 'listen', command: 'node tick.mjs' },
            workspace: EXT,
          },
        },
        {
          id: 'nightly',
          type: 'wfTrigger',
          position: { x: 480, y: -320 },
          data: {
            label: '夜巡',
            source: { kind: 'schedule', schedule: { kind: 'daily', time: '03:00' } },
            workspace: EXT,
            enabled: true,
          },
        },
      ],
      edges: [
        { id: 'docs->a', source: 'docs', target: 'a', sourceHandle: null, targetHandle: null },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  })

  // 画布打开时会把叠在一起的卡片挪开（会改图），所以等它安顿好了再存版本。
  // `DSH_SESSION_TITLE`：一次性实例里按标题找会话（新建的会话行显示「刚刚」，按相对时间找不到）。
  await bootToCanvas(session, NAME, { sessionTitle: process.env.DSH_SESSION_TITLE })
  await sleep(1500)
  await rpc('graph/versionSave', { name: NAME, note: '第一版' })
  await session.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })
  await session.evaluate(clickTestId('wl-hub-open'))
  await waitFor(session, exists('wl-hub-workflows'))
  await session.evaluate(clickTestId('wl-hub-workflows'))
  await waitFor(session, `document.querySelector(${JSON.stringify(hubRow(NAME))}) !== null`)
  await session.evaluate(`document.querySelector(${JSON.stringify(hubRow(NAME))}).click()`)
  await waitFor(session, exists('wl-hub-wf-export'))
  pass('工作流页：标题栏有「导出」，左栏有「导入」')

  // 把包拖到这一页上：宿主那层「拖动到此处即可添加」不出现，放下直接进导入。
  // 区域外的拖动照旧弹遮罩（对照），放下后遮罩收掉，宿主不会卡在拖动状态。
  const overlay = `!!document.body.querySelector(':scope > div[role=status]')`
  const fireDrag = (target, type) =>
    session.evaluate(`(() => {
      const el = ${target}
      const data = new DataTransfer()
      data.items.add(new File(['x'], 'a.wflite.zip'))
      el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, dataTransfer: data }))
    })()`)
  const inside = `document.querySelector('[data-wl-file-drop]')`
  const outside = `document.querySelector('[data-testid="wl-hub-open"]') ?? document.body`
  await fireDrag(outside, 'dragenter')
  await sleep(150)
  check(await session.evaluate(overlay), '区域外拖进文件，宿主应弹遮罩（对照）')
  await fireDrag(outside, 'dragleave')
  await sleep(150)
  check(!(await session.evaluate(overlay)), '拖出去遮罩应收掉')
  await fireDrag(inside, 'dragenter')
  await sleep(150)
  check(!(await session.evaluate(overlay)), '拖在导入区域里，宿主的遮罩不该出现')
  await fireDrag(outside, 'dragenter')
  await fireDrag(inside, 'drop')
  await waitFor(session, exists('wl-pack-import'))
  check(!(await session.evaluate(overlay)), '放在区域里之后遮罩应收掉')
  // 假包会被拒（传上去在检查时），等它不忙了再退出。
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-pack-back"]')?.disabled === false`,
    {
      timeoutMs: 30_000,
    },
  )
  await session.evaluate(clickTestId('wl-pack-back'))
  await waitFor(session, exists('wl-hub-wf-export'))
  pass('拖到页面上：宿主遮罩不出现、放下进导入、遮罩不卡住')

  // 1) 导出第一步：v1 缺省勾上（和现在一样），没有「没存成版本」的提醒。
  await session.evaluate(clickTestId('wl-hub-wf-export'))
  await waitFor(session, exists('wl-pack-ver-1'))
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-pack-ver-1"] input').checked === true`,
    ),
    'v1 应缺省勾上',
  )
  check(await session.evaluate(gone('wl-pack-unsaved')), '现在的内容就是 v1，不该提醒没存')
  await screenshot(session, 'pack-01-versions.png')
  pass('导出：选版本（缺省带现在这一版）')

  // 2) 第二步：外部资源清单只有 Skill / 文件 / 文件夹三类，文件和 skill 缺省勾上；
  //    分类行点一下展开 / 收起，开关另管打不打包，互不牵连。
  await session.evaluate(clickTestId('wl-pack-next'))
  await waitFor(session, exists('wl-pack-cat-file'))
  for (const gone_ of ['url', 'text', 'assets'])
    check(await session.evaluate(gone(`wl-pack-cat-${gone_}`)), `清单里不该有「${gone_}」一类`)
  const fileCat = await session.evaluate(textOf('wl-pack-cat-file'))
  check(fileCat.includes('spec.md'), `文件一类应列出 spec.md：${fileCat}`)
  if (skill !== undefined) {
    const skillCat = await session.evaluate(textOf('wl-pack-cat-skill'))
    check(skillCat.includes(skill), `Skill 一类应列出 ${skill}：${skillCat}`)
  }
  const attr = (id, name) =>
    `document.querySelector('[data-testid="${id}"]')?.getAttribute(${JSON.stringify(name)})`
  check(
    (await session.evaluate(attr('wl-pack-cat-file-switch', 'aria-checked'))) === 'true',
    '文件开关缺省开',
  )
  check(
    (await session.evaluate(attr('wl-pack-cat-file-toggle', 'aria-expanded'))) === 'true',
    '有内容的分类缺省展开',
  )
  await session.evaluate(clickTestId('wl-pack-cat-file-toggle'))
  await waitFor(session, `${attr('wl-pack-cat-file-toggle', 'aria-expanded')} === 'false'`)
  check(
    (await session.evaluate(attr('wl-pack-cat-file-switch', 'aria-checked'))) === 'true',
    '收起不该动开关',
  )
  await session.evaluate(clickTestId('wl-pack-cat-file-toggle'))
  await waitFor(session, `${attr('wl-pack-cat-file-toggle', 'aria-expanded')} === 'true'`)

  // 触发器：两张卡片缺省都带，密钥、脚本数据缺省不带；有跑命令的卡片，触发脚本整个带上。
  await waitFor(session, exists('wl-pack-cat-triggers'))
  const cardRow = (label) =>
    `[...document.querySelectorAll('[data-testid="wl-pack-trigger"]')].find((el) => el.textContent.includes(${JSON.stringify(label)}))`
  const secretsRow = `document.querySelector('[data-testid="wl-pack-trigger-secrets"]')`
  const dataRow = `document.querySelector('[data-testid="wl-pack-trigger-data"]')`
  const box = (row) => `(${row})?.querySelector('input')`
  const scriptsText = textOf('wl-pack-trigger-scripts')
  check(
    (await session.evaluate(
      `document.querySelectorAll('[data-testid="wl-pack-trigger"]').length`,
    )) === 2,
    '两张触发卡片各占一行',
  )
  check(
    (await session.evaluate(
      `${box(cardRow('收件'))}?.checked && ${box(cardRow('夜巡'))}?.checked`,
    )) === true,
    '触发卡片缺省都带',
  )
  check((await session.evaluate(`${box(secretsRow)}?.checked`)) === false, '密钥缺省不带')
  check((await session.evaluate(`${box(dataRow)}?.checked`)) === false, '脚本数据缺省不带')
  check(
    (await session.evaluate(scriptsText)).includes('整个带上'),
    '有跑命令的卡片，触发脚本应带上',
  )
  // 不带跑命令的那张：触发脚本跟着不带，它的密钥也勾不了；再带回来。
  await session.evaluate(`${box(cardRow('收件'))}.click()`)
  await waitFor(session, `${scriptsText}.includes('不带')`)
  check((await session.evaluate(`${box(secretsRow)}.disabled`)) === true, '卡片不带时密钥勾不了')
  await session.evaluate(`${box(cardRow('收件'))}.click()`)
  await waitFor(session, `${scriptsText}.includes('整个带上')`)
  // 勾上密钥：写明是明文进包。
  await session.evaluate(`${box(secretsRow)}.click()`)
  await waitFor(session, `(${secretsRow}).textContent.includes('明文')`)
  pass('导出：触发器一类（卡片缺省都带，密钥、数据缺省不带，脚本跟着跑命令的卡片走）')
  await screenshot(session, 'pack-02-resources.png')
  pass(
    `导出：外部资源清单（文件${skill === undefined ? '' : ` + skill ${skill}`}，分类展开收起、开关独立）`,
  )

  // 3) 导出：下载下来，回到版本页带一句结果。
  await session.evaluate(clickTestId('wl-pack-do-export'))
  await waitFor(session, exists('wl-pack-notice'), { timeoutMs: 30_000 })
  const zip = await waitDownload()
  check((await stat(zip)).size > 0, '下载的包不该是空的')
  check((await session.evaluate(textOf('wl-pack-notice'))).includes('.wflite.zip'), '应说导出了')
  const packed = unzipSync(new Uint8Array(await readFile(zip)))
  // 包里整个放在以工作流名命名的一层目录下。
  const packedNames = Object.keys(packed).map((name) => name.slice(NAME.length + 1))
  for (const want of [
    'assets/triggers/inbox/tick.mjs',
    'assets/triggers/inbox/secrets/token.txt',
  ]) {
    check(packedNames.includes(want), `包里应有 ${want}：${packedNames.join(', ')}`)
  }
  check(
    !packedNames.some((name) => name.startsWith('assets/triggers/inbox/data/')),
    `没勾脚本数据，包里不该有：${packedNames.join(', ')}`,
  )
  const packedCards = JSON.parse(
    strFromU8(packed[`${NAME}/versions/1.json`]),
  ).document.nodes.filter((node) => node.type === 'wfTrigger')
  check(
    packedCards.length === 2 && packedCards.every((node) => node.data.enabled === undefined),
    `包里两张触发卡片都该是关着的：${JSON.stringify(packedCards.map((node) => node.data))}`,
  )
  pass('导出：浏览器下载到 .wflite.zip（触发脚本、勾上的密钥在包里，数据不在，开关都关着）')

  // 结果条右边的 ✕：点了不是一下消失，条在原地淡出（影子没有 testid，带 aria-hidden），放完才没。
  const ghosts = `[...document.querySelectorAll('[aria-hidden="true"][inert]')].filter((el) => el.textContent.includes('.wflite.zip')).length`
  await session.evaluate(clickTestId('wl-pack-notice-close'))
  await sleep(50)
  check((await session.evaluate(gone('wl-pack-notice'))) === true, '点 ✕ 后真的那条应该已经收掉')
  check((await session.evaluate(ghosts)) === 1, '点 ✕ 后应留一份影子淡出，不是一下消失')
  await waitFor(session, `${ghosts} === 0`, { timeoutMs: 3000 })
  pass('结果条：✕ 收掉时淡出，放完才没')

  // 3b) 导出成 skill：换到「Skill」，版本变单选，资源清单之后多一步「Skill 信息」。
  await session.evaluate(clickTestId('wl-hub-wf-export'))
  await waitFor(session, exists('wl-pack-kind-skill'))
  await session.evaluate(clickTestId('wl-pack-kind-skill'))
  await waitFor(session, exists('wl-pack-ver-1'))
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-pack-ver-1"] input').checked === true`,
    ),
    'skill：v1 应缺省选上',
  )
  await session.evaluate(clickTestId('wl-pack-next'))
  await waitFor(session, exists('wl-pack-cat-file'))
  check(
    (await session.evaluate(textOf('wl-pack-do-export'))).includes('下一步'),
    'skill：资源清单底下应是「下一步」',
  )
  check(
    (await session.evaluate(exists('wl-pack-skill-triggers'))) &&
      (await session.evaluate(gone('wl-pack-cat-triggers'))),
    'skill：触发卡片不进 skill，应提醒一句、不列触发器一类',
  )
  await session.evaluate(clickTestId('wl-pack-do-export'))
  await waitFor(session, exists('wl-skill-name'), { timeoutMs: 30_000 })
  const value = (testId) =>
    session.evaluate(`document.querySelector('[data-testid="${testId}"]').value`)
  check(
    (await value('wl-skill-name')) === NAME,
    `名字应按工作流名预填：${await value('wl-skill-name')}`,
  )
  check((await value('wl-skill-desc')).includes(NAME), '描述应预填')
  await setReactInput(session, '[data-testid="wl-skill-name"]', 'Bad_Name')
  await waitFor(session, `document.querySelector('[data-testid="wl-skill-download"]').disabled`)
  await setReactInput(session, '[data-testid="wl-skill-name"]', SKILL)
  await waitFor(session, `!document.querySelector('[data-testid="wl-skill-download"]').disabled`)
  await sleep(400)
  await screenshot(session, 'pack-07-skill-info.png')
  pass('导出成 skill：单选版本 → 资源 → Skill 信息（名字、描述预填，名字不合规矩不让导）')

  // 预览整个包：左边文件树、右边预览（同实例里看文件夹），一打开先看 SKILL.md。
  await session.evaluate(clickTestId('wl-skill-preview'))
  await waitFor(session, exists('wl-skill-doc'))
  await waitFor(session, exists('wl-folder-browser'))
  const entryNames = `[...document.querySelectorAll('[data-testid="wl-skill-doc"] [data-testid="wl-folder-entry"]')].map((el) => el.dataset.name)`
  await waitFor(session, `${entryNames}.includes('SKILL.md')`)
  const rootNames = await session.evaluate(entryNames)
  for (const want of ['assets', 'steps', 'SKILL.md']) {
    check(rootNames.includes(want), `包根应列出 ${want}：${rootNames.join(', ')}`)
  }
  await waitFor(session, `${textOf('wl-folder-file')}.includes('本次执行')`)
  // 头部单独列成元数据（填的名字），不当正文排版
  await waitFor(session, exists('wl-skill-meta'))
  check(
    (await session.evaluate(textOf('wl-skill-meta'))).includes(SKILL),
    'SKILL.md 的元数据应是填的名字',
  )
  check(
    !(await session.evaluate(textOf('wl-folder-file'))).includes('name: '),
    '预览里不该把头部当正文',
  )
  await sleep(400)
  await screenshot(session, 'pack-08-skill-doc.png')
  // 进 steps/，点开一个步骤的任务描述
  await session.evaluate(
    `document.querySelector('[data-testid="wl-skill-doc"] [data-testid="wl-folder-entry"][data-name="steps"]').click()`,
  )
  await waitFor(session, `${entryNames}.includes('a.md')`)
  await session.evaluate(
    `document.querySelector('[data-testid="wl-skill-doc"] [data-testid="wl-folder-entry"][data-name="a.md"]').click()`,
  )
  await waitFor(session, `${textOf('wl-folder-file')}.includes('工作流')`)
  // 旧正文的影子淡出要一会儿（useStage），等它走完再看
  await waitFor(session, gone('wl-skill-meta'), { timeoutMs: 3000 })
  await sleep(400)
  await screenshot(session, 'pack-08b-skill-step.png')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-skill-doc"] button[aria-label="关闭"]').click()`,
  )
  await waitFor(session, gone('wl-skill-doc'))
  pass('导出成 skill：预览整个包（文件树 + 预览，SKILL.md 头部列成元数据）')

  await session.evaluate(clickTestId('wl-skill-download'))
  await waitFor(session, exists('wl-pack-notice'), { timeoutMs: 30_000 })
  const skillZip = await waitDownload(20_000, `${SKILL}.zip`)
  const entries = unzipSync(new Uint8Array(await readFile(skillZip)))
  const paths = Object.keys(entries).sort()
  for (const want of ['SKILL.md', 'steps/a.md', 'assets/spec.md']) {
    check(paths.includes(`${SKILL}/${want}`), `包里应有 ${want}：${paths.join(', ')}`)
  }
  const doc = strFromU8(entries[`${SKILL}/SKILL.md`])
  check(doc.startsWith(`---\nname: ${SKILL}\n`), 'SKILL.md 头部应是填的名字')
  check(doc.includes('`{skill}/steps/a.md`') && !doc.includes(SPEC), '包里的路径应写成 {skill}/…')
  check(
    !paths.some((path) => path.includes('/triggers/')),
    `skill 包里不该有触发脚本：${paths.join(', ')}`,
  )
  pass('导出成 skill：下载 zip（SKILL.md + steps + assets，路径都在包里）')

  // 装到本机，再装一次要先确认覆盖。
  const installOnce = async (overwrite) => {
    await session.evaluate(clickTestId('wl-pack-notice-close'))
    await session.evaluate(clickTestId('wl-hub-wf-export'))
    await waitFor(session, exists('wl-pack-kind-skill'))
    await session.evaluate(clickTestId('wl-pack-kind-skill'))
    await waitFor(session, exists('wl-pack-next'))
    await session.evaluate(clickTestId('wl-pack-next'))
    await waitFor(session, exists('wl-pack-do-export'))
    await session.evaluate(clickTestId('wl-pack-do-export'))
    await waitFor(session, exists('wl-skill-name'), { timeoutMs: 30_000 })
    await setReactInput(session, '[data-testid="wl-skill-name"]', SKILL)
    if (overwrite) await waitFor(session, exists('wl-skill-name-taken'))
    await waitFor(session, `!document.querySelector('[data-testid="wl-skill-install"]').disabled`)
    await session.evaluate(clickTestId('wl-skill-install'))
    if (overwrite) {
      await waitFor(session, exists('wl-skill-overwrite-pop'))
      await sleep(300)
      await screenshot(session, 'pack-09-skill-overwrite.png')
      await session.evaluate(clickTestId('wl-skill-overwrite'))
    }
    await waitFor(session, exists('wl-pack-notice'), { timeoutMs: 30_000 })
    const notice = await session.evaluate(textOf('wl-pack-notice'))
    const at = /已装到 (.+)$/u.exec(notice)?.[1]
    check(at !== undefined, `应说装到了哪：${notice}`)
    return at
  }
  installedAt = await installOnce(false)
  check(
    (await readFile(join(installedAt, 'SKILL.md'), 'utf8')).includes(`name: ${SKILL}`),
    '装到本机的 SKILL.md 应在',
  )
  await writeFile(join(installedAt, 'stale.md'), '旧的')
  check((await installOnce(true)) === installedAt, '覆盖应装在同一处')
  check(
    await stat(join(installedAt, 'stale.md')).then(
      () => false,
      () => true,
    ),
    '覆盖后旧文件应没了',
  )
  await session.evaluate(clickTestId('wl-pack-notice-close'))
  pass('导出成 skill：装到本机；同名的先确认覆盖')

  // 4) 导入同一个包：名字撞了，缺省另存为新名字；资料放到哪写清楚；skill 内容一样跳过。
  await session.evaluate(clickTestId('wl-hub-wf-import'))
  await waitFor(session, exists('wl-pack-pick'))
  await sleep(400) // 等换页的淡入走完
  await screenshot(session, 'pack-03-drop.png')
  await chooseFile(session, zip)
  await waitFor(session, exists('wl-pack-target'), { timeoutMs: 30_000 })
  check(await session.evaluate(exists('wl-pack-mode-new')), '名字撞了应能选另存或并入')
  await setReactInput(session, '[data-testid="wl-pack-name"]', COPY)
  const assets = await session.evaluate(textOf('wl-pack-assets'))
  check(
    assets.includes(`/assets/${COPY}/`) && assets.includes('spec.md'),
    `应写明放到哪：${assets}`,
  )
  if (skill !== undefined) {
    const skills = await session.evaluate(textOf('wl-pack-skills'))
    check(skills.includes('内容一样'), `本机已装的 skill 应是内容一样：${skills}`)
    check(await session.evaluate(gone('wl-pack-trust')), '不装 skill 就不用勾确认')
  }
  const triggerPreview = await session.evaluate(textOf('wl-pack-triggers'))
  check(triggerPreview.includes('2 张触发卡片'), `应写出几张触发卡片：${triggerPreview}`)
  check(await session.evaluate(exists('wl-pack-triggers-secrets')), '带了密钥应写出来')
  check(await session.evaluate(gone('wl-pack-triggers-workspace')), '工作区本机有，不该提醒重选')
  await screenshot(session, 'pack-04-preview.png')
  pass('导入：预览（另存为新名字、资料目标路径、skill 状态、触发卡片与密钥）')

  await confirmImport(session)
  const copied = await rpc('graph/load', { name: COPY })
  const text = JSON.stringify(copied.document)
  check(
    text.includes('{workflow}/spec.md') && !text.includes(SPEC),
    '导入的图应改写成 {workflow}/spec.md',
  )
  const copiedVersions = (await rpc('graph/versions', { name: COPY })).versions
  check(
    copiedVersions.length === 1 && copiedVersions[0].n === 1 && copiedVersions[0].note === '第一版',
    '版本号与说明应保留',
  )
  check(
    await session.evaluate(
      `document.querySelector('[aria-current="true"][data-testid="wl-hub-wf"]')?.dataset.value === ${JSON.stringify(COPY)}`,
    ),
    '导入后应选中新的那张',
  )
  const copiedCards = copied.document.nodes.filter((node) => node.type === 'wfTrigger')
  check(
    copiedCards.length === 2 && copiedCards.every((node) => node.data.enabled === undefined),
    '导入的触发卡片都该是关着的',
  )
  const copiedInbox = cardHome(data, COPY, 'inbox')
  check(
    (await present(join(copiedInbox, 'tick.mjs'))) &&
      (await present(join(copiedInbox, 'secrets', 'token.txt'))) &&
      !(await present(join(copiedInbox, 'data'))),
    '脚本、密钥应落进新工作流的卡片目录，脚本数据不带',
  )
  const plan = await rpc('plan/build', { name: COPY })
  check(plan.plan.includes(`/assets/${COPY}/spec.md`), '计划里应是资料目录下的绝对路径')
  await screenshot(session, 'pack-06-done.png')
  pass('导入：落盘，版本号保留，图里是 {workflow}/…，计划里是绝对路径，触发卡片关着、脚本密钥到位')

  // 5) 并入原来那张（编辑页正开着它）：包里的 v1 路径改成了 {workflow}/…，和本机 v1 不一样，存成 v2；
  //    编辑页按磁盘重新加载，不拿旧图覆盖回去。
  async function mergeBack() {
    await session.evaluate(clickTestId('wl-hub-wf-import'))
    await waitFor(session, exists('wl-pack-pick'))
    await chooseFile(session, zip)
    await waitFor(session, exists('wl-pack-mode-merge'), { timeoutMs: 30_000 })
    await session.evaluate(clickTestId('wl-pack-mode-merge'))
    await waitFor(session, gone('wl-pack-name'))
    await confirmImport(session)
    return session.evaluate(textOf('wl-pack-notice'))
  }
  check((await mergeBack()).includes('新增 1 个版本'), '并入改过路径的版本应新增一版')
  await sleep(1500)
  const merged = await rpc('graph/versions', { name: NAME })
  check(
    merged.versions.length === 2 &&
      merged.versions.find((entry) => entry.n === 2)?.current === true,
    '应多出 v2 且现在就是它',
  )
  const reloaded = JSON.stringify((await rpc('graph/load', { name: NAME })).document)
  check(reloaded.includes('{workflow}/spec.md'), '编辑页不该拿旧图盖回去')
  pass('导入：并入正开着的那张，新增 v2，编辑页重新加载')

  // 6) 同一个包再并一次：和 v2 一样，不再存。
  check((await mergeBack()).includes('没再存'), '并入同样的版本应说没再存')
  check((await rpc('graph/versions', { name: NAME })).versions.length === 2, '不该多出版本')
  pass('导入：重复的版本不再存')

  check(session.errors.length === 0, `页面不该有报错：${JSON.stringify(session.errors)}`)
  console.log('\n✅ 导入导出验收全部通过')
}

const session = await openPage()
try {
  await run(session)
} catch (error) {
  await screenshot(session, 'pack-failure.png').catch(() => {})
  console.error(`\n❌ 第 ${step + 1} 步失败：${error.message}`)
  process.exitCode = 1
} finally {
  for (const name of [NAME, COPY]) await rpc('graph/delete', { name }).catch(() => {})
  await rm(EXT, { recursive: true, force: true })
  await rm(DOWNLOADS, { recursive: true, force: true })
  if (installedAt !== null) await rm(installedAt, { recursive: true, force: true })
  session.close()
}
