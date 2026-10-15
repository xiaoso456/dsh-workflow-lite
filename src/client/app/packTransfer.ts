/**
 * dsh-workflow-lite — 工作流包在浏览器与主机之间搬：导出时一块块取回来存成下载，导入时一块块传上去。
 *
 * 一块 {@link PACK_CHUNK_BYTES}（base64 之前），不赌宿主对单条消息的上限。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/packTransfer
 */

import { PACK_CHUNK_BYTES, type PackReadResponse } from '../../shared/pack.ts'
import { fromBase64, toBase64 } from '../model/pack.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'

/** 进度：已经搬了多少、一共多少（字节）。 */
export type Progress = (done: number, total: number) => void

/** 把主机暂存的包取回来；取完（或失败）都让主机删掉暂存。 */
export async function downloadPack(
  rpc: WorkflowLiteRpc,
  token: string,
  total: number,
  progress?: Progress,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let received = 0
  try {
    let offset: number | null = 0
    while (offset !== null) {
      const chunk: PackReadResponse = await rpc.call('pack/read', { token, offset })
      const bytes = fromBase64(chunk.data)
      parts.push(bytes)
      received += bytes.length
      progress?.(received, total)
      offset = chunk.next
    }
  } finally {
    void rpc.call('pack/discard', { token }).catch(() => undefined)
  }
  const out = new Uint8Array(received)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** 交给浏览器存成文件。 */
export function saveFile(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  // 下载是异步开始的：等一会儿再收回地址。
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 把用户选的文件传到主机暂存，回暂存编号。 */
export async function uploadPack(
  rpc: WorkflowLiteRpc,
  file: Blob,
  progress?: Progress,
): Promise<string> {
  let token: string | undefined
  for (let offset = 0; offset < file.size || offset === 0; offset += PACK_CHUNK_BYTES) {
    const slice = new Uint8Array(await file.slice(offset, offset + PACK_CHUNK_BYTES).arrayBuffer())
    const sent: { token: string; received: number } = await rpc.call('pack/upload', {
      ...(token === undefined ? {} : { token }),
      offset,
      data: toBase64(slice),
    })
    token = sent.token
    progress?.(sent.received, file.size)
    if (file.size === 0) break
  }
  return token as string
}
