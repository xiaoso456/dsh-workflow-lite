/**
 * dsh-workflow-lite — 导出成 skill 前浏览整个包：预览时把编好的包摆进暂存区，前端像看文件夹一样看它。
 *
 * 暂存目录 `<dataDir>/.pack/<token>/` 里：`skill/` 是包本身（和装到本机的那份一样），`body.md` 是 SKILL.md 的正文。
 * SKILL.md 的头部是前端现填的：看它之前带上 `meta`，按它重写 `skill/SKILL.md`。
 * 读文件、列目录、读图都走实例文件夹浏览的那几样（`runs/files.ts`），同样只许往下走、软链指出去的不认。
 * 用完前端 `pack/discard`；没删的跟着暂存区一天后清掉。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pack/skillBrowse
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse } from 'yaml'
import {
  SKILL_PATHS,
  type SkillBrowseRequest,
  type SkillFileResponse,
  type SkillImageRequest,
  type SkillMeta,
  skillDoc,
} from '../../shared/skillPack.ts'
import type { RunDirResponse, RunImageResponse } from '../../shared/wire.ts'
import {
  cleanSub,
  readRunDir,
  readRunFile,
  readRunImage,
  realInside,
  resolveImageRef,
  resolveSelfImage,
} from '../runs/files.ts'
import type { Outcome } from '../store/repository.ts'
import { newStage, stageDir } from './staging.ts'

const PACK_DIR = 'skill'
const BODY = 'body.md'

function missing(): Outcome<never> {
  return {
    ok: false,
    error: { code: 'not_found', message: '这份预览已经清掉了，回上一步重新进来' },
  }
}

/** 把编好的包摆进一个新的暂存目录，回暂存编号。SKILL.md 先按工作流名拼一个头部，看的时候再按填的重写。 */
export async function stageSkill(
  dataDir: string,
  name: string,
  body: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<string> {
  const stage = await newStage(dataDir)
  const root = join(stage.dir, PACK_DIR)
  await writeFile(join(stage.dir, BODY), body)
  const all: [string, Uint8Array | string][] = [
    [SKILL_PATHS.doc, skillDoc({ name, description: '' }, body)],
    ...files,
  ]
  for (const [path, data] of all) {
    const full = join(root, ...path.split('/'))
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, data)
  }
  return stage.token
}

/** 包根、要看的那一份的绝对路径和给人看的路径（`<名>/…`）；编号不对、越界都是错误。 */
async function locate(
  dataDir: string,
  request: SkillBrowseRequest,
): Promise<Outcome<{ stage: string; root: string; full: string; display: string; sub: string }>> {
  const stage = stageDir(dataDir, request.token)
  if (stage === null) return missing()
  const sub = cleanSub(request.sub)
  if (!sub.ok) return sub
  const root = join(stage, PACK_DIR)
  const full = sub.result === '' ? root : resolve(root, ...sub.result.split('/'))
  if (!(await realInside(root, full))) {
    return { ok: false, error: { code: 'invalid_args', message: '只能看包里面的东西' } }
  }
  const head = request.meta?.name || '.'
  const display = sub.result === '' ? head : `${head}/${sub.result}`
  return { ok: true, result: { stage, root, full, display, sub: sub.result } }
}

/** 按前端填的头部重写包根的 SKILL.md（正文是预览时存下的那份）。 */
async function syncDoc(stage: string, root: string, meta: SkillMeta | undefined): Promise<void> {
  if (meta === undefined) return
  let body: string
  try {
    body = await readFile(join(stage, BODY), 'utf8')
  } catch {
    return
  }
  await writeFile(join(root, SKILL_PATHS.doc), skillDoc(meta, body))
}

/** 列包里的一层。 */
export async function skillDir(
  dataDir: string,
  request: SkillBrowseRequest,
): Promise<Outcome<RunDirResponse>> {
  const at = await locate(dataDir, request)
  if (!at.ok) return at
  const { stage, root, full, display, sub } = at.result
  const dir = await readRunDir(full, display, sub)
  if (sub === '' && !dir.exists) return missing()
  // 包根的 SKILL.md 按填的头部重写过再量大小。
  if (sub === '' && request.meta !== undefined) {
    await syncDoc(stage, root, request.meta)
    return { ok: true, result: await readRunDir(full, display, sub) }
  }
  return { ok: true, result: dir }
}

/** YAML 头部：`---` 开头、下一个单独一行的 `---` 结束；解析不了、不是键值就当没有。 */
export function splitHead(text: string): { head: Record<string, unknown>; content: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(text)
  if (match === null) return null
  let head: unknown
  try {
    head = parse(match[1] ?? '')
  } catch {
    return null
  }
  if (head === null || typeof head !== 'object' || Array.isArray(head)) return null
  return {
    head: head as Record<string, unknown>,
    content: text.slice(match[0].length).replace(/^\s*\n/u, ''),
  }
}

/** 读包里的一份；Markdown 带头部的另回解析好的头部与去掉头部的正文。 */
export async function skillFile(
  dataDir: string,
  request: SkillBrowseRequest,
): Promise<Outcome<SkillFileResponse>> {
  const at = await locate(dataDir, request)
  if (!at.ok) return at
  const { stage, root, full, display, sub } = at.result
  if (sub === SKILL_PATHS.doc) await syncDoc(stage, root, request.meta)
  const file: SkillFileResponse = await readRunFile(full, display)
  if (file.kind !== 'markdown' || file.text === undefined) return { ok: true, result: file }
  const split = splitHead(file.text)
  return { ok: true, result: split === null ? file : { ...file, ...split } }
}

/** 读包里的一张图：`src` 按文档所在目录解析，只许落在包里。 */
export async function skillImage(
  dataDir: string,
  request: SkillImageRequest,
): Promise<Outcome<RunImageResponse>> {
  const at = await locate(dataDir, request)
  if (!at.ok) return at
  const { root, full } = at.result
  const image =
    request.src === undefined ? resolveSelfImage(full) : resolveImageRef(root, full, request.src)
  if (!image.ok) return image
  if (!(await realInside(root, image.result.full))) {
    return { ok: false, error: { code: 'invalid_args', message: '只能看包里面的东西' } }
  }
  return readRunImage(image.result.full, image.result.mime)
}
